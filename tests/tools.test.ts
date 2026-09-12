import { describe, it, expect, vi } from "vitest";
import { createTools, formatResult } from "../src/tools.js";
import { MuseError } from "../src/errors.js";
import type { Config } from "../src/config.js";

const CONFIG: Config = Object.freeze({
  apiKey: "k",
  baseUrl: "https://api.example.test/v1",
  outputDir: "/out",
  timeoutMs: 1000,
  model: "muse-image-1.0",
  extraParams: {}
});

/** 組出一套可控的相依，預設全部成功 */
function makeDeps(overrides: Partial<Parameters<typeof createTools>[0]> = {}) {
  return {
    config: CONFIG,
    client: {
      generate: vi.fn(async () => ({
        result: {
          created: 1,
          data: [{ b64_json: "AAAA" }],
          output_format: "png" as const,
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
        },
        blockedKeys: [] as string[]
      })),
      edit: vi.fn(async () => ({
        result: {
          created: 1,
          data: [{ b64_json: "BBBB" }],
          output_format: "png" as const
        },
        blockedKeys: [] as string[]
      })),
      iterate: vi.fn(async () => ({
        result: {
          responseId: "resp_42",
          images: ["CCCC"],
          outputFormat: "png" as const,
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
        },
        blockedKeys: [] as string[]
      }))
    },
    saveImages: vi.fn(async (list: string[]) => list.map((_, i) => `/out/img-${i + 1}.png`)),
    toImageUrl: vi.fn(async (p: string) => (p.startsWith("http") ? p : `data:image/png;base64,ENC(${p})`)),
    ...overrides
  };
}

/** 取出指定名稱的工具定義 */
function pick(tools: ReturnType<typeof createTools>, name: string) {
  const found = tools.find(t => t.name === name);
  if (!found) throw new Error(`找不到工具 ${name}`);
  return found;
}

describe("createTools", () => {
  it("註冊三個工具且名稱正確", () => {
    const tools = createTools(makeDeps());
    expect(tools.map(t => t.name)).toEqual(["generate_image", "edit_image", "iterate_image"]);
  });

  it("generate_image 的描述說明 size 是長寬比且揭露成本", () => {
    const tool = pick(createTools(makeDeps()), "generate_image");
    expect(tool.config.description).toContain("長寬比");
    expect(tool.config.description).toContain("0.01");
  });
});

describe("generate_image handler", () => {
  it("套用預設值：n=1、output_format=png、reasoning=high、prefix=muse", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "generate_image");

    await tool.handler({ prompt: "a fox" } as never);

    expect(deps.client.generate).toHaveBeenCalledWith({
      prompt: "a fox",
      n: 1,
      size: undefined,
      outputFormat: "png",
      reasoningStrength: "high"
    });
    expect(deps.saveImages).toHaveBeenCalledWith(["AAAA"], {
      outputDir: "/out",
      prefix: "muse",
      format: "png"
    });
  });

  it("回應文字包含路徑、用量與預估成本", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "generate_image");

    const result = await tool.handler({ prompt: "a fox" } as never);

    expect(result.isError).toBeFalsy();
    const text = result.content[0]!.text;
    expect(text).toContain("/out/img-1.png");
    expect(text).toContain("total_tokens=3");
    expect(text).toContain("US$0.01");
  });

  it("MuseError 轉為 isError 回應並保留原始訊息", async () => {
    const deps = makeDeps();
    deps.client.generate = vi.fn(async () => {
      throw new MuseError("invalid_request", "請求參數不合法：n must be between 1 and 10");
    });
    const tool = pick(createTools(deps), "generate_image");

    const result = await tool.handler({ prompt: "a fox" } as never);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("n must be between 1 and 10");
    expect(result.content[0]!.text).toContain("invalid_request");
  });

  it("非 MuseError 的例外也轉為 isError 而不外拋", async () => {
    const deps = makeDeps();
    deps.client.generate = vi.fn(async () => {
      throw new Error("boom");
    });
    const tool = pick(createTools(deps), "generate_image");

    const result = await tool.handler({ prompt: "a fox" } as never);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("boom");
  });
});

describe("edit_image handler", () => {
  it("把每個 images 元素都經過 toImageUrl 正規化", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "edit_image");

    await tool.handler({ prompt: "add hat", images: ["a.png", "https://x.test/b.png"] } as never);

    expect(deps.toImageUrl).toHaveBeenCalledTimes(2);
    expect(deps.client.edit).toHaveBeenCalledWith({
      prompt: "add hat",
      imageUrls: ["data:image/png;base64,ENC(a.png)", "https://x.test/b.png"],
      n: 1,
      size: undefined,
      outputFormat: "png",
      reasoningStrength: "high"
    });
  });

  it("預設檔名前綴為 muse-edit", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "edit_image");

    await tool.handler({ prompt: "x", images: ["a.png"] } as never);

    expect(deps.saveImages).toHaveBeenCalledWith(["BBBB"], {
      outputDir: "/out",
      prefix: "muse-edit",
      format: "png"
    });
  });

  it("讀檔失敗時回傳 isError 並指出是哪個路徑", async () => {
    const deps = makeDeps();
    deps.toImageUrl = vi.fn(async () => {
      throw new MuseError("input", "讀取圖片失敗：/nope.png（目前工作目錄：/cwd）");
    });
    const tool = pick(createTools(deps), "edit_image");

    const result = await tool.handler({ prompt: "x", images: ["/nope.png"] } as never);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("/nope.png");
  });
});

