# 模型切換與參數擴充 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 muse-image-mcp 能以環境變數與單次工具參數切換模型、送出未知的新參數，並把專案調整到可被他人安裝的狀態後發佈到 GitHub。

**Architecture:** 新增純函式模組 `src/request-body.ts` 統一組裝三個 endpoint 的 request body——核心欄位、具名參數、全域擴充參數、單次擴充參數依序合併，核心欄位最後套用因而必勝，其鍵集合同時就是保護名單。`MuseClient` 退化為只管 HTTP，回傳型別包一層 `ClientResult<T>` 以攜帶被忽略的參數 key，由工具層轉為警告文字。

**Tech Stack:** TypeScript 7（nodenext、strict）、Node >= 20.12.0、@modelcontextprotocol/sdk 1.30.0（v1 API）、zod 4.6.2、vitest 5

**Spec:** [docs/superpowers/specs/2026-09-12-model-switching-design.md](../specs/2026-09-12-model-switching-design.md)

## Global Constraints

- Node.js 版本下限 `>=20.12.0`（`process.loadEnvFile` 需要），不得引入 `dotenv` 套件。
- MCP SDK 使用 **v1 API**：`McpServer` 來自 `@modelcontextprotocol/sdk/server/mcp.js`，`registerTool` 的 `inputSchema` 收 `ZodRawShape` 純物件（`{ prompt: z.string() }`），**不是** `z.object()`。
- zod 為 4.x：`z.record()` 需同時指定鍵與值 schema（`z.record(z.string(), z.unknown())`），zod 3 的單參數寫法會編譯失敗。
- 所有註解、錯誤訊息、工具說明文字一律繁體中文。
- 函式需有函式級別中文註解；重要變數與物件亦須註解。
- stdout 是 JSON-RPC 通道，任何日誌一律走 `console.error`。
- `tests/smoke.e2e.test.ts` 全程不得修改——它呼叫真實 API 需付費。
- 測試指令 `npm test`（vitest run，不含 e2e）；建置 `npm run build`。
- 每個 task 結束時 `npm test` 必須全綠、`npm run build` 必須 exit 0。
- 分支：`feat/model-switching`（已建立，spec 已 commit 於 `2d816af`）。

---

### Task 1: 設定層新增 MUSE_MODEL 與 MUSE_EXTRA_PARAMS

**Files:**
- Modify: `src/config.ts`（`Config` 介面、`loadConfig`）
- Modify: `tests/config.test.ts`
- Modify: `tests/muse-client.test.ts:6-11`（`CONFIG` 夾具補新欄位）
- Modify: `tests/tools.test.ts:6-11`（`CONFIG` 夾具補新欄位）

**Interfaces:**
- Consumes: 無（本 task 為起點）
- Produces: `Config` 新增兩個必填欄位 `model: string`、`extraParams: Record<string, unknown>`；模組常數 `DEFAULT_MODEL = "muse-image-1.0"`

- [ ] **Step 1: 寫失敗測試**

在 `tests/config.test.ts` 的 `describe("loadConfig", ...)` 區塊內、`it("逾時可覆寫", ...)` 之前插入：

```ts
  it("未設定 MUSE_MODEL 時使用預設模型", () => {
    expect(loadConfig({ MUSE_API_KEY: "k" }).model).toBe("muse-image-1.0");
  });

  it("MUSE_MODEL 可覆寫預設模型", () => {
    expect(loadConfig({ MUSE_API_KEY: "k", MUSE_MODEL: "muse-image-2.0" }).model).toBe("muse-image-2.0");
  });

  it("MUSE_MODEL 為空字串時視同未設定，使用預設模型", () => {
    expect(loadConfig({ MUSE_API_KEY: "k", MUSE_MODEL: "" }).model).toBe("muse-image-1.0");
  });

  it("MUSE_MODEL 為全空白時視同未設定，使用預設模型", () => {
    expect(loadConfig({ MUSE_API_KEY: "k", MUSE_MODEL: "   " }).model).toBe("muse-image-1.0");
  });

  it("未設定 MUSE_EXTRA_PARAMS 時為空物件", () => {
    expect(loadConfig({ MUSE_API_KEY: "k" }).extraParams).toEqual({});
  });

  it("MUSE_EXTRA_PARAMS 可解析為物件", () => {
    const config = loadConfig({ MUSE_API_KEY: "k", MUSE_EXTRA_PARAMS: '{"quality":"ultra","seed":7}' });
    expect(config.extraParams).toEqual({ quality: "ultra", seed: 7 });
  });

  it("MUSE_EXTRA_PARAMS 為空字串時視同未設定", () => {
    expect(loadConfig({ MUSE_API_KEY: "k", MUSE_EXTRA_PARAMS: "" }).extraParams).toEqual({});
  });

  it("MUSE_EXTRA_PARAMS 為非法 JSON 時拋出 config 類錯誤", () => {
    try {
      loadConfig({ MUSE_API_KEY: "k", MUSE_EXTRA_PARAMS: "{not json" });
      throw new Error("預期應該拋錯但沒有");
    } catch (err) {
      expect(err).toBeInstanceOf(MuseError);
      expect((err as MuseError).kind).toBe("config");
      expect((err as MuseError).message).toContain("MUSE_EXTRA_PARAMS");
    }
  });

  it("MUSE_EXTRA_PARAMS 為 JSON 陣列時拋出 config 類錯誤", () => {
    expect(() => loadConfig({ MUSE_API_KEY: "k", MUSE_EXTRA_PARAMS: "[1,2]" })).toThrow(MuseError);
  });

  it("MUSE_EXTRA_PARAMS 為 JSON null 時拋出 config 類錯誤", () => {
    expect(() => loadConfig({ MUSE_API_KEY: "k", MUSE_EXTRA_PARAMS: "null" })).toThrow(MuseError);
  });

  it("MUSE_EXTRA_PARAMS 為 JSON 數字時拋出 config 類錯誤", () => {
    expect(() => loadConfig({ MUSE_API_KEY: "k", MUSE_EXTRA_PARAMS: "42" })).toThrow(MuseError);
  });
```

同時修正既有的「只給 API key 時套用全部預設值」測試，補上兩個新欄位的斷言。把 `tests/config.test.ts:68-74` 整段換成：

```ts
  it("只給 API key 時套用全部預設值", () => {
    const config = loadConfig({ MUSE_API_KEY: "test-key" });
    expect(config.apiKey).toBe("test-key");
    expect(config.baseUrl).toBe("https://api.meta.ai/v1");
    expect(config.outputDir).toBe(resolve(process.cwd(), "muse-output"));
    expect(config.timeoutMs).toBe(120_000);
    expect(config.model).toBe("muse-image-1.0");
    expect(config.extraParams).toEqual({});
  });
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -- tests/config.test.ts`
Expected: FAIL——新測試斷言 `config.model` 為 `undefined`，且 TypeScript 報 `Property 'model' does not exist on type 'Config'`

- [ ] **Step 3: 修改 Config 介面與 loadConfig**

`src/config.ts` 的 `Config` 介面（第 30-39 行）改為：

