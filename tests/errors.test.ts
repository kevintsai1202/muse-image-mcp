import { describe, it, expect } from "vitest";
import { MuseError, classifyHttpError, classifyFetchError } from "../src/errors.js";

describe("classifyHttpError", () => {
  it("400 保留 Meta 回傳的 error.message 原文", () => {
    const err = classifyHttpError(400, { error: { message: "n must be between 1 and 10" } });
    expect(err.kind).toBe("invalid_request");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("n must be between 1 and 10");
  });

  it("400 且訊息含審核字樣時分類為 moderation 且不重試", () => {
    const err = classifyHttpError(400, {
      error: { message: "Request rejected by content moderation policy" }
    });
    expect(err.kind).toBe("moderation");
    expect(err.retryable).toBe(false);
  });

  it("401 分類為 auth 且不重試", () => {
    expect(classifyHttpError(401, {}).kind).toBe("auth");
    expect(classifyHttpError(401, {}).retryable).toBe(false);
  });

  it("403 分類為 auth", () => {
    expect(classifyHttpError(403, {}).kind).toBe("auth");
  });

  it("429 分類為 rate_limit 且可重試", () => {
    const err = classifyHttpError(429, {});
    expect(err.kind).toBe("rate_limit");
    expect(err.retryable).toBe(true);
  });

  it("500 分類為 server 且可重試", () => {
    const err = classifyHttpError(500, {});
    expect(err.kind).toBe("server");
    expect(err.retryable).toBe(true);
  });

  it("404 等其他 4xx 分類為 invalid_request 且不重試", () => {
    const err = classifyHttpError(404, {});
    expect(err.kind).toBe("invalid_request");
    expect(err.retryable).toBe(false);
  });

  it("body 非預期結構時仍能產生可讀訊息且帶上狀態碼", () => {
    const err = classifyHttpError(400, "plain text body");
    expect(err.status).toBe(400);
    expect(err.message).toContain("plain text body");
  });
});

describe("classifyFetchError", () => {
  it("網路錯誤分類為 network 且可重試", () => {
    const err = classifyFetchError(new TypeError("fetch failed"));
    expect(err.kind).toBe("network");
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("fetch failed");
  });
});

describe("MuseError", () => {
  it("config 類錯誤不可重試", () => {
    expect(new MuseError("config", "missing key").retryable).toBe(false);
  });
});
