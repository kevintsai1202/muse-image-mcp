import { describe, it, expect } from "vitest";
import { loadConfig, loadDotEnvFile } from "../src/config.js";
import { MuseClient, extractB64Images } from "../src/muse-client.js";
import { saveImages } from "../src/image-store.js";

/**
 * 真實 API 煙霧測試。
 * 需要 MUSE_E2E=1 與真實的 MUSE_API_KEY 才會執行，每次共產生 6 張圖，約花費 US$0.06：
 * generate 1 張、edit（內部先 generate 1 張再 edit 1 張）2 張、iterate 單輪 1 張、
 * iterate 兩輪對話（Task 7，第一輪 1 張＋第二輪 1 張）2 張。
 * 由獨立的 vitest.e2e.config.ts 載入，預設的 `npm test` 不會跑到。
 */
// key 放在專案根目錄的 .env，測試也要走同一條載入路徑
loadDotEnvFile();

const enabled = process.env.MUSE_E2E === "1";

describe.skipIf(!enabled)("Muse API 煙霧測試", () => {
  it("generate_image 能實際產出一張圖", async () => {
    const config = loadConfig();
    const client = new MuseClient(config);

    const { result: genResult } = await client.generate({
      prompt: "a simple flat-style icon of a blue cube on white background",
      n: 1,
      outputFormat: "png"
    });

    expect(genResult.data.length).toBe(1);
    expect(genResult.data[0]!.b64_json.length).toBeGreaterThan(1000);

    const paths = await saveImages([genResult.data[0]!.b64_json], {
      outputDir: config.outputDir,
      prefix: "smoke-generate",
      format: "png"
    });
    console.error(`[smoke] 生圖輸出：${paths[0]}`);
  });

  it("edit_image 能依剛產出的圖改圖", async () => {
    const config = loadConfig();
    const client = new MuseClient(config);

    const { result: baseResult } = await client.generate({
      prompt: "a simple flat-style icon of a blue cube on white background",
      n: 1,
      outputFormat: "png"
    });
    const dataUrl = `data:image/png;base64,${baseResult.data[0]!.b64_json}`;

    const { result: editResult } = await client.edit({
      prompt: "change the cube color to red",
      imageUrls: [dataUrl],
      n: 1,
      outputFormat: "png"
    });

    expect(editResult.data.length).toBe(1);
    const paths = await saveImages([editResult.data[0]!.b64_json], {
      outputDir: config.outputDir,
      prefix: "smoke-edit",
      format: "png"
    });
    console.error(`[smoke] 改圖輸出：${paths[0]}`);
  });

  it("iterate_image 能取得 response_id 與圖片（驗證 /responses 的實際結構）", async () => {
    const config = loadConfig();
    const client = new MuseClient(config);

    const { result: iterateResult } = await client.iterate({
      prompt: "a simple flat-style icon of a green triangle on white background"
    });

    // 這三個斷言就是 spec §1「待實測確認」項目的驗證點
    expect(iterateResult.responseId).not.toBe("");
    expect(iterateResult.images.length).toBeGreaterThan(0);
    expect(iterateResult.images[0]!.length).toBeGreaterThan(1000);

    const paths = await saveImages(iterateResult.images, {
      outputDir: config.outputDir,
      prefix: "smoke-iterate",
      format: iterateResult.outputFormat
    });
    console.error(`[smoke] 迭代輸出：${paths.join(", ")}；response_id=${iterateResult.responseId}`);
  });

  it("iterate_image 兩輪對話：第二輪不應重複回傳第一輪的圖片（Task 7）", async () => {
    const config = loadConfig();
    const client = new MuseClient(config);

    // 第一輪：開新對話
    const { result: turn1 } = await client.iterate({
      prompt: "a simple flat-style icon of a purple star on white background"
    });
    expect(turn1.responseId).not.toBe("");
    expect(turn1.images.length).toBe(1);

    // 第二輪：帶入 previous_response_id 續接對話，驗證是否只回傳「這一輪」新生成的圖片，
    // 而不是把第一輪的 image_generation_call 也一併撈出來（extractB64Images 是無去重的深度走訪）
    const { result: turn2 } = await client.iterate({
      prompt: "now make the star yellow",
      previousResponseId: turn1.responseId
    });
    expect(turn2.responseId).not.toBe("");

    // 這就是 Task 7 要驗證的核心事實：第二輪實際回傳幾張圖片。
    // 實測結果：剛好 1 張，並未把第一輪的 image_generation_call 也撈出來——
    // extractB64Images 不需修改。
    expect(turn2.images.length).toBe(1);

    const paths = await saveImages(turn2.images, {
      outputDir: config.outputDir,
      prefix: "smoke-iterate-turn2",
      format: turn2.outputFormat
    });
    console.error(
      `[smoke] 兩輪對話輸出：turn1=${turn1.responseId} turn2=${turn2.responseId} ` +
        `turn2.images.length=${turn2.images.length} paths=${paths.join(", ")}`
    );
  });
});

describe("extractB64Images 在真實結構上的健全性", () => {
  it("即使結構未知也不會誤抓非字串值", () => {
    expect(extractB64Images({ b64_json: 123, nested: { b64_json: "ok" } })).toEqual(["ok"]);
  });
});
