/**
 * 實測紀錄：edit_image 能不能修掉圖中既有的錯字？
 *
 * 結論（2026-09-12，muse-image-1.0）：**不能**。保留這支腳本是為了讓這個結論可重跑驗證，
 * 而不是因為它有效。
 *
 * 背景：某一版資訊圖表出現兩處拼錯（AAFE LOCATION 應為 SAFE、CARDHOLLER 應為 CARDHOLDER）。
 * 比起重生整張碰運氣，「只動那兩個字」看起來才是 edit_image 該擅長的事。
 *
 * 實際跑了兩次，兩次都沒改動到目標文字：
 *   1. 同時指名兩處、說明原字與正確拼法、要求其餘不動 → 兩個字都沒變
 *   2. 只改一處，並指名紅色墨水、手寫大寫、相同位置與確切內容 → 仍然沒變
 * 兩次的構圖、插圖、其餘文字都忠實保留（這點它做得很好），唯獨要改的字紋風不動。
 *
 * 可以推得的界線：edit_image 擅長作用於整張畫面的修改（換光線、換色調、換材質），
 * 但不會重寫已經畫進點陣圖裡的字形。文字要正確，只能在 generate_image 階段就講清楚——
 * 逐格指定確切字串，並加上「只能用列出的字」。做法見 generate-infographic-demo.mjs。
 *
 * 前置：需先 npm run build，且 site/images/demo-infographic.webp 存在。
 * 費用：每次 1 張圖 US$0.01（失敗一樣計費）。
 * 用法：node scripts/fix-infographic-typos.mjs
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
const { saveImages, toImageUrl } = await import("../dist/image-store.js");

const SOURCE = resolve(PACKAGE_ROOT, "site/images/demo-infographic.webp");

// 指令寫得越具體越好：指名面板、指名原字與正確拼法，並明確要求其餘不動。
// 只說「修正拼字錯誤」會讓模型自由發揮，連版面一起重畫。
const PROMPT = [
  "Look at the red annotation in the third panel, next to the golden key.",
  "It currently reads: STORE IN SAFE AAFE LOCATION.",
  "Redraw that one annotation so it reads exactly: STORE IN A SAFE LOCATION.",
  "Use the same red ink, the same hand-lettered capitals and the same position.",
  "Do not touch anything else in the poster."
].join(" ");

const client = new MuseClient(loadConfig());

console.log("修正資訊圖表的拼字，1 張，費用 US$0.01\n");
console.log("來源：" + SOURCE);
console.log("指令：" + PROMPT + "\n");

const imageUrl = await toImageUrl(SOURCE);

const { result: response } = await client.edit({
  prompt: PROMPT,
  imageUrls: [imageUrl],
  n: 1,
  size: "1792x1024",
  outputFormat: "png",
  reasoningStrength: "high"
});

const paths = await saveImages(
  response.data.map(item => item.b64_json),
  {
    outputDir: resolve(PACKAGE_ROOT, "site/images/raw"),
    prefix: "infographic-fixed",
    format: response.output_format ?? "png"
  }
);

console.log("→ " + paths[0]);
console.log("\n完成。請把前後兩張並排檢查：錯字是否改對，其餘是否原封不動。");
