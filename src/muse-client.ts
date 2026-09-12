import type { Config } from "./config.js";
import { MuseError, classifyHttpError, classifyFetchError } from "./errors.js";
import type {
  EditParams,
  GenerateParams,
  IterateParams,
  IterateResult,
  MuseImageResponse,
  MuseUsage,
  OutputFormat
} from "./types.js";

/** Muse 影像模型 ID，全專案固定 */
const MODEL = "muse-image-1.0";

/** 可重試錯誤的退避間隔（毫秒）。陣列長度即為最大重試次數。 */
const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

/** 可注入的相依，供測試替換 */
export interface MuseClientDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** 預設的延遲實作 */
const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 深度走訪任意 JSON 結構，收集所有 b64_json 字串。
 * /v1/responses 的回應結構官方文件未載明，因此不硬編欄位路徑。
 */
export function extractB64Images(node: unknown): string[] {
  const found: string[] = [];

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "b64_json" && typeof child === "string") {
          found.push(child);
        } else {
          walk(child);
        }
      }
    }
  };

  walk(node);
  return found;
}

/** 去除物件中值為 undefined 的欄位，避免送出 `"size": null` 這類無效欄位 */
function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/** Muse API 的薄封裝。只負責 HTTP，不碰檔案系統。 */
export class MuseClient {
  private readonly config: Config;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: Config, deps: MuseClientDeps = {}) {
    this.config = config;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.sleep = deps.sleep ?? defaultSleep;
  }

  /** 文字生圖 */
  async generate(params: GenerateParams): Promise<MuseImageResponse> {
    const body = compact({
      model: MODEL,
      prompt: params.prompt,
      response_format: "b64_json",
      n: params.n,
      size: params.size,
      output_format: params.outputFormat,
      reasoning_strength: params.reasoningStrength
    });
    return (await this.request("/images/generations", body)) as MuseImageResponse;
  }

  /** 依既有圖片改圖。imageUrls 須為 data URL 或 http(s) URL。 */
  async edit(params: EditParams): Promise<MuseImageResponse> {
    const body = compact({
      model: MODEL,
      prompt: params.prompt,
      response_format: "b64_json",
      images: params.imageUrls.map(url => ({ image_url: url })),
      n: params.n,
      size: params.size,
      output_format: params.outputFormat,
      reasoning_strength: params.reasoningStrength
    });
    return (await this.request("/images/edits", body)) as MuseImageResponse;
  }

  /**
   * 對話式迭代修圖。
   * store 固定為 true，讓 Meta 端保存對話，本 server 不維護任何 state。
   */
  async iterate(params: IterateParams): Promise<IterateResult> {
    // 有參考圖時用結構化 input，否則用純字串
    const input =
      params.imageUrls && params.imageUrls.length > 0
        ? [
            {
              role: "user",
              content: [
                { type: "input_text", text: params.prompt },
                ...params.imageUrls.map(url => ({ type: "input_image", image_url: url }))
              ]
            }
          ]
        : params.prompt;

    const body = compact({
      model: MODEL,
      input,
      store: true,
      previous_response_id: params.previousResponseId,
      reasoning_strength: params.reasoningStrength
    });

    const raw = (await this.request("/responses", body)) as Record<string, unknown>;
    const images = extractB64Images(raw);
    if (images.length === 0) {
      throw new MuseError(
        "server",
        `Muse /responses 回應中找不到任何圖片資料（b64_json）。原始回應：${JSON.stringify(raw).slice(0, 500)}`
      );
    }

    const responseId = typeof raw.id === "string" ? raw.id : "";
    const outputFormat = (typeof raw.output_format === "string" ? raw.output_format : "png") as OutputFormat;

    return {
      responseId,
      images,
      outputFormat,
      usage: raw.usage as MuseUsage | undefined
    };
  }

  /**
   * 送出單次 POST 請求，帶逾時與可重試錯誤的指數退避。
   * @param path 相對於 baseUrl 的路徑，需以斜線開頭
   * @param body 已去除 undefined 欄位的 request body
   */
  private async request(path: string, body: Record<string, unknown>): Promise<unknown> {
    const url = `${this.config.baseUrl}${path}`;
    let lastError: MuseError | undefined;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeoutMs)
        });
      } catch (cause) {
        lastError = classifyFetchError(cause);
        if (attempt < RETRY_DELAYS_MS.length) {
          await this.sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        throw lastError;
      }

      if (response.ok) {
        return await response.json();
      }

      // 錯誤回應：先讀成文字再嘗試解析成 JSON，避免非 JSON body 讓解析炸掉
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* 保留原始文字 */
      }

      lastError = classifyHttpError(response.status, parsed);
      if (lastError.retryable && attempt < RETRY_DELAYS_MS.length) {
        await this.sleep(RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      throw lastError;
    }

    // 理論上不會走到這裡；保留為防禦
    throw lastError ?? new MuseError("server", "Muse API 請求失敗且無錯誤資訊");
  }
}