describe("iterate_image handler", () => {
  it("回應必定包含 response_id 與續接說明", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "iterate_image");

    const result = await tool.handler({ prompt: "make it blue" } as never);

    const text = result.content[0]!.text;
    expect(text).toContain("resp_42");
    expect(text).toContain("previous_response_id");
  });

  it("首輪不帶 images 時 imageUrls 為 undefined", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "iterate_image");

    await tool.handler({ prompt: "x" } as never);

    expect(deps.client.iterate).toHaveBeenCalledWith({
      prompt: "x",
      previousResponseId: undefined,
      imageUrls: undefined,
      reasoningStrength: "high"
    });
  });

  it("帶 previous_response_id 時傳給 client", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "iterate_image");

    await tool.handler({ prompt: "x", previous_response_id: "resp_1" } as never);

    expect(deps.client.iterate).toHaveBeenCalledWith(
      expect.objectContaining({ previousResponseId: "resp_1" })
    );
  });

  // 實測確認 /v1/responses 透過 tools 物件支援這兩個參數（見 scripts/probe-responses-api.mjs case 4），
  // 因此 iterate_image 沒有理由比另外兩個工具少這兩個選項。
  it("size 與 output_format 傳給 client", async () => {
    const deps = makeDeps();
    const tool = pick(createTools(deps), "iterate_image");

    await tool.handler({ prompt: "x", size: "1024x1536", output_format: "png" } as never);

    expect(deps.client.iterate).toHaveBeenCalledWith(
      expect.objectContaining({ size: "1024x1536", outputFormat: "png" })
    );
  });

  it("schema 含 size 與 output_format", () => {
    const shape = pick(createTools(makeDeps()), "iterate_image").config.inputSchema;

    expect(shape.size).toBeDefined();
    expect(shape.output_format).toBeDefined();
  });
});

describe("formatResult", () => {
  it("多張圖片時成本按張數累加", () => {
    const text = formatResult(["/a.png", "/b.png", "/c.png"]);
    expect(text).toContain("已生成 3 張圖片");
    expect(text).toContain("US$0.03");
    expect(text).toContain("1. /a.png");
    expect(text).toContain("3. /c.png");
  });

  it("沒有 usage 時不印用量行", () => {
    expect(formatResult(["/a.png"])).not.toContain("用量：");
  });

  it("額外行會附加在最後", () => {
    expect(formatResult(["/a.png"], undefined, ["response_id: r1"])).toContain("response_id: r1");
  });
});

describe("output_format 以回應為準（I-1）", () => {
  it("generate_image：response.output_format 與請求 format 不同時，saveImages 收到回應的格式", async () => {
    const deps = makeDeps({
      client: {
        generate: vi.fn(async () => ({
          // extra_params 覆寫了 output_format，API 實際回傳 webp，但請求時是 png
          result: { created: 1, data: [{ b64_json: "AAAA" }], output_format: "webp" as const },
          blockedKeys: [] as string[]
        })),
        edit: vi.fn(),
        iterate: vi.fn()
      }
    });
    const tools = createTools(deps);

    await pick(tools, "generate_image").handler({
      prompt: "p",
      extra_params: { output_format: "webp" }
    } as never);

    expect(deps.saveImages).toHaveBeenCalledWith(["AAAA"], {
      outputDir: "/out",
      prefix: "muse",
      format: "webp"
    });
  });

  it("edit_image：response.output_format 與請求 format 不同時，saveImages 收到回應的格式", async () => {
    const deps = makeDeps({
      client: {
        generate: vi.fn(),
        edit: vi.fn(async () => ({
          result: { created: 1, data: [{ b64_json: "BBBB" }], output_format: "jpeg" as const },
          blockedKeys: [] as string[]
        })),
        iterate: vi.fn()
      }
    });
    const tools = createTools(deps);

    await pick(tools, "edit_image").handler({
      prompt: "p",
      images: ["http://example.test/a.png"],
      extra_params: { output_format: "jpeg" }
    } as never);

    expect(deps.saveImages).toHaveBeenCalledWith(["BBBB"], {
      outputDir: "/out",
      prefix: "muse-edit",
      format: "jpeg"
    });
  });

  it("generate_image：response.output_format 為非預期值時退回請求 format", async () => {
    const deps = makeDeps({
      client: {
        generate: vi.fn(async () => ({
          // API 回傳了不在 png/webp/jpeg 之列的值（例如伺服器端異常或新格式尚未支援）
          result: { created: 1, data: [{ b64_json: "AAAA" }], output_format: "bmp" as never },
          blockedKeys: [] as string[]
        })),
        edit: vi.fn(),
        iterate: vi.fn()
      }
    });
    const tools = createTools(deps);

    await pick(tools, "generate_image").handler({ prompt: "p", output_format: "png" } as never);

    expect(deps.saveImages).toHaveBeenCalledWith(["AAAA"], {
      outputDir: "/out",
      prefix: "muse",
      format: "png"
    });
  });
});

