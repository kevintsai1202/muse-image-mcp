# muse-image-mcp

[![CI](https://github.com/kevintsai1202/muse-image-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/kevintsai1202/muse-image-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/muse-image-mcp)](https://www.npmjs.com/package/muse-image-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md) · [繁體中文](README.zh-TW.md) · **简体中文**

以 Meta Muse 影像模型提供生图能力的 MCP server，让任何支持 MCP 的 Agent——Claude Code、Claude Desktop、Cursor——都能画图。

## 这是什么

三个工具，覆盖在对话中处理图片的完整流程：

| 工具 | 用途 |
|---|---|
| `generate_image` | 文字生图。单次 1–10 张。 |
| `edit_image` | 依参考图改图，支持本地文件与网址。 |
| `iterate_image` | 对话式迭代。一直说「再暖一点」，它记得前面几轮。 |

## 为什么用这个 server

**你的 context 不会被图片吃掉。** 每个工具都把图片写进磁盘、只回传**绝对路径**，绝不回传图片内容。生成十几张图只花掉十几行 context，而不是十几 MB 的 base64。真的要看图时，用文件读取工具打开那个路径即可。

**多轮迭代，但不存状态。** `iterate_image` 会回传 `response_id`；把它当作下一轮的 `previous_response_id`，就能延续同一段对话。server 自己不保存任何状态——对话由 Meta 端保存，所以这个 server 随时可以重启。

**出了新模型不必等改版。** 用 `MUSE_MODEL` 或单次的 `model` 参数换模型，用 `extra_params` 送这个 server 从没听过的新参数。决定请求结构的字段受保护不会被覆写，其余都是刻意留的逃生口。

**你随时知道花了多少钱。** 每次回应结尾都会揭露该次的预估成本。

## 需求

- Node.js >= 20.12.0
- 一组 Meta Muse API key

### 如何取得 API key

Muse Image 跑在 **Meta Model API** 上，所以你是向 Meta 注册，不是向本项目注册：

1. 前往 **<https://dev.meta.ai>**，登录 Meta Model API 后台。
2. 打开 **API keys**。
3. 点 **Create API key**，复制产生的密钥。

这组值就是下面要填的 `MUSE_API_KEY`。Meta 官方文档把这个变量叫 `MODEL_API_KEY`；本 server 读的名称是 `MUSE_API_KEY`，连接到 `https://api.meta.ai/v1`，默认模型为 `muse-image-1.0`。

参考：[Model API 文档](https://dev.meta.ai/docs) · [影像生成](https://dev.meta.ai/docs/image-generation) · [Muse Image 发布说明](https://developer.meta.com/ai/resources/blog/build-with-muse-Image/)

密钥不要进版本控制——用 MCP 设置的 `env` 区块或 `.env` 文件，两种方式都在下面说明。

## 安装

### 方式一：npx（推荐，不需 clone）

```bash
claude mcp add muse-image --scope user --env MUSE_API_KEY=你的key -- npx -y muse-image-mcp
```

`npx` 会自动抓取最新版执行，不需要先安装。

- `--scope user` 对所有项目生效；只想装在当前项目改用 `--scope local`。
- `-y` 跳过 npx 的安装确认。**漏掉会卡在互动询问而握手失败。**
- `--` 之后才是真正的启动指令，前面的 `--env` 属于 `claude mcp add`。

其他 MCP client（Claude Desktop、Cursor）请手动写设置文件：

```jsonc
{
  "mcpServers": {
    "muse-image": {
      "command": "npx",
      "args": ["-y", "muse-image-mcp"],
      "env": { "MUSE_API_KEY": "你的key" }
    }
  }
}
```

Windows 若出现 `npx` 找不到，把 `command` 换成 `cmd`、`args` 改为 `["/c", "npx", "-y", "muse-image-mcp"]`。

### 方式二：本机 clone（要改代码时用）

```bash
git clone https://github.com/kevintsai1202/muse-image-mcp.git
cd muse-image-mcp
npm install
npm run build
claude mcp add muse-image --scope user --env MUSE_API_KEY=你的key -- node <你 clone 的路径>/dist/index.js
```

### 装完之后

装完要**重开一个新的 session**，`mcp__muse-image__*` 三个工具才会载入。用 `claude mcp list` 确认显示 `muse-image: ... - Connected`。

## 设置 API key

优先序为 **MCP 设置的 `env` 区块 > `.env` 文件**。

### 用 MCP 设置的 env 区块（npx 安装时的唯一途径）

见上方 `--env MUSE_API_KEY=你的key`。

### 用 `.env` 文件

server 会依序搜索下列位置，采用第一个存在的文件：

1. `<包根目录>/.env` — 本机 clone 时最方便
2. `~/.muse-image-mcp/.env` — 经 npx 安装时使用者唯一可控的位置

```
MUSE_API_KEY=你的key
```

注意 `.env` 不是从你执行 Claude Code 的项目目录读取——MCP server 的工作目录由 client 决定，不适合放配置。经 npx 安装时包本体位于带哈希的 npm 缓存目录（会被清掉），在那里放 `.env` 没有意义。

### 环境变量

以下变量都可写在 `.env` 或 MCP 设置的 `env` 区块。

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `MUSE_API_KEY` | 是 | — | API key。缺少时 server 会立刻结束并在 stderr 说明 |
| `MUSE_MODEL` | 否 | `muse-image-1.0` | 全局默认模型 ID |
| `MUSE_EXTRA_PARAMS` | 否 | `{}` | JSON 对象字符串，全局默认额外参数 |
| `MUSE_OUTPUT_DIR` | 否 | `<cwd>/generated-images` | 图片输出目录，不存在时自动建立 |
| `MUSE_BASE_URL` | 否 | `https://api.meta.ai/v1` | API base URL |
| `MUSE_TIMEOUT_MS` | 否 | `120000` | 单次请求超时毫秒数 |

> `MUSE_OUTPUT_DIR` 默认值 `<cwd>/generated-images` 所指的 `cwd`，是 MCP client 启动这个 server 时所在的工作目录。在 Claude Code 中即为你启动 session 的项目根目录，因此图片会落在你当前项目下的 `generated-images/`。若你的 client 不是这个行为、或想要固定的输出位置，请把 `MUSE_OUTPUT_DIR` 设为绝对路径。
>
> v0.1.0 起默认输出目录由 `muse-output/` 改为 `generated-images/`。旧目录不会被自动删除或搬移。

## 切换模型与额外参数

新模型推出时不需要等本项目改版——用环境变量换模型，用 `extra_params` 送新参数。

### 换模型

全局切换写在 `.env` 或 MCP 设置：

```
MUSE_MODEL=muse-image-2.0
```

单次指定则直接在对话中要求，Agent 会带 `model` 参数：

```jsonc
{ "prompt": "a red fox", "model": "muse-image-2.0" }
```

### 送新参数

全局默认写成 JSON 对象字符串：

```
MUSE_EXTRA_PARAMS={"quality":"ultra"}
```

单次覆写用 `extra_params`，会与全局设置合并、单次的优先：

```jsonc
{ "prompt": "a red fox", "extra_params": { "style_preset": "anime" } }
```

### 核心字段保护

`model`、`prompt`、`response_format`、`images`、`input`、`store`、`previous_response_id` 这些决定请求结构的字段不会被 `extra_params` 覆写——写了也不生效，并且会在回应末端看到被忽略的字段警告。

换模型请用 `model` 参数或 `MUSE_MODEL`，不要写在 `extra_params` 里。

除上述核心字段外，`extra_params` 会覆写同名的一般参数，包含 `n`、`size`、`output_format`、`reasoning_strength`。这些字段在工具 schema 上的取值验证（例如 `n` 限 1–10）在此路径下**不生效**——这是刻意保留的逃生口，让新模型改变参数语义时仍可绕过既有限制。使用 `extra_params` 覆写 `n` 时请自行留意张数与成本。

## 工具

所有工具都把图片存到本机并回传**绝对路径**，不回传图片内容本身——这是为了避免 base64 占用大量对话 context。需要看图时用文件读取工具打开该路径即可。

### `generate_image` — 文字生图

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `prompt` | 是 | — | 图片描述 |
| `n` | 否 | 1 | 生成张数，1–10 |
| `size` | 否 | — | **长宽比**字符串如 `1792x1024`，非精确像素分辨率 |
| `output_format` | 否 | `png` | `png` / `webp` / `jpeg` |
| `reasoning_strength` | 否 | `high` | `high` / `low`，计价相同 |
| `filename_prefix` | 否 | `muse` | 输出文件名前缀 |
| `model` | 否 | — | 模型 ID，省略则用服务器设置的默认值（见 `MUSE_MODEL`） |
| `extra_params` | 否 | — | 对象，传给 API 的额外参数，与全局 `MUSE_EXTRA_PARAMS` 合并、单次优先；核心字段受保护 |

### `edit_image` — 依图改图

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `prompt` | 是 | — | 图片描述 |
| `images` | 是 | — | 本机文件路径（png/jpg/jpeg/webp/gif）或 http(s) 网址的数组。本机文件会自动转成 base64 |
| `n` | 否 | 1 | 生成张数，1–10 |
| `size` | 否 | — | **长宽比**字符串如 `1792x1024`，非精确像素分辨率 |
| `output_format` | 否 | `png` | `png` / `webp` / `jpeg` |
| `reasoning_strength` | 否 | `high` | `high` / `low`，计价相同 |
| `filename_prefix` | 否 | `muse-edit` | 输出文件名前缀 |
| `model` | 否 | — | 模型 ID，省略则用服务器设置的默认值 |
| `extra_params` | 否 | — | 合并与保护规则同上 |

### `iterate_image` — 对话式迭代修图

| 参数 | 必填 | 说明 |
|---|---|---|
| `prompt` | 是 | 本轮修改指令 |
| `previous_response_id` | 否 | 上一轮回传的 id；省略代表开新对话 |
| `images` | 否 | 首轮参考图 |
| `reasoning_strength` | 否 | 默认 `high` |
| `filename_prefix` | 否 | 默认 `muse-iter` |
| `model` | 否 | 模型 ID，省略则用服务器设置的默认值 |
| `extra_params` | 否 | 合并与保护规则同上 |

注意此工具**没有** `n`、`size`、`output_format` 参数——`/v1/responses` 端点一次只回传一张图，且不接受输出格式参数（见下方实测结果，未指定时 Meta 端默认输出 webp）。

回应**一定包含 `response_id`**。下一轮把它填进 `previous_response_id` 即可延续同一段对话。本 server 不保存任何对话状态，对话由 Meta 端保存。

## `/v1/responses` 实测结果

Meta 未公开 `/v1/responses` 的回应 schema，实现时是比照 OpenAI Responses 惯例的推测，之后以真实 API 调用验证。实际结构如下：

```json
{
  "model": "muse-image-1.0",
  "id": "resp_6aa4c23f99592ae0ac454928",
  "object": "response",
  "status": "completed",
  "output": [
    { "type": "reasoning", "summary": [{ "type": "summary_text", "text": "..." }] },
    { "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": "" }] },
    { "type": "image_generation_call", "id": "ig_...", "status": "completed", "result": "<base64 图片数据>" }
  ]
}
```

与推测形状的差异：

- **`id` 取值路径**：`raw.id` 猜对了，实测确认正确，无需修改。
- **图片数据位置**：不在任何 `b64_json` 字段，而是在 `output[]` 数组中 `type === "image_generation_call"` 项目的 `result` 字段，值直接是 base64（无 data URL 前缀）。`src/muse-client.ts` 的 `extractB64Images` 已改为同时辨识 `b64_json`（保留给其他可能形状）与这个实测到的形状。
- **`output_format` 字段不存在**：回应中完全没有 `output_format` 字段。原本的 fallback 默认值 `"png"` 是错的——iterate 因为送出的 request 不带 `output_format` 参数，Meta 端套用了与 `/images/generations` 相同的默认值 `webp`，实测回传的 base64 解出来确实是 WebP 格式（RIFF/WEBP 文件头）。fallback 已改为 `"webp"`。

### 多轮对话（`previous_response_id`）已实测验证

以真实 API 做了两轮对话：先调用一次 `iterate_image` 取得 `response_id`，再用该 id 当 `previous_response_id` 调用第二轮。结果：第二轮只回传当轮新生成的 **1 张图片**，并未把第一轮已经生成过的图片也重复带回来——`extractB64Images` 的深度遍历逻辑对此无需修改。

（受限于测试工具在该次执行中未能完整撷取第二轮原始回应的逐字节内容，这个结论是以「输出文件数量刚好 1 个、无 -2/-3 等后续序号」的文件系统证据佐证，而非逐字节比对；`tests/muse-client.test.ts` 中新增的 pinning test 沿用已验证的真实回应形状来钉住这个行为。）

## 计价

每张生成图片 **US$0.01**，与 `reasoning_strength` 无关。每次工具回应都会揭露该次的预估成本。

这个 server 本身免费且采用 MIT 授权——你只需支付 Meta 的 API 使用费。

## 开发

```bash
npm test          # 单元测试（不会打真实 API）
npm run build     # 编译到 dist/
npm run smoke     # 真实 API 冒烟测试，需 MUSE_E2E=1 与真 key，共产生 6 张图，约花费 US$0.06
```

## 授权

[MIT](LICENSE) © Kevin Tsai