```ts
/** 執行期設定，來源為環境變數（含由 .env 載入者） */
export interface Config {
  /** Meta Muse API key，唯一來源為 MUSE_API_KEY 環境變數 */
  apiKey: string;
  /** API base URL，結尾不含斜線 */
  baseUrl: string;
  /** 圖片輸出目錄的絕對路徑 */
  outputDir: string;
  /** 單次 HTTP 請求逾時毫秒數 */
  timeoutMs: number;
  /** 全域預設模型 ID，可被工具的 model 參數單次覆寫 */
  model: string;
  /** 全域預設額外參數，與工具的 extra_params 合併後送給 API */
  extraParams: Record<string, unknown>;
}
```

常數區（第 41-43 行）加一行：

```ts
const DEFAULT_MODEL = "muse-image-1.0";
```

在 `loadConfig` 的 timeout 解析之後、`return` 之前插入：

```ts
  // 空字串或全空白視同未設定，與 MUSE_BASE_URL、MUSE_OUTPUT_DIR 的處理一致
  const rawModel = (env.MUSE_MODEL ?? "").trim();
  const model = rawModel === "" ? DEFAULT_MODEL : rawModel;

  // 額外參數採 fail fast：設定錯誤時寧可啟動失敗，也不要讓參數靜默消失造成極難追的問題
  const rawExtraParams = (env.MUSE_EXTRA_PARAMS ?? "").trim();
  let extraParams: Record<string, unknown> = {};
  if (rawExtraParams !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawExtraParams);
    } catch {
      throw new MuseError(
        "config",
        `MUSE_EXTRA_PARAMS 必須是合法的 JSON 物件字串，例如 {"quality":"ultra"}，目前為 "${rawExtraParams}"。`
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new MuseError(
        "config",
        `MUSE_EXTRA_PARAMS 必須是 JSON 物件，不能是陣列、數字、字串或 null，目前為 "${rawExtraParams}"。`
      );
    }
    extraParams = parsed as Record<string, unknown>;
  }
```

`return` 那行（第 81 行）改為：

```ts
  return Object.freeze({ apiKey, baseUrl, outputDir, timeoutMs, model, extraParams });
```

- [ ] **Step 4: 修正兩個測試夾具**

`tests/muse-client.test.ts:6-11` 改為：

```ts
const CONFIG: Config = Object.freeze({
  apiKey: "test-key",
  baseUrl: "https://api.example.test/v1",
  outputDir: "/tmp/out",
  timeoutMs: 1000,
  model: "muse-image-1.0",
  extraParams: {}
});
```

`tests/tools.test.ts:6-11` 改為：

```ts
const CONFIG: Config = Object.freeze({
  apiKey: "k",
  baseUrl: "https://api.example.test/v1",
  outputDir: "/out",
  timeoutMs: 1000,
  model: "muse-image-1.0",
  extraParams: {}
});
```

- [ ] **Step 5: 執行測試確認通過**

Run: `npm test`
Expected: PASS，全套綠燈

- [ ] **Step 6: 確認建置通過**

Run: `npm run build`
Expected: exit 0，無 TypeScript 錯誤

- [ ] **Step 7: Commit**

```bash
git add src/config.ts tests/config.test.ts tests/muse-client.test.ts tests/tools.test.ts
git commit -m "feat: 設定層新增 MUSE_MODEL 與 MUSE_EXTRA_PARAMS

MUSE_EXTRA_PARAMS 採 fail fast：非法 JSON 或非物件一律於啟動時擲出
config 類錯誤，避免參數靜默消失。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: .env 搜尋鏈加家目錄 fallback、預設輸出目錄改名

**Files:**
- Modify: `src/config.ts`（`loadDotEnvFile`、`DEFAULT_OUTPUT_DIR`、缺 key 的錯誤訊息）
- Modify: `src/index.ts:16,28-31`（啟動訊息顯示實際載入路徑）
- Modify: `tests/config.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Task 1 的 `Config`
- Produces: `loadDotEnvFile(envPaths?: string[]): string | null`（回傳實際載入的路徑，全部失敗回傳 `null`）；`envCandidatePaths(): string[]`；`DEFAULT_OUTPUT_DIR = "generated-images"`

- [ ] **Step 1: 寫失敗測試**

把 `tests/config.test.ts` 的 `describe("loadDotEnvFile", ...)` 整段（第 15-50 行）換成：

```ts
describe("loadDotEnvFile", () => {
  it("能把 .env 的內容載入 process.env，並回傳實際載入的路徑", async () => {
    const dir = await mkdtemp(join(tmpdir(), "muse-dotenv-"));
    try {
      const envPath = join(dir, ".env");
      await writeFile(envPath, "DOTENV_PROBE_A=from_file\n", "utf8");

      expect(loadDotEnvFile([envPath])).toBe(envPath);
      expect(process.env.DOTENV_PROBE_A).toBe("from_file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("既有的環境變數優先，不會被 .env 覆寫", async () => {
    const dir = await mkdtemp(join(tmpdir(), "muse-dotenv-"));
    try {
      process.env.DOTENV_PROBE_B = "from_shell";
      await writeFile(join(dir, ".env"), "DOTENV_PROBE_B=from_file\n", "utf8");

      loadDotEnvFile([join(dir, ".env")]);

      expect(process.env.DOTENV_PROBE_B).toBe("from_shell");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("全部候選路徑都不存在時回傳 null 且不拋錯", () => {
    expect(loadDotEnvFile([join(tmpdir(), "definitely-not-here", ".env")])).toBe(null);
  });

  it("依序搜尋候選路徑，採用第一個存在者", async () => {
    const dir = await mkdtemp(join(tmpdir(), "muse-dotenv-"));
    try {
      const second = join(dir, "second.env");
      await writeFile(second, "DOTENV_PROBE_A=from_second\n", "utf8");

      const missing = join(dir, "missing.env");
      expect(loadDotEnvFile([missing, second])).toBe(second);
      expect(process.env.DOTENV_PROBE_A).toBe("from_second");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("候選路徑預設為套件根目錄與家目錄，且順序為套件根優先", () => {
    const candidates = envCandidatePaths();
    expect(candidates).toEqual([
      resolve(PACKAGE_ROOT, ".env"),
      resolve(homedir(), ".muse-image-mcp", ".env")
    ]);
  });

  it("PACKAGE_ROOT 指向專案根目錄（該處有 package.json）", async () => {
    const { access } = await import("node:fs/promises");
    await expect(access(join(PACKAGE_ROOT, "package.json"))).resolves.toBeUndefined();
  });
});
```

`tests/config.test.ts` 的 import 區（第 1-6 行）改為：

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { envCandidatePaths, loadConfig, loadDotEnvFile, PACKAGE_ROOT } from "../src/config.js";
import { MuseError } from "../src/errors.js";
```

再把 `describe("loadConfig", ...)` 內三處提到 `muse-output` 的測試改為 `generated-images`：

```ts
  it("只給 API key 時套用全部預設值", () => {
    const config = loadConfig({ MUSE_API_KEY: "test-key" });
    expect(config.apiKey).toBe("test-key");
    expect(config.baseUrl).toBe("https://api.meta.ai/v1");
    expect(config.outputDir).toBe(resolve(process.cwd(), "generated-images"));
    expect(config.timeoutMs).toBe(120_000);
    expect(config.model).toBe("muse-image-1.0");
    expect(config.extraParams).toEqual({});
  });
