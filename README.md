# muse-image-mcp

以 Meta Muse 影像模型提供生圖能力的 MCP server。支援文字生圖、依圖改圖、以及對話式多輪迭代修圖。

## 需求

- Node.js >= 20.12.0
- 一組 Meta Muse API key（於 <https://dev.meta.ai> 後台取得）

## 安裝

```bash
npm install
npm run build
```

## 設定 API key

有兩種方式，**優先序為 MCP 設定的 `env` > `.env` 檔**：

### 方式一：`.env` 檔（推薦）

在**本專案根目錄**建立 `.env`（可複製 `.env.example`）：

```
MUSE_API_KEY=你的key
```

注意 `.env` 是從**套件根目錄**讀取，不是從你執行 Claude Code 的專案目錄——因為 MCP server 的工作目錄由 client 決定，不可靠。`.env` 已列在 `.gitignore`，不會被提交。

### 方式二：MCP 設定的 env 區塊

```bash
claude mcp add muse-image node <你的專案路徑>\dist\index.js \
  --scope user \
  --env MUSE_API_KEY=你的key
```

> 將 `<你的專案路徑>` 換成你實際 clone 這個專案的位置（例如 `D:\GitHub\muse-image-mcp`）。

## 設定到 Claude Code

用了 `.env` 的話，註冊時就不必再帶 key：

```bash
claude mcp add muse-image node <你的專案路徑>\dist\index.js --scope user
```

同樣把 `<你的專案路徑>` 換成實際 clone 位置。

裝完要**重開一個新的 session**，`mcp__muse-image__*` 三個工具才會載入。用 `claude mcp list` 確認顯示 `muse-image: ... - Connected`。

### 環境變數

以下變數都可寫在 `.env` 或 MCP 設定的 `env` 區塊。

| 變數 | 必填 | 預設 | 說明 |
|---|---|---|---|
| `MUSE_API_KEY` | 是 | — | API key。缺少時 server 會立刻結束並在 stderr 說明 |
| `MUSE_OUTPUT_DIR` | 否 | `<cwd>/muse-output` | 圖片輸出目錄，不存在時自動建立 |
| `MUSE_BASE_URL` | 否 | `https://api.meta.ai/v1` | API base URL |
| `MUSE_TIMEOUT_MS` | 否 | `120000` | 單次請求逾時毫秒數 |

> `MUSE_OUTPUT_DIR` 的預設值 `<cwd>/muse-output` 所指的 `cwd`，是 **MCP client 啟動這個 server 時所在的工作目錄**——如同上方 `.env` 一節所說，這個目錄由 client 決定、不可靠，多半不是本專案目錄。也就是說圖片實際會落在「啟動 server 當下 client 的工作目錄」下的 `muse-output/`。如果想要固定的輸出位置，請明確設定 `MUSE_OUTPUT_DIR` 為絕對路徑。

## 工具

所有工具都把圖片存到本機並回傳**絕對路徑**，不回傳圖片內容本身——這是為了避免 base64 佔用大量對話 context。需要看圖時用檔案讀取工具開啟該路徑即可。

### `generate_image` — 文字生圖

| 參數 | 必填 | 預設 | 說明 |
|---|---|---|---|
| `prompt` | 是 | — | 圖片描述 |
| `n` | 否 | 1 | 生成張數，1–10 |
| `size` | 否 | — | **長寬比**字串如 `1792x1024`，非精確像素解析度 |
| `output_format` | 否 | `png` | `png` / `webp` / `jpeg` |
| `reasoning_strength` | 否 | `high` | `high` / `low`，計價相同 |
| `filename_prefix` | 否 | `muse` | 輸出檔名前綴 |

### `edit_image` — 依圖改圖

| 參數 | 必填 | 預設 | 說明 |
|---|---|---|---|
| `prompt` | 是 | — | 圖片描述 |
| `images` | 是 | — | 本機檔案路徑（png/jpg/jpeg/webp/gif）或 http(s) 網址的陣列。本機檔案會自動轉成 base64 |
| `n` | 否 | 1 | 生成張數，1–10 |
| `size` | 否 | — | **長寬比**字串如 `1792x1024`，非精確像素解析度 |
| `output_format` | 否 | `png` | `png` / `webp` / `jpeg` |
| `reasoning_strength` | 否 | `high` | `high` / `low`，計價相同 |
| `filename_prefix` | 否 | `muse-edit` | 輸出檔名前綴 |

