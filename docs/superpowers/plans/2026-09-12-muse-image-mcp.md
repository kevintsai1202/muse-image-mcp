# muse-image-mcp 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個 stdio MCP server，讓 Agent 能透過 Meta Muse 模型生圖、依圖改圖、以及多輪對話式迭代修圖。

**Architecture:** TypeScript ESM 專案。以 Node 內建 `fetch` 自寫薄 client 打 Meta 的 OpenAI 相容端點（不使用 openai SDK）。圖片一律解 base64 落地成本機檔案，工具只回傳絕對路徑與用量資訊。對話式迭代為 stateless — `response_id` 交由 Agent 保管並在下一輪帶回。

**Tech Stack:** TypeScript 7 / Node >= 20 / `@modelcontextprotocol/sdk` 1.30.x / zod 4 / vitest 5

**Spec:** `docs/superpowers/specs/2026-09-12-muse-image-mcp-design.md`

---

## Global Constraints

這些約束適用於**每一個** task，不再重複列出：

- **Node 版本下限 `>=20`**（需要內建 `fetch`、`AbortSignal.timeout`）。開發機為 v24.15.0。
- **ESM only**：`package.json` 設 `"type": "module"`；所有相對 import **必須帶 `.js` 副檔名**（例 `import { loadConfig } from "./config.js"`），即使原始檔是 `.ts`。這是 `nodenext` 模組解析的硬性要求，漏掉會在 runtime 炸。
- **MCP SDK 用 1.x 寫法，不可用 2.x alpha 寫法**：
  - import 路徑為 `@modelcontextprotocol/sdk/server/mcp.js` 與 `@modelcontextprotocol/sdk/server/stdio.js`
  - `registerTool` 的 `inputSchema` 收 **ZodRawShape**（純物件如 `{ prompt: z.string() }`），**不是** `z.object({...})`
  - 用 `new StdioServerTransport()` + `await server.connect(transport)`，**不是** `serveStdio()`
- **模型 ID 固定為 `muse-image-1.0`**。
- **Base URL 預設 `https://api.meta.ai/v1`**，可由 `MUSE_BASE_URL` 覆寫。
- **每張生成圖片成本 US$0.01**，回應文字需揭露預估成本。
- **stdout 是 JSON-RPC 通道**：任何日誌一律走 `console.error`（stderr）。在 stdout 印任何東西會毀掉協定。
- **API key 只從 `process.env.MUSE_API_KEY` 讀**，不得寫進程式碼、測試 fixture、git 或任何文件。
- **中文註解**：所有函式需有函式級別的繁體中文註解，重要變數也要註解。
- **TDD**：每個 task 先寫失敗的測試、跑一次確認失敗、再寫最小實作、再跑一次確認通過、然後 commit。

### 與 spec 的兩處刻意偏離（實作時照此計畫執行）

1. **spec §4 的 `index.ts` 拆成 `index.ts` + `tools.ts`**。理由：工具處理邏輯若寫在 `index.ts`，測試就得啟動 stdio transport 才能驗。拆出 `tools.ts`（純函式、依賴以參數注入）後，工具層可用 mock 完整單元測試，`index.ts` 退化成 12 行的組裝碼。
2. **spec §8 的 `scripts/smoke-test.ts` 改為 `tests/smoke.e2e.test.ts` + 獨立 vitest config**。理由：避免為了跑一個 .ts 腳本額外引入 tsx/ts-node 依賴；用 `vitest.e2e.config.ts` 隔離即可確保預設 `npm test` 不會誤觸真實 API。

---

## File Structure

| 檔案 | 職責 | 由哪個 Task 建立 |
|---|---|---|
| `package.json` / `tsconfig.json` / `vitest.config.ts` / `vitest.e2e.config.ts` | 專案骨架與建置設定 | Task 1 |
| `.gitignore` / `.env.example` | 機密與產出物排除、設定範本 | Task 1 |
| `src/types.ts` | 共用型別；不含任何邏輯 | Task 1 |
| `src/errors.ts` | `MuseError` 類別與 HTTP 錯誤分類；無任何依賴 | Task 1 |
| `src/config.ts` | 環境變數讀取與驗證 | Task 2 |
| `src/muse-client.ts` | 三端點的 HTTP 封裝 + retry + timeout；**不碰檔案系統** | Task 3 |
| `src/image-store.ts` | base64 落地、檔名規則、本機路徑轉 data URL；**不碰網路** | Task 4 |
| `src/tools.ts` | 三個 MCP 工具的 schema 與 handler；依賴以參數注入 | Task 5 |
| `src/index.ts` | 進入點：載入設定、組裝、註冊工具、接上 stdio | Task 5 |
| `tests/*.test.ts` | 單元測試 | Task 1–5 |
| `tests/smoke.e2e.test.ts` | 真實 API 煙霧測試（需 `MUSE_E2E=1`） | Task 6 |
| `README.md` | 安裝、設定、工具用法 | Task 6 |

---

## Task 1: 專案骨架 + 型別 + 錯誤分類

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.e2e.config.ts`, `.gitignore`, `.env.example`
- Create: `src/types.ts`, `src/errors.ts`
- Test: `tests/errors.test.ts`

**Interfaces:**
- Consumes: 無（第一個 task）
- Produces:
  - `src/types.ts`：`OutputFormat`、`ReasoningStrength`、`MuseUsage`、`MuseImageResponse`、`GenerateParams`、`EditParams`、`IterateParams`、`IterateResult`
  - `src/errors.ts`：`ErrorKind`、`class MuseError`、`classifyHttpError(status: number, body: unknown): MuseError`、`classifyFetchError(cause: unknown): MuseError`

---

- [ ] **Step 1: 建立 `package.json`**

```json
{
  "name": "muse-image-mcp",
  "version": "0.1.0",
  "description": "MCP server for Meta Muse image generation",
  "type": "module",
  "bin": { "muse-image-mcp": "./dist/index.js" },
  "files": ["dist"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "smoke": "vitest run --config vitest.e2e.config.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "zod": "^4.6.2"
  },
  "devDependencies": {
    "@types/node": "^22.20.2",
    "typescript": "^7.0.2",
    "vitest": "^5.0.0"
  }
}
```

- [ ] **Step 2: 建立 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: 建立 vitest 設定（兩份）**

`vitest.config.ts` — 預設測試，**排除** e2e：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.e2e.test.ts", "node_modules/**"],
    environment: "node"
  }
});
```

`vitest.e2e.config.ts` — **只**跑 e2e，需真實 API key：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.e2e.test.ts"],
    environment: "node",
    testTimeout: 180_000
  }
});
```

- [ ] **Step 4: 建立 `.gitignore` 與 `.env.example`**

`.gitignore`：

```
node_modules/
dist/
muse-output/
.env
*.log
```

`.env.example`：

```
# Meta Muse API key，於 https://dev.meta.ai 後台取得。切勿提交真實 key。
MUSE_API_KEY=

# 圖片輸出目錄，選填，預設為執行時工作目錄下的 muse-output
# MUSE_OUTPUT_DIR=D:\muse-output

# API base URL，選填，預設 https://api.meta.ai/v1（測試時可指向 mock server）
# MUSE_BASE_URL=https://api.meta.ai/v1

# 單次請求逾時毫秒數，選填，預設 120000
# MUSE_TIMEOUT_MS=120000
```

- [ ] **Step 5: 安裝依賴**

Run: `npm install`
Expected: 成功，產生 `node_modules/` 與 `package-lock.json`

- [ ] **Step 6: 建立 `src/types.ts`**

```ts
/** 圖片輸出格式。API 預設 webp，本專案工具層預設改用 png。 */
export type OutputFormat = "png" | "webp" | "jpeg";

/** 推理強度。high 品質較佳但較慢；兩者計價相同。 */
export type ReasoningStrength = "high" | "low";

/** Muse API 回報的 token 用量 */
export interface MuseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/** /v1/images/generations 與 /v1/images/edits 的共同回應結構 */
export interface MuseImageResponse {
  created: number;
  data: Array<{ b64_json: string }>;
  output_format: OutputFormat;
  usage?: MuseUsage;
}

/** 文字生圖參數（已由工具層正規化，欄位為 camelCase） */
export interface GenerateParams {
  prompt: string;
  n?: number;
  /** 長寬比字串如 "1792x1024"，非精確像素 */
  size?: string;
  outputFormat?: OutputFormat;
  reasoningStrength?: ReasoningStrength;
}

/** 改圖參數。imageUrls 已正規化為 data URL 或 http(s) URL，client 不需再讀檔。 */
export interface EditParams extends GenerateParams {
  imageUrls: string[];
}

/** 對話式迭代參數 */
export interface IterateParams {
  prompt: string;
  /** 上一輪回傳的 response id；省略代表開新對話 */
  previousResponseId?: string;
  imageUrls?: string[];
  reasoningStrength?: ReasoningStrength;
}

/** 對話式迭代結果。responseId 必須回傳給呼叫端以便續接下一輪。 */
export interface IterateResult {
  responseId: string;
  /** 取出的圖片 base64 內容 */
  images: string[];
  outputFormat: OutputFormat;
  usage?: MuseUsage;
}
```

- [ ] **Step 7: 寫 `tests/errors.test.ts`（失敗的測試）**

```ts
import { describe, it, expect } from "vitest";
import { MuseError, classifyHttpError, classifyFetchError } from "../src/errors.js";