```

```ts
  it("MUSE_OUTPUT_DIR 為空字串時視同未設定，使用預設值 generated-images", () => {
    const config = loadConfig({ MUSE_API_KEY: "k", MUSE_OUTPUT_DIR: "" });
    expect(config.outputDir).toBe(resolve(process.cwd(), "generated-images"));
  });

  it("MUSE_OUTPUT_DIR 為全空白字串時視同未設定，使用預設值 generated-images", () => {
    const config = loadConfig({ MUSE_API_KEY: "k", MUSE_OUTPUT_DIR: "   " });
    expect(config.outputDir).toBe(resolve(process.cwd(), "generated-images"));
  });
```

最後加一個錯誤訊息測試，放在 `it("缺少 MUSE_API_KEY 時拋出 config 類錯誤", ...)` 之後：

```ts
  it("缺少 MUSE_API_KEY 的錯誤訊息會列出完整的 .env 搜尋鏈", () => {
    try {
      loadConfig({});
      throw new Error("預期應該拋錯但沒有");
    } catch (err) {
      const message = (err as MuseError).message;
      for (const candidate of envCandidatePaths()) {
        expect(message).toContain(candidate);
      }
    }
  });
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -- tests/config.test.ts`
Expected: FAIL——`envCandidatePaths` 尚未匯出，TypeScript 報 `has no exported member 'envCandidatePaths'`

- [ ] **Step 3: 改寫 loadDotEnvFile 與預設輸出目錄**

`src/config.ts` 的 import 區（第 1-3 行）改為：

```ts
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MuseError } from "./errors.js";
```

把第 12-27 行的 `loadDotEnvFile` 整段換成：

```ts
/**
 * 取得 .env 的候選路徑，依搜尋優先序排列。
 * 套件根優先是為了讓本機 clone 的既有用法不受影響；家目錄是經 npx 安裝時
 * 使用者唯一可控的固定位置——npx 執行時套件根位於 npm 快取目錄，帶雜湊且會被清除。
 */
export function envCandidatePaths(): string[] {
  return [resolve(PACKAGE_ROOT, ".env"), resolve(homedir(), ".muse-image-mcp", ".env")];
}

/**
 * 依序嘗試候選路徑，載入第一個存在的 .env 到 process.env。
 * 使用 Node 內建的 process.loadEnvFile（Node >= 20.12），不引入 dotenv 套件。
 * 已存在的環境變數不會被覆寫，因此 MCP client 傳入的 env 永遠優先於 .env。
 * @param envPaths 候選路徑清單，預設為 envCandidatePaths()
 * @returns 實際載入的路徑；全部都不存在或格式錯誤時回傳 null 而不拋錯——
 *          只用 MCP 設定的 env 區塊提供 key 也是合法用法，不該因為沒有 .env 就啟動失敗。
 */
export function loadDotEnvFile(envPaths: string[] = envCandidatePaths()): string | null {
  for (const envPath of envPaths) {
    try {
      process.loadEnvFile(envPath);
      return envPath;
    } catch {
      // 這個候選不存在或讀不了，換下一個
    }
  }
  return null;
}
```

`DEFAULT_OUTPUT_DIR` 常數改為：

```ts
const DEFAULT_OUTPUT_DIR = "generated-images";
```

缺 key 的錯誤訊息（第 53-57 行）改為：

```ts
    throw new MuseError(
      "config",
      `缺少 MUSE_API_KEY。請擇一設定：(1) 在下列任一位置建立 .env 檔並寫入 MUSE_API_KEY=你的key（依序採用第一個存在者）：` +
        `${envCandidatePaths().join("、")}，或 (2) 在 MCP server 設定的 env 區塊填入。` +
        "API key 可於 https://dev.meta.ai 後台取得。"
    );
```

第 66-67 行的註解中 `muse-output/` 改為 `generated-images/`。

- [ ] **Step 4: 更新 index.ts 的啟動訊息**

`src/index.ts:16` 改為：

```ts
  // 依序搜尋套件根與家目錄的 .env；已存在的環境變數優先，故 MCP 設定的 env 不會被蓋掉
  const dotEnvPath = loadDotEnvFile();
```

`src/index.ts:28-31` 改為：

```ts
  console.error(
    `muse-image MCP server 已啟動（模型：${config.model}；輸出目錄：${config.outputDir}；` +
      `.env：${dotEnvPath ?? "未使用"}）`
  );
```

- [ ] **Step 5: 更新 .gitignore**

把 `.gitignore` 的 `muse-output/` 那一行改為：

```
generated-images/
```

保留其餘四行（`node_modules/`、`dist/`、`.env`、`*.log`）不動。

- [ ] **Step 6: 執行測試確認通過**

Run: `npm test`
Expected: PASS，全套綠燈

- [ ] **Step 7: 確認建置通過**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 8: Commit**

```bash
git add src/config.ts src/index.ts tests/config.test.ts .gitignore
git commit -m "feat: .env 搜尋鏈加家目錄 fallback，預設輸出目錄改為 generated-images

npx 執行時套件根位於 npm 快取目錄，使用者無法放 .env，
故新增 ~/.muse-image-mcp/.env 作為第二候選。
loadDotEnvFile 回傳實際載入路徑以便啟動訊息指出 key 來源。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 合併層 request-body.ts

**Files:**
- Create: `src/request-body.ts`
- Test: `tests/request-body.test.ts`

**Interfaces:**
- Consumes: 無（純函式模組，不依賴任何既有程式碼）
- Produces:
  - `buildRequestBody(input: BuildRequestBodyInput): BuildRequestBodyResult`
  - `interface BuildRequestBodyInput { core: Record<string, unknown>; named: Record<string, unknown>; defaultExtra: Record<string, unknown>; callExtra?: Record<string, unknown> }`
  - `interface BuildRequestBodyResult { body: Record<string, unknown>; blockedKeys: string[] }`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/request-body.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { buildRequestBody } from "../src/request-body.js";