### `iterate_image` — 對話式迭代修圖

| 參數 | 必填 | 說明 |
|---|---|---|
| `prompt` | 是 | 本輪修改指令 |
| `previous_response_id` | 否 | 上一輪回傳的 id；省略代表開新對話 |
| `images` | 否 | 首輪參考圖 |
| `reasoning_strength` | 否 | 預設 `high` |
| `filename_prefix` | 否 | 預設 `muse-iter` |

注意此工具**沒有** `n`、`size`、`output_format` 參數——`/v1/responses` 端點一次只回傳一張圖，且不接受輸出格式參數（見下方「`/v1/responses` 實測結果」，未指定時 Meta 端預設輸出 webp）。

回應**一定包含 `response_id`**。下一輪把它填進 `previous_response_id` 即可延續同一段對話。本 server 不保存任何對話狀態，對話由 Meta 端保存。

## `/v1/responses` 實測結果

Meta 未公開 `/v1/responses` 的回應 schema，Task 3 實作時是比照 OpenAI Responses 慣例的推測。Task 6 以真實 API 呼叫（`iterate_image`）驗證後，實際結構如下：

```json
{
  "model": "muse-image-1.0",
  "id": "resp_6aa4c23f99592ae0ac454928",
  "object": "response",
  "status": "completed",
  "output": [
    { "type": "reasoning", "summary": [{ "type": "summary_text", "text": "..." }] },
    { "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": "" }] },
    { "type": "image_generation_call", "id": "ig_...", "status": "completed", "result": "<base64 圖片資料>" }
  ]
}
```

與推測形狀的差異：

- **`id` 取值路徑**：`raw.id` 猜對了，實測確認正確，無需修改。
- **圖片資料位置**：不在任何 `b64_json` 欄位，而是在 `output[]` 陣列中 `type === "image_generation_call"` 項目的 `result` 欄位，值直接是 base64（無 data URL 前綴）。`src/muse-client.ts` 的 `extractB64Images` 已改為同時辨識 `b64_json`（保留給其他可能形狀）與這個實測到的 `image_generation_call.result` 形狀。
- **`output_format` 欄位不存在**：回應中完全沒有 `output_format` 欄位。原本的 fallback 預設值 `"png"`是錯的——iterate 因為送出的 request 不帶 `output_format` 參數，Meta 端套用了與 `/images/generations` 相同的預設值 `webp`，實測回傳的 base64 解出來確實是 WebP 格式（RIFF/WEBP 檔頭）。fallback 已改為 `"webp"`。

### 多輪對話（`previous_response_id`）已實測驗證

Task 7 以真實 API 做了兩輪對話：先呼叫一次 `iterate_image` 取得 `response_id`，再用該 id 當 `previous_response_id` 呼叫第二輪。結果：第二輪只回傳當輪新生成的 **1 張圖片**，並未把第一輪已經生成過的圖片也重複帶回來——`extractB64Images` 的深度走訪邏輯對此無需修改。（受限於測試工具在該次執行中未能完整擷取第二輪原始回應的逐位元組內容，這個結論是以「輸出檔案數量剛好 1 個、無 -2/-3 等後續序號」的檔案系統證據佐證，而非逐位元組比對；`tests/muse-client.test.ts` 中新增的 pinning test 沿用 Task 6 已驗證的真實回應形狀來釘住這個行為。）

## 計價

每張生成圖片 **US$0.01**，與 `reasoning_strength` 無關。每次工具回應都會揭露該次的預估成本。

## 開發

```bash
npm test          # 單元測試（不會打真實 API）
npm run build     # 編譯到 dist/
npm run smoke     # 真實 API 煙霧測試，需 MUSE_E2E=1 與真 key，共產生 4 張圖，約花費 US$0.04
```
