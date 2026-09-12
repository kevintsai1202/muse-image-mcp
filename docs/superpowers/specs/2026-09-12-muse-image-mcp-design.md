# muse-image-mcp 設計文件

- **日期**：2026-09-12
- **狀態**：已與開發者確認，待實作
- **目標**：提供一個 MCP server，讓 Claude Code／其他 MCP client 透過 Meta Muse 模型生圖、改圖與多輪迭代修圖

---

## 1. 背景與來源

Meta 於 `dev.meta.ai` 提供 Muse 影像模型的 OpenAI 相容 API。本專案把它包成 stdio MCP server，讓 Agent 可直接呼叫。

官方 API 事實（取自 <https://dev.meta.ai/docs/image-generation>，2026-09-12 讀取）：

| 項目 | 內容 |
|---|---|
| Base URL | `https://api.meta.ai/v1` |
| 認證 | HTTP header `Authorization: Bearer <MODEL_API_KEY>` |
| 模型 ID | `muse-image-1.0` |
| 文字生圖 | `POST /v1/images/generations` |
| 依圖改圖 | `POST /v1/images/edits` |
| 對話式迭代 | `POST /v1/responses` |
| 計價 | 每張生成圖片 US$0.01（與 reasoning_strength、工具使用無關） |

共用參數：

- `prompt`：string，生圖必填
- `n`：1–10，預設 1
- `size`：`"WxH"` 字串（例 `"1792x1024"`）。**文件明述這是長寬比而非精確像素**，實際解析度由生成器決定
- `response_format`：`b64_json` | `url`，預設 `b64_json`
- `output_format`：`webp` | `png` | `jpeg`，預設 `webp`
- `reasoning_strength`：`high`（預設）| `low`
- `tool_enablement`：物件，含 `enable_image_search`、`enable_web_search`、`enable_shell`（皆 boolean）

`/v1/images/edits` 的圖片輸入有兩種路徑：OpenAI SDK 走 `multipart/form-data`；原始 HTTP 走 JSON body 的 `images` 陣列，元素為 `{"image_url": "data:image/webp;base64,..."}`（亦接受公開 URL 或 `file_id`）。

`/v1/responses` 額外參數：`input`（文字或含參考圖的結構化內容陣列）、`previous_response_id`（串接多輪）、`store`（boolean，預設 `true`）。

回應格式：

```json
{
  "created": 1784584435,
  "data": [{ "b64_json": "UklGR..." }],
  "output_format": "webp",
  "usage": { "input_tokens": 0, "output_tokens": 0, "total_tokens": 0 }
}
```

錯誤：HTTP 400 為驗證失敗（`invalid_request_error`），情境包含缺 `prompt`、`n` 超出 1–10、`response_format`／`output_format` 非法、`images` 空或格式錯、工具不支援、審核設定受限。官方文件未列出具體 rate limit 數值。

### 文件未涵蓋、實作時需以實測確認的項目

- `size` 的合法值清單（文件僅給範例，未列舉）→ 設計上以字串原樣傳遞，由 API 端驗證，錯誤訊息原文回傳給 Agent
- mask（局部重繪遮罩）參數 → 文件未提及，本版不支援
- 具體 rate limit 數值 → 以 429 退避重試因應
- `/v1/responses` 回應中圖片資料的確切欄位路徑 → 文件僅給出 `/v1/images/*` 的 `data[].b64_json`；實作 `iterate_image` 時先以煙霧測試打一次真實 API，依實際回應結構撰寫解析，不憑推測

---

## 2. 範圍

### 本版包含

1. `generate_image`：文字生圖
2. `edit_image`：依既有圖片 + 指令改圖
3. `iterate_image`：對話式多輪迭代修圖
4. 圖片落地到本機檔案，工具回傳絕對路徑
5. 環境變數設定與啟動期驗證

### 本版不包含（YAGNI）

- mask 局部重繪（API 未提供）
- `response_format: "url"` 模式（統一走 `b64_json` 落地，避免 Meta 端 URL 過期）
- `tool_enablement`（`enable_image_search` / `enable_web_search` / `enable_shell`）暴露為工具參數 — 全部使用 API 預設值
- 圖片後處理（縮圖、浮水印、格式轉換）
- 遠端部署形態（HTTP／SSE transport），本版僅 stdio
- 生成紀錄資料庫或成本統計持久化

---

## 3. 技術決策

### 3.1 HTTP client：自寫薄 fetch 封裝，不使用 openai SDK