describe("buildRequestBody", () => {
  it("合併核心欄位與具名參數", () => {
    const { body } = buildRequestBody({
      core: { model: "m1", prompt: "a fox", response_format: "b64_json" },
      named: { n: 2, size: "1024x1024" },
      defaultExtra: {}
    });

    expect(body).toEqual({
      model: "m1",
      prompt: "a fox",
      response_format: "b64_json",
      n: 2,
      size: "1024x1024"
    });
  });

  it("移除值為 undefined 的具名參數", () => {
    const { body } = buildRequestBody({
      core: { model: "m1", prompt: "a fox" },
      named: { n: 1, size: undefined, output_format: undefined },
      defaultExtra: {}
    });

    expect(body).toEqual({ model: "m1", prompt: "a fox", n: 1 });
    expect("size" in body).toBe(false);
  });

  it("移除值為 undefined 的核心欄位，body 不含該鍵", () => {
    const { body } = buildRequestBody({
      core: { model: "m1", input: "hi", store: true, previous_response_id: undefined },
      named: {},
      defaultExtra: {}
    });

    expect(body).toEqual({ model: "m1", input: "hi", store: true });
  });

  it("全域擴充參數會併入 body", () => {
    const { body } = buildRequestBody({
      core: { model: "m1", prompt: "p" },
      named: {},
      defaultExtra: { quality: "ultra" }
    });

    expect(body.quality).toBe("ultra");
  });

  it("單次擴充參數覆寫全域擴充參數", () => {
    const { body } = buildRequestBody({
      core: { model: "m1", prompt: "p" },
      named: {},
      defaultExtra: { quality: "ultra", seed: 1 },
      callExtra: { quality: "draft" }
    });

    expect(body.quality).toBe("draft");
    expect(body.seed).toBe(1);
  });

  it("擴充參數可覆寫具名參數", () => {
    const { body } = buildRequestBody({
      core: { model: "m1", prompt: "p" },
      named: { size: "1024x1024" },
      defaultExtra: {},
      callExtra: { size: "2048x2048" }
    });

    expect(body.size).toBe("2048x2048");
  });

  it("擴充參數不得覆寫核心欄位，並列入 blockedKeys", () => {
    const { body, blockedKeys } = buildRequestBody({
      core: { model: "m1", prompt: "real prompt" },
      named: {},
      defaultExtra: {},
      callExtra: { model: "hijack", prompt: "fake prompt", quality: "ultra" }
    });

    expect(body.model).toBe("m1");
    expect(body.prompt).toBe("real prompt");
    expect(body.quality).toBe("ultra");
    expect(blockedKeys.sort()).toEqual(["model", "prompt"]);
  });

  it("值為 undefined 的核心欄位其鍵仍受保護", () => {
    const { body, blockedKeys } = buildRequestBody({
      core: { model: "m1", previous_response_id: undefined },
      named: {},
      defaultExtra: {},
      callExtra: { previous_response_id: "resp_hijack" }
    });

    expect("previous_response_id" in body).toBe(false);
    expect(blockedKeys).toEqual(["previous_response_id"]);
  });

  it("全域與單次擴充參數撞到同一個核心欄位時，blockedKeys 不重複", () => {
    const { blockedKeys } = buildRequestBody({
      core: { model: "m1" },
      named: {},
      defaultExtra: { model: "a" },
      callExtra: { model: "b" }
    });

    expect(blockedKeys).toEqual(["model"]);
  });

  it("沒有任何衝突時 blockedKeys 為空陣列", () => {
    const { blockedKeys } = buildRequestBody({
      core: { model: "m1", prompt: "p" },
      named: { n: 1 },
      defaultExtra: { quality: "ultra" }
    });

    expect(blockedKeys).toEqual([]);
  });

  it("省略 callExtra 時行為正常", () => {
    const { body, blockedKeys } = buildRequestBody({
      core: { model: "m1", prompt: "p" },
      named: { n: 1 },
      defaultExtra: {}
    });

    expect(body).toEqual({ model: "m1", prompt: "p", n: 1 });
    expect(blockedKeys).toEqual([]);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -- tests/request-body.test.ts`
Expected: FAIL，錯誤訊息為找不到模組 `../src/request-body.js`

- [ ] **Step 3: 實作 request-body.ts**

建立 `src/request-body.ts`：

```ts
/**
 * Request body 合併層。
 * 三個 endpoint（/images/generations、/images/edits、/responses）的 body 形狀不同，
 * 但「核心欄位受保護、擴充參數可覆寫一般參數」這條規則相同，故收斂於此單一模組。
 */

/** 組 body 的輸入 */
export interface BuildRequestBodyInput {
  /**
   * 決定請求結構的核心欄位，不可被擴充參數覆寫。
   * 其鍵集合同時就是保護名單——保護哪些欄位由呼叫端的結構決定，本模組不需認識任何 endpoint。
   */
  core: Record<string, unknown>;
  /** 一般具名參數，可被擴充參數覆寫 */
  named: Record<string, unknown>;
  /** 全域預設額外參數，來自 config.extraParams */
  defaultExtra: Record<string, unknown>;
  /** 單次呼叫的額外參數，來自工具參數 extra_params */
  callExtra?: Record<string, unknown>;
}

/** 組 body 的結果 */
export interface BuildRequestBodyResult {
  /** 可直接 JSON.stringify 送出的 request body */
  body: Record<string, unknown>;
  /** 因撞到核心欄位而被忽略的 key，供工具層回報警告 */
  blockedKeys: string[];
}

/** 去除物件中值為 undefined 的欄位，避免送出 `"size": null` 這類無效欄位 */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

/**
 * 依「具名參數 → 全域擴充 → 單次擴充 → 核心欄位」的順序合併出最終 request body。
 * 核心欄位最後套用，因此必定勝出——保護機制即由這個順序與 core 的鍵集合共同表達，
 * 不需維護硬編的保護欄位清單。
 * @param input 四個來源的參數
 * @returns 合併後的 body，以及被忽略的擴充參數 key
 */
export function buildRequestBody(input: BuildRequestBodyInput): BuildRequestBodyResult {
  const { core, named, defaultExtra, callExtra = {} } = input;

  // core 的鍵集合即保護名單。即使該鍵的值是 undefined（欄位不會送出），
  // 仍不允許擴充參數從旁塞值進來，否則「這次沒給」會變成破口。
  const protectedKeys = new Set(Object.keys(core));
  const extraKeys = [...Object.keys(defaultExtra), ...Object.keys(callExtra)];
  const blockedKeys = [...new Set(extraKeys.filter(key => protectedKeys.has(key)))];

  const body = compact({ ...named, ...defaultExtra, ...callExtra, ...core });

  return { body, blockedKeys };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npm test -- tests/request-body.test.ts`
Expected: PASS，11 個測試全過

- [ ] **Step 5: 執行全套測試與建置**

Run: `npm test && npm run build`
Expected: 全套綠燈、build exit 0

- [ ] **Step 6: Commit**

```bash
git add src/request-body.ts tests/request-body.test.ts
git commit -m "feat: 新增 request body 合併層

核心欄位最後套用故必定勝出，其鍵集合同時即保護名單——
保護哪些欄位由呼叫端的 core 結構決定，本模組不需認識任何 endpoint，
因此兩種完全不同的 body 形狀可共用同一套規則。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 型別層與 MuseClient 接上合併層

**Files:**
- Modify: `src/types.ts`
- Modify: `src/muse-client.ts`
- Modify: `tests/muse-client.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Config.model` / `Config.extraParams`；Task 3 的 `buildRequestBody`
- Produces:
  - `interface ModelOverrides { model?: string; extraParams?: Record<string, unknown> }`
  - `interface ClientResult<T> { result: T; blockedKeys: string[] }`
  - `MuseClient.generate(params: GenerateParams): Promise<ClientResult<MuseImageResponse>>`
  - `MuseClient.edit(params: EditParams): Promise<ClientResult<MuseImageResponse>>`
  - `MuseClient.iterate(params: IterateParams): Promise<ClientResult<IterateResult>>`

- [ ] **Step 1: 寫失敗測試**

在 `tests/muse-client.test.ts` 的 `describe("MuseClient.generate", ...)` 內加入：

```ts
  it("可用 params.model 覆寫 config 的預設模型", async () => {
    const fetchImpl = fakeFetch(200, OK_IMAGE_BODY);
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.generate({ prompt: "p", model: "muse-image-9.9" });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string).model).toBe("muse-image-9.9");
  });

  it("未給 params.model 時採用 config.model", async () => {
    const fetchImpl = fakeFetch(200, OK_IMAGE_BODY);
    const config: Config = Object.freeze({ ...CONFIG, model: "muse-image-from-config" });
    const client = new MuseClient(config, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.generate({ prompt: "p" });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string).model).toBe("muse-image-from-config");
  });

  it("config.extraParams 會併入 body", async () => {
    const fetchImpl = fakeFetch(200, OK_IMAGE_BODY);
    const config: Config = Object.freeze({ ...CONFIG, extraParams: { quality: "ultra" } });
    const client = new MuseClient(config, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.generate({ prompt: "p" });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string).quality).toBe("ultra");
  });

  it("params.extraParams 覆寫 config.extraParams", async () => {
    const fetchImpl = fakeFetch(200, OK_IMAGE_BODY);
    const config: Config = Object.freeze({ ...CONFIG, extraParams: { quality: "ultra" } });
    const client = new MuseClient(config, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.generate({ prompt: "p", extraParams: { quality: "draft", seed: 7 } });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.quality).toBe("draft");
    expect(body.seed).toBe(7);
  });

  it("extraParams 不得覆寫 prompt 與 model，並以 blockedKeys 回報", async () => {
    const fetchImpl = fakeFetch(200, OK_IMAGE_BODY);
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    const { blockedKeys } = await client.generate({
      prompt: "real",
      extraParams: { prompt: "fake", model: "hijack" }
    });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.prompt).toBe("real");
    expect(body.model).toBe("muse-image-1.0");
    expect(blockedKeys.sort()).toEqual(["model", "prompt"]);
  });

  it("回傳值以 result 攜帶 API 回應", async () => {
    const fetchImpl = fakeFetch(200, OK_IMAGE_BODY);
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    const { result } = await client.generate({ prompt: "p" });

    expect(result.data[0]!.b64_json).toBe("AAAA");
  });
```

在 `describe("MuseClient.iterate", ...)` 內加入：

```ts
  it("extraParams 不得覆寫 store 與 input 等核心欄位", async () => {
    const fetchImpl = fakeFetch(200, { id: "resp_1", output: [{ type: "image_generation_call", result: "ZZZZ" }] });
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    const { blockedKeys } = await client.iterate({
      prompt: "p",
      extraParams: { store: false, input: "hijack", quality: "ultra" }
    });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.store).toBe(true);
    expect(body.input).toBe("p");
    expect(body.quality).toBe("ultra");
    expect(blockedKeys.sort()).toEqual(["input", "store"]);
  });
```

既有測試中所有 `await client.generate(...)`、`client.edit(...)`、`client.iterate(...)` 若有直接取用回傳值（例如 `const result = await client.iterate(...)` 後存取 `result.responseId`），一律改為解構 `const { result } = await client.iterate(...)`。逐一檢視 `tests/muse-client.test.ts` 全檔調整。

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -- tests/muse-client.test.ts`
Expected: FAIL——`blockedKeys` 不存在於回傳值，TypeScript 報型別錯誤

- [ ] **Step 3: 新增型別**

在 `src/types.ts` 檔尾加入：

```ts
/** 三個工具共用的模型與擴充參數覆寫 */
export interface ModelOverrides {
  /** 模型 ID，省略則採用 config.model */
  model?: string;
  /** 單次呼叫的額外參數，與 config.extraParams 合併後套用 */
  extraParams?: Record<string, unknown>;
}

/**
 * client 方法的回傳包裝。
 * blockedKeys 是本地產生的資訊，不塞進 MuseImageResponse——後者是 API 回應的忠實對應，
 * 混入本地欄位會讓它不再能代表 API 契約。
 */
export interface ClientResult<T> {
  /** API 回應或其解析結果 */
  result: T;
  /** 因撞到核心欄位而被忽略的擴充參數 key */
  blockedKeys: string[];
}
```

把 `GenerateParams` 與 `IterateParams` 的宣告改為繼承 `ModelOverrides`：

```ts
/** 文字生圖參數（已由工具層正規化，欄位為 camelCase） */
export interface GenerateParams extends ModelOverrides {
  prompt: string;
  n?: number;
  /** 長寬比字串如 "1792x1024"，非精確像素 */
  size?: string;
  outputFormat?: OutputFormat;
  reasoningStrength?: ReasoningStrength;
}
```

```ts
/** 對話式迭代參數 */
export interface IterateParams extends ModelOverrides {
  prompt: string;
  /** 上一輪回傳的 response id；省略代表開新對話 */
  previousResponseId?: string;
  imageUrls?: string[];
  reasoningStrength?: ReasoningStrength;
}
```

`EditParams` 不動——它已 extends `GenerateParams`，自動繼承。

- [ ] **Step 4: 改寫 MuseClient**

`src/muse-client.ts` 的 import 區加入：

```ts
import { buildRequestBody } from "./request-body.js";
```

type import 區加入 `ClientResult`：

```ts
import type {
  ClientResult,
  EditParams,
  GenerateParams,
  IterateParams,
  IterateResult,
  MuseImageResponse,
  MuseUsage,
  OutputFormat
} from "./types.js";
```

刪除模組常數 `MODEL`（第 15 行的 `const MODEL = "muse-image-1.0";` 與其上方註解）與本地的 `compact` 函式（合併層已提供）。

`generate` 改為：

```ts
  /** 文字生圖 */
  async generate(params: GenerateParams): Promise<ClientResult<MuseImageResponse>> {
    const { body, blockedKeys } = buildRequestBody({
      core: {
        model: params.model ?? this.config.model,
        prompt: params.prompt,
        response_format: "b64_json"
      },
      named: {
        n: params.n,
        size: params.size,
        output_format: params.outputFormat,
        reasoning_strength: params.reasoningStrength
      },
      defaultExtra: this.config.extraParams,
      callExtra: params.extraParams
    });
    const result = (await this.request("/images/generations", body)) as MuseImageResponse;
    return { result, blockedKeys };
  }
```

`edit` 改為：

```ts
  /** 依既有圖片改圖。imageUrls 須為 data URL 或 http(s) URL。 */
  async edit(params: EditParams): Promise<ClientResult<MuseImageResponse>> {
    const { body, blockedKeys } = buildRequestBody({
      core: {
        model: params.model ?? this.config.model,
        prompt: params.prompt,
        response_format: "b64_json",
        images: params.imageUrls.map(url => ({ image_url: url }))
      },
      named: {
        n: params.n,
        size: params.size,
        output_format: params.outputFormat,
        reasoning_strength: params.reasoningStrength
      },
      defaultExtra: this.config.extraParams,
      callExtra: params.extraParams
    });
    const result = (await this.request("/images/edits", body)) as MuseImageResponse;
    return { result, blockedKeys };
  }
```

`iterate` 的簽章與 body 組裝改為（`input` 的計算與後續的圖片萃取邏輯保持原樣）：

```ts
  async iterate(params: IterateParams): Promise<ClientResult<IterateResult>> {
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

    const { body, blockedKeys } = buildRequestBody({
      core: {
        model: params.model ?? this.config.model,
        input,
        store: true,
        previous_response_id: params.previousResponseId
      },
      named: { reasoning_strength: params.reasoningStrength },
      defaultExtra: this.config.extraParams,
      callExtra: params.extraParams
    });

    const raw = (await this.request("/responses", body)) as Record<string, unknown>;
    const images = extractB64Images(raw);
    if (images.length === 0) {
      throw new MuseError(
        "server",
        `Muse /responses 回應中找不到任何圖片資料（b64_json 或 image_generation_call.result）。原始回應：${JSON.stringify(raw).slice(0, 500)}`
      );
    }

    const responseId = typeof raw.id === "string" ? raw.id : "";
    // 實測 /v1/responses 不會回傳 output_format 欄位；未帶 output_format 參數時 Meta 端預設輸出 webp，故以此為 fallback
    const outputFormat = (typeof raw.output_format === "string" ? raw.output_format : "webp") as OutputFormat;

    return {
      result: {
        responseId,
        images,
        outputFormat,
        usage: raw.usage as MuseUsage | undefined
      },
      blockedKeys
    };
  }
```

- [ ] **Step 5: 執行測試確認通過**

Run: `npm test -- tests/muse-client.test.ts`
Expected: PASS

- [ ] **Step 6: 確認全套與建置**

Run: `npm test && npm run build`
Expected: `tests/tools.test.ts` 此時會 FAIL（工具層還在用舊的回傳形狀），這是預期內的——**若 tools 測試失敗，直接進入 Task 5，不要在此回頭修改工具層**。`npm run build` 也會因工具層型別不符而失敗，同樣留給 Task 5。

僅需確認 `tests/muse-client.test.ts`、`tests/request-body.test.ts`、`tests/config.test.ts`、`tests/errors.test.ts`、`tests/image-store.test.ts` 五支全綠。

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/muse-client.ts tests/muse-client.test.ts
git commit -m "feat: MuseClient 接上合併層，回傳值改以 ClientResult 包裝

移除硬編的 MODEL 常數與本地 compact，改由 request-body 統一組裝。
blockedKeys 另外包裝而不塞進 MuseImageResponse，保持該型別忠實對應 API 契約。
工具層尚未跟進，本 commit 的 tools 測試與 build 預期失敗，由下一個 task 收斂。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 工具層新增 model / extra_params 參數與衝突警告

**Files:**
- Modify: `src/tools.ts`
- Modify: `tests/tools.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `ClientResult<T>`、`ModelOverrides`
- Produces: `blockedWarning(blockedKeys: string[]): string[]`；三個工具的 inputSchema 各新增 `model` 與 `extra_params`

- [ ] **Step 1: 寫失敗測試**

`tests/tools.test.ts` 的 `makeDeps` 內三個 client 假物件改為回傳 `ClientResult` 形狀：

```ts
    client: {
      generate: vi.fn(async () => ({
        result: {
          created: 1,
          data: [{ b64_json: "AAAA" }],
          output_format: "png" as const,
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
        },
        blockedKeys: [] as string[]
      })),
      edit: vi.fn(async () => ({
        result: {
          created: 1,
          data: [{ b64_json: "BBBB" }],
          output_format: "png" as const
        },
        blockedKeys: [] as string[]
      })),
      iterate: vi.fn(async () => ({
        result: {
          responseId: "resp_42",
          images: ["CCCC"],
          outputFormat: "png" as const,
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
        },
        blockedKeys: [] as string[]
      }))
    },
```

並在檔尾新增一個 describe：

```ts
describe("模型與擴充參數", () => {
  it("generate_image 的 schema 含 model 與 extra_params", () => {
    const tools = createTools(makeDeps());
    const shape = pick(tools, "generate_image").config.inputSchema;
    expect(shape.model).toBeDefined();
    expect(shape.extra_params).toBeDefined();
  });

  it("edit_image 的 schema 含 model 與 extra_params", () => {
    const tools = createTools(makeDeps());
    const shape = pick(tools, "edit_image").config.inputSchema;
    expect(shape.model).toBeDefined();
    expect(shape.extra_params).toBeDefined();
  });

  it("iterate_image 的 schema 含 model 與 extra_params", () => {
    const tools = createTools(makeDeps());
    const shape = pick(tools, "iterate_image").config.inputSchema;
    expect(shape.model).toBeDefined();
    expect(shape.extra_params).toBeDefined();
  });

  it("generate_image 把 model 與 extra_params 透傳給 client", async () => {
    const deps = makeDeps();
    const tools = createTools(deps);
    await pick(tools, "generate_image").handler({
      prompt: "p",
      model: "muse-image-9.9",
      extra_params: { quality: "ultra" }
    } as never);

    expect(deps.client.generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "muse-image-9.9", extraParams: { quality: "ultra" } })
    );
  });

  it("edit_image 把 model 與 extra_params 透傳給 client", async () => {
    const deps = makeDeps();
    const tools = createTools(deps);
    await pick(tools, "edit_image").handler({
      prompt: "p",
      images: ["http://example.test/a.png"],
      model: "muse-image-9.9",
      extra_params: { quality: "ultra" }
    } as never);

    expect(deps.client.edit).toHaveBeenCalledWith(
      expect.objectContaining({ model: "muse-image-9.9", extraParams: { quality: "ultra" } })
    );
  });

  it("iterate_image 把 model 與 extra_params 透傳給 client", async () => {
    const deps = makeDeps();
    const tools = createTools(deps);
    await pick(tools, "iterate_image").handler({
      prompt: "p",
      model: "muse-image-9.9",
      extra_params: { quality: "ultra" }
    } as never);

    expect(deps.client.iterate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "muse-image-9.9", extraParams: { quality: "ultra" } })
    );
  });

  it("blockedKeys 非空時在回應文字附加警告行", async () => {
    const deps = makeDeps({
      client: {
        generate: vi.fn(async () => ({
          result: { created: 1, data: [{ b64_json: "AAAA" }], output_format: "png" as const },
          blockedKeys: ["model", "prompt"]
        })),
        edit: vi.fn(async () => ({
          result: { created: 1, data: [{ b64_json: "BBBB" }], output_format: "png" as const },
          blockedKeys: [] as string[]
        })),
        iterate: vi.fn(async () => ({
          result: { responseId: "r", images: ["CCCC"], outputFormat: "png" as const },
          blockedKeys: [] as string[]
        }))
      }
    });
    const tools = createTools(deps);
    const result = await pick(tools, "generate_image").handler({ prompt: "p" } as never);

    expect(result.content[0]!.text).toContain("已忽略：model, prompt");
  });

  it("blockedKeys 為空時不附加警告行", async () => {
    const tools = createTools(makeDeps());
    const result = await pick(tools, "generate_image").handler({ prompt: "p" } as never);

    expect(result.content[0]!.text).not.toContain("已忽略");
  });

  it("iterate_image 的警告與 response_id 提示可並存", async () => {
    const deps = makeDeps({
      client: {
        generate: vi.fn(async () => ({
          result: { created: 1, data: [{ b64_json: "AAAA" }], output_format: "png" as const },
          blockedKeys: [] as string[]
        })),
        edit: vi.fn(async () => ({
          result: { created: 1, data: [{ b64_json: "BBBB" }], output_format: "png" as const },
          blockedKeys: [] as string[]
        })),
        iterate: vi.fn(async () => ({
          result: { responseId: "resp_42", images: ["CCCC"], outputFormat: "png" as const },
          blockedKeys: ["store"]
        }))
      }
    });
    const tools = createTools(deps);
    const result = await pick(tools, "iterate_image").handler({ prompt: "p" } as never);

    expect(result.content[0]!.text).toContain("response_id: resp_42");
    expect(result.content[0]!.text).toContain("已忽略：store");
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -- tests/tools.test.ts`
Expected: FAIL——`shape.model` 為 undefined、警告文字不存在

- [ ] **Step 3: 確認 zod 4 的 z.record 寫法可編譯**

Run:
```bash
node -e "const {z}=require('zod'); const s=z.record(z.string(), z.unknown()); console.log(s.parse({a:1}))"
```
Expected: 印出 `{ a: 1 }`。若此寫法報錯，改查 `node_modules/zod/package.json` 的版本並以該版本正確的 record 寫法替代，後續步驟一併調整。

- [ ] **Step 4: 修改 tools.ts**

在 `commonShape` 之後新增共用片段：

```ts
/** 三個工具共用的模型與擴充參數覆寫 schema 片段 */
const overrideShape = {
  model: z.string().optional().describe("模型 ID，省略則使用伺服器設定的預設模型"),
  extra_params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "傳給 API 的額外參數（物件），用於新模型的特殊參數。會與伺服器全域設定合併，單次設定優先。" +
        "與請求核心欄位（model、prompt、response_format 等）衝突的 key 會被忽略並在回應中提示。"
    )
};
```

在 `formatResult` 之後新增警告組裝函式：

```ts
/**
 * 把被忽略的擴充參數 key 組成警告行。
 * 只警告不拋錯——參數被忽略屬於「結果仍可用但使用者應當知情」的等級，
 * 拋錯會讓 Agent 進入重試迴圈反而干擾使用。
 * @param blockedKeys 被核心欄位擋下的 key
 * @returns 要附加到回應末端的文字行；沒有衝突時為空陣列
 */
export function blockedWarning(blockedKeys: string[]): string[] {
  if (blockedKeys.length === 0) return [];
  return [`⚠️ 下列 extra_params 與請求核心欄位衝突，已忽略：${blockedKeys.join(", ")}`];
}
```

`generateImage` 的 `inputSchema` 加入 `...overrideShape`：

```ts
      inputSchema: {
        prompt: z.string().min(1).describe("圖片描述，英文通常效果較佳"),
        ...commonShape,
        ...overrideShape,
        filename_prefix: z.string().optional().describe("輸出檔名前綴，預設 muse")
      }
```

`generateImage` 的 handler 內，`input` 型別標註補兩個欄位、呼叫端改為解構：

```ts
      const input = args as {
        prompt: string;
        n?: number;
        size?: string;
        output_format?: OutputFormat;
        reasoning_strength?: ReasoningStrength;
        filename_prefix?: string;
        model?: string;
        extra_params?: Record<string, unknown>;
      };
      try {
        const format = input.output_format ?? "png";
        const { result: response, blockedKeys } = await client.generate({
          prompt: input.prompt,
          n: input.n ?? 1,
          size: input.size,
          outputFormat: format,
          reasoningStrength: input.reasoning_strength ?? "high",
          model: input.model,
          extraParams: input.extra_params
        });
        const paths = await saveImages(
          response.data.map(item => item.b64_json),
          { outputDir: config.outputDir, prefix: input.filename_prefix ?? "muse", format }
        );
        return {
          content: [{ type: "text", text: formatResult(paths, response.usage, blockedWarning(blockedKeys)) }]
        };
      } catch (error) {
        return toErrorResult(error);
      }
```

`editImage` 的 `inputSchema` 同樣加入 `...overrideShape`（放在 `...commonShape` 之後、`filename_prefix` 之前），handler 改為：

```ts
      const input = args as {
        prompt: string;
        images: string[];
        n?: number;
        size?: string;
        output_format?: OutputFormat;
        reasoning_strength?: ReasoningStrength;
        filename_prefix?: string;
        model?: string;
        extra_params?: Record<string, unknown>;
      };
      try {
        const format = input.output_format ?? "png";
        // 逐一正規化，任何一張讀不到就整批失敗並指出是哪一張
        const imageUrls: string[] = [];
        for (const item of input.images) {
          imageUrls.push(await toImageUrl(item));
        }
        const { result: response, blockedKeys } = await client.edit({
          prompt: input.prompt,
          imageUrls,
          n: input.n ?? 1,
          size: input.size,
          outputFormat: format,
          reasoningStrength: input.reasoning_strength ?? "high",
          model: input.model,
          extraParams: input.extra_params
        });
        const paths = await saveImages(
          response.data.map(item => item.b64_json),
          { outputDir: config.outputDir, prefix: input.filename_prefix ?? "muse-edit", format }
        );
        return {
          content: [{ type: "text", text: formatResult(paths, response.usage, blockedWarning(blockedKeys)) }]
        };
      } catch (error) {
        return toErrorResult(error);
      }
```

`iterateImage` 的 `inputSchema` 在 `reasoning_strength` 之後加入 `...overrideShape`，handler 改為：

```ts
      const input = args as {
        prompt: string;
        previous_response_id?: string;
        images?: string[];
        reasoning_strength?: ReasoningStrength;
        filename_prefix?: string;
        model?: string;
        extra_params?: Record<string, unknown>;
      };
      try {
        let imageUrls: string[] | undefined;
        if (input.images && input.images.length > 0) {
          imageUrls = [];
          for (const item of input.images) {
            imageUrls.push(await toImageUrl(item));
          }
        }

        const { result, blockedKeys } = await client.iterate({
          prompt: input.prompt,
          previousResponseId: input.previous_response_id,
          imageUrls,
          reasoningStrength: input.reasoning_strength ?? "high",
          model: input.model,
          extraParams: input.extra_params
        });

        const paths = await saveImages(result.images, {
          outputDir: config.outputDir,
          prefix: input.filename_prefix ?? "muse-iter",
          format: result.outputFormat
        });

        const extra = [
          `response_id: ${result.responseId}（下一輪修改請把它填入 previous_response_id）`,
          ...blockedWarning(blockedKeys)
        ];
        return { content: [{ type: "text", text: formatResult(paths, result.usage, extra) }] };
      } catch (error) {
        return toErrorResult(error);
      }
```

- [ ] **Step 5: 執行全套測試確認通過**

Run: `npm test`
Expected: PASS，全套綠燈（Task 4 遺留的 tools 失敗於此收斂）

- [ ] **Step 6: 確認建置通過**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 7: 手動驗證工具清單**

Run:
```bash
MUSE_API_KEY=fake node dist/index.js 1>stdout.log 2>stderr.log <<< '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
Expected: `stdout.log` 為精確一行 JSON，其中三個工具的 `inputSchema.properties` 都含 `model` 與 `extra_params`；`stderr.log` 含啟動訊息且 stdout 無污染。驗證後刪除兩個 log 檔。

- [ ] **Step 8: Commit**

```bash
git add src/tools.ts tests/tools.test.ts
git commit -m "feat: 三個工具新增 model 與 extra_params 參數及衝突警告

衝突只警告不拋錯——參數被忽略屬於結果仍可用的等級，
拋錯會讓 Agent 進入重試迴圈反而干擾使用。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 發佈前置——package.json、LICENSE、README

**Files:**
- Modify: `package.json`
- Create: `LICENSE`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1-5 的所有對外行為（環境變數、工具參數）
- Produces: 無程式介面

- [ ] **Step 1: 補齊 package.json**

把 `package.json` 換成：

```json
{
  "name": "muse-image-mcp",
  "version": "0.1.0",
  "description": "MCP server for Meta Muse image generation",
  "type": "module",
  "license": "MIT",
  "author": "Kevin Tsai",
  "homepage": "https://github.com/kevintsai1202/muse-image-mcp#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/kevintsai1202/muse-image-mcp.git"
  },
  "bugs": {
    "url": "https://github.com/kevintsai1202/muse-image-mcp/issues"
  },
  "keywords": [
    "mcp",
    "model-context-protocol",
    "meta-muse",
    "image-generation",
    "claude",
    "claude-code"
  ],
  "bin": { "muse-image-mcp": "./dist/index.js" },
  "files": ["dist"],
  "engines": { "node": ">=20.12.0" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "smoke": "vitest run --config vitest.e2e.config.ts",
    "prepublishOnly": "npm run build && npm test"
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

- [ ] **Step 2: 建立 LICENSE**

建立 `LICENSE`，內容為標準 MIT 授權條款，版權行為：

```
MIT License

Copyright (c) 2026 Kevin Tsai
```

其餘為 MIT 標準條文（Permission is hereby granted... 到 ...DEALINGS IN THE SOFTWARE.）。

- [ ] **Step 3: 改寫 README 的安裝與設定段落**

把 `README.md` 從 `## 安裝` 到 `### 環境變數` 表格結束為止的內容換成：

````markdown
## 安裝

### 方式一：npx（推薦，不需 clone）

```bash
claude mcp add muse-image npx -y muse-image-mcp --scope user --env MUSE_API_KEY=你的key
```

### 方式二：本機開發

```bash
git clone https://github.com/kevintsai1202/muse-image-mcp.git
cd muse-image-mcp
npm install
npm run build
claude mcp add muse-image node <你的專案路徑>/dist/index.js --scope user
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
````

同時檢查 README 其餘段落（工具參數表）並補上 `model` 與 `extra_params` 兩列，以及把所有殘留的 `muse-output` 字樣改為 `generated-images`。

- [ ] **Step 4: 驗證文件與實作一致**

Run:
```bash
grep -rn "muse-output" README.md || echo "README 已無殘留"
npm test && npm run build
```
Expected: README 無 `muse-output` 殘留；測試全綠、build exit 0

- [ ] **Step 5: Commit**

```bash
git add package.json LICENSE README.md
git commit -m "docs: 補齊發佈 metadata、MIT LICENSE 與 README 改寫

安裝方式改以 npx 為主，新增切換模型與額外參數一節，
修正輸出目錄說明（cwd 即 client 的專案根目錄）。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 最終驗證與發佈到 GitHub

**Files:**
- 無檔案修改（僅驗證與發佈）

**Interfaces:**
- Consumes: Task 1-6 的全部成果
- Produces: `github.com/kevintsai1202/muse-image-mcp`（public）

- [ ] **Step 1: 增量全套驗證**

Run:
```bash
npm test 2>&1 | tee test-final.log
npm run build
```
Expected: 測試全綠（既有 81 個 + 本次新增約 40 個）、build exit 0。確認後刪除 `test-final.log`。

本專案只有單一側（TypeScript），無跨側改動，故此處跑全套即為完整驗證。

- [ ] **Step 2: 確認 npm 打包內容正確**

Run: `npm pack --dry-run`
Expected: 僅包含 `dist/`、`package.json`、`README.md`、`LICENSE`；**不得**出現 `.env`、`generated-images/`、`src/`、`tests/`、`docs/`

- [ ] **Step 3: 確認工作區乾淨**

Run: `git status --porcelain`
Expected: 無輸出

- [ ] **Step 4: 合併回 main**

```bash
git checkout main
git merge --no-ff feat/model-switching -m "Merge branch 'feat/model-switching'"
```

- [ ] **Step 5: 建立 GitHub repo 並推送**

Run:
```bash
gh repo create kevintsai1202/muse-image-mcp --public --source=. --push
```
Expected: 回傳 repo 網址；`git remote -v` 顯示 origin 指向該 repo

- [ ] **Step 6: 驗證遠端內容**

Run:
```bash
gh repo view kevintsai1202/muse-image-mcp --json name,visibility,licenseInfo
git log origin/main --oneline -3
```
Expected: `visibility` 為 `PUBLIC`、`licenseInfo` 為 MIT、遠端有本次所有 commit

- [ ] **Step 7: 回報並停止**

回報 repo 網址與測試數字給使用者。**不執行 `npm publish`**——是否上架 npm 由使用者自行決定。

---

## Self-Review

**1. Spec coverage**

| Spec 章節 | 對應 Task |
|---|---|
| §4 設定層（`MUSE_MODEL`、`MUSE_EXTRA_PARAMS`） | Task 1 |
| §4 `.env` 搜尋鏈、輸出目錄改名 | Task 2 |
| §5 型別層 `ModelOverrides` | Task 4 Step 3 |
| §6 合併層 `request-body.ts` | Task 3 |
| §6 `MuseClient` 調整、`ClientResult<T>` | Task 4 |
| §6 各 endpoint core/named 劃分 | Task 4 Step 4 |
| §7 工具層 `model` / `extra_params` | Task 5 |
| §8 警告回報 | Task 5 Step 4（`blockedWarning`） |
| §9 測試策略 | Task 1/2/3/4/5 各自的測試步驟 |
| §10 發佈前置與發佈 | Task 6、Task 7 |
| §11 風險緩解（舊目錄不搬移） | Task 2 僅改預設值，未加入任何搬移邏輯 |

無遺漏。

**2. Placeholder scan**

已逐步檢查，無 TBD / TODO / 「類似 Task N」/ 無程式碼的程式步驟。Task 6 Step 2 的 MIT 條文以標準文本描述而非逐字抄錄，屬於眾所周知的固定文本，不構成佔位符。

**3. Type consistency**

- `buildRequestBody` 的參數名 `core` / `named` / `defaultExtra` / `callExtra` 在 Task 3 定義、Task 4 使用，一致。
- `ClientResult<T>` 的欄位名 `result` / `blockedKeys` 在 Task 4 定義，Task 5 解構使用，一致。
- `blockedWarning` 在 Task 5 定義並於同 task 的三個 handler 使用，一致。
- `envCandidatePaths` 在 Task 2 定義，同 task 的測試與錯誤訊息使用，一致。
- `DEFAULT_MODEL`（Task 1）與 `DEFAULT_OUTPUT_DIR`（Task 2）皆為 `src/config.ts` 模組內部常數，未跨檔引用。
