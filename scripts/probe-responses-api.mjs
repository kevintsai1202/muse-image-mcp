/**
 * /v1/responses request body 形狀探測腳本。
 *
 * 用途：在修改 src/muse-client.ts 的 iterate() 之前，先用真實 API 確認
 *       reasoning_strength / size / output_format 到底該放在哪裡。
 *       目前 iterate() 把 reasoning_strength 送在 body 頂層，實測會被拒。
 *
 * 為什麼要寫成檔案而不是一次性指令：這組驗證會反覆用到——改完程式要回歸、
 * Meta 端改 API 時要重測——逐案分開才能在失敗時知道是哪個參數的問題。
 *
 * 費用：每個成功產圖的 case 花費 US$0.01。case 1 預期失敗，不產圖不計費。
 *       完整跑一輪（case 1~4）約 US$0.03。
 *
 * 用法：
 *   node scripts/probe-responses-api.mjs            # 跑全部
 *   node scripts/probe-responses-api.mjs 1 3        # 只跑指定 case
 *
 * 金鑰來源：專案根目錄的 .env（MUSE_API_KEY），與 server 本體同一份。
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 沿用 server 本體的作法：Node 內建 loadEnvFile，不額外裝 dotenv
try {
  process.loadEnvFile(resolve(PACKAGE_ROOT, ".env"));
} catch {
  // .env 不存在時不算錯，改由環境變數提供
}

const API_KEY = process.env.MUSE_API_KEY?.trim();
const BASE_URL = (process.env.MUSE_BASE_URL ?? "https://api.meta.ai/v1").replace(/\/$/, "");
const MODEL = process.env.MUSE_MODEL ?? "muse-image-1.0";

if (!API_KEY) {
  console.error("缺少 MUSE_API_KEY：請在專案根目錄的 .env 設定，或以環境變數提供。");
  process.exit(1);
}

/**
 * 從 base64 前綴判斷實際圖片格式。
 * 這是驗證 output_format 有沒有真的生效的唯一可靠方式——
 * 回應本身不帶 output_format 欄位，只能從位元組檔頭反推。
 * @param {string} b64 圖片的 base64 字串
 * @returns {string} 格式名稱
 */
function sniffFormat(b64) {
  const head = Buffer.from(b64.slice(0, 32), "base64");
  if (head[0] === 0x89 && head.toString("latin1", 1, 4) === "PNG") return "png";
  if (head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (head[0] === 0xff && head[1] === 0xd8) return "jpeg";
  return "unknown";
}

/**
 * 深度走訪回應，取出所有 base64 圖片資料。
 * 與 src/muse-client.ts 的 extractB64Images 同邏輯，此處獨立實作避免載入 TS 原始碼。
 * @param {unknown} node 回應中的任意節點
 * @param {string[]} out 累積結果
 * @returns {string[]} 找到的 base64 字串
 */
function extractB64(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) extractB64(item, out);
    return out;
  }
  const obj = /** @type {Record<string, unknown>} */ (node);
  if (typeof obj.b64_json === "string") out.push(obj.b64_json);
  if (obj.type === "image_generation_call" && typeof obj.result === "string") out.push(obj.result);
  for (const value of Object.values(obj)) extractB64(value, out);
  return out;
}

/**
 * 送出一次 /responses 請求並整理成可判讀的結果。
 * @param {Record<string, unknown>} body request body
 * @returns {Promise<{ok: boolean, status: number, id?: string, images: string[], error?: string, raw: unknown}>}
 */
