/**
 * iterate() 修復的端到端驗證腳本。
 *
 * 用途：直接載入編譯後的 dist/muse-client.js 對真實 API 跑兩輪對話，
 *       證明修好的是「實際會被安裝執行的程式碼」，而不只是 request body 的形狀猜對了。
 *       scripts/probe-responses-api.mjs 驗證的是 API 契約，這支驗證的是本專案的實作。
 *
 * 驗證三件事：
 *   1. 帶 reasoning_strength 的 iterate 不再被回 400（修復前 100% 失敗）
 *   2. 指定 output_format: "png" 時，回報的 outputFormat 與圖片實際檔頭一致
 *      （修復前會回報 webp 而內容是 png，存檔副檔名因此是錯的）
 *   3. previous_response_id 續接第二輪仍正常
 *
 * 前置：需先 npm run build。費用：2 張圖，US$0.02。
 * 用法：node scripts/verify-iterate-fix.mjs
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

/**
 * 從 base64 前綴判斷實際圖片格式，用來比對回報值是否誠實。
 * @param {string} b64 圖片 base64
 * @returns {string} 格式名稱
 */
function sniffFormat(b64) {
  const head = Buffer.from(b64.slice(0, 32), "base64");
  if (head[0] === 0x89 && head.toString("latin1", 1, 4) === "PNG") return "png";
  if (head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (head[0] === 0xff && head[1] === 0xd8) return "jpeg";
  return "unknown";
}

const failures = [];

/**
 * 記錄一項檢查結果並印出。
 * @param {string} label 檢查項目名稱
 * @param {boolean} passed 是否通過
 * @param {string} detail 實際觀察到的值
 */
function check(label, passed, detail) {
  console.log(`   ${passed ? "PASS" : "FAIL"}  ${label}：${detail}`);
  if (!passed) failures.push(label);
}

const config = loadConfig();
const client = new MuseClient(config);

console.log(`驗證 iterate() 修復，base URL ${config.baseUrl}，模型 ${config.model}`);
console.log("將產生 2 張圖，費用 US$0.02\n");

// ── 第一輪：帶 reasoning_strength 與 output_format，這正是修復前會 400 的組合
console.log("── 第一輪：全新對話，reasoning_strength=low、output_format=png");
const first = await client.iterate({
  prompt: "A single ripe persimmon on a slate plate, soft window light",
  reasoningStrength: "low",
  outputFormat: "png"
});

const firstFormat = sniffFormat(first.result.images[0]);
check("呼叫成功並取得圖片", first.result.images.length === 1, `${first.result.images.length} 張`);
check("回傳 response_id", Boolean(first.result.responseId), first.result.responseId);
check("回報格式與實際檔頭一致", first.result.outputFormat === firstFormat, `回報 ${first.result.outputFormat}／實際 ${firstFormat}`);
check("指定的 png 有生效", firstFormat === "png", firstFormat);

// ── 第二輪：用第一輪的 id 續接，確認修改後的 body 形狀不影響多輪對話
console.log("\n── 第二輪：以 previous_response_id 續接");
const second = await client.iterate({
  prompt: "now make the background deep navy",
  previousResponseId: first.result.responseId,
  reasoningStrength: "low",
  outputFormat: "png"
});

const secondFormat = sniffFormat(second.result.images[0]);
check("續接成功並取得圖片", second.result.images.length === 1, `${second.result.images.length} 張`);
check("回傳新的 response_id", Boolean(second.result.responseId) && second.result.responseId !== first.result.responseId, second.result.responseId);
check("回報格式與實際檔頭一致", second.result.outputFormat === secondFormat, `回報 ${second.result.outputFormat}／實際 ${secondFormat}`);

console.log();
if (failures.length > 0) {
  console.error(`驗證失敗，未通過項目：${failures.join("、")}`);
  process.exit(1);
}
console.log("全部通過：iterate() 在真實 API 上可用，格式回報正確，多輪對話正常。");