**決策**：以 Node 內建 `fetch` 自寫 `muse-client.ts`。

**理由**：

- 三個端點都可用純 JSON body（`edits` 接受 `images: [{image_url}]` 的 data URL 形式），完全不需要 multipart，openai SDK 最大的價值用不到
- Muse 專有欄位（`reasoning_strength`、`tool_enablement`）不在 OpenAI SDK 型別內，用 SDK 需一路 `as any`，反而喪失型別安全
- `/v1/responses` 的 Muse 語意與 OpenAI Responses API 不完全相同，SDK 型別會誤導
- 少一個約 10MB 的依賴，MCP server 啟動更快

**代價**：retry 與逾時需自行實作（約 40 行，已納入設計與測試）。

### 3.2 `iterate_image` 為 stateless

**決策**：MCP server 不維護任何 conversation state。

**理由**：`/v1/responses` 在 `store: true`（預設）時由 Meta 端保存對話，`previous_response_id` 即完整的續接憑證。因此工具只需把 `response_id` 當回傳值交給 Agent，下一輪由 Agent 帶回來。Server 端不需要 session map，消除記憶體成長、併發競態與跨程序失效三類問題。

### 3.3 圖片輸出：落地檔案 + 回傳路徑

**決策**：所有生成圖片一律寫入本機目錄，工具回傳絕對路徑，**不**回傳 MCP `ImageContent`。

**理由**：base64 圖片進入對話 context 的 token 成本極高（一張 1792x1024 webp 動輒數百 KB）。落地後 Agent 需要「看」圖時，可用既有的 Read 工具讀取指定路徑，由呼叫端決定何時付這個成本。

---

## 4. 架構

```
muse-image-mcp/
├─ src/
│  ├─ index.ts          MCP server 進入點：註冊 3 個 tool、接上 stdio transport
│  ├─ config.ts         環境變數讀取與驗證（啟動期 fail fast）
│  ├─ muse-client.ts    Muse API 薄封裝：generations / edits / responses + retry
│  ├─ image-store.ts    base64 → 落地檔案、檔名規則、目錄建立
│  ├─ errors.ts         HTTP 狀態碼 / Meta 錯誤 → Agent 可讀訊息的映射
│  └─ types.ts          共用型別定義
├─ tests/               vitest 單元測試
├─ scripts/
│  └─ smoke-test.ts     真實 API 煙霧測試（需 MUSE_E2E=1 + 真 key）
├─ docs/superpowers/specs/
├─ .env.example
├─ .gitignore
├─ README.md
├─ package.json
└─ tsconfig.json
```

### 模組邊界

| 模組 | 職責 | 依賴 | 不做什麼 |
|---|---|---|---|
| `config.ts` | 讀取並驗證環境變數，產出凍結的 `Config` 物件 | 無 | 不碰網路、不碰檔案 |
| `muse-client.ts` | 組 request body、送 HTTP、解析回應、retry | `config`、`errors` | **不碰檔案系統** |
| `image-store.ts` | base64 解碼、決定檔名、建目錄、寫檔 | `config` | **不碰網路** |
| `errors.ts` | 錯誤分類與訊息生成 | 無 | 不決定是否重試（由 client 依分類決定） |
| `index.ts` | 參數驗證（zod）、編排 client + store、格式化回應 | 全部 | 不含業務邏輯細節 |

此邊界讓 `muse-client` 可用 fetch mock 完整測試，`image-store` 可用暫存目錄完整測試，兩者互不干擾。

本機圖片路徑讀檔與轉 data URL 的職責歸 `image-store.ts`（它是唯一碰檔案系統的模組），`index.ts` 先呼叫它把 `images` 參數正規化為 data URL／http URL 陣列，再交給 `muse-client`。

---

## 5. 工具介面

### 5.1 `generate_image`

文字生圖。

| 參數 | 型別 | 必填 | 預設 | 說明 |
|---|---|---|---|---|
| `prompt` | string | 是 | — | 圖片描述 |
| `n` | integer 1–10 | 否 | 1 | 生成張數 |
| `size` | string | 否 | 不傳 | **長寬比**字串，例 `1792x1024`、`1024x1536`。非精確像素 |
| `output_format` | `png`\|`webp`\|`jpeg` | 否 | `png` | 覆寫 API 預設的 `webp`，png 相容性較佳 |
| `reasoning_strength` | `high`\|`low` | 否 | `high` | |
| `filename_prefix` | string | 否 | `muse` | 檔名前綴，需為安全檔名字元 |

