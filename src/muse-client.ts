import type { Config } from "./config.js";
import { MuseError, classifyHttpError, classifyFetchError } from "./errors.js";
import { buildRequestBody } from "./request-body.js";
import type {
  ClientResult,
  EditParams,
  GenerateParams,
  IterateParams,
  IterateResult,
  MuseImageResponse,
  MuseUsage,
  OutputFormat
} from "./types.js";

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
 * 深度走訪任意 JSON 結構，收集所有圖片的 base64 字串。
 * /v1/responses 的回應結構官方文件未載明，因此不硬編欄位路徑，改用兩種已知形狀辨識：
 * (1) 任意層級的 `b64_json` 字串欄位（OpenAI Responses 慣例的猜測形狀）；
 * (2) 實測 Meta Muse API 的真實形狀——`output[]` 陣列中 `type === "image_generation_call"`
 *     的項目，圖片資料在其 `result` 欄位（直接是 base64，無 data URL 前綴，預設 webp）。
 */
export function extractB64Images(node: unknown): string[] {
  const found: string[] = [];

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      // 實測發現的真實形狀：image_generation_call 項目的 result 欄位
      if (obj.type === "image_generation_call" && typeof obj.result === "string") {
        found.push(obj.result);
      }
      for (const [key, child] of Object.entries(obj)) {
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
  async generate(params: GenerateParams): Promise<ClientResult<MuseImageResponse>> {
    const { body, blockedKeys } = buildRequestBody({
      core: {
        model: params.model ?? this.config.model,
        prompt: params.prompt,
        response_format: "b64_json"
      },
      named: {
        n: params.n,
        size: params.size,
        output_format: params.outputFormat,
        reasoning_strength: params.reasoningStrength
      },
      defaultExtra: this.config.extraParams,
      callExtra: params.extraParams
    });
    const result = (await this.request("/images/generations", body)) as MuseImageResponse;
    return { result, blockedKeys };
  }

  /** 依既有圖片改圖。imageUrls 須為 data URL 或 http(s) URL。 */
  async edit(params: EditParams): Promise<ClientResult<MuseImageResponse>> {
    const { body, blockedKeys } = buildRequestBody({
      core: {
        model: params.model ?? this.config.model,
        prompt: params.prompt,
        response_format: "b64_json",
        images: params.imageUrls.map(url => ({ image_url: url }))
      },
      named: {
        n: params.n,
        size: params.size,
        output_format: params.outputFormat,
        reasoning_strength: params.reasoningStrength
      },
      defaultExtra: this.config.extraParams,
      callExtra: params.extraParams
    });
    const result = (await this.request("/images/edits", body)) as MuseImageResponse;
    return { result, blockedKeys };
  }

  /**
   * 對話式迭代修圖。
   * store 固定為 true，讓 Meta 端保存對話，本 server 不維護任何 state。
   */
  async iterate(params: IterateParams): Promise<ClientResult<IterateResult>> {
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

    const { body, blockedKeys } = buildRequestBody({
      core: {
        model: params.model ?? this.config.model,
        input,
        store: true,
        previous_response_id: params.previousResponseId
      },
      // reasoning_strength／size／output_format 在 /v1/responses 不是頂層參數，
      // 而是 image_generation 這個工具的設定，必須包在 tools 陣列內。
      // 送在頂層會被回 HTTP 400 unknown parameter（非「多送無害」），iterate 因此全數失敗。
      // 放在 named 而非 core，是為了讓 extra_params 仍能整個換掉 tools（例如開關 web search）。
      // 值為 undefined 的欄位會在 JSON.stringify 時自動消失，因此未指定的參數
      // 不會變成 "size": null 之類的無效欄位；compact() 只處理 body 頂層，管不到這層巢狀物件。
      named: {
        tools: [
          {
            type: "image_generation",
            reasoning_strength: params.reasoningStrength,
            size: params.size,
            output_format: params.outputFormat
          }
        ]
      },
      defaultExtra: this.config.extraParams,
      callExtra: params.extraParams
    });

    const raw = (await this.request("/responses", body)) as Record<string, unknown>;
    const images = extractB64Images(raw);
    if (images.length === 0) {
      throw new MuseError(
        "server",
        `Muse /responses 回應中找不到任何圖片資料（b64_json 或 image_generation_call.result）。原始回應：${JSON.stringify(raw).slice(0, 500)}`
      );
    }

    const responseId = typeof raw.id === "string" ? raw.id : "";
    // 實測 /v1/responses 不會回傳 output_format 欄位，所以格式只能由請求端決定：
    // 有指定就用指定值，沒指定時 Meta 端預設輸出 webp。
    // 少了中間這段，指定 png 會存成 .webp 副檔名而內容是 PNG——不拋錯但檔案標示是錯的。
    const outputFormat = (typeof raw.output_format === "string"
      ? raw.output_format
      : params.outputFormat ?? "webp") as OutputFormat;

    return {
      result: {
        responseId,
        images,
        outputFormat,
        usage: raw.usage as MuseUsage | undefined
      },
      blockedKeys
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
