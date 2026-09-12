/**
 * 錯誤分類。retry 策略由此分類推導，分類邏輯本身不含重試實作。
 * - config：環境變數設定問題
 * - invalid_request：請求參數不合法（HTTP 400/其他 4xx）
 * - moderation：內容審核拒絕，重試無意義
 * - auth：API key 無效或無權限
 * - rate_limit / server / network：暫時性，可重試
 * - input：呼叫端給的本機輸入有問題（檔案不存在等）
 * - io：寫檔失敗
 */
export type ErrorKind =
  | "config"
  | "invalid_request"
  | "moderation"
  | "auth"
  | "rate_limit"
  | "server"
  | "network"
  | "input"
  | "io";

/** 可重試的錯誤分類 */
const RETRYABLE_KINDS: ReadonlySet<ErrorKind> = new Set<ErrorKind>(["rate_limit", "server", "network"]);

/** 判定為內容審核拒絕的關鍵字（Meta 回傳訊息為英文） */
const MODERATION_HINTS = ["moderation", "safety", "policy", "content_filter", "blocked"];

/** 本專案統一的錯誤型別，帶分類與是否可重試 */
export class MuseError extends Error {
  readonly kind: ErrorKind;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(kind: ErrorKind, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "MuseError";
    this.kind = kind;
    this.retryable = RETRYABLE_KINDS.has(kind);
    this.status = options?.status;
  }
}

/**
 * 從回應 body 中盡力取出可讀的錯誤訊息。
 * Meta 的 400 訊息是 Agent 自我修正的唯一依據，必須原樣保留、不可改寫。
 */
function extractMessage(body: unknown): string {
  if (typeof body === "string" && body.trim() !== "") return body;
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim() !== "") return message;
    }
    const topLevel = (body as { message?: unknown }).message;
    if (typeof topLevel === "string" && topLevel.trim() !== "") return topLevel;
    try {
      return JSON.stringify(body);
    } catch {
      /* 落到下方預設訊息 */
    }
  }
  return "（API 未提供錯誤訊息）";
}

/** 依 HTTP 狀態碼與回應 body 分類錯誤 */
export function classifyHttpError(status: number, body: unknown): MuseError {
  const detail = extractMessage(body);

  if (status === 400) {
    const lowered = detail.toLowerCase();
    const isModeration = MODERATION_HINTS.some(hint => lowered.includes(hint));
    return isModeration
      ? new MuseError("moderation", `內容審核拒絕此請求，請調整 prompt：${detail}`, { status })
      : new MuseError("invalid_request", `請求參數不合法：${detail}`, { status });
  }

  if (status === 401 || status === 403) {
    return new MuseError("auth", `API key 無效或無權限（HTTP ${status}）：${detail}`, { status });
  }

  if (status === 429) {
    return new MuseError("rate_limit", `觸發速率限制（HTTP 429）：${detail}`, { status });
  }

  if (status >= 500) {
    return new MuseError("server", `Meta 伺服器錯誤（HTTP ${status}）：${detail}`, { status });
  }

  return new MuseError("invalid_request", `請求失敗（HTTP ${status}）：${detail}`, { status });
}

/** 把 fetch 拋出的例外（連線失敗、逾時 abort）歸類為可重試的網路錯誤 */
export function classifyFetchError(cause: unknown): MuseError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new MuseError("network", `連線 Muse API 失敗：${detail}`, { cause });
}
