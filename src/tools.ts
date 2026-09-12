import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { Config } from "./config.js";
import { MuseError } from "./errors.js";
import type { saveImages as saveImagesFn, toImageUrl as toImageUrlFn } from "./image-store.js";
import type { MuseClient } from "./muse-client.js";
import type { MuseUsage, OutputFormat, ReasoningStrength } from "./types.js";

/** 每張生成圖片的固定成本（美元） */
const COST_PER_IMAGE_USD = 0.01;

/** MCP 工具回傳格式（僅用文字內容，不回傳 base64 圖片以節省 context） */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** 工具定義，由 index.ts 轉交給 McpServer.registerTool */
export interface ToolDefinition {
  name: string;
  config: { title: string; description: string; inputSchema: ZodRawShape };
  handler: (args: never) => Promise<ToolResult>;
}

/** 工具層的相依，全部以參數注入以便測試 */
export interface ToolDeps {
  client: Pick<MuseClient, "generate" | "edit" | "iterate">;
  config: Config;
  saveImages: typeof saveImagesFn;
  toImageUrl: typeof toImageUrlFn;
}

/** 三個工具共用的選填參數 schema 片段 */
const commonShape = {
  n: z.number().int().min(1).max(10).optional().describe("生成張數，1 到 10，預設 1"),
  size: z
    .string()
    .optional()
    .describe('長寬比字串，例如 "1792x1024"、"1024x1536"。注意：這是長寬比而非精確像素解析度'),
  output_format: z.enum(["png", "webp", "jpeg"]).optional().describe("輸出格式，預設 png"),
  reasoning_strength: z.enum(["high", "low"]).optional().describe("推理強度，預設 high（品質較佳但較慢）")
};

/**
 * 組出工具回應文字。
 * 只回傳路徑不回傳圖片本體，避免 base64 佔用大量 context token。
 */
export function formatResult(paths: string[], usage?: MuseUsage, extraLines: string[] = []): string {
  const lines: string[] = [`已生成 ${paths.length} 張圖片：`];
  paths.forEach((path, index) => lines.push(`${index + 1}. ${path}`));
  lines.push("");

  if (usage) {
    lines.push(
      `用量：input_tokens=${usage.input_tokens} output_tokens=${usage.output_tokens} total_tokens=${usage.total_tokens}`
    );
  }

  const cost = (paths.length * COST_PER_IMAGE_USD).toFixed(2);
  lines.push(`預估成本：US$${cost}（${paths.length} 張 x US$${COST_PER_IMAGE_USD.toFixed(2)}）`);
  lines.push(...extraLines);

  return lines.join("\n");
}

/** 把任意例外轉成給 Agent 看的錯誤回應。絕不外拋，否則 Agent 只會看到通用失敗訊息。 */
function toErrorResult(error: unknown): ToolResult {
  const text =
    error instanceof MuseError
      ? `[${error.kind}] ${error.message}`
      : `[unexpected] ${error instanceof Error ? error.message : String(error)}`;
  return { content: [{ type: "text", text }], isError: true };
}

