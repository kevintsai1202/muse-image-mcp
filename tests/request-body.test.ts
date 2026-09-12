import { describe, it, expect } from "vitest";
import { buildRequestBody } from "../src/request-body.js";

describe("buildRequestBody", () => {
  it("合併核心欄位與具名參數", () => {
    const { body } = buildRequestBody({
      core: { model: "m1", prompt: "a fox", response_format: "b64_json" },
      named: { n: 2, size: "1024x1024" },
      defaultExtra: {}
    });

    expect(body).toEqual({
      model: "m1",
      prompt: "a fox",
      response_format: "b64_json",
      n: 2,
      size: "1024x1024"
    });
  });

  it("移除值為 undefined 的具名參數", () => {
    const { body } = buildRequestBody({
      core: { model: "m1", prompt: "a fox" },
      named: { n: 1, size: undefined, output_format: undefined },
      defaultExtra: {}
    });

    expect(body).toEqual({ model: "m1", prompt: "a fox", n: 1 });
    expect("size" in body).toBe(false);
  });

  it("移除值為 undefined 的核心欄位，body 不含該鍵", () => {
    const { body } = buildRequestBody({
      core: { model: "m1", input: "hi", store: true, previous_response_id: undefined },
      named: {},
      defaultExtra: {}
    });

    expect(body).toEqual({ model: "m1", input: "hi", store: true });
  });

  it("全域擴充參數會併入 body", () => {
    const { body } = buildRequestBody({
      core: { model: "m1", prompt: "p" },
      named: {},
      defaultExtra: { quality: "ultra" }
    });

    expect(body.quality).toBe("ultra");
  });

  it("單次擴充參數覆寫全域擴充參數", () => {
    const { body } = buildRequestBody({
      core: { model: "m1", prompt: "p" },
      named: {},
      defaultExtra: { quality: "ultra", seed: 1 },
      callExtra: { quality: "draft" }
    });

    expect(body.quality).toBe("draft");
    expect(body.seed).toBe(1);
  });

  it("擴充參數可覆寫具名參數", () => {
    const { body } = buildRequestBody({
      core: { model: "m1", prompt: "p" },
      named: { size: "1024x1024" },
      defaultExtra: {},
      callExtra: { size: "2048x2048" }
    });

    expect(body.size).toBe("2048x2048");
  });

  it("擴充參數不得覆寫核心欄位，並列入 blockedKeys", () => {
    const { body, blockedKeys } = buildRequestBody({
      core: { model: "m1", prompt: "real prompt" },
      named: {},
      defaultExtra: {},
      callExtra: { model: "hijack", prompt: "fake prompt", quality: "ultra" }
    });

    expect(body.model).toBe("m1");
    expect(body.prompt).toBe("real prompt");
    expect(body.quality).toBe("ultra");
    expect(blockedKeys.sort()).toEqual(["model", "prompt"]);
  });

  it("值為 undefined 的核心欄位其鍵仍受保護", () => {
    const { body, blockedKeys } = buildRequestBody({
      core: { model: "m1", previous_response_id: undefined },
      named: {},
      defaultExtra: {},
      callExtra: { previous_response_id: "resp_hijack" }
    });

    expect("previous_response_id" in body).toBe(false);
    expect(blockedKeys).toEqual(["previous_response_id"]);
  });

  it("全域與單次擴充參數撞到同一個核心欄位時，blockedKeys 不重複", () => {
    const { blockedKeys } = buildRequestBody({
      core: { model: "m1" },
      named: {},
      defaultExtra: { model: "a" },
      callExtra: { model: "b" }
    });

    expect(blockedKeys).toEqual(["model"]);
  });

  it("沒有任何衝突時 blockedKeys 為空陣列", () => {
    const { blockedKeys } = buildRequestBody({
      core: { model: "m1", prompt: "p" },
      named: { n: 1 },
      defaultExtra: { quality: "ultra" }
    });

    expect(blockedKeys).toEqual([]);
  });

  it("省略 callExtra 時行為正常", () => {
    const { body, blockedKeys } = buildRequestBody({
      core: { model: "m1", prompt: "p" },
      named: { n: 1 },
      defaultExtra: {}
    });

    expect(body).toEqual({ model: "m1", prompt: "p", n: 1 });
    expect(blockedKeys).toEqual([]);
  });
});