describe("classifyHttpError", () => {
  it("400 保留 Meta 回傳的 error.message 原文", () => {
    const err = classifyHttpError(400, { error: { message: "n must be between 1 and 10" } });
    expect(err.kind).toBe("invalid_request");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("n must be between 1 and 10");
  });

  it("400 且訊息含審核字樣時分類為 moderation 且不重試", () => {
    const err = classifyHttpError(400, {
      error: { message: "Request rejected by content moderation policy" }
    });
    expect(err.kind).toBe("moderation");
    expect(err.retryable).toBe(false);
  });

  it("401 分類為 auth 且不重試", () => {
    expect(classifyHttpError(401, {}).kind).toBe("auth");
    expect(classifyHttpError(401, {}).retryable).toBe(false);
  });

  it("403 分類為 auth", () => {
    expect(classifyHttpError(403, {}).kind).toBe("auth");
  });

  it("429 分類為 rate_limit 且可重試", () => {
    const err = classifyHttpError(429, {});
    expect(err.kind).toBe("rate_limit");
    expect(err.retryable).toBe(true);
  });

  it("500 分類為 server 且可重試", () => {
    const err = classifyHttpError(500, {});
    expect(err.kind).toBe("server");
    expect(err.retryable).toBe(true);
  });

  it("404 等其他 4xx 分類為 invalid_request 且不重試", () => {
    const err = classifyHttpError(404, {});
    expect(err.kind).toBe("invalid_request");
    expect(err.retryable).toBe(false);
  });

  it("body 非預期結構時仍能產生可讀訊息且帶上狀態碼", () => {
    const err = classifyHttpError(400, "plain text body");
    expect(err.status).toBe(400);
    expect(err.message).toContain("plain text body");
  });
});

describe("classifyFetchError", () => {
  it("網路錯誤分類為 network 且可重試", () => {
    const err = classifyFetchError(new TypeError("fetch failed"));
    expect(err.kind).toBe("network");
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("fetch failed");
  });
});

describe("MuseError", () => {
  it("config 類錯誤不可重試", () => {
    expect(new MuseError("config", "missing key").retryable).toBe(false);
  });
});
```

- [ ] **Step 8: 跑測試確認失敗**

Run: `npx vitest run tests/errors.test.ts`
Expected: FAIL — 找不到模組 `../src/errors.js`

- [ ] **Step 9: 實作 `src/errors.ts`**

```ts
/**
 * 錯誤分類。retry 策略由此分類推導，分類邏輯本身不含重試實作。
 * - config：環境變數設定問題
 * - invalid_request：請求參數不合法（HTTP 400/其他 4xx）
 * - moderation：內容審核拒絕，重試無意義
 * - auth：API key 無效或無權限
 * - rate_limit / server / network：暫時性，可重試
 * - input：呼叫端給的本機輸入有問題（檔案不存在等）
 * - io：寫檔失敗
 */
export type ErrorKind =
  | "config"
  | "invalid_request"
  | "moderation"
  | "auth"
  | "rate_limit"
  | "server"
  | "network"
  | "input"
  | "io";

/** 可重試的錯誤分類 */
const RETRYABLE_KINDS: ReadonlySet<ErrorKind> = new Set<ErrorKind>(["rate_limit", "server", "network"]);

/** 判定為內容審核拒絕的關鍵字（Meta 回傳訊息為英文） */
const MODERATION_HINTS = ["moderation", "safety", "policy", "content_filter", "blocked"];

/** 本專案統一的錯誤型別，帶分類與是否可重試 */
export class MuseError extends Error {
  readonly kind: ErrorKind;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(kind: ErrorKind, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "MuseError";
    this.kind = kind;
    this.retryable = RETRYABLE_KINDS.has(kind);
    this.status = options?.status;
  }
}

/**
 * 從回應 body 中盡力取出可讀的錯誤訊息。
 * Meta 的 400 訊息是 Agent 自我修正的唯一依據，必須原樣保留、不可改寫。
 */
function extractMessage(body: unknown): string {
  if (typeof body === "string" && body.trim() !== "") return body;
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim() !== "") return message;
    }
    const topLevel = (body as { message?: unknown }).message;
    if (typeof topLevel === "string" && topLevel.trim() !== "") return topLevel;
    try {
      return JSON.stringify(body);
    } catch {
      /* 落到下方預設訊息 */
    }
  }
  return "（API 未提供錯誤訊息）";
}

/** 依 HTTP 狀態碼與回應 body 分類錯誤 */
export function classifyHttpError(status: number, body: unknown): MuseError {
  const detail = extractMessage(body);

  if (status === 400) {
    const lowered = detail.toLowerCase();
    const isModeration = MODERATION_HINTS.some(hint => lowered.includes(hint));
    return isModeration
      ? new MuseError("moderation", `內容審核拒絕此請求，請調整 prompt：${detail}`, { status })
      : new MuseError("invalid_request", `請求參數不合法：${detail}`, { status });
  }

  if (status === 401 || status === 403) {
    return new MuseError("auth", `API key 無效或無權限（HTTP ${status}）：${detail}`, { status });
  }

  if (status === 429) {
    return new MuseError("rate_limit", `觸發速率限制（HTTP 429）：${detail}`, { status });
  }

  if (status >= 500) {
    return new MuseError("server", `Meta 伺服器錯誤（HTTP ${status}）：${detail}`, { status });
  }

  return new MuseError("invalid_request", `請求失敗（HTTP ${status}）：${detail}`, { status });
}

/** 把 fetch 拋出的例外（連線失敗、逾時 abort）歸類為可重試的網路錯誤 */
export function classifyFetchError(cause: unknown): MuseError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new MuseError("network", `連線 Muse API 失敗：${detail}`, { cause });
}
```

- [ ] **Step 10: 跑測試確認通過**

Run: `npx vitest run tests/errors.test.ts`
Expected: PASS，9 個測試全綠

- [ ] **Step 11: 確認建置通過**

Run: `npm run build`
Expected: 無錯誤，產生 `dist/types.js` 與 `dist/errors.js`

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts vitest.e2e.config.ts .gitignore .env.example src/types.ts src/errors.ts tests/errors.test.ts
git commit -m "feat: 專案骨架、共用型別與錯誤分類"
```

---

## Task 2: 設定載入（config.ts）

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: `MuseError` from `src/errors.js`
- Produces: `interface Config { apiKey: string; baseUrl: string; outputDir: string; timeoutMs: number }`、`loadConfig(env?: NodeJS.ProcessEnv): Config`

---

- [ ] **Step 1: 寫 `tests/config.test.ts`（失敗的測試）**

```ts
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { MuseError } from "../src/errors.js";

describe("loadConfig", () => {
  it("缺少 MUSE_API_KEY 時拋出 config 類錯誤", () => {
    try {
      loadConfig({});
      throw new Error("預期應該拋錯但沒有");
    } catch (err) {
      expect(err).toBeInstanceOf(MuseError);
      expect((err as MuseError).kind).toBe("config");
      expect((err as MuseError).message).toContain("MUSE_API_KEY");
    }
  });

  it("MUSE_API_KEY 為空白字串時視同缺少", () => {
    expect(() => loadConfig({ MUSE_API_KEY: "   " })).toThrow(MuseError);
  });

  it("只給 API key 時套用全部預設值", () => {
    const config = loadConfig({ MUSE_API_KEY: "test-key" });
    expect(config.apiKey).toBe("test-key");
    expect(config.baseUrl).toBe("https://api.meta.ai/v1");
    expect(config.outputDir).toBe(resolve(process.cwd(), "muse-output"));
    expect(config.timeoutMs).toBe(120_000);
  });

  it("可覆寫 base URL，並移除結尾斜線", () => {
    const config = loadConfig({ MUSE_API_KEY: "k", MUSE_BASE_URL: "http://localhost:9999/v1/" });
    expect(config.baseUrl).toBe("http://localhost:9999/v1");
  });

  it("輸出目錄一律轉為絕對路徑", () => {
    const config = loadConfig({ MUSE_API_KEY: "k", MUSE_OUTPUT_DIR: "out/images" });
    expect(config.outputDir).toBe(resolve(process.cwd(), "out/images"));
  });

  it("逾時可覆寫", () => {
    expect(loadConfig({ MUSE_API_KEY: "k", MUSE_TIMEOUT_MS: "5000" }).timeoutMs).toBe(5000);
  });

  it("逾時為非正整數時拋出 config 類錯誤", () => {
    expect(() => loadConfig({ MUSE_API_KEY: "k", MUSE_TIMEOUT_MS: "abc" })).toThrow(MuseError);
    expect(() => loadConfig({ MUSE_API_KEY: "k", MUSE_TIMEOUT_MS: "0" })).toThrow(MuseError);
  });

  it("回傳的設定物件為凍結狀態，避免被下游意外改動", () => {
    const config = loadConfig({ MUSE_API_KEY: "k" });
    expect(Object.isFrozen(config)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — 找不到模組 `../src/config.js`

- [ ] **Step 3: 實作 `src/config.ts`**

```ts
import { resolve } from "node:path";
import { MuseError } from "./errors.js";