/** 建立三個 MCP 工具的定義 */
export function createTools(deps: ToolDeps): ToolDefinition[] {
  const { client, config, saveImages, toImageUrl } = deps;

  /** 文字生圖 */
  const generateImage: ToolDefinition = {
    name: "generate_image",
    config: {
      title: "Muse 文字生圖",
      description:
        "以 Meta Muse 模型從文字描述生成圖片。圖片會存到本機並回傳絕對路徑（不回傳圖片內容本身，" +
        "需要看圖請用檔案讀取工具開啟該路徑）。size 參數是長寬比而非精確像素解析度。" +
        "每張圖片成本 US$0.01。",
      inputSchema: {
        prompt: z.string().min(1).describe("圖片描述，英文通常效果較佳"),
        ...commonShape,
        filename_prefix: z.string().optional().describe("輸出檔名前綴，預設 muse")
      }
    },
    handler: async (args: never): Promise<ToolResult> => {
      const input = args as {
        prompt: string;
        n?: number;
        size?: string;
        output_format?: OutputFormat;
        reasoning_strength?: ReasoningStrength;
        filename_prefix?: string;
      };
      try {
        const format = input.output_format ?? "png";
        const response = await client.generate({
          prompt: input.prompt,
          n: input.n ?? 1,
          size: input.size,
          outputFormat: format,
          reasoningStrength: input.reasoning_strength ?? "high"
        });
        const paths = await saveImages(
          response.data.map(item => item.b64_json),
          { outputDir: config.outputDir, prefix: input.filename_prefix ?? "muse", format }
        );
        return { content: [{ type: "text", text: formatResult(paths, response.usage) }] };
      } catch (error) {
        return toErrorResult(error);
      }
    }
  };

  /** 依既有圖片改圖 */
  const editImage: ToolDefinition = {
    name: "edit_image",
    config: {
      title: "Muse 依圖改圖",
      description:
        "以 Meta Muse 模型依既有圖片與指令生成新圖。images 可填本機檔案路徑或 http(s) 網址，" +
        "本機檔案會自動轉成 base64，呼叫端不需自行處理。結果存到本機並回傳絕對路徑。" +
        "每張圖片成本 US$0.01。",
      inputSchema: {
        prompt: z.string().min(1).describe("修改指令，描述你要如何改這張圖"),
        images: z
          .array(z.string().min(1))
          .min(1)
          .describe("參考圖片，可為本機檔案路徑（png/jpg/jpeg/webp/gif）或 http(s) 網址"),
        ...commonShape,
        filename_prefix: z.string().optional().describe("輸出檔名前綴，預設 muse-edit")
      }
    },
    handler: async (args: never): Promise<ToolResult> => {
      const input = args as {
        prompt: string;
        images: string[];
        n?: number;
        size?: string;
        output_format?: OutputFormat;
        reasoning_strength?: ReasoningStrength;
        filename_prefix?: string;
      };
      try {
        const format = input.output_format ?? "png";
        // 逐一正規化，任何一張讀不到就整批失敗並指出是哪一張
        const imageUrls: string[] = [];
        for (const item of input.images) {
          imageUrls.push(await toImageUrl(item));
        }
        const response = await client.edit({
          prompt: input.prompt,
          imageUrls,
          n: input.n ?? 1,
          size: input.size,
          outputFormat: format,
          reasoningStrength: input.reasoning_strength ?? "high"
        });
        const paths = await saveImages(
          response.data.map(item => item.b64_json),
          { outputDir: config.outputDir, prefix: input.filename_prefix ?? "muse-edit", format }
        );
        return { content: [{ type: "text", text: formatResult(paths, response.usage) }] };
      } catch (error) {
        return toErrorResult(error);
      }
    }
  };

  /** 對話式多輪迭代修圖 */
  const iterateImage: ToolDefinition = {
    name: "iterate_image",
    config: {
      title: "Muse 對話式迭代修圖",
      description:
        "以對話方式多輪迭代修改圖片。回傳中一定包含 response_id；下一輪修改時把它填入 " +
        "previous_response_id 即可延續同一段對話，本 server 不保存任何對話狀態。" +
        "每張圖片成本 US$0.01。",
      inputSchema: {
        prompt: z.string().min(1).describe("本輪的修改指令"),
        previous_response_id: z
          .string()
          .optional()
          .describe("上一輪回傳的 response_id；省略代表開始一段新對話"),
        images: z.array(z.string().min(1)).optional().describe("首輪參考圖，本機路徑或 http(s) 網址"),
        reasoning_strength: z.enum(["high", "low"]).optional().describe("推理強度，預設 high"),
        filename_prefix: z.string().optional().describe("輸出檔名前綴，預設 muse-iter")
      }
    },
    handler: async (args: never): Promise<ToolResult> => {
      const input = args as {
        prompt: string;
        previous_response_id?: string;
        images?: string[];
        reasoning_strength?: ReasoningStrength;
        filename_prefix?: string;
      };
      try {
        let imageUrls: string[] | undefined;
        if (input.images && input.images.length > 0) {
          imageUrls = [];
          for (const item of input.images) {
            imageUrls.push(await toImageUrl(item));
          }
        }

        const result = await client.iterate({
          prompt: input.prompt,
          previousResponseId: input.previous_response_id,
          imageUrls,
          reasoningStrength: input.reasoning_strength ?? "high"
        });

        const paths = await saveImages(result.images, {
          outputDir: config.outputDir,
          prefix: input.filename_prefix ?? "muse-iter",
          format: result.outputFormat
        });

        const extra = [`response_id: ${result.responseId}（下一輪修改請把它填入 previous_response_id）`];
        return { content: [{ type: "text", text: formatResult(paths, result.usage, extra) }] };
      } catch (error) {
        return toErrorResult(error);
      }
    }
  };

  return [generateImage, editImage, iterateImage];
}
