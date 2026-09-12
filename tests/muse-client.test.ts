import { describe, it, expect, vi } from "vitest";
import { MuseClient, extractB64Images } from "../src/muse-client.js";
import { MuseError } from "../src/errors.js";
import type { Config } from "../src/config.js";

const CONFIG: Config = Object.freeze({
  apiKey: "test-key",
  baseUrl: "https://api.example.test/v1",
  outputDir: "/tmp/out",
  timeoutMs: 1000
});

/** 建立一個回傳指定 JSON 與狀態碼的 fetch 假物件 */
function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    })
  );
}

/** 立即完成的 sleep，讓重試測試不必真的等待 */
const noSleep = async () => {};

const OK_IMAGE_BODY = {
  created: 1784584435,
  data: [{ b64_json: "AAAA" }],
  output_format: "png",
  usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 }
};

describe("MuseClient.generate", () => {
  it("送出正確的 URL、header 與 request body", async () => {
    const fetchImpl = fakeFetch(200, OK_IMAGE_BODY);
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.generate({
      prompt: "a red fox",
      n: 2,
      size: "1792x1024",
      outputFormat: "png",
      reasoningStrength: "low"
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/v1/images/generations");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      model: "muse-image-1.0",
      prompt: "a red fox",
      response_format: "b64_json",
      n: 2,
      size: "1792x1024",
      output_format: "png",
      reasoning_strength: "low"
    });
  });

  it("未給的選填參數不出現在 body 中", async () => {
    const fetchImpl = fakeFetch(200, OK_IMAGE_BODY);
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.generate({ prompt: "only prompt" });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({
      model: "muse-image-1.0",
      prompt: "only prompt",
      response_format: "b64_json"
    });
    expect("size" in body).toBe(false);
    expect("n" in body).toBe(false);
  });

  it("回傳解析後的回應", async () => {
    const client = new MuseClient(CONFIG, {
      fetchImpl: fakeFetch(200, OK_IMAGE_BODY) as unknown as typeof fetch,
      sleep: noSleep
    });
    const result = await client.generate({ prompt: "x" });
    expect(result.data[0]!.b64_json).toBe("AAAA");
    expect(result.usage!.total_tokens).toBe(15);
  });
});

describe("MuseClient.edit", () => {
  it("把 imageUrls 包成 images 陣列送到 /images/edits", async () => {
    const fetchImpl = fakeFetch(200, OK_IMAGE_BODY);
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.edit({ prompt: "add a hat", imageUrls: ["data:image/png;base64,ZZZ", "https://x.test/a.png"] });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/v1/images/edits");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.images).toEqual([
      { image_url: "data:image/png;base64,ZZZ" },
      { image_url: "https://x.test/a.png" }
    ]);
  });
});