/** 執行期設定，全部來自環境變數 */
export interface Config {
  /** Meta Muse API key，唯一來源為 MUSE_API_KEY 環境變數 */
  apiKey: string;
  /** API base URL，結尾不含斜線 */
  baseUrl: string;
  /** 圖片輸出目錄的絕對路徑 */
  outputDir: string;
  /** 單次 HTTP 請求逾時毫秒數 */
  timeoutMs: number;
}

const DEFAULT_BASE_URL = "https://api.meta.ai/v1";
const DEFAULT_OUTPUT_DIR = "muse-output";
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * 從環境變數載入設定並驗證。
 * 缺少 API key 時直接拋出 config 類錯誤——MCP server 最難查的故障就是靜默失敗。
 * @param env 環境變數來源，預設為 process.env（測試時可注入）
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = (env.MUSE_API_KEY ?? "").trim();
  if (apiKey === "") {
    throw new MuseError(
      "config",
      "缺少環境變數 MUSE_API_KEY。請於 MCP server 設定的 env 區塊填入你的 Meta Muse API key（可於 https://dev.meta.ai 後台取得）。"
    );
  }

  // 結尾斜線會讓後續 `${baseUrl}/images/generations` 變成雙斜線，先移除
  const baseUrl = (env.MUSE_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");

  const outputDir = resolve(process.cwd(), (env.MUSE_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR).trim());

  const rawTimeout = (env.MUSE_TIMEOUT_MS ?? "").trim();
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (rawTimeout !== "") {
    const parsed = Number(rawTimeout);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new MuseError("config", `MUSE_TIMEOUT_MS 必須為正整數毫秒數，目前為 "${rawTimeout}"。`);
    }
    timeoutMs = parsed;
  }

  return Object.freeze({ apiKey, baseUrl, outputDir, timeoutMs });
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS，8 個測試全綠

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: 環境變數設定載入與驗證"
```

---

## Task 3: Muse API client（muse-client.ts）

**Files:**
- Create: `src/muse-client.ts`
- Test: `tests/muse-client.test.ts`

**Interfaces:**
- Consumes: `Config` from `src/config.js`；`MuseError`、`classifyHttpError`、`classifyFetchError` from `src/errors.js`；`GenerateParams`、`EditParams`、`IterateParams`、`IterateResult`、`MuseImageResponse` from `src/types.js`
- Produces:
  - `class MuseClient`，建構子 `new MuseClient(config: Config, deps?: MuseClientDeps)`
  - `interface MuseClientDeps { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }`
  - 方法：`generate(params: GenerateParams): Promise<MuseImageResponse>`、`edit(params: EditParams): Promise<MuseImageResponse>`、`iterate(params: IterateParams): Promise<IterateResult>`
  - `export function extractB64Images(node: unknown): string[]`（深度走訪回應 JSON 收集 `b64_json`，供 `/v1/responses` 結構未知時使用）

**⚠️ 實作注意：** spec §1 記載 `/v1/responses` 的回應中圖片欄位路徑**官方文件未給**。因此 `iterate()` 不可硬編欄位路徑，必須用 `extractB64Images` 做深度走訪；`/v1/responses` 的 `input` 結構亦為推測（比照 OpenAI Responses 慣例），兩者都要在 Task 6 的煙霧測試中以真實 API 驗證後才算完成。

---

- [ ] **Step 1: 寫 `tests/muse-client.test.ts`（失敗的測試）**

```ts
import { describe, it, expect, vi } from "vitest";
import { MuseClient, extractB64Images } from "../src/muse-client.js";
import { MuseError } from "../src/errors.js";
import type { Config } from "../src/config.js";

const CONFIG: Config = Object.freeze({
  apiKey: "test-key",
  baseUrl: "https://api.example.test/v1",
  outputDir: "/tmp/out",
  timeoutMs: 1000
});

/** 建立一個回傳指定 JSON 與狀態碼的 fetch 假物件 */
function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    })
  );
}

/** 立即完成的 sleep，讓重試測試不必真的等待 */
const noSleep = async () => {};

const OK_IMAGE_BODY = {
  created: 1784584435,
  data: [{ b64_json: "AAAA" }],
  output_format: "png",
  usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 }
};

describe("MuseClient.generate", () => {
  it("送出正確的 URL、header 與 request body", async () => {
    const fetchImpl = fakeFetch(200, OK_IMAGE_BODY);
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.generate({
      prompt: "a red fox",
      n: 2,
      size: "1792x1024",
      outputFormat: "png",
      reasoningStrength: "low"
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/v1/images/generations");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      model: "muse-image-1.0",
      prompt: "a red fox",
      response_format: "b64_json",
      n: 2,
      size: "1792x1024",
      output_format: "png",
      reasoning_strength: "low"
    });
  });

  it("未給的選填參數不出現在 body 中", async () => {
    const fetchImpl = fakeFetch(200, OK_IMAGE_BODY);
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.generate({ prompt: "only prompt" });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({
      model: "muse-image-1.0",
      prompt: "only prompt",
      response_format: "b64_json"
    });
    expect("size" in body).toBe(false);
    expect("n" in body).toBe(false);
  });

  it("回傳解析後的回應", async () => {
    const client = new MuseClient(CONFIG, {
      fetchImpl: fakeFetch(200, OK_IMAGE_BODY) as unknown as typeof fetch,
      sleep: noSleep
    });
    const result = await client.generate({ prompt: "x" });
    expect(result.data[0]!.b64_json).toBe("AAAA");
    expect(result.usage!.total_tokens).toBe(15);
  });
});

describe("MuseClient.edit", () => {
  it("把 imageUrls 包成 images 陣列送到 /images/edits", async () => {
    const fetchImpl = fakeFetch(200, OK_IMAGE_BODY);
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.edit({ prompt: "add a hat", imageUrls: ["data:image/png;base64,ZZZ", "https://x.test/a.png"] });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/v1/images/edits");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.images).toEqual([
      { image_url: "data:image/png;base64,ZZZ" },
      { image_url: "https://x.test/a.png" }
    ]);
  });
});

describe("MuseClient.iterate", () => {
  it("首輪無圖時 input 為純字串，且帶 store: true", async () => {
    const fetchImpl = fakeFetch(200, { id: "resp_1", output: [{ content: [{ b64_json: "IMG" }] }] });
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.iterate({ prompt: "make it blue" });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/v1/responses");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.input).toBe("make it blue");
    expect(body.store).toBe(true);
    expect(body.model).toBe("muse-image-1.0");
    expect("previous_response_id" in body).toBe(false);
  });

  it("有參考圖時 input 為結構化陣列", async () => {
    const fetchImpl = fakeFetch(200, { id: "resp_1", output: [{ b64_json: "IMG" }] });
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.iterate({ prompt: "make it blue", imageUrls: ["data:image/png;base64,ZZZ"] });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "make it blue" },
          { type: "input_image", image_url: "data:image/png;base64,ZZZ" }
        ]
      }
    ]);
  });

  it("帶入 previousResponseId 以續接對話", async () => {
    const fetchImpl = fakeFetch(200, { id: "resp_2", output: [{ b64_json: "IMG" }] });
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.iterate({ prompt: "again", previousResponseId: "resp_1" });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.previous_response_id).toBe("resp_1");
  });

  it("從巢狀回應中取出 response id 與圖片", async () => {
    const client = new MuseClient(CONFIG, {
      fetchImpl: fakeFetch(200, {
        id: "resp_9",
        output: [{ type: "image", content: [{ b64_json: "DEEP" }] }],
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
      }) as unknown as typeof fetch,
      sleep: noSleep
    });

    const result = await client.iterate({ prompt: "x" });
    expect(result.responseId).toBe("resp_9");
    expect(result.images).toEqual(["DEEP"]);
    expect(result.usage!.total_tokens).toBe(3);
  });

  it("回應中找不到任何圖片時拋出 server 類錯誤", async () => {
    const client = new MuseClient(CONFIG, {
      fetchImpl: fakeFetch(200, { id: "resp_x", output: [] }) as unknown as typeof fetch,
      sleep: noSleep
    });
    await expect(client.iterate({ prompt: "x" })).rejects.toMatchObject({ kind: "server" });
  });
});