工具描述中必須寫明：`size` 是長寬比不是解析度；每張圖成本 US$0.01。

### 5.2 `edit_image`

依既有圖片 + 指令改圖。

| 參數 | 型別 | 必填 | 預設 | 說明 |
|---|---|---|---|---|
| `prompt` | string | 是 | — | 修改指令 |
| `images` | string[] | 是 | — | 本機絕對／相對路徑，或 `http(s)://` URL。至少 1 個 |
| `n` | integer 1–10 | 否 | 1 | |
| `size` | string | 否 | 不傳 | 同上 |
| `output_format` | `png`\|`webp`\|`jpeg` | 否 | `png` | |
| `reasoning_strength` | `high`\|`low` | 否 | `high` | |
| `filename_prefix` | string | 否 | `muse-edit` | |

本機路徑由 server 讀檔、依副檔名推導 MIME、轉為 `data:<mime>;base64,<...>`；`http(s)` URL 原樣傳給 API。Agent 不需自行做 base64。

### 5.3 `iterate_image`

對話式多輪修圖，走 `/v1/responses`。

| 參數 | 型別 | 必填 | 預設 | 說明 |
|---|---|---|---|---|
| `prompt` | string | 是 | — | 本輪指令 |
| `previous_response_id` | string | 否 | — | 上一輪回傳的 id；省略代表開新對話 |
| `images` | string[] | 否 | — | 首輪參考圖，路徑或 URL |
| `reasoning_strength` | `high`\|`low` | 否 | `high` | |
| `filename_prefix` | string | 否 | `muse-iter` | |

回傳**必須**包含 `response_id`，並在文字中明示「下一輪修改請帶入此 id」。

### 5.4 共同回傳格式

工具回傳 MCP `TextContent`，內容為：

```
已生成 2 張圖片：
1. D:\GitHub\muse-image-mcp\muse-output\fox-20260912-141530-1.png
2. D:\GitHub\muse-image-mcp\muse-output\fox-20260912-141530-2.png

用量：input_tokens=12 output_tokens=1830 total_tokens=1842
預估成本：US$0.02（2 張 x $0.01）
```

`iterate_image` 額外附加一行：

```
response_id: resp_xxxxx（下一輪修改請帶入 previous_response_id）
```

---

## 6. 設定

| 環境變數 | 必填 | 預設 | 說明 |
|---|---|---|---|
| `MUSE_API_KEY` | **是** | — | Meta 後台取得的 API key |
| `MUSE_OUTPUT_DIR` | 否 | `<cwd>/muse-output` | 圖片輸出目錄，不存在時自動建立 |
| `MUSE_BASE_URL` | 否 | `https://api.meta.ai/v1` | 可指向 mock server 供測試 |
| `MUSE_TIMEOUT_MS` | 否 | `120000` | 單次請求逾時（生圖較慢，預設 2 分鐘） |

### 6.1 `.env` 檔支援（2026-09-12 追加）

開發者要求把 `MUSE_API_KEY` 放在專案根目錄的 `.env`，而非只靠 MCP 設定的 `env` 區塊。

**實作方式**：使用 Node 內建的 `process.loadEnvFile()`，**不引入 dotenv 套件**。已於 Node v24.15.0 實測確認三項行為：

| 行為 | 實測結果 | 設計採用 |
|---|---|---|
| API 可用性 | `typeof process.loadEnvFile === "function"` | 直接使用，零依賴 |
| 與既有環境變數的優先序 | **既有的環境變數勝出**，不會被 `.env` 覆寫 | 正是所需的優先序：MCP 設定的 `env` > `.env` 檔 |
| 檔案不存在 | 拋出 `ENOENT` | 必須 try/catch 吞掉，因為只用 MCP `env` 設定 key 也是合法用法 |

**`.env` 的位置**：解析為**套件根目錄**（相對於 `import.meta.url` 上溯一層），**不是** `process.cwd()`。理由：MCP server 的 cwd 由 client 決定，通常是使用者當下的專案目錄而非本 server 的目錄，用 cwd 會找不到檔案。編譯後檔案在 `<root>/dist/config.js`、測試時在 `<root>/src/config.ts`，兩者上溯一層都得到 `<root>`。

**Node 版本下限因此提高到 `>=20.12.0`**（`process.loadEnvFile` 的導入版本）。

