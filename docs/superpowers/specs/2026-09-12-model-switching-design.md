# muse-image-mcp 模型切換與參數擴充設計

**日期：** 2026-09-12
**狀態：** 已定案，待實作
**前置：** [2026-09-12-muse-image-mcp-design.md](2026-09-12-muse-image-mcp-design.md)（初版設計）

## 1. 背景與問題

初版 muse-image-mcp 把模型 ID 硬編為 `src/muse-client.ts` 的模組常數 `MODEL = "muse-image-1.0"`，並在 `generate` / `edit` / `iterate` 三個方法各自塞進 request body。參數則由 `src/types.ts` 的固定欄位 interface 定義。

這造成兩個問題：

1. **換不了模型。** Meta 推出新版影像模型時，使用者無法切換，必須等本專案改程式碼重發版。
2. **加不了參數。** 新模型若帶來專屬參數（例如 `quality`、`style_preset`），現行架構必須同時改 `types.ts`、`muse-client.ts` 的 body 建構、`tools.ts` 的 zod schema 三處才送得出去。

同時，本專案準備發佈到 GitHub 公開，既有的兩項設定路徑設計在「被別人安裝」的情境下會失效，一併在本次處理。

## 2. 目標與非目標

### 目標

- 模型可透過環境變數設全域預設，也可在單次工具呼叫時覆寫。
- 未知的新參數不必改程式碼即可送達 API，同樣支援全域預設與單次覆寫。
- 決定請求結構的核心欄位不得被擴充參數破壞。
- 專案調整到可被他人安裝使用的狀態，並發佈到 GitHub。

### 非目標

- **不做模型能力 registry。** 不預先描述各模型支援哪些參數——我們無從得知未來模型的形狀，猜測出來的表必定失準，且會使「新模型免改程式碼」的目標落空。
- **不執行 `npm publish`。** 本次僅備妥發佈條件並推上 GitHub，是否上架 npm 由使用者自行決定。
- **不動 e2e 煙霧測試。** 該測試呼叫真實 API 需付費，而本次改動集中在 request body 建構層，單元測試即可完整涵蓋。

## 3. 關鍵決策

| 決策 | 選定 | 理由 |
|---|---|---|
| 模型選擇方式 | env 預設 + 工具參數覆寫 | 日常不需干預；需要 A/B 比較時可單次指定 |
| 新參數擴充方式 | env 預設 + 工具參數覆寫 | 與模型選擇同一套心智模型；新參數零改版即可用 |
| 撞名時的優先序 | 擴充參數贏，核心欄位受保護 | 保留逆向相容的逃生口，同時確保請求結構不被破壞 |
| 合併邏輯位置 | 抽出獨立模組 `src/request-body.ts` | 規則單一來源；三個 endpoint 行為天生一致；可純函式測試 |
| 授權與可見性 | MIT / Public / `kevintsai1202` | npm 生態最通用、限制最少 |

## 4. 設定層

`src/config.ts` 的 `Config` 介面新增兩個欄位，來源為兩個新環境變數。

| 變數 | 必填 | 預設 | 說明 |
|---|---|---|---|
| `MUSE_MODEL` | 否 | `muse-image-1.0` | 全域預設模型 ID。空字串或全空白視同未設定，與既有 `MUSE_OUTPUT_DIR` 的處理一致 |
| `MUSE_EXTRA_PARAMS` | 否 | `{}` | JSON 物件字串，全域預設額外參數 |

```ts
export interface Config {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  outputDir: string;
  model: string;                          // 新增
  extraParams: Record<string, unknown>;   // 新增
}
```

### `MUSE_EXTRA_PARAMS` 的解析規則

採 fail fast，與既有 `MUSE_API_KEY` 缺漏的處理一致：

| 輸入 | 行為 |
|---|---|
| 未設定、空字串、全空白 | 視為 `{}` |
| 合法 JSON 物件 | 解析後採用 |
| 非法 JSON | 擲出設定錯誤，server 啟動失敗並印出中文說明 |
| 合法 JSON 但非物件（陣列／數字／字串／`null`） | 同上，擲出設定錯誤 |

靜默忽略錯誤設定會使參數無聲消失，除錯成本極高，因此一律在啟動時擋下。

### 一併處理的發佈前調整

**`.env` 搜尋鏈**改為依序尋找，第一個存在者生效：