describe("重試行為", () => {
  it("401 不重試，直接拋 auth 錯誤", async () => {
    const fetchImpl = fakeFetch(401, { error: { message: "invalid api key" } });
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await expect(client.generate({ prompt: "x" })).rejects.toMatchObject({ kind: "auth" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("400 不重試", async () => {
    const fetchImpl = fakeFetch(400, { error: { message: "bad n" } });
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await expect(client.generate({ prompt: "x" })).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("429 重試 3 次後放棄，共發出 4 次請求", async () => {
    const fetchImpl = fakeFetch(429, { error: { message: "slow down" } });
    const sleep = vi.fn(async () => {});
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep });

    await expect(client.generate({ prompt: "x" })).rejects.toMatchObject({ kind: "rate_limit" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(c => c[0])).toEqual([1000, 2000, 4000]);
  });

  it("先 500 後成功時回傳成功結果", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(OK_IMAGE_BODY), { status: 200 }));
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    const result = await client.generate({ prompt: "x" });
    expect(result.data[0]!.b64_json).toBe("AAAA");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fetch 拋例外時歸類為 network 並重試", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await expect(client.generate({ prompt: "x" })).rejects.toMatchObject({ kind: "network" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe("extractB64Images", () => {
  it("深度走訪任意巢狀結構收集 b64_json", () => {
    const node = { a: [{ b: { b64_json: "X" } }, { b64_json: "Y" }], c: "ignored" };
    expect(extractB64Images(node)).toEqual(["X", "Y"]);
  });

  it("沒有任何 b64_json 時回傳空陣列", () => {
    expect(extractB64Images({ a: 1, b: "text" })).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/muse-client.test.ts`
Expected: FAIL — 找不到模組 `../src/muse-client.js`

- [ ] **Step 3: 實作 `src/muse-client.ts`**

```ts
import type { Config } from "./config.js";
import { MuseError, classifyHttpError, classifyFetchError } from "./errors.js";
import type {
  EditParams,
  GenerateParams,
  IterateParams,
  IterateResult,
  MuseImageResponse,
  MuseUsage,
  OutputFormat
} from "./types.js";

/** Muse 影像模型 ID，全專案固定 */
const MODEL = "muse-image-1.0";

/** 可重試錯誤的退避間隔（毫秒）。陣列長度即為最大重試次數。 */
const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

/** 可注入的相依，供測試替換 */
export interface MuseClientDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** 預設的延遲實作 */
const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 深度走訪任意 JSON 結構，收集所有 b64_json 字串。
 * /v1/responses 的回應結構官方文件未載明，因此不硬編欄位路徑。
 */
export function extractB64Images(node: unknown): string[] {
  const found: string[] = [];

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "b64_json" && typeof child === "string") {
          found.push(child);
        } else {
          walk(child);
        }
      }
    }
  };

  walk(node);
  return found;
}

/** 去除物件中值為 undefined 的欄位，避免送出 `"size": null` 這類無效欄位 */
function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/** Muse API 的薄封裝。只負責 HTTP，不碰檔案系統。 */
export class MuseClient {
  private readonly config: Config;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: Config, deps: MuseClientDeps = {}) {
    this.config = config;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.sleep = deps.sleep ?? defaultSleep;
  }

  /** 文字生圖 */
  async generate(params: GenerateParams): Promise<MuseImageResponse> {
    const body = compact({
      model: MODEL,
      prompt: params.prompt,
      response_format: "b64_json",
      n: params.n,
      size: params.size,
      output_format: params.outputFormat,
      reasoning_strength: params.reasoningStrength
    });
    return (await this.request("/images/generations", body)) as MuseImageResponse;
  }

  /** 依既有圖片改圖。imageUrls 須為 data URL 或 http(s) URL。 */
  async edit(params: EditParams): Promise<MuseImageResponse> {
    const body = compact({
      model: MODEL,
      prompt: params.prompt,
      response_format: "b64_json",
      images: params.imageUrls.map(url => ({ image_url: url })),
      n: params.n,
      size: params.size,
      output_format: params.outputFormat,
      reasoning_strength: params.reasoningStrength
    });
    return (await this.request("/images/edits", body)) as MuseImageResponse;
  }

  /**
   * 對話式迭代修圖。
   * store 固定為 true，讓 Meta 端保存對話，本 server 不維護任何 state。
   */
  async iterate(params: IterateParams): Promise<IterateResult> {
    // 有參考圖時用結構化 input，否則用純字串
    const input =
      params.imageUrls && params.imageUrls.length > 0
        ? [
            {
              role: "user",
              content: [
                { type: "input_text", text: params.prompt },
                ...params.imageUrls.map(url => ({ type: "input_image", image_url: url }))
              ]
            }
          ]
        : params.prompt;

    const body = compact({
      model: MODEL,
      input,
      store: true,
      previous_response_id: params.previousResponseId,
      reasoning_strength: params.reasoningStrength
    });

    const raw = (await this.request("/responses", body)) as Record<string, unknown>;
    const images = extractB64Images(raw);
    if (images.length === 0) {
      throw new MuseError(
        "server",
        `Muse /responses 回應中找不到任何圖片資料（b64_json）。原始回應：${JSON.stringify(raw).slice(0, 500)}`
      );
    }

    const responseId = typeof raw.id === "string" ? raw.id : "";
    const outputFormat = (typeof raw.output_format === "string" ? raw.output_format : "png") as OutputFormat;

    return {
      responseId,
      images,
      outputFormat,
      usage: raw.usage as MuseUsage | undefined
    };
  }

  /**
   * 送出單次 POST 請求，帶逾時與可重試錯誤的指數退避。
   * @param path 相對於 baseUrl 的路徑，需以斜線開頭
   * @param body 已去除 undefined 欄位的 request body
   */
  private async request(path: string, body: Record<string, unknown>): Promise<unknown> {
    const url = `${this.config.baseUrl}${path}`;
    let lastError: MuseError | undefined;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeoutMs)
        });
      } catch (cause) {
        lastError = classifyFetchError(cause);
        if (attempt < RETRY_DELAYS_MS.length) {
          await this.sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        throw lastError;
      }

      if (response.ok) {
        return await response.json();
      }

      // 錯誤回應：先讀成文字再嘗試解析成 JSON，避免非 JSON body 讓解析炸掉
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* 保留原始文字 */
      }

      lastError = classifyHttpError(response.status, parsed);
      if (lastError.retryable && attempt < RETRY_DELAYS_MS.length) {
        await this.sleep(RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      throw lastError;
    }

    // 理論上不會走到這裡；保留為防禦
    throw lastError ?? new MuseError("server", "Muse API 請求失敗且無錯誤資訊");
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/muse-client.test.ts`
Expected: PASS，15 個測試全綠

- [ ] **Step 5: Commit**

```bash
git add src/muse-client.ts tests/muse-client.test.ts
git commit -m "feat: Muse API client 含重試與逾時"
```

---

## Task 4: 圖片落地與輸入正規化（image-store.ts）

**Files:**
- Create: `src/image-store.ts`
- Test: `tests/image-store.test.ts`

**Interfaces:**
- Consumes: `MuseError` from `src/errors.js`；`OutputFormat` from `src/types.js`
- Produces:
  - `sanitizePrefix(prefix: string): string`
  - `buildFilename(prefix: string, index: number, format: OutputFormat, now?: Date): string`
  - `saveImages(b64List: string[], opts: { outputDir: string; prefix: string; format: OutputFormat }): Promise<string[]>`（回傳絕對路徑陣列）
  - `toImageUrl(pathOrUrl: string): Promise<string>`（本機路徑→data URL；http(s) 原樣回傳）

---

- [ ] **Step 1: 寫 `tests/image-store.test.ts`（失敗的測試）**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { sanitizePrefix, buildFilename, saveImages, toImageUrl } from "../src/image-store.js";
import { MuseError } from "../src/errors.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "muse-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("sanitizePrefix", () => {
  it("保留安全字元", () => {
    expect(sanitizePrefix("red-fox_01")).toBe("red-fox_01");
  });

  it("把路徑分隔字元與空白換成連字號", () => {
    expect(sanitizePrefix("a/b\\c d")).toBe("a-b-c-d");
  });

  it("折疊連續連字號並去除頭尾連字號", () => {
    expect(sanitizePrefix("--a???b--")).toBe("a-b");
  });

  it("全為不安全字元時回退為 muse", () => {
    expect(sanitizePrefix("???")).toBe("muse");
    expect(sanitizePrefix("")).toBe("muse");
  });

  it("長度上限 40 字元", () => {
    expect(sanitizePrefix("x".repeat(100))).toHaveLength(40);
  });
});

describe("buildFilename", () => {
  const now = new Date(2026, 8, 12, 14, 15, 30); // 2026-09-12 14:15:30（月份自 0 起算）

  it("組出 prefix-時間戳-序號.副檔名", () => {
    expect(buildFilename("fox", 1, "png", now)).toBe("fox-20260912-141530-1.png");
  });

  it("jpeg 使用 .jpg 副檔名", () => {
    expect(buildFilename("fox", 2, "jpeg", now)).toBe("fox-20260912-141530-2.jpg");
  });

  it("webp 使用 .webp 副檔名", () => {
    expect(buildFilename("fox", 1, "webp", now)).toBe("fox-20260912-141530-1.webp");
  });

  it("prefix 會先經過清理", () => {
    expect(buildFilename("a/b", 1, "png", now)).toBe("a-b-20260912-141530-1.png");
  });
});

describe("saveImages", () => {
  it("把 base64 解碼寫入檔案並回傳絕對路徑", async () => {
    const content = "hello muse";
    const b64 = Buffer.from(content, "utf8").toString("base64");

    const paths = await saveImages([b64], { outputDir: workDir, prefix: "t", format: "png" });

    expect(paths).toHaveLength(1);
    expect(isAbsolute(paths[0]!)).toBe(true);
    expect(await readFile(paths[0]!, "utf8")).toBe(content);
  });

  it("多張圖片的序號遞增且檔名互異", async () => {
    const b64 = Buffer.from("x", "utf8").toString("base64");
    const paths = await saveImages([b64, b64, b64], { outputDir: workDir, prefix: "t", format: "png" });

    expect(paths).toHaveLength(3);
    expect(new Set(paths).size).toBe(3);
    expect(paths[0]!).toMatch(/-1\.png$/);
    expect(paths[2]!).toMatch(/-3\.png$/);
  });

  it("輸出目錄不存在時自動建立（含多層）", async () => {
    const nested = join(workDir, "a", "b", "c");
    const b64 = Buffer.from("x", "utf8").toString("base64");

    const paths = await saveImages([b64], { outputDir: nested, prefix: "t", format: "png" });

    expect(await readFile(paths[0]!, "utf8")).toBe("x");
  });

  it("空陣列回傳空陣列且不建立目錄以外的檔案", async () => {
    expect(await saveImages([], { outputDir: workDir, prefix: "t", format: "png" })).toEqual([]);
  });
});

describe("toImageUrl", () => {
  it("http(s) URL 原樣回傳", async () => {
    expect(await toImageUrl("https://example.test/a.png")).toBe("https://example.test/a.png");
    expect(await toImageUrl("http://example.test/a.png")).toBe("http://example.test/a.png");
  });

  it("本機 png 轉成 data URL", async () => {
    const file = join(workDir, "in.png");
    await writeFile(file, Buffer.from("PNGDATA", "utf8"));

    const url = await toImageUrl(file);

    expect(url).toBe(`data:image/png;base64,${Buffer.from("PNGDATA", "utf8").toString("base64")}`);
  });

  it("jpg 與 webp 對應正確的 MIME", async () => {
    const jpg = join(workDir, "in.jpg");
    await writeFile(jpg, Buffer.from("J", "utf8"));
    expect(await toImageUrl(jpg)).toMatch(/^data:image\/jpeg;base64,/);

    const webp = join(workDir, "in.webp");
    await writeFile(webp, Buffer.from("W", "utf8"));
    expect(await toImageUrl(webp)).toMatch(/^data:image\/webp;base64,/);
  });

  it("檔案不存在時拋出 input 類錯誤且訊息含路徑與 cwd", async () => {
    const missing = join(workDir, "nope.png");
    await expect(toImageUrl(missing)).rejects.toMatchObject({ kind: "input" });
    await expect(toImageUrl(missing)).rejects.toThrow(MuseError);
    await expect(toImageUrl(missing)).rejects.toThrow(new RegExp(process.cwd().replace(/\\/g, "\\\\")));
  });

  it("不支援的副檔名拋出 input 類錯誤", async () => {
    const file = join(workDir, "in.txt");
    await writeFile(file, "x");
    await expect(toImageUrl(file)).rejects.toMatchObject({ kind: "input" });
  });

  it("相對路徑以 cwd 解析", async () => {
    const dir = join(workDir, "rel");
    await mkdir(dir, { recursive: true });
    const file = join(dir, "r.png");
    await writeFile(file, Buffer.from("R", "utf8"));

    const original = process.cwd();
    process.chdir(workDir);
    try {
      expect(await toImageUrl("rel/r.png")).toMatch(/^data:image\/png;base64,/);
    } finally {
      process.chdir(original);
    }
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/image-store.test.ts`
Expected: FAIL — 找不到模組 `../src/image-store.js`

- [ ] **Step 3: 實作 `src/image-store.ts`**

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import { MuseError } from "./errors.js";
import type { OutputFormat } from "./types.js";

/** 輸出格式對應的實際副檔名（jpeg 習慣寫成 jpg） */
const EXTENSION_BY_FORMAT: Record<OutputFormat, string> = {
  png: "png",
  webp: "webp",
  jpeg: "jpg"
};

/** 允許作為改圖輸入的副檔名與其 MIME type */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

/** 檔名前綴的長度上限，避免路徑過長 */
const MAX_PREFIX_LENGTH = 40;

/**
 * 把使用者給的前綴清理成安全檔名片段。
 * 任何非 [A-Za-z0-9_-] 的字元都換成連字號，避免路徑穿越與跨平台檔名問題。
 */
export function sanitizePrefix(prefix: string): string {
  const cleaned = prefix
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PREFIX_LENGTH);
  return cleaned === "" ? "muse" : cleaned;
}

/**
 * 組出輸出檔名：`<prefix>-<yyyyMMdd-HHmmss>-<序號>.<副檔名>`
 * @param index 從 1 起算的序號
 * @param now 時間來源，測試時可注入固定時間
 */
export function buildFilename(prefix: string, index: number, format: OutputFormat, now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${sanitizePrefix(prefix)}-${stamp}-${index}.${EXTENSION_BY_FORMAT[format]}`;
}

/**
 * 把 base64 圖片解碼寫入輸出目錄。
 * 目錄不存在時自動建立。寫檔失敗必須大聲報錯——生成結果已經付費，不可靜默遺失。
 * @returns 依序對應輸入的絕對檔案路徑
 */
export async function saveImages(
  b64List: string[],
  opts: { outputDir: string; prefix: string; format: OutputFormat }
): Promise<string[]> {
  if (b64List.length === 0) return [];

  try {
    await mkdir(opts.outputDir, { recursive: true });
  } catch (cause) {
    throw new MuseError("io", `無法建立輸出目錄 ${opts.outputDir}：${(cause as Error).message}`, { cause });
  }

  // 同一批圖片共用同一個時間戳，靠序號區分，方便辨識是同一次生成
  const now = new Date();
  const paths: string[] = [];

  for (const [offset, b64] of b64List.entries()) {
    const filename = buildFilename(opts.prefix, offset + 1, opts.format, now);
    const fullPath = join(opts.outputDir, filename);
    try {
      await writeFile(fullPath, Buffer.from(b64, "base64"));
    } catch (cause) {
      throw new MuseError(
        "io",
        `寫入圖片失敗 ${fullPath}：${(cause as Error).message}。已生成的圖片可能因此遺失，請檢查目錄權限後重試。`,
        { cause }
      );
    }
    paths.push(fullPath);
  }

  return paths;
}

/**
 * 把改圖輸入正規化成 API 可接受的 image_url。
 * http(s) URL 原樣回傳；本機路徑讀檔轉成 data URL，呼叫端不需自行做 base64。
 */
export async function toImageUrl(pathOrUrl: string): Promise<string> {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

  const absolute = isAbsolute(pathOrUrl) ? pathOrUrl : resolve(process.cwd(), pathOrUrl);
  const mime = MIME_BY_EXTENSION[extname(absolute).toLowerCase()];
  if (mime === undefined) {
    throw new MuseError(
      "input",
      `不支援的圖片副檔名：${absolute}。支援 ${Object.keys(MIME_BY_EXTENSION).join("、")}。`
    );
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(absolute);
  } catch (cause) {
    throw new MuseError(
      "input",
      `讀取圖片失敗：${absolute}（目前工作目錄：${process.cwd()}）。請確認路徑是否正確、檔案是否存在且可讀。`,
      { cause }
    );
  }

  return `data:${mime};base64,${buffer.toString("base64")}`;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/image-store.test.ts`
Expected: PASS，16 個測試全綠

- [ ] **Step 5: Commit**

```bash
git add src/image-store.ts tests/image-store.test.ts
git commit -m "feat: 圖片落地存檔與改圖輸入正規化"
```

---

## Task 5: MCP 工具層與進入點（tools.ts + index.ts）

**Files:**
- Create: `src/tools.ts`, `src/index.ts`
- Test: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `MuseClient` from `src/muse-client.js`；`saveImages`、`toImageUrl` from `src/image-store.js`；`Config` from `src/config.js`；`MuseError` from `src/errors.js`
- Produces:
  - `interface ToolDeps { client: Pick<MuseClient, "generate" | "edit" | "iterate">; config: Config; saveImages: typeof saveImages; toImageUrl: typeof toImageUrl }`
  - `interface ToolDefinition { name: string; config: { title: string; description: string; inputSchema: ZodRawShape }; handler: (args: never) => Promise<ToolResult> }`
  - `createTools(deps: ToolDeps): ToolDefinition[]` — 回傳三個工具，順序為 `generate_image`、`edit_image`、`iterate_image`
  - `formatResult(paths: string[], usage?: MuseUsage, extraLines?: string[]): string`

---

- [ ] **Step 1: 寫 `tests/tools.test.ts`（失敗的測試）**

```ts
import { describe, it, expect, vi } from "vitest";
import { createTools, formatResult } from "../src/tools.js";
import { MuseError } from "../src/errors.js";
import type { Config } from "../src/config.js";

const CONFIG: Config = Object.freeze({
  apiKey: "k",
  baseUrl: "https://api.example.test/v1",
  outputDir: "/out",
  timeoutMs: 1000
});

/** 組出一套可控的相依，預設全部成功 */
function makeDeps(overrides: Partial<Parameters<typeof createTools>[0]> = {}) {
  return {
    config: CONFIG,
    client: {
      generate: vi.fn(async () => ({
        created: 1,
        data: [{ b64_json: "AAAA" }],
        output_format: "png" as const,
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
      })),
      edit: vi.fn(async () => ({
        created: 1,
        data: [{ b64_json: "BBBB" }],
        output_format: "png" as const
      })),
      iterate: vi.fn(async () => ({
        responseId: "resp_42",
        images: ["CCCC"],
        outputFormat: "png" as const,
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
      }))
    },
    saveImages: vi.fn(async (list: string[]) => list.map((_, i) => `/out/img-${i + 1}.png`)),
    toImageUrl: vi.fn(async (p: string) => (p.startsWith("http") ? p : `data:image/png;base64,ENC(${p})`)),
    ...overrides
  };
}

/** 取出指定名稱的工具定義 */
function pick(tools: ReturnType<typeof createTools>, name: string) {
  const found = tools.find(t => t.name === name);
  if (!found) throw new Error(`找不到工具 ${name}`);
  return found;
}

describe("createTools", () => {
  it("註冊三個工具且名稱正確", () => {
    const tools = createTools(makeDeps());
    expect(tools.map(t => t.name)).toEqual(["generate_image", "edit_image", "iterate_image"]);
  });

  it("generate_image 的描述說明 size 是長寬比且揭露成本", () => {
    const tool = pick(createTools(makeDeps()), "generate_image");
    expect(tool.config.description).toContain("長寬比");
    expect(tool.config.description).toContain("0.01");
  });
});

describe("generate_image handler", () => {
  it("套用預設值：n=1、output_format=png、reasoning=high、prefix=muse", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "generate_image");

    await tool.handler({ prompt: "a fox" } as never);

    expect(deps.client.generate).toHaveBeenCalledWith({
      prompt: "a fox",
      n: 1,
      size: undefined,
      outputFormat: "png",
      reasoningStrength: "high"
    });
    expect(deps.saveImages).toHaveBeenCalledWith(["AAAA"], {
      outputDir: "/out",
      prefix: "muse",
      format: "png"
    });
  });

  it("回應文字包含路徑、用量與預估成本", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "generate_image");

    const result = await tool.handler({ prompt: "a fox" } as never);

    expect(result.isError).toBeFalsy();
    const text = result.content[0]!.text;
    expect(text).toContain("/out/img-1.png");
    expect(text).toContain("total_tokens=3");
    expect(text).toContain("US$0.01");
  });

  it("MuseError 轉為 isError 回應並保留原始訊息", async () => {
    const deps = makeDeps();
    deps.client.generate = vi.fn(async () => {
      throw new MuseError("invalid_request", "請求參數不合法：n must be between 1 and 10");
    });
    const tool = pick(createTools(deps), "generate_image");

    const result = await tool.handler({ prompt: "a fox" } as never);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("n must be between 1 and 10");
    expect(result.content[0]!.text).toContain("invalid_request");
  });

  it("非 MuseError 的例外也轉為 isError 而不外拋", async () => {
    const deps = makeDeps();
    deps.client.generate = vi.fn(async () => {
      throw new Error("boom");
    });
    const tool = pick(createTools(deps), "generate_image");

    const result = await tool.handler({ prompt: "a fox" } as never);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("boom");
  });
});

describe("edit_image handler", () => {
  it("把每個 images 元素都經過 toImageUrl 正規化", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "edit_image");

    await tool.handler({ prompt: "add hat", images: ["a.png", "https://x.test/b.png"] } as never);

    expect(deps.toImageUrl).toHaveBeenCalledTimes(2);
    expect(deps.client.edit).toHaveBeenCalledWith({
      prompt: "add hat",
      imageUrls: ["data:image/png;base64,ENC(a.png)", "https://x.test/b.png"],
      n: 1,
      size: undefined,
      outputFormat: "png",
      reasoningStrength: "high"
    });
  });

  it("預設檔名前綴為 muse-edit", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "edit_image");

    await tool.handler({ prompt: "x", images: ["a.png"] } as never);

    expect(deps.saveImages).toHaveBeenCalledWith(["BBBB"], {
      outputDir: "/out",
      prefix: "muse-edit",
      format: "png"
    });
  });

  it("讀檔失敗時回傳 isError 並指出是哪個路徑", async () => {
    const deps = makeDeps();
    deps.toImageUrl = vi.fn(async () => {
      throw new MuseError("input", "讀取圖片失敗：/nope.png（目前工作目錄：/cwd）");
    });
    const tool = pick(createTools(deps), "edit_image");

    const result = await tool.handler({ prompt: "x", images: ["/nope.png"] } as never);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("/nope.png");
  });
});

describe("iterate_image handler", () => {
  it("回應必定包含 response_id 與續接說明", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "iterate_image");

    const result = await tool.handler({ prompt: "make it blue" } as never);

    const text = result.content[0]!.text;
    expect(text).toContain("resp_42");
    expect(text).toContain("previous_response_id");
  });

  it("首輪不帶 images 時 imageUrls 為 undefined", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "iterate_image");

    await tool.handler({ prompt: "x" } as never);

    expect(deps.client.iterate).toHaveBeenCalledWith({
      prompt: "x",
      previousResponseId: undefined,
      imageUrls: undefined,
      reasoningStrength: "high"
    });
  });

  it("帶 previous_response_id 時傳給 client", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "iterate_image");

    await tool.handler({ prompt: "x", previous_response_id: "resp_1" } as never);

    expect(deps.client.iterate).toHaveBeenCalledWith(
      expect.objectContaining({ previousResponseId: "resp_1" })
    );
  });
});

describe("formatResult", () => {
  it("多張圖片時成本按張數累加", () => {
    const text = formatResult(["/a.png", "/b.png", "/c.png"]);
    expect(text).toContain("已生成 3 張圖片");
    expect(text).toContain("US$0.03");
    expect(text).toContain("1. /a.png");
    expect(text).toContain("3. /c.png");
  });

  it("沒有 usage 時不印用量行", () => {
    expect(formatResult(["/a.png"])).not.toContain("用量：");
  });

  it("額外行會附加在最後", () => {
    expect(formatResult(["/a.png"], undefined, ["response_id: r1"])).toContain("response_id: r1");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/tools.test.ts`
Expected: FAIL — 找不到模組 `../src/tools.js`

- [ ] **Step 3: 實作 `src/tools.ts`**

```ts
import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { Config } from "./config.js";
import { MuseError } from "./errors.js";
import type { saveImages as saveImagesFn, toImageUrl as toImageUrlFn } from "./image-store.js";
import type { MuseClient } from "./muse-client.js";
import type { MuseUsage, OutputFormat, ReasoningStrength } from "./types.js";

/** 每張生成圖片的固定成本（美元） */
const COST_PER_IMAGE_USD = 0.01;

/** MCP 工具回傳格式（僅用文字內容，不回傳 base64 圖片以節省 context） */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** 工具定義，由 index.ts 轉交給 McpServer.registerTool */
export interface ToolDefinition {
  name: string;
  config: { title: string; description: string; inputSchema: ZodRawShape };
  handler: (args: never) => Promise<ToolResult>;
}

/** 工具層的相依，全部以參數注入以便測試 */
export interface ToolDeps {
  client: Pick<MuseClient, "generate" | "edit" | "iterate">;
  config: Config;
  saveImages: typeof saveImagesFn;
  toImageUrl: typeof toImageUrlFn;
}

/** 三個工具共用的選填參數 schema 片段 */
const commonShape = {
  n: z.number().int().min(1).max(10).optional().describe("生成張數，1 到 10，預設 1"),
  size: z
    .string()
    .optional()
    .describe('長寬比字串，例如 "1792x1024"、"1024x1536"。注意：這是長寬比而非精確像素解析度'),
  output_format: z.enum(["png", "webp", "jpeg"]).optional().describe("輸出格式，預設 png"),
  reasoning_strength: z.enum(["high", "low"]).optional().describe("推理強度，預設 high（品質較佳但較慢）")
};

/**
 * 組出工具回應文字。
 * 只回傳路徑不回傳圖片本體，避免 base64 佔用大量 context token。
 */
export function formatResult(paths: string[], usage?: MuseUsage, extraLines: string[] = []): string {
  const lines: string[] = [`已生成 ${paths.length} 張圖片：`];
  paths.forEach((path, index) => lines.push(`${index + 1}. ${path}`));
  lines.push("");

  if (usage) {
    lines.push(
      `用量：input_tokens=${usage.input_tokens} output_tokens=${usage.output_tokens} total_tokens=${usage.total_tokens}`
    );
  }

  const cost = (paths.length * COST_PER_IMAGE_USD).toFixed(2);
  lines.push(`預估成本：US$${cost}（${paths.length} 張 x US$${COST_PER_IMAGE_USD.toFixed(2)}）`);
  lines.push(...extraLines);

  return lines.join("\n");
}

/** 把任意例外轉成給 Agent 看的錯誤回應。絕不外拋，否則 Agent 只會看到通用失敗訊息。 */
function toErrorResult(error: unknown): ToolResult {
  const text =
    error instanceof MuseError
      ? `[${error.kind}] ${error.message}`
      : `[unexpected] ${error instanceof Error ? error.message : String(error)}`;
  return { content: [{ type: "text", text }], isError: true };
}

/** 建立三個 MCP 工具的定義 */
export function createTools(deps: ToolDeps): ToolDefinition[] {
  const { client, config, saveImages, toImageUrl } = deps;

  /** 文字生圖 */
  const generateImage: ToolDefinition = {
    name: "generate_image",
    config: {
      title: "Muse 文字生圖",
      description:
        "以 Meta Muse 模型從文字描述生成圖片。圖片會存到本機並回傳絕對路徑（不回傳圖片內容本身，" +
        "需要看圖請用檔案讀取工具開啟該路徑）。size 參數是長寬比而非精確像素解析度。" +
        "每張圖片成本 US$0.01。",
      inputSchema: {
        prompt: z.string().min(1).describe("圖片描述，英文通常效果較佳"),
        ...commonShape,
        filename_prefix: z.string().optional().describe("輸出檔名前綴，預設 muse")
      }
    },
    handler: async (args: never): Promise<ToolResult> => {
      const input = args as {
        prompt: string;
        n?: number;
        size?: string;
        output_format?: OutputFormat;
        reasoning_strength?: ReasoningStrength;
        filename_prefix?: string;
      };
      try {
        const format = input.output_format ?? "png";
        const response = await client.generate({
          prompt: input.prompt,
          n: input.n ?? 1,
          size: input.size,
          outputFormat: format,
          reasoningStrength: input.reasoning_strength ?? "high"
        });
        const paths = await saveImages(
          response.data.map(item => item.b64_json),
          { outputDir: config.outputDir, prefix: input.filename_prefix ?? "muse", format }
        );
        return { content: [{ type: "text", text: formatResult(paths, response.usage) }] };
      } catch (error) {
        return toErrorResult(error);
      }
    }
  };

  /** 依既有圖片改圖 */
  const editImage: ToolDefinition = {
    name: "edit_image",
    config: {
      title: "Muse 依圖改圖",
      description:
        "以 Meta Muse 模型依既有圖片與指令生成新圖。images 可填本機檔案路徑或 http(s) 網址，" +
        "本機檔案會自動轉成 base64，呼叫端不需自行處理。結果存到本機並回傳絕對路徑。" +
        "每張圖片成本 US$0.01。",
      inputSchema: {
        prompt: z.string().min(1).describe("修改指令，描述你要如何改這張圖"),
        images: z
          .array(z.string().min(1))
          .min(1)
          .describe("參考圖片，可為本機檔案路徑（png/jpg/jpeg/webp/gif）或 http(s) 網址"),
        ...commonShape,
        filename_prefix: z.string().optional().describe("輸出檔名前綴，預設 muse-edit")
      }
    },
    handler: async (args: never): Promise<ToolResult> => {
      const input = args as {
        prompt: string;
        images: string[];
        n?: number;
        size?: string;
        output_format?: OutputFormat;
        reasoning_strength?: ReasoningStrength;
        filename_prefix?: string;
      };
      try {
        const format = input.output_format ?? "png";
        // 逐一正規化，任何一張讀不到就整批失敗並指出是哪一張
        const imageUrls: string[] = [];
        for (const item of input.images) {
          imageUrls.push(await toImageUrl(item));
        }
        const response = await client.edit({
          prompt: input.prompt,
          imageUrls,
          n: input.n ?? 1,
          size: input.size,
          outputFormat: format,
          reasoningStrength: input.reasoning_strength ?? "high"
        });
        const paths = await saveImages(
          response.data.map(item => item.b64_json),
          { outputDir: config.outputDir, prefix: input.filename_prefix ?? "muse-edit", format }
        );
        return { content: [{ type: "text", text: formatResult(paths, response.usage) }] };
      } catch (error) {
        return toErrorResult(error);
      }
    }
  };

  /** 對話式多輪迭代修圖 */
  const iterateImage: ToolDefinition = {
    name: "iterate_image",
    config: {
      title: "Muse 對話式迭代修圖",
      description:
        "以對話方式多輪迭代修改圖片。回傳中一定包含 response_id；下一輪修改時把它填入 " +
        "previous_response_id 即可延續同一段對話，本 server 不保存任何對話狀態。" +
        "每張圖片成本 US$0.01。",
      inputSchema: {
        prompt: z.string().min(1).describe("本輪的修改指令"),
        previous_response_id: z
          .string()
          .optional()
          .describe("上一輪回傳的 response_id；省略代表開始一段新對話"),
        images: z.array(z.string().min(1)).optional().describe("首輪參考圖，本機路徑或 http(s) 網址"),
        reasoning_strength: z.enum(["high", "low"]).optional().describe("推理強度，預設 high"),
        filename_prefix: z.string().optional().describe("輸出檔名前綴，預設 muse-iter")
      }
    },
    handler: async (args: never): Promise<ToolResult> => {
      const input = args as {
        prompt: string;
        previous_response_id?: string;
        images?: string[];
        reasoning_strength?: ReasoningStrength;
        filename_prefix?: string;
      };
      try {
        let imageUrls: string[] | undefined;
        if (input.images && input.images.length > 0) {
          imageUrls = [];
          for (const item of input.images) {
            imageUrls.push(await toImageUrl(item));
          }
        }

        const result = await client.iterate({
          prompt: input.prompt,
          previousResponseId: input.previous_response_id,
          imageUrls,
          reasoningStrength: input.reasoning_strength ?? "high"
        });

        const paths = await saveImages(result.images, {
          outputDir: config.outputDir,
          prefix: input.filename_prefix ?? "muse-iter",
          format: result.outputFormat
        });

        const extra = [`response_id: ${result.responseId}（下一輪修改請把它填入 previous_response_id）`];
        return { content: [{ type: "text", text: formatResult(paths, result.usage, extra) }] };
      } catch (error) {
        return toErrorResult(error);
      }
    }
  };

  return [generateImage, editImage, iterateImage];
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/tools.test.ts`
Expected: PASS，14 個測試全綠

- [ ] **Step 5: 實作 `src/index.ts`（進入點）**

```ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { MuseError } from "./errors.js";
import { saveImages, toImageUrl } from "./image-store.js";
import { MuseClient } from "./muse-client.js";
import { createTools } from "./tools.js";

/**
 * 啟動 MCP server。
 * 注意：stdout 是 JSON-RPC 通道，所有日誌一律走 stderr。
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const client = new MuseClient(config);
  const tools = createTools({ client, config, saveImages, toImageUrl });

  const server = new McpServer({ name: "muse-image", version: "0.1.0" });
  for (const tool of tools) {
    server.registerTool(tool.name, tool.config, tool.handler as never);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`muse-image MCP server 已啟動（輸出目錄：${config.outputDir}）`);
}

main().catch((error: unknown) => {
  // 設定錯誤要給出可操作的訊息，避免 MCP server 靜默失敗難以排查
  if (error instanceof MuseError) {
    console.error(`[${error.kind}] ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
```

- [ ] **Step 6: 建置並驗證缺少 key 時的失敗訊息**

Run: `npm run build`
Expected: 無錯誤

Run（PowerShell，刻意不給 key）：

```powershell
$env:MUSE_API_KEY = ""; node dist/index.js
```

Expected: 立刻結束，stderr 印出含 `MUSE_API_KEY` 的中文設定說明，exit code 為 1

- [ ] **Step 7: 驗證有 key 時能完成 MCP 握手**

Run（PowerShell，用假 key 只驗協定層，不會真的打 API）：

```powershell
$env:MUSE_API_KEY = "dummy-key-for-handshake-test"
'{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js
```

Expected: stdout 輸出一行 JSON-RPC 回應，其中 `result.tools` 含 `generate_image`、`edit_image`、`iterate_image` 三個工具

- [ ] **Step 8: 跑完整測試套件**

Run: `npm test`
Expected: PASS，全部測試檔案（errors / config / muse-client / image-store / tools）全綠

- [ ] **Step 9: Commit**

```bash
git add src/tools.ts src/index.ts tests/tools.test.ts
git commit -m "feat: 三個 MCP 工具與 stdio 進入點"
```

---

## Task 6: 煙霧測試與文件

**Files:**
- Create: `tests/smoke.e2e.test.ts`, `README.md`
- Modify: `src/muse-client.ts`（僅在煙霧測試揭露真實回應結構與 spec 推測不符時才改）

**Interfaces:**
- Consumes: `loadConfig`、`MuseClient`、`saveImages` from Task 2–4
- Produces: 無新的公開介面

**⚠️ 這個 task 會真的花錢**（每張圖 US$0.01，本 task 約產生 3 張＝US$0.03），且需要開發者提供真實 API key。若開發者尚未提供 key，Step 3–6 標記為 blocked 並在最後回報時明說「煙霧測試未執行」，不可宣稱已驗證。

---

- [ ] **Step 1: 寫 `tests/smoke.e2e.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { MuseClient, extractB64Images } from "../src/muse-client.js";
import { saveImages } from "../src/image-store.js";

/**
 * 真實 API 煙霧測試。
 * 需要 MUSE_E2E=1 與真實的 MUSE_API_KEY 才會執行，每次約花費 US$0.03。
 * 由獨立的 vitest.e2e.config.ts 載入，預設的 `npm test` 不會跑到。
 */
const enabled = process.env.MUSE_E2E === "1";

describe.skipIf(!enabled)("Muse API 煙霧測試", () => {
  it("generate_image 能實際產出一張圖", async () => {
    const config = loadConfig();
    const client = new MuseClient(config);

    const response = await client.generate({
      prompt: "a simple flat-style icon of a blue cube on white background",
      n: 1,
      outputFormat: "png"
    });

    expect(response.data.length).toBe(1);
    expect(response.data[0]!.b64_json.length).toBeGreaterThan(1000);

    const paths = await saveImages([response.data[0]!.b64_json], {
      outputDir: config.outputDir,
      prefix: "smoke-generate",
      format: "png"
    });
    console.error(`[smoke] 生圖輸出：${paths[0]}`);
  });

  it("edit_image 能依剛產出的圖改圖", async () => {
    const config = loadConfig();
    const client = new MuseClient(config);

    const base = await client.generate({
      prompt: "a simple flat-style icon of a blue cube on white background",
      n: 1,
      outputFormat: "png"
    });
    const dataUrl = `data:image/png;base64,${base.data[0]!.b64_json}`;

    const edited = await client.edit({
      prompt: "change the cube color to red",
      imageUrls: [dataUrl],
      n: 1,
      outputFormat: "png"
    });

    expect(edited.data.length).toBe(1);
    const paths = await saveImages([edited.data[0]!.b64_json], {
      outputDir: config.outputDir,
      prefix: "smoke-edit",
      format: "png"
    });
    console.error(`[smoke] 改圖輸出：${paths[0]}`);
  });

  it("iterate_image 能取得 response_id 與圖片（驗證 /responses 的實際結構）", async () => {
    const config = loadConfig();
    const client = new MuseClient(config);

    const result = await client.iterate({
      prompt: "a simple flat-style icon of a green triangle on white background"
    });

    // 這三個斷言就是 spec §1「待實測確認」項目的驗證點
    expect(result.responseId).not.toBe("");
    expect(result.images.length).toBeGreaterThan(0);
    expect(result.images[0]!.length).toBeGreaterThan(1000);

    const paths = await saveImages(result.images, {
      outputDir: config.outputDir,
      prefix: "smoke-iterate",
      format: result.outputFormat
    });
    console.error(`[smoke] 迭代輸出：${paths.join(", ")}；response_id=${result.responseId}`);
  });
});

describe("extractB64Images 在真實結構上的健全性", () => {
  it("即使結構未知也不會誤抓非字串值", () => {
    expect(extractB64Images({ b64_json: 123, nested: { b64_json: "ok" } })).toEqual(["ok"]);
  });
});
```

- [ ] **Step 2: 確認預設測試不會誤觸 e2e**

Run: `npm test`
Expected: PASS，且輸出中**不含** `tests/smoke.e2e.test.ts`

- [ ] **Step 3: 向開發者索取 API key 並執行煙霧測試**

先確認開發者已把真實 key 放進環境變數（**不要**請開發者把 key 貼進對話）。

Run（PowerShell）：

```powershell
$env:MUSE_E2E = "1"
npm run smoke
```

Expected: 3 個測試通過，`muse-output/` 下出現 `smoke-generate-*.png`、`smoke-edit-*.png`、`smoke-iterate-*.png`

- [ ] **Step 4: 若 `iterate` 測試失敗，依真實回應修正 `src/muse-client.ts`**

失敗時先把實際回應印出來看結構：在 `iterate()` 的 `const raw = ...` 之後暫時加一行 `console.error(JSON.stringify(raw, null, 2).slice(0, 2000));`，重跑 `npm run smoke`，依實際結構修正下列三者之一，然後**移除**這行除錯輸出：

- `input` 的結構（目前推測為 `[{ role, content: [{ type: "input_text" | "input_image", ... }] }]`）
- `responseId` 的取值路徑（目前取 `raw.id`）
- `outputFormat` 的取值路徑（目前取 `raw.output_format`，找不到時預設 `png`）

修正後在 `tests/muse-client.test.ts` 補上對應真實結構的單元測試，再跑 `npx vitest run tests/muse-client.test.ts` 確認全綠。

- [ ] **Step 5: 撰寫 `README.md`**

````markdown
# muse-image-mcp

以 Meta Muse 影像模型提供生圖能力的 MCP server。支援文字生圖、依圖改圖、以及對話式多輪迭代修圖。

## 需求

- Node.js >= 20
- 一組 Meta Muse API key（於 <https://dev.meta.ai> 後台取得）

## 安裝

```bash
npm install
npm run build
```

## 設定到 Claude Code

```bash
claude mcp add muse-image node D:\GitHub\muse-image-mcp\dist\index.js \
  --scope user \
  --env MUSE_API_KEY=你的key \
  --env MUSE_OUTPUT_DIR=D:\muse-output
```

裝完要**重開一個新的 session**，`mcp__muse-image__*` 三個工具才會載入。用 `claude mcp list` 確認顯示 `muse-image: ... - Connected`。

### 環境變數

| 變數 | 必填 | 預設 | 說明 |
|---|---|---|---|
| `MUSE_API_KEY` | 是 | — | API key。缺少時 server 會立刻結束並在 stderr 說明 |
| `MUSE_OUTPUT_DIR` | 否 | `<cwd>/muse-output` | 圖片輸出目錄，不存在時自動建立 |
| `MUSE_BASE_URL` | 否 | `https://api.meta.ai/v1` | API base URL |
| `MUSE_TIMEOUT_MS` | 否 | `120000` | 單次請求逾時毫秒數 |

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

除 `generate_image` 的參數外，額外需要 `images`：本機檔案路徑（png/jpg/jpeg/webp/gif）或 http(s) 網址的陣列。本機檔案會自動轉成 base64。預設檔名前綴為 `muse-edit`。

### `iterate_image` — 對話式迭代修圖

| 參數 | 必填 | 說明 |
|---|---|---|
| `prompt` | 是 | 本輪修改指令 |
| `previous_response_id` | 否 | 上一輪回傳的 id；省略代表開新對話 |
| `images` | 否 | 首輪參考圖 |
| `reasoning_strength` | 否 | 預設 `high` |
| `filename_prefix` | 否 | 預設 `muse-iter` |

回應**一定包含 `response_id`**。下一輪把它填進 `previous_response_id` 即可延續同一段對話。本 server 不保存任何對話狀態，對話由 Meta 端保存。

## 計價

每張生成圖片 **US$0.01**，與 `reasoning_strength` 無關。每次工具回應都會揭露該次的預估成本。

## 開發

```bash
npm test          # 單元測試（不會打真實 API）
npm run build     # 編譯到 dist/
npm run smoke     # 真實 API 煙霧測試，需 MUSE_E2E=1 與真 key，約花費 US$0.03
```
````

- [ ] **Step 6: 最終驗證**

Run: `npm run build`
Expected: 無錯誤

Run: `npm test`
Expected: 全部單元測試通過

Run（PowerShell，實測 MCP 握手）：

```powershell
$env:MUSE_API_KEY = "dummy-key-for-handshake-test"
'{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js
```

Expected: 回應中三個工具都在

- [ ] **Step 7: Commit**

```bash
git add tests/smoke.e2e.test.ts README.md src/muse-client.ts tests/muse-client.test.ts
git commit -m "feat: 煙霧測試與使用說明文件"
```

---

## Self-Review 紀錄

**Spec 覆蓋檢查：**

| Spec 節次 | 對應 Task | 狀態 |
|---|---|---|
| §1 API 事實（三端點、參數、回應） | Task 3 | 涵蓋 |
| §1 待實測項目（`/responses` 結構） | Task 3 的 `extractB64Images` + Task 6 Step 3–4 | 涵蓋 |
| §2 範圍與 YAGNI 排除項 | 全部 task 均未實作被排除項 | 涵蓋 |
| §3.1 自寫 fetch client | Task 3 | 涵蓋 |
| §3.2 stateless iterate | Task 3 `iterate()` + Task 5 工具回傳 `response_id` | 涵蓋 |
| §3.3 落地檔案回傳路徑 | Task 4 + Task 5 `formatResult` | 涵蓋 |
| §4 模組邊界 | Task 1–5 的 File Structure（含 `tools.ts` 拆分偏離說明） | 涵蓋 |
| §5.1–5.3 三個工具的參數表 | Task 5 的 schema | 涵蓋 |
| §5.4 共同回傳格式 | Task 5 `formatResult` + 測試 | 涵蓋 |
| §6 四個環境變數與 fail fast | Task 2 + Task 5 Step 6 | 涵蓋 |
| §7 錯誤處理對照表（9 種分類） | Task 1 `errors.ts` + Task 3 retry + Task 4 io/input + Task 5 `toErrorResult` | 涵蓋 |
| §8 測試策略 | Task 1–6 各自的測試 | 涵蓋 |
| §10 完成定義 | Task 6 Step 6 | 涵蓋 |

**Placeholder 掃描：** 無 TBD／TODO；每個程式步驟都附完整可貼上的程式碼；唯一的條件分支（Task 6 Step 4）已寫明觸發條件、除錯手法與三個候選修正點。

**型別一致性檢查：**

- `Config` 四個欄位（`apiKey` / `baseUrl` / `outputDir` / `timeoutMs`）在 Task 2 定義，Task 3、5 與測試的用法一致
- `MuseError.kind` 九種值在 Task 1 定義，Task 2（`config`）、3（`invalid_request`/`moderation`/`auth`/`rate_limit`/`server`/`network`）、4（`input`/`io`）皆在此集合內
- `saveImages` 的簽章 `(b64List, { outputDir, prefix, format })` 在 Task 4 定義，Task 5 呼叫與測試斷言一致
- `toImageUrl(pathOrUrl): Promise<string>` 在 Task 4 定義，Task 5 呼叫一致
- 工具參數用 snake_case（MCP 對外介面），內部 params 用 camelCase（`outputFormat` / `reasoningStrength` / `previousResponseId` / `imageUrls`），轉換點統一在 Task 5 的 handler，測試已覆蓋
- `IterateResult` 四個欄位（`responseId` / `images` / `outputFormat` / `usage`）在 Task 1 定義，Task 3 產生、Task 5 消費，一致