**設定來源優先序**：MCP client 傳入的 `env` > 套件根目錄的 `.env` > 程式內建預設值。

**啟動期行為**：先嘗試載入 `.env`（失敗則靜默略過），再讀取環境變數。缺少 `MUSE_API_KEY` 時，在 stderr 印出明確的設定教學後 `process.exit(1)`。MCP server 最難查的故障就是靜默失敗，必須大聲失敗。

**安全**：key 只從環境變數或 `.env` 讀取，不寫入程式碼、不寫入 git、不寫入對話紀錄。`.gitignore` 必須在 `.env` 出現之前就排除 `muse-output/`、`.env`、`node_modules/`、`dist/`。README 提供 `claude mcp add` 設定範本與 `.env` 用法，key 由開發者自行填入。

---

## 7. 錯誤處理

| 情境 | 分類 | 是否重試 | 給 Agent 的訊息 |
|---|---|---|---|
| HTTP 400 驗證錯 | `invalid_request` | 否 | **原樣帶回 Meta 的 `error.message`** — 這是 Agent 自我修正的唯一依據，絕不可吞掉或改寫 |
| 內容審核拒絕 | `moderation` | 否 | 明確標示為審核問題，建議調整 prompt。重試只是重複燒錢 |
| HTTP 401 / 403 | `auth` | 否 | key 無效或過期，提示到 Meta 後台確認 |
| HTTP 429 | `rate_limit` | 是 | 指數退避 1s / 2s / 4s，最多 3 次 |
| HTTP 5xx | `server` | 是 | 同上 |
| 網路錯誤 / 逾時 | `network` | 是 | 同上 |
| 本機圖片不存在或不可讀 | `input` | 否 | 指出是哪一個路徑、以及 cwd 為何 |
| 寫檔失敗 | `io` | 否 | 回報目標目錄與 errno，**不可靜默遺失已付費的生成結果** |

重試由 `muse-client` 依 `errors.ts` 的分類決定，分類邏輯本身不含重試策略（單一職責）。

---

## 8. 測試策略

採 TDD：先寫測試，再寫實作。

| 測試對象 | 方式 | 覆蓋重點 |
|---|---|---|
| `config` | 直接呼叫 + 暫存 `.env` 檔 | 缺 `MUSE_API_KEY` 拋明確錯誤；各預設值正確；`MUSE_BASE_URL` 可覆寫；`.env` 能被載入；`.env` 不存在時不拋錯；既有環境變數優先於 `.env` |
| `errors` | 直接呼叫 | 各 HTTP 狀態碼 → 正確分類與 `retryable` 旗標；400 的 `error.message` 原文保留 |
| `muse-client` | mock `globalThis.fetch` | 三端點 request body 組裝正確（含選填參數的省略行為）；401 不重試；429 重試 3 次後拋錯；逾時觸發 abort |
| `image-store` | 暫存目錄 | base64 正確解碼落地；副檔名對應 `output_format`；檔名含時間戳與序號；目錄自動建立；`filename_prefix` 的不安全字元被清理；本機路徑轉 data URL 正確、不存在時拋 `input` 類錯誤 |
| `index` 工具層 | mock client + store | 參數驗證（`n` 超範圍、`images` 空陣列）；回傳文字格式；`iterate_image` 必帶 `response_id` |
| 真實 API | `scripts/smoke-test.ts` | 需 `MUSE_E2E=1` + 真 key 才執行，每次約 US$0.01。**不進 CI** |

測試框架：vitest。

---

## 9. 實作順序（供 writing-plans 展開）

1. 專案骨架：`package.json`、`tsconfig.json`、vitest 設定、`.gitignore`、`.env.example`
2. `types.ts` + `config.ts`（含測試）
3. `errors.ts`（含測試）
4. `muse-client.ts`（含測試，fetch mock）
5. `image-store.ts`（含測試，暫存目錄）
6. `index.ts` 三個工具與 stdio transport（含測試）
7. `scripts/smoke-test.ts` + README + `claude mcp add` 設定說明
8. 實跑驗證：build 通過、單元測試全綠、（若開發者提供 key）煙霧測試實際產出一張圖

---

## 10. 完成定義

- `npm run build` 無錯
- `npm test` 全綠
- README 說明如何取得 key、如何用 `claude mcp add` 安裝、三個工具的用法範例
- 開發者能在新 session 看到 `mcp__muse-image__*` 三個工具並成功生出一張圖