1. `<套件根>/.env` — 本機 clone 的既有用法，維持不變
2. `~/.muse-image-mcp/.env` — 經 npx 安裝時使用者唯一可控的固定位置

MCP 設定的 `env` 區塊仍永遠優先於 `.env`（現況不變）。`loadDotEnvFile()` 的回傳型別由 `boolean` 改為「實際載入的路徑或 `null`」，使啟動訊息與錯誤訊息能指出 key 的來源。`loadConfig()` 缺 key 時的錯誤訊息須列出完整搜尋鏈。

**預設輸出目錄**由 `<cwd>/muse-output` 改為 `<cwd>/generated-images`。維持專案相對路徑——在 Claude Code 情境下 cwd 即使用者的專案根目錄，圖片留在專案下最易尋找；僅將目錄名改為一眼可辨識為生成圖的名稱。

## 5. 型別層

`src/types.ts` 新增共用介面：

```ts
/** 三個工具共用的模型與擴充參數覆寫 */
export interface ModelOverrides {
  /** 模型 ID，省略則採用 config.model */
  model?: string;
  /** 單次呼叫的額外參數，與 config.extraParams 合併後套用 */
  extraParams?: Record<string, unknown>;
}
```

`GenerateParams` 與 `IterateParams` 分別 extends `ModelOverrides`；`EditParams` 既已 extends `GenerateParams`，自動繼承。

## 6. 合併層（新模組 `src/request-body.ts`）

### 介面

```ts
export interface BuildRequestBodyInput {
  /** 決定請求結構的核心欄位，不可被擴充參數覆寫 */
  core: Record<string, unknown>;
  /** 一般具名參數，可被擴充參數覆寫 */
  named: Record<string, unknown>;
  /** 全域預設額外參數（來自 config.extraParams） */
  defaultExtra: Record<string, unknown>;
  /** 單次呼叫的額外參數（來自工具參數 extra_params） */
  callExtra?: Record<string, unknown>;
}

export interface BuildRequestBodyResult {
  /** 可直接 JSON.stringify 送出的 request body */
  body: Record<string, unknown>;
  /** 因撞到核心欄位而被忽略的 key，供工具層回報警告 */
  blockedKeys: string[];
}

export function buildRequestBody(input: BuildRequestBodyInput): BuildRequestBodyResult;
```

### 合併順序

後者覆寫前者：

```
named（先移除值為 undefined 的欄位）
  ↓
defaultExtra
  ↓
callExtra
  ↓
core        ← 最後套用，核心欄位必勝
```

### 保護機制

**保護名單不是硬編字串清單，而是 `core` 的鍵集合加上「core 最後套用」這個順序本身。**

保護哪些欄位完全由呼叫端傳入的 `core` 結構決定，`buildRequestBody` 不需認識任何 endpoint 或 body 形狀。未來 API 增減核心欄位時，只需改呼叫端的 `core` 物件，本模組不動。

兩則細節：

- `core` 中值為 `undefined` 的欄位會從 `body` 移除，**但其 key 仍列入保護名單**。否則「這次沒給 `previous_response_id`」會變成擴充參數塞值進去的破口。
- `blockedKeys` 為 `defaultExtra` 與 `callExtra` 的鍵聯集中，與 `core` 鍵集合相交的部分。

### 各 endpoint 的 core / named 劃分

| endpoint | core（受保護） | named（可被覆寫） |
|---|---|---|
| `/images/generations` | `model`, `prompt`, `response_format` | `n`, `size`, `output_format`, `reasoning_strength` |
| `/images/edits` | `model`, `prompt`, `response_format`, `images` | `n`, `size`, `output_format`, `reasoning_strength` |
| `/responses` | `model`, `input`, `store`, `previous_response_id` | `reasoning_strength` |

`model` 的實際值為 `params.model ?? config.model`。因其已有專用工具參數，故列入 `core`，避免出現兩種設定模型的途徑而優先序不直觀。

### `MuseClient` 的調整

三個方法改為呼叫 `buildRequestBody`，自身只負責 HTTP 傳輸、重試與回應解析；原本的 `compact()` 由合併層吸收。

`blockedKeys` 產生於合併層、但需由工具層呈現給使用者，因此三個方法的回傳型別統一包一層：

```ts
/** client 方法的回傳包裝，額外攜帶被忽略的擴充參數 key */
export interface ClientResult<T> {
  result: T;
  blockedKeys: string[];
}
```

