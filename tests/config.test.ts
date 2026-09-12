import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig, loadDotEnvFile, PACKAGE_ROOT } from "../src/config.js";
import { MuseError } from "../src/errors.js";

/** 測試中被寫進 process.env 的變數，結束後要清掉避免污染其他測試 */
const TEMP_ENV_KEYS = ["DOTENV_PROBE_A", "DOTENV_PROBE_B"];

afterEach(() => {
  for (const key of TEMP_ENV_KEYS) delete process.env[key];
});

describe("loadDotEnvFile", () => {
  it("能把 .env 的內容載入 process.env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "muse-dotenv-"));
    try {
      await writeFile(join(dir, ".env"), "DOTENV_PROBE_A=from_file\n", "utf8");

      expect(loadDotEnvFile(join(dir, ".env"))).toBe(true);
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

      loadDotEnvFile(join(dir, ".env"));

      expect(process.env.DOTENV_PROBE_B).toBe("from_shell");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("檔案不存在時回傳 false 且不拋錯", () => {
    expect(loadDotEnvFile(join(tmpdir(), "definitely-not-here", ".env"))).toBe(false);
  });

  it("PACKAGE_ROOT 指向專案根目錄（該處有 package.json）", async () => {
    const { access } = await import("node:fs/promises");
    await expect(access(join(PACKAGE_ROOT, "package.json"))).resolves.toBeUndefined();
  });
});

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

  it("可覆寫 base URL，並移除結尾斜線", () => {
    const config = loadConfig({ MUSE_API_KEY: "k", MUSE_BASE_URL: "http://localhost:9999/v1/" });
    expect(config.baseUrl).toBe("http://localhost:9999/v1");
  });

  it("MUSE_BASE_URL 為空字串時視同未設定，使用預設值", () => {
    const config = loadConfig({ MUSE_API_KEY: "k", MUSE_BASE_URL: "" });
    expect(config.baseUrl).toBe("https://api.meta.ai/v1");
  });

  it("MUSE_BASE_URL 為全空白字串時視同未設定，使用預設值", () => {
    const config = loadConfig({ MUSE_API_KEY: "k", MUSE_BASE_URL: "   " });
    expect(config.baseUrl).toBe("https://api.meta.ai/v1");
  });

  it("輸出目錄一律轉為絕對路徑", () => {
    const config = loadConfig({ MUSE_API_KEY: "k", MUSE_OUTPUT_DIR: "out/images" });
    expect(config.outputDir).toBe(resolve(process.cwd(), "out/images"));
  });

  it("MUSE_OUTPUT_DIR 為空字串時視同未設定，使用預設值 muse-output", () => {
    const config = loadConfig({ MUSE_API_KEY: "k", MUSE_OUTPUT_DIR: "" });
    expect(config.outputDir).toBe(resolve(process.cwd(), "muse-output"));
  });

  it("MUSE_OUTPUT_DIR 為全空白字串時視同未設定，使用預設值 muse-output", () => {
    const config = loadConfig({ MUSE_API_KEY: "k", MUSE_OUTPUT_DIR: "   " });
    expect(config.outputDir).toBe(resolve(process.cwd(), "muse-output"));
  });

  it("逾時可覆寫", () => {
    expect(loadConfig({ MUSE_API_KEY: "k", MUSE_TIMEOUT_MS: "5000" }).timeoutMs).toBe(5000);
  });

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

  it("逾時為非正整數時拋出 config 類錯誤", () => {
    expect(() => loadConfig({ MUSE_API_KEY: "k", MUSE_TIMEOUT_MS: "abc" })).toThrow(MuseError);
    expect(() => loadConfig({ MUSE_API_KEY: "k", MUSE_TIMEOUT_MS: "0" })).toThrow(MuseError);
  });

  it("只給 API key 時套用全部預設值", () => {
    const config = loadConfig({ MUSE_API_KEY: "test-key" });
    expect(config.apiKey).toBe("test-key");
    expect(config.baseUrl).toBe("https://api.meta.ai/v1");
    expect(config.outputDir).toBe(resolve(process.cwd(), "muse-output"));
    expect(config.timeoutMs).toBe(120_000);
    expect(config.model).toBe("muse-image-1.0");
    expect(config.extraParams).toEqual({});
  });

  it("回傳的設定物件為凍結狀態，避免被下游意外改動", () => {
    const config = loadConfig({ MUSE_API_KEY: "k" });
    expect(Object.isFrozen(config)).toBe(true);
  });
});
