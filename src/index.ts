#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, loadDotEnvFile } from "./config.js";
import { MuseError } from "./errors.js";
import { saveImages, toImageUrl } from "./image-store.js";
import { MuseClient } from "./muse-client.js";
import { createTools } from "./tools.js";

/**
 * 啟動 MCP server。
 * 注意：stdout 是 JSON-RPC 通道，所有日誌一律走 stderr。
 */
async function main(): Promise<void> {
  // 依序搜尋套件根與家目錄的 .env；已存在的環境變數優先，故 MCP 設定的 env 不會被蓋掉
  const dotEnvPath = loadDotEnvFile();
  const config = loadConfig();
  const client = new MuseClient(config);
  const tools = createTools({ client, config, saveImages, toImageUrl });

  const server = new McpServer({ name: "muse-image", version: "0.1.0" });
  for (const tool of tools) {
    server.registerTool(tool.name, tool.config, tool.handler as never);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `muse-image MCP server 已啟動（模型：${config.model}；輸出目錄：${config.outputDir}；` +
      `.env：${dotEnvPath ?? "未使用"}）`
  );
}

main().catch((error: unknown) => {
  // 設定錯誤要給出可操作的訊息，避免 MCP server 靜默失敗難以排查
  if (error instanceof MuseError) {
    console.error(`[${error.kind}] ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