describe("MuseClient.iterate", () => {
  it("首輪無圖時 input 為純字串，且帶 store: true", async () => {
    const fetchImpl = fakeFetch(200, { id: "resp_1", output: [{ content: [{ b64_json: "IMG" }] }] });
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.iterate({ prompt: "make it blue" });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/v1/responses");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.input).toBe("make it blue");
    expect(body.store).toBe(true);
    expect(body.model).toBe("muse-image-1.0");
    expect("previous_response_id" in body).toBe(false);
  });

  it("有參考圖時 input 為結構化陣列", async () => {
    const fetchImpl = fakeFetch(200, { id: "resp_1", output: [{ b64_json: "IMG" }] });
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.iterate({ prompt: "make it blue", imageUrls: ["data:image/png;base64,ZZZ"] });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "make it blue" },
          { type: "input_image", image_url: "data:image/png;base64,ZZZ" }
        ]
      }
    ]);
  });

  it("帶入 previousResponseId 以續接對話", async () => {
    const fetchImpl = fakeFetch(200, { id: "resp_2", output: [{ b64_json: "IMG" }] });
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await client.iterate({ prompt: "again", previousResponseId: "resp_1" });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.previous_response_id).toBe("resp_1");
  });

  it("從巢狀回應中取出 response id 與圖片", async () => {
    const client = new MuseClient(CONFIG, {
      fetchImpl: fakeFetch(200, {
        id: "resp_9",
        output: [{ type: "image", content: [{ b64_json: "DEEP" }] }],
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
      }) as unknown as typeof fetch,
      sleep: noSleep
    });

    const result = await client.iterate({ prompt: "x" });
    expect(result.responseId).toBe("resp_9");
    expect(result.images).toEqual(["DEEP"]);
    expect(result.usage!.total_tokens).toBe(3);
  });

  it("回應中找不到任何圖片時拋出 server 類錯誤", async () => {
    const client = new MuseClient(CONFIG, {
      fetchImpl: fakeFetch(200, { id: "resp_x", output: [] }) as unknown as typeof fetch,
      sleep: noSleep
    });
    await expect(client.iterate({ prompt: "x" })).rejects.toMatchObject({ kind: "server" });
  });

  // 2026-09-12 實測 /v1/responses 真實回應結構（節錄自煙霧測試，圖片 base64 已截短）：
  // output[] 內混有 reasoning、message、image_generation_call 三種 type，
  // 圖片資料在 image_generation_call.result（非 b64_json），且回應中沒有 output_format 欄位。
  const REAL_RESPONSES_SHAPE = {
    model: "muse-image-1.0",
    id: "resp_6aa4c23f99592ae0ac454928",
    object: "response",
    status: "completed",
    created_at: 1789182527,
    error: null,
    incomplete_details: null,
    output: [
      {
        type: "reasoning",
        id: "rs_6aa4c23f8b0b6df47fb64ab7",
        summary: [{ type: "summary_text", text: "設計中的圖示說明文字" }],
        status: "completed"
      },
      {
        type: "message",
        id: "msg_6aa4c23f8072b0d3598c4ade",
        role: "assistant",
        content: [{ type: "output_text", text: "", annotations: [], logprobs: [] }],
        status: "completed"
      },
      {
        type: "image_generation_call",
        id: "ig_redacted",
        status: "completed",
        result: "UklGRi5rAABXRUJQVlA4WAoAAAAEAAAAPwYAPwYAVlA4IIZpAABwHgSdASpABkAGPg=="
      }
    ]
  };

  it("實測形狀：從 image_generation_call.result 取出圖片，output_format 缺席時預設 webp", async () => {
    const client = new MuseClient(CONFIG, {
      fetchImpl: fakeFetch(200, REAL_RESPONSES_SHAPE) as unknown as typeof fetch,
      sleep: noSleep
    });

    const result = await client.iterate({ prompt: "a simple flat-style icon of a green triangle" });
    expect(result.responseId).toBe("resp_6aa4c23f99592ae0ac454928");
    expect(result.images).toEqual(["UklGRi5rAABXRUJQVlA4WAoAAAAEAAAAPwYAPwYAVlA4IIZpAABwHgSdASpABkAGPg=="]);
    expect(result.outputFormat).toBe("webp");
  });
});

describe("重試行為", () => {
  it("401 不重試，直接拋 auth 錯誤", async () => {
    const fetchImpl = fakeFetch(401, { error: { message: "invalid api key" } });
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await expect(client.generate({ prompt: "x" })).rejects.toMatchObject({ kind: "auth" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("400 不重試", async () => {
    const fetchImpl = fakeFetch(400, { error: { message: "bad n" } });
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await expect(client.generate({ prompt: "x" })).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("429 重試 3 次後放棄，共發出 4 次請求", async () => {
    const fetchImpl = fakeFetch(429, { error: { message: "slow down" } });
    const sleep = vi.fn(async () => {});
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep });

    await expect(client.generate({ prompt: "x" })).rejects.toMatchObject({ kind: "rate_limit" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(c => c[0])).toEqual([1000, 2000, 4000]);
  });

  it("先 500 後成功時回傳成功結果", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(OK_IMAGE_BODY), { status: 200 }));
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    const result = await client.generate({ prompt: "x" });
    expect(result.data[0]!.b64_json).toBe("AAAA");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fetch 拋例外時歸類為 network 並重試", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const client = new MuseClient(CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await expect(client.generate({ prompt: "x" })).rejects.toMatchObject({ kind: "network" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe("extractB64Images", () => {
  it("深度走訪任意巢狀結構收集 b64_json", () => {
    const node = { a: [{ b: { b64_json: "X" } }, { b64_json: "Y" }], c: "ignored" };
    expect(extractB64Images(node)).toEqual(["X", "Y"]);
  });

  it("沒有任何 b64_json 時回傳空陣列", () => {
    expect(extractB64Images({ a: 1, b: "text" })).toEqual([]);
  });

  it("實測形狀：從 type === image_generation_call 的 result 欄位取出圖片", () => {
    const node = {
      output: [
        { type: "reasoning", summary: [{ type: "summary_text", text: "not an image" }] },
        { type: "image_generation_call", result: "REAL_IMG_1" }
      ]
    };
    expect(extractB64Images(node)).toEqual(["REAL_IMG_1"]);
  });
});
