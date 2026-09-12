import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MuseError } from "./errors.js";

/**
 * 套件根目錄。
 * 編譯後本檔在 <root>/dist/config.js、測試時在 <root>/src/config.ts，兩者上溯一層都得到 <root>。
 * 不可用 process.cwd()——MCP server 的 cwd 由 client 決定，通常是使用者的專案目錄而非本 server 目錄。
 */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

const DEFAULT_BASE_URL = "https://api.meta.ai/v1";
const DEFAULT_OUTPUT_DIR = "generated-images";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MODEL = "muse-image-1.0";

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
      `缺少 MUSE_API_KEY。請擇一設定：(1) 在下列任一位置建立 .env 檔並寫入 MUSE_API_KEY=你的key（依序採用第一個存在者）：` +
        `${envCandidatePaths().join("、")}，或 (2) 在 MCP server 設定的 env 區塊填入。` +
        "API key 可於 https://dev.meta.ai 後台取得。"
    );
  }

  // 空字串或全空白視同未設定，才落回預設值——MCP JSON 設定常見把變數留空當佔位符，
  // 若在此當成「使用者刻意指定空字串」，baseUrl 會變成 "" 導致組出的 URL 缺少主機部分。
  // 結尾斜線會讓後續 `${baseUrl}/images/generations` 變成雙斜線，先移除
  const rawBaseUrl = (env.MUSE_BASE_URL ?? "").trim();
  const baseUrl = (rawBaseUrl === "" ? DEFAULT_BASE_URL : rawBaseUrl).replace(/\/+$/, "");

  // 同理，空字串或全空白視同未設定 MUSE_OUTPUT_DIR，否則 resolve(cwd, "") 會解析成 cwd 本身，
  // 圖片就會落在使用者專案根目錄而非 generated-images/ 子目錄
  const rawOutputDir = (env.MUSE_OUTPUT_DIR ?? "").trim();
  const outputDir = resolve(process.cwd(), rawOutputDir === "" ? DEFAULT_OUTPUT_DIR : rawOutputDir);

  const rawTimeout = (env.MUSE_TIMEOUT_MS ?? "").trim();
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (rawTimeout !== "") {
    const parsed = Number(rawTimeout);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new MuseError("config", `MUSE_TIMEOUT_MS 必須為正整數毫秒數，目前為 "${rawTimeout}"。`);
    }
    timeoutMs = parsed;
  }

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

  return Object.freeze({ apiKey, baseUrl, outputDir, timeoutMs, model, extraParams });
}
