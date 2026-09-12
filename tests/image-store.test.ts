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

  it("裁切點恰好落在連字號上時，不得殘留結尾連字號", () => {
    // 第 40 個字元（index 39）是連字號：若先裁切再去頭尾，會裁出一個從未被處理過的結尾連字號
    const result = sanitizePrefix("a".repeat(39) + "-" + "b".repeat(10));
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result.endsWith("-")).toBe(false);
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
