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
 * 長度上限必須在「去除頭尾連字號」之前套用：若先裁切再去頭尾，恰好落在裁切邊界上的
 * 連字號會被裁出一個從未被收斂或去除過的全新結尾連字號，違反本函式頭尾不留連字號的約定。
 */
export function sanitizePrefix(prefix: string): string {
  const cleaned = prefix
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_PREFIX_LENGTH)
    .replace(/^-+|-+$/g, "");
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
