/** 圖片輸出格式。API 預設 webp，本專案工具層預設改用 png。 */
export type OutputFormat = "png" | "webp" | "jpeg";

/** 推理強度。high 品質較佳但較慢；兩者計價相同。 */
export type ReasoningStrength = "high" | "low";

/** Muse API 回報的 token 用量 */
export interface MuseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/** /v1/images/generations 與 /v1/images/edits 的共同回應結構 */
export interface MuseImageResponse {
  created: number;
  data: Array<{ b64_json: string }>;
  output_format: OutputFormat;
  usage?: MuseUsage;
}

/** 文字生圖參數（已由工具層正規化，欄位為 camelCase） */
export interface GenerateParams extends ModelOverrides {
  prompt: string;
  n?: number;
  /** 長寬比字串如 "1792x1024"，非精確像素 */
  size?: string;
  outputFormat?: OutputFormat;
  reasoningStrength?: ReasoningStrength;
}

/** 改圖參數。imageUrls 已正規化為 data URL 或 http(s) URL，client 不需再讀檔。 */
export interface EditParams extends GenerateParams {
  imageUrls: string[];
}

/** 對話式迭代參數 */
export interface IterateParams extends ModelOverrides {
  prompt: string;
  /** 上一輪回傳的 response id；省略代表開新對話 */
  previousResponseId?: string;
  imageUrls?: string[];
  reasoningStrength?: ReasoningStrength;
}

/** 對話式迭代結果。responseId 必須回傳給呼叫端以便續接下一輪。 */
export interface IterateResult {
  responseId: string;
  /** 取出的圖片 base64 內容 */
  images: string[];
  outputFormat: OutputFormat;
  usage?: MuseUsage;
}

/** 三個工具共用的模型與擴充參數覆寫 */
export interface ModelOverrides {
  /** 模型 ID，省略則採用 config.model */
  model?: string;
  /** 單次呼叫的額外參數，與 config.extraParams 合併後套用 */
  extraParams?: Record<string, unknown>;
}

/**
 * client 方法的回傳包裝。
 * blockedKeys 是本地產生的資訊，不塞進 MuseImageResponse——後者是 API 回應的忠實對應，
 * 混入本地欄位會讓它不再能代表 API 契約。
 */
export interface ClientResult<T> {
  /** API 回應或其解析結果 */
  result: T;
  /** 因撞到核心欄位而被忽略的擴充參數 key */
  blockedKeys: string[];
}
