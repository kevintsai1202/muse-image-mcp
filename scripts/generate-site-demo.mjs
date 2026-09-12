/**
 * 產生宣傳網頁用的 iterate_image 示範圖。
 *
 * 用途：網頁上 generate_image 與 edit_image 都有真實輸出可看，iterate_image 沒有。
 *       這支腳本跑一段兩輪對話，把兩輪的結果存下來當對照圖——第二輪只送一句
 *       修改指令、不重送任何圖，正是 iterate 與 edit 的差別所在。
 *
 * 為什麼不用 MCP 工具直接生：MCP server 進程是 client 啟動 session 當下載入的，
 * 改完程式碼要重開 session 才會生效。這支腳本直接載入編譯後的 dist，
 * 不受 session 生命週期影響，也因此可以重跑。
 *
 * 前置：需先 npm run build。費用：2 張圖，US$0.02。
 * 用法：node scripts/generate-site-demo.mjs
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.loadEnvFile(resolve(PACKAGE_ROOT, ".env"));
} catch {
  // 沒有 .env 時改由環境變數提供
}

const { MuseClient } = await import("../dist/muse-client.js");
const { loadConfig } = await import("../dist/config.js");
const { saveImages } = await import("../dist/image-store.js");

// 與網頁上另外兩張 demo 一致的正方形比例
const SIZE = "1024x1024";
const OUTPUT_DIR = resolve(PACKAGE_ROOT, "site/images/raw");

const client = new MuseClient(loadConfig());

console.log("產生 iterate_image 示範圖，共 2 張，費用 US$0.02\n");

// ── 第一輪：開一段新對話
const firstPrompt = "A minimalist ceramic vase on a concrete pedestal, soft overcast daylight, clean studio background";
console.log("第一輪：" + firstPrompt);
const first = await client.iterate({
  prompt: firstPrompt,
  reasoningStrength: "low",
  size: SIZE,
  outputFormat: "png"
});
const firstPaths = await saveImages(first.result.images, {
  outputDir: OUTPUT_DIR,
  prefix: "iter-1",
  format: first.result.outputFormat
});
console.log("  → " + firstPaths[0]);
console.log("  response_id: " + first.result.responseId + "\n");

// ── 第二輪：只送一句修改指令，不重送圖片——這正是要展示的重點
const secondPrompt = "Make the vase deep cobalt blue and add a single dried branch";
console.log("第二輪（只帶 previous_response_id，不重送圖）：" + secondPrompt);
const second = await client.iterate({
  prompt: secondPrompt,
  previousResponseId: first.result.responseId,
  reasoningStrength: "low",
  size: SIZE,
  outputFormat: "png"
});
const secondPaths = await saveImages(second.result.images, {
  outputDir: OUTPUT_DIR,
  prefix: "iter-2",
  format: second.result.outputFormat
});
console.log("  → " + secondPaths[0]);
console.log("  response_id: " + second.result.responseId + "\n");

console.log("完成。接著用 ffmpeg 轉成 webp 放進 site/images/。");
