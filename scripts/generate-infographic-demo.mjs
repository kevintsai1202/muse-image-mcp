/**
 * 產生宣傳網頁的「資訊圖表」示範圖。
 *
 * 用途：展示這個 MCP 不只能生美圖，也能把一段說明變成可用的圖解。
 *       題材選 API key 註冊流程——正是讀者在這個頁面上真的要做的事。
 *
 * 風格取「一萬個為什麼」那類 1980 年代科普讀物插畫：水粉質感、泛黃紙張、
 * 手繪墨線、明亮的原色、圓形數字徽章與箭頭串接的圖解式構圖。
 *
 * 刻意不要求圖中出現文字標籤：生圖模型的中文字形很不可靠，糊掉的字會讓
 * 整張圖失去可信度。文字說明放在網頁上圖片旁邊，這也剛好對應要展示的兩個步驟——
 * 先讓 Claude Code 整理出說明，再把說明畫成圖。
 *
 * 前置：需先 npm run build。費用：1 張圖，US$0.01。
 * 用法：node scripts/generate-infographic-demo.mjs
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

// 上一版讓模型自由發揮標註文字，字一多就出現拼錯（AAFE LOCATION、CARDHOLLER），
// 而 edit_image 實測改不動圖中既有文字（見 fix-infographic-typos.mjs）。
// 這一版改為逐格指定確切字串並限制「只能用列出的字」，以字數換取拼字正確率。
const PROMPT = [
  "A richly detailed horizontal infographic poster in the style of a 1980s popular-science encyclopedia.",
  "A bold banner across the top reads: HOW TO GET AN API KEY.",
  "Below it, four panels left to right, joined by arrows, each with a large circular numbered badge.",
  "Panel 1, badge 1, heading SIGN IN, showing a person at a desktop computer,",
  "with one short annotation on a leader line reading: ENTER EMAIL AND PASSWORD.",
  "Panel 2, badge 2, heading OPEN API KEYS, showing a browser dashboard window with a key icon,",
  "with one short annotation reading: FIND THE API KEYS PAGE.",
  "Panel 3, badge 3, heading CREATE KEY, showing a hand holding a golden key,",
  "with one short annotation reading: COPY IT AND STORE IT SAFELY.",
  "Panel 4, badge 4, heading ADD PAYMENT, showing a credit card beside a monthly invoice,",
  "with one short annotation reading: BILLING IS USAGE BASED.",
  "A narrow banner along the bottom reads: TREAT YOUR API KEY LIKE A PASSWORD.",
  "Rich gouache and watercolour textures on warm aged paper, detailed hand-drawn ink linework,",
  "cross-hatching and stippling, bright primary colours, a decorative ruled border.",
  "Use only the words listed above and no other text.",
  "Every word must be spelled correctly, in clean legible hand-lettered English capitals."
].join(" ");

const client = new MuseClient(loadConfig());

console.log("產生資訊圖表示範圖，1 張，費用 US$0.01\n");
console.log("Prompt：" + PROMPT + "\n");

// 注意：generate 回傳的是原始 API 回應（data[].b64_json），
// 與 iterate 回傳的加工結構（result.images）不同，兩者不能照抄
const { result: response } = await client.generate({
  prompt: PROMPT,
  n: 1,
  size: "1792x1024",
  outputFormat: "png",
  reasoningStrength: "high"
});

const paths = await saveImages(
  response.data.map(item => item.b64_json),
  {
    outputDir: resolve(PACKAGE_ROOT, "site/images/raw"),
    prefix: "infographic",
    // 實際格式以回應為準，避免副檔名與內容不符
    format: response.output_format ?? "png"
  }
);

console.log("→ " + paths[0]);
console.log("\n完成。接著用 ffmpeg 轉成 webp 放進 site/images/。");
