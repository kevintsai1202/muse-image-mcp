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

const PROMPT = [
  "A vintage Chinese popular-science encyclopedia illustration from the 1980s,",
  "a four-step diagram explaining how to obtain an API key:",
  "(1) a person sitting at a desktop computer,",
  "(2) a browser dashboard window with a key symbol on screen,",
  "(3) a hand holding up a golden key,",
  "(4) a credit card lying next to a paper receipt.",
  "Large circular numbered badges 1 2 3 4 mark each step, thin arrows connect them in order.",
  "Flat gouache and watercolour textures on warm aged paper, bright primary colours,",
  "hand-drawn ink linework, clean diagrammatic layout, no text labels, no lettering."
].join(" ");

const client = new MuseClient(loadConfig());

console.log("產生資訊圖表示範圖，1 張，費用 US$0.01\n");
console.log("Prompt：" + PROMPT + "\n");

// 注意：generate 回傳的是原始 API 回應（data[].b64_json），
// 與 iterate 回傳的加工結構（result.images）不同，兩者不能照抄
const { result: response } = await client.generate({
  prompt: PROMPT,
  n: 1,
  size: "1024x1024",
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
