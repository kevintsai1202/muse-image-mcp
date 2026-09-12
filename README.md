# muse-image-mcp

以 Meta Muse 影像模型提供生圖能力的 MCP server。支援文字生圖、依圖改圖、以及對話式多輪迭代修圖。

## 需求

- Node.js >= 20.12.0
- 一組 Meta Muse API key（於 <https://dev.meta.ai> 後台取得）

## 安裝

### 方式一：本機 clone（目前唯一可用的方式）

```bash
git clone https://github.com/kevintsai1202/muse-image-mcp.git
cd muse-image-mcp
npm install
npm run build
claude mcp add muse-image --scope user --env MUSE_API_KEY=你的key -- node <你 clone 的 muse-image-mcp 路徑>/dist/index.js
```

### 方式二：npx（待本套件上架 npm 後可用）

本套件目前**尚未發佈到 npm**，下列指令在套件上架前會出現 404，請先使用方式一。

```bash
claude mcp add muse-image --scope user --env MUSE_API_KEY=你的key -- npx -y muse-image-mcp
```

裝完要**重開一個新的 session**，`mcp__muse-image__*` 三個工具才會載入。用 `claude mcp list` 確認顯示 `muse-image: ... - Connected`。

## 設定 API key

優先序為 **MCP 設定的 `env` 區塊 > `.env` 檔**。

### 用 MCP 設定的 env 區塊（npx 安裝時的唯一途徑）

見上方 `--env MUSE_API_KEY=你的key`。

### 用 `.env` 檔

server 會依序搜尋下列位置，採用第一個存在的檔案：

1. `<套件根目錄>/.env` — 本機 clone 時最方便
2. `~/.muse-image-mcp/.env` — 經 npx 安裝時使用者唯一可控的位置

```
MUSE_API_KEY=你的key
```

注意 `.env` 不是從你執行 Claude Code 的專案目錄讀取——MCP server 的工作目錄由 client 決定，不適合放設定。`.env` 已列在 `.gitignore`，不會被提交。

### 環境變數

以下變數都可寫在 `.env` 或 MCP 設定的 `env` 區塊。

| 變數 | 必填 | 預設 | 說明 |
|---|---|---|---|
| `MUSE_API_KEY` | 是 | — | API key。缺少時 server 會立刻結束並在 stderr 說明 |
| `MUSE_MODEL` | 否 | `muse-image-1.0` | 全域預設模型 ID |
| `MUSE_EXTRA_PARAMS` | 否 | `{}` | JSON 物件字串，全域預設額外參數 |
| `MUSE_OUTPUT_DIR` | 否 | `<cwd>/generated-images` | 圖片輸出目錄，不存在時自動建立 |
| `MUSE_BASE_URL` | 否 | `https://api.meta.ai/v1` | API base URL |
| `MUSE_TIMEOUT_MS` | 否 | `120000` | 單次請求逾時毫秒數 |

> `MUSE_OUTPUT_DIR` 的預設值 `<cwd>/generated-images` 所指的 `cwd`，是 MCP client 啟動這個 server 時所在的工作目錄。在 Claude Code 中即為你啟動 session 的專案根目錄，因此圖片會落在你目前專案下的 `generated-images/`。若你的 client 不是這個行為、或想要固定的輸出位置，請把 `MUSE_OUTPUT_DIR` 設為絕對路徑。
>
> v0.1.0 起預設輸出目錄由 `muse-output/` 改為 `generated-images/`。舊目錄不會被自動刪除或搬移，如有舊圖請自行處理。

## 切換模型與額外參數

新模型推出時不需要等本專案改版——用環境變數換模型，用 `extra_params` 送新參數。

### 換模型

全域切換寫在 `.env` 或 MCP 設定：

```
MUSE_MODEL=muse-image-2.0
```

單次指定則直接在對話中要求，Agent 會帶 `model` 參數：

```jsonc
{ "prompt": "a red fox", "model": "muse-image-2.0" }
```

### 送新參數

全域預設寫成 JSON 物件字串：

```
MUSE_EXTRA_PARAMS={"quality":"ultra"}
```

單次覆寫用 `extra_params`，會與全域設定合併、單次的優先：

```jsonc
{ "prompt": "a red fox", "extra_params": { "style_preset": "anime" } }
```

### 核心欄位保護

`model`、`prompt`、`response_format`、`images`、`input`、`store`、`previous_response_id` 這些決定請求結構的欄位不會被 `extra_params` 覆寫——寫了也不生效，並且會在回應末端看到：

```
⚠️ 下列 extra_params 與請求核心欄位衝突，已忽略：model, prompt
```

換模型請用 `model` 參數或 `MUSE_MODEL`，不要寫在 `extra_params` 裡。

除上述核心欄位外，`extra_params` 會覆寫同名的一般參數，包含 `n`、`size`、`output_format`、`reasoning_strength`。這些欄位在工具 schema 上的取值驗證（例如 `n` 限 1–10）在此路徑下**不生效**——這是刻意保留的逃生口，讓新模型改變參數語意時仍可繞過既有限制。使用 `extra_params` 覆寫 `n` 時請自行留意張數與成本。

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
| `model` | 否 | — | 模型 ID，省略則用伺服器設定的預設（見 `MUSE_MODEL`） |
| `extra_params` | 否 | — | 物件，傳給 API 的額外參數，與全域 `MUSE_EXTRA_PARAMS` 合併、單次優先；核心欄位受保護（見上方「核心欄位保護」） |

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
| `model` | 否 | — | 模型 ID，省略則用伺服器設定的預設（見 `MUSE_MODEL`） |
| `extra_params` | 否 | — | 物件，傳給 API 的額外參數，與全域 `MUSE_EXTRA_PARAMS` 合併、單次優先；核心欄位受保護（見上方「核心欄位保護」） |

### `iterate_image` — 對話式迭代修圖

| 參數 | 必填 | 說明 |
|---|---|---|
| `prompt` | 是 | 本輪修改指令 |
| `previous_response_id` | 否 | 上一輪回傳的 id；省略代表開新對話 |
| `images` | 否 | 首輪參考圖 |
| `reasoning_strength` | 否 | 預設 `high` |
| `filename_prefix` | 否 | 預設 `muse-iter` |
| `model` | 否 | 模型 ID，省略則用伺服器設定的預設（見 `MUSE_MODEL`） |
| `extra_params` | 否 | 物件，傳給 API 的額外參數，與全域 `MUSE_EXTRA_PARAMS` 合併、單次優先；核心欄位受保護（見上方「核心欄位保護」） |

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
npm run smoke     # 真實 API 煙霧測試，需 MUSE_E2E=1 與真 key，共產生 6 張圖，約花費 US$0.06
```