describe("模型與擴充參數", () => {
  it("generate_image 的 schema 含 model 與 extra_params", () => {
    const tools = createTools(makeDeps());
    const shape = pick(tools, "generate_image").config.inputSchema;
    expect(shape.model).toBeDefined();
    expect(shape.extra_params).toBeDefined();
  });

  it("edit_image 的 schema 含 model 與 extra_params", () => {
    const tools = createTools(makeDeps());
    const shape = pick(tools, "edit_image").config.inputSchema;
    expect(shape.model).toBeDefined();
    expect(shape.extra_params).toBeDefined();
  });

  it("iterate_image 的 schema 含 model 與 extra_params", () => {
    const tools = createTools(makeDeps());
    const shape = pick(tools, "iterate_image").config.inputSchema;
    expect(shape.model).toBeDefined();
    expect(shape.extra_params).toBeDefined();
  });

  it("generate_image 把 model 與 extra_params 透傳給 client", async () => {
    const deps = makeDeps();
    const tools = createTools(deps);
    await pick(tools, "generate_image").handler({
      prompt: "p",
      model: "muse-image-9.9",
      extra_params: { quality: "ultra" }
    } as never);

    expect(deps.client.generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "muse-image-9.9", extraParams: { quality: "ultra" } })
    );
  });

  it("edit_image 把 model 與 extra_params 透傳給 client", async () => {
    const deps = makeDeps();
    const tools = createTools(deps);
    await pick(tools, "edit_image").handler({
      prompt: "p",
      images: ["http://example.test/a.png"],
      model: "muse-image-9.9",
      extra_params: { quality: "ultra" }
    } as never);

    expect(deps.client.edit).toHaveBeenCalledWith(
      expect.objectContaining({ model: "muse-image-9.9", extraParams: { quality: "ultra" } })
    );
  });

  it("iterate_image 把 model 與 extra_params 透傳給 client", async () => {
    const deps = makeDeps();
    const tools = createTools(deps);
    await pick(tools, "iterate_image").handler({
      prompt: "p",
      model: "muse-image-9.9",
      extra_params: { quality: "ultra" }
    } as never);

    expect(deps.client.iterate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "muse-image-9.9", extraParams: { quality: "ultra" } })
    );
  });

  it("blockedKeys 非空時在回應文字附加警告行", async () => {
    const deps = makeDeps({
      client: {
        generate: vi.fn(async () => ({
          result: { created: 1, data: [{ b64_json: "AAAA" }], output_format: "png" as const },
          blockedKeys: ["model", "prompt"]
        })),
        edit: vi.fn(async () => ({
          result: { created: 1, data: [{ b64_json: "BBBB" }], output_format: "png" as const },
          blockedKeys: [] as string[]
        })),
        iterate: vi.fn(async () => ({
          result: { responseId: "r", images: ["CCCC"], outputFormat: "png" as const },
          blockedKeys: [] as string[]
        }))
      }
    });
    const tools = createTools(deps);
    const result = await pick(tools, "generate_image").handler({ prompt: "p" } as never);

    expect(result.content[0]!.text).toContain("已忽略：model, prompt");
  });

  it("blockedKeys 為空時不附加警告行", async () => {
    const tools = createTools(makeDeps());
    const result = await pick(tools, "generate_image").handler({ prompt: "p" } as never);

    expect(result.content[0]!.text).not.toContain("已忽略");
  });

  it("iterate_image 的警告與 response_id 提示可並存", async () => {
    const deps = makeDeps({
      client: {
        generate: vi.fn(async () => ({
          result: { created: 1, data: [{ b64_json: "AAAA" }], output_format: "png" as const },
          blockedKeys: [] as string[]
        })),
        edit: vi.fn(async () => ({
          result: { created: 1, data: [{ b64_json: "BBBB" }], output_format: "png" as const },
          blockedKeys: [] as string[]
        })),
        iterate: vi.fn(async () => ({
          result: { responseId: "resp_42", images: ["CCCC"], outputFormat: "png" as const },
          blockedKeys: ["store"]
        }))
      }
    });
    const tools = createTools(deps);
    const result = await pick(tools, "iterate_image").handler({ prompt: "p" } as never);

    expect(result.content[0]!.text).toContain("response_id: resp_42");
    expect(result.content[0]!.text).toContain("已忽略：store");
  });
});
