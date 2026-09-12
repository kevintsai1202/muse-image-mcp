import { describe, it, expect } from "vitest";
import { loadConfig, loadDotEnvFile } from "../src/config.js";
import { MuseClient, extractB64Images } from "../src/muse-client.js";
import { saveImages } from "../src/image-store.js";

/**
 * 真實 API 煙霧測試。
 * 需要 MUSE_E2E=1 與真實的 MUSE_API_KEY 才會執行，每次共產生 4 張圖（generate 1 張、
 * edit 先 generate 1 張再 edit 1 張、iterate 1 張），約花費 US$0.04。
 * 由獨立的 vitest.e2e.config.ts 載入，預設的 `npm test` 不會跑到。
 */
// key 放在專案根目錄的 .env，測試也要走同一條載入路徑
loadDotEnvFile();

const enabled = process.env.MUSE_E2E === "1";

describe.skipIf(!enabled)("Muse API 煙霧測試", () => {
  it("generate_image 能實際產出一張圖", async () => {
    const config = loadConfig();
    const client = new MuseClient(config);

    const response = await client.generate({
      prompt: "a simple flat-style icon of a blue cube on white background",
      n: 1,
      outputFormat: "png"
    });

    expect(response.data.length).toBe(1);
    expect(response.data[0]!.b64_json.length).toBeGreaterThan(1000);

    const paths = await saveImages([response.data[0]!.b64_json], {
      outputDir: config.outputDir,
      prefix: "smoke-generate",
      format: "png"
    });
    console.error(`[smoke] 生圖輸出：${paths[0]}`);
  });

  it("edit_image 能依剛產出的圖改圖", async () => {
    const config = loadConfig();
    const client = new MuseClient(config);

    const base = await client.generate({
      prompt: "a simple flat-style icon of a blue cube on white background",
      n: 1,
      outputFormat: "png"
    });
    const dataUrl = `data:image/png;base64,${base.data[0]!.b64_json}`;

    const edited = await client.edit({
      prompt: "change the cube color to red",
      imageUrls: [dataUrl],
      n: 1,
      outputFormat: "png"
    });

    expect(edited.data.length).toBe(1);
    const paths = await saveImages([edited.data[0]!.b64_json], {
      outputDir: config.outputDir,
      prefix: "smoke-edit",
      format: "png"
    });
    console.error(`[smoke] 改圖輸出：${paths[0]}`);
  });

  it("iterate_image 能取得 response_id 與圖片（驗證 /responses 的實際結構）", async () => {
    const config = loadConfig();
    const client = new MuseClient(config);

    const result = await client.iterate({
      prompt: "a simple flat-style icon of a green triangle on white background"
    });

    // 這三個斷言就是 spec §1「待實測確認」項目的驗證點
    expect(result.responseId).not.toBe("");
    expect(result.images.length).toBeGreaterThan(0);
    expect(result.images[0]!.length).toBeGreaterThan(1000);

    const paths = await saveImages(result.images, {
      outputDir: config.outputDir,
      prefix: "smoke-iterate",
      format: result.outputFormat
    });
    console.error(`[smoke] 迭代輸出：${paths.join(", ")}；response_id=${result.responseId}`);
  });
});

describe("extractB64Images 在真實結構上的健全性", () => {
  it("即使結構未知也不會誤抓非字串值", () => {
    expect(extractB64Images({ b64_json: 123, nested: { b64_json: "ok" } })).toEqual(["ok"]);
  });
});
