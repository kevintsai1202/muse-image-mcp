/**
 * Request body 合併層。
 * 三個 endpoint（/images/generations、/images/edits、/responses）的 body 形狀不同，
 * 但「核心欄位受保護、擴充參數可覆寫一般參數」這條規則相同，故收斂於此單一模組。
 */

/** 組 body 的輸入 */
export interface BuildRequestBodyInput {
  /**
   * 決定請求結構的核心欄位，不可被擴充參數覆寫。
   * 其鍵集合同時就是保護名單——保護哪些欄位由呼叫端的結構決定，本模組不需認識任何 endpoint。
   */
  core: Record<string, unknown>;
  /** 一般具名參數，可被擴充參數覆寫 */
  named: Record<string, unknown>;
  /** 全域預設額外參數，來自 config.extraParams */
  defaultExtra: Record<string, unknown>;
  /** 單次呼叫的額外參數，來自工具參數 extra_params */
  callExtra?: Record<string, unknown>;
}

/** 組 body 的結果 */
export interface BuildRequestBodyResult {
  /** 可直接 JSON.stringify 送出的 request body */
  body: Record<string, unknown>;
  /** 因撞到核心欄位而被忽略的 key，供工具層回報警告 */
  blockedKeys: string[];
}

/**
 * 去除物件中值為 undefined 的欄位，避免送出 `"size": null` 這類無效欄位。
 * @param obj 輸入物件
 * @returns 移除 undefined 值後的物件
 */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

/**
 * 依「具名參數 → 全域擴充 → 單次擴充 → 核心欄位」的順序合併出最終 request body。
 * 核心欄位最後套用，因此必定勝出——保護機制即由這個順序與 core 的鍵集合共同表達，
 * 不需維護硬編的保護欄位清單。
 * @param input 四個來源的參數
 * @returns 合併後的 body，以及被忽略的擴充參數 key
 */
export function buildRequestBody(input: BuildRequestBodyInput): BuildRequestBodyResult {
  const { core, named, defaultExtra, callExtra = {} } = input;

  // core 的鍵集合即保護名單。即使該鍵的值是 undefined（欄位不會送出），
  // 仍不允許擴充參數從旁塞值進來，否則「這次沒給」會變成破口。
  const protectedKeys = new Set(Object.keys(core));
  const extraKeys = [...Object.keys(defaultExtra), ...Object.keys(callExtra)];
  const blockedKeys = [...new Set(extraKeys.filter(key => protectedKeys.has(key)))];

  const body = compact({ ...named, ...defaultExtra, ...callExtra, ...core });

  return { body, blockedKeys };
}