- `generate` / `edit`：`Promise<ClientResult<MuseImageResponse>>`
- `iterate`：`Promise<ClientResult<IterateResult>>`

不將 `blockedKeys` 直接塞進 `MuseImageResponse`，是因為該型別是 API 回應的忠實對應，混入本地產生的欄位會讓它不再能代表 API 契約。

## 7. 工具層

`src/tools.ts` 的三個工具 schema 各新增兩個選填參數：

| 參數 | 型別 | 說明文字（給 LLM 讀） |
|---|---|---|
| `model` | string 選填 | 模型 ID，省略則使用伺服器設定的預設模型 |
| `extra_params` | object 選填 | 傳給 API 的額外參數，用於新模型的特殊參數。會與伺服器全域設定合併，單次設定優先 |

實作註記：zod 4 的 `z.record()` 需同時指定鍵與值的 schema（`z.record(z.string(), z.unknown())`），與 zod 3 的單參數寫法不同，實作時須確認編譯通過。

## 8. 警告回報

`blockedKeys` 非空時，於工具回傳文字末端附加一行，**不擲出錯誤**：

```
⚠️ 下列 extra_params 與請求核心欄位衝突，已忽略：model, prompt
```

擲錯會使 LLM 進入重試迴圈反而干擾使用；參數被忽略屬於「結果仍可用但使用者應當知情」的等級，警告是相稱的強度。

## 9. 測試策略

採 TDD，先寫測試至 RED，再改實作至 GREEN。

| 檔案 | 涵蓋範圍 |
|---|---|
| `tests/request-body.test.ts`（新增） | 合併順序、`undefined` 欄位移除、核心欄位保護、`blockedKeys` 收集、三種 core 形狀 |
| `tests/config.test.ts`（擴充） | `MUSE_MODEL` 預設與覆寫；`MUSE_EXTRA_PARAMS` 的合法／空／非法 JSON／非物件四種輸入；`.env` 搜尋鏈；輸出目錄改名 |
| `tests/muse-client.test.ts`（擴充） | 三個方法送出的 body 帶對 model；擴充參數確實出現在 body；核心欄位未被覆寫 |
| `tests/tools.test.ts`（擴充） | `model` 與 `extra_params` 的透傳；警告文字產生 |
| `tests/smoke.e2e.test.ts` | 不修改 |

完成後須跑全套 `npm test` 與 `npm run build`，兩者皆須通過方可進入發佈步驟。

## 10. 發佈前置與發佈

### `package.json`

補齊 `license`（MIT）、`author`（Kevin Tsai）、`keywords`、`repository`／`bugs`／`homepage`（指向 `github.com/kevintsai1202/muse-image-mcp`），並新增：

```json
"prepublishOnly": "npm run build && npm test"
```

避免發出過期或未通過測試的 `dist`。

### 其他檔案

- 新增 MIT `LICENSE` 檔
- `.gitignore` 的 `muse-output/` 改為 `generated-images/`
- `README.md` 改寫：
  - 安裝方式以 `npx -y muse-image-mcp` 為主，clone 開發降為次要段落
  - `.env` 一節補上家目錄位置與完整搜尋鏈
  - 環境變數表新增 `MUSE_MODEL` 與 `MUSE_EXTRA_PARAMS` 兩列
  - 新增「切換模型與額外參數」一節，含使用範例與核心欄位保護說明
  - 修正輸出目錄段落：cwd 即 client 的專案根目錄，非不可靠值

### 發佈

功能完成、全套測試綠燈且 build 通過後：

```bash
gh repo create kevintsai1202/muse-image-mcp --public --source=. --push
```

`npm publish` 不在本次範圍。

## 11. 風險與緩解

| 風險 | 緩解 |
|---|---|
| LLM 在 `extra_params` 亂猜欄位名，錯誤要到 API 回 400 才顯現 | 錯誤訊息由既有 `classifyHttpError` 分類後回傳，包含 API 原始說明；核心欄位另有保護與警告 |
| `MUSE_EXTRA_PARAMS` 設定錯誤導致 server 起不來 | 這是刻意的 fail fast；錯誤訊息以中文明確指出是哪個變數、期望什麼格式 |
| 輸出目錄改名使既有本機使用者的舊圖散落在 `muse-output/` | 舊目錄不刪除、不搬移；README 註明改名一事 |
| 其他 MCP client 的 cwd 未必是專案根目錄 | `MUSE_OUTPUT_DIR` 可明確覆寫；README 說明其適用時機 |