async function callResponses(body) {
  const res = await fetch(`${BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, status: res.status, images: [], error: `非 JSON 回應：${text.slice(0, 200)}`, raw: text };
  }

  if (!res.ok) {
    const message = raw?.error?.message ?? raw?.message ?? JSON.stringify(raw).slice(0, 300);
    return { ok: false, status: res.status, images: [], error: message, raw };
  }

  return { ok: true, status: res.status, id: raw.id, images: extractB64(raw), raw };
}

/** 上一個成功 case 的 response id，供多輪對話的 case 使用 */
let lastResponseId = null;

/**
 * 探測案例定義。
 * 每個案例都有明確的預期，跑完後可直接對照「預期 vs 實際」判定假設成立與否。
 */
const CASES = [
  {
    id: 1,
    name: "頂層 reasoning_strength（重現目前 iterate() 的送法）",
    expect: "失敗：unknown parameter `reasoning_strength`",
    build: () => ({
      model: MODEL,
      input: "A single ripe persimmon on a slate plate, soft window light",
      store: true,
      reasoning_strength: "high"
    })
  },
  {
    id: 2,
    name: "完全不帶 reasoning_strength、不帶 tools（最小可行 body）",
    expect: "成功：證明拿掉該參數即可，是最小修法",
    build: () => ({
      model: MODEL,
      input: "A single ripe persimmon on a slate plate, soft window light",
      store: true
    })
  },
  {
    id: 3,
    name: "reasoning_strength 放進 tools[{type:image_generation}]（官方文件形狀）",
    expect: "成功：證明參數本身合法，只是位置錯",
    build: () => ({
      model: MODEL,
      input: "A single ripe persimmon on a slate plate, soft window light",
      store: true,
      tools: [{ type: "image_generation", reasoning_strength: "high" }]
    })
  },
  {
    id: 4,
    name: "tools 內同時帶 reasoning_strength + size + output_format",
    expect: "成功且回傳 png：證明 iterate 其實支援 size/output_format，推翻 README 既有結論",
    build: () => ({
      model: MODEL,
      input: "A single ripe persimmon on a slate plate, soft window light",
      store: true,
      tools: [
        { type: "image_generation", reasoning_strength: "low", size: "1024x1536", output_format: "png" }
      ]
    })
  },
  {
    id: 5,
    name: "以上一輪的 id 續接第二輪（previous_response_id + tools）",
    expect: "成功：證明修正後的形狀不影響多輪對話",
    build: () => ({
      model: MODEL,
      input: "now make the background deep navy",
      store: true,
      previous_response_id: lastResponseId,
      tools: [{ type: "image_generation", reasoning_strength: "low", output_format: "png" }]
    }),
    // 沒有前一輪 id 就跳過，避免送出 previous_response_id: null 造成無意義的失敗
    skipIf: () => (lastResponseId ? null : "沒有可用的 previous_response_id（前面的 case 都未成功）")
  }
];

const selected = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
const toRun = selected.length > 0 ? CASES.filter(c => selected.includes(c.id)) : CASES;

console.log(`探測 ${BASE_URL}/responses，模型 ${MODEL}`);
console.log(`本次執行 ${toRun.length} 個 case，成功產圖者每張 US$0.01\n`);

for (const testCase of toRun) {
  const skipReason = testCase.skipIf?.();
  if (skipReason) {
    console.log(`── case ${testCase.id}：${testCase.name}`);
    console.log(`   跳過：${skipReason}\n`);
    continue;
  }

  const body = testCase.build();
  console.log(`── case ${testCase.id}：${testCase.name}`);
  console.log(`   預期：${testCase.expect}`);
  console.log(`   送出：${JSON.stringify(body).replace(/"input":"[^"]*"/, '"input":"<略>"')}`);

  try {
    const result = await callResponses(body);
    if (result.ok) {
      const formats = result.images.map(sniffFormat);
      console.log(`   實際：HTTP ${result.status} 成功，取得 ${result.images.length} 張圖，格式 ${formats.join(", ") || "無"}`);
      console.log(`   id：${result.id}`);
      if (result.id) lastResponseId = result.id;
    } else {
      console.log(`   實際：HTTP ${result.status} 失敗 — ${result.error}`);
    }
  } catch (error) {
    console.log(`   實際：例外 — ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log();
}

console.log("探測結束。");
