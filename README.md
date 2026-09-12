# muse-image-mcp

[![CI](https://github.com/kevintsai1202/muse-image-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/kevintsai1202/muse-image-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/muse-image-mcp)](https://www.npmjs.com/package/muse-image-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**English** · [繁體中文](README.zh-TW.md) · [简体中文](README.zh-CN.md)

An MCP server that gives any MCP-capable agent — Claude Code, Claude Desktop, Cursor — image generation powered by the Meta Muse image model.

## What it does

Three tools, covering the full loop of working with images in a conversation:

| Tool | What it's for |
|---|---|
| `generate_image` | Text to image. 1–10 images per call. |
| `edit_image` | Edit from reference images — local files or URLs. |
| `iterate_image` | Conversational refinement. Keep saying "make it warmer" and it remembers. |

## Why this server

**Your context window survives.** Every tool writes images to disk and returns an **absolute file path** — never the image bytes. Generating a dozen images costs you a dozen lines of context instead of a dozen megabytes of base64. When you actually want to look at an image, open the path with a file-reading tool.

**Multi-turn refinement without state.** `iterate_image` returns a `response_id`; feed it back as `previous_response_id` and the next turn continues the same conversation. The server itself stores nothing — conversation state lives on Meta's side, so the server stays restartable and stateless.

**New models don't require a new release.** Switch models with `MUSE_MODEL` or a per-call `model` parameter, and pass parameters this server has never heard of through `extra_params`. Fields that determine request structure are protected from being overwritten; everything else is a deliberate escape hatch.

**You always know what it cost.** Every response ends with the estimated cost of that call.

## Requirements

- Node.js >= 20.12.0
- A Meta Muse API key

### Getting an API key

Muse Image runs on the **Meta Model API**, so you register with Meta — not with this project:

1. Go to **<https://dev.meta.ai>** and sign in to the Meta Model API dashboard.
2. Open **API keys**.
3. Click **Create API key** and copy the value.

That value is what you pass as `MUSE_API_KEY` below. Meta's own documentation calls this variable `MODEL_API_KEY`; this server reads it as `MUSE_API_KEY`, talks to `https://api.meta.ai/v1`, and defaults to the model `muse-image-1.0`.

Reference: [Model API docs](https://dev.meta.ai/docs) · [Image generation](https://dev.meta.ai/docs/image-generation) · [Muse Image announcement](https://developer.meta.com/ai/resources/blog/build-with-muse-Image/)

Keep the key out of source control — use the MCP config's `env` block or a `.env` file, both described below.

## Install

### Option 1: npx (recommended — no clone required)

```bash
claude mcp add muse-image --scope user --env MUSE_API_KEY=your-key -- npx -y muse-image-mcp
```

`npx` fetches and runs the latest version on demand — nothing to install first.

- `--scope user` applies it to every project; use `--scope local` for the current project only.
- `-y` skips npx's install prompt. **Without it the server hangs on an interactive question and the handshake fails.**
- Everything after `--` is the launch command; `--env` before it belongs to `claude mcp add`.

For other MCP clients (Claude Desktop, Cursor), write the config by hand:

```jsonc
{
  "mcpServers": {
    "muse-image": {
      "command": "npx",
      "args": ["-y", "muse-image-mcp"],
      "env": { "MUSE_API_KEY": "your-key" }
    }
  }
}
```

On Windows, if `npx` can't be found, use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "muse-image-mcp"]`.

### Option 2: Local clone (when you want to change the code)

```bash
git clone https://github.com/kevintsai1202/muse-image-mcp.git
cd muse-image-mcp
npm install
npm run build
claude mcp add muse-image --scope user --env MUSE_API_KEY=your-key -- node <your-clone-path>/dist/index.js
```

### After installing

**Start a new session** — MCP servers are loaded at session start, so an existing session won't pick it up. Then confirm with `claude mcp list`, which should show `muse-image: ... - Connected`, and check that the three `mcp__muse-image__*` tools are available.

## Configuring the API key

Precedence is **the `env` block in your MCP config > a `.env` file**.

### Using the MCP config `env` block (the only route when installed via npx)

See `--env MUSE_API_KEY=your-key` above.

### Using a `.env` file

The server searches these locations in order and uses the first one that exists:

1. `<package root>/.env` — convenient for a local clone
2. `~/.muse-image-mcp/.env` — the only location you control when installed via npx

```
MUSE_API_KEY=your-key
```

Note that `.env` is **not** read from the directory you launched Claude Code in — an MCP server's working directory is decided by the client, which makes it a poor place for configuration. When installed via npx the package itself lives in a hashed npm cache directory that gets cleaned up, so a `.env` there would be pointless.

### Environment variables

All of these work in either `.env` or your MCP config's `env` block.

| Variable | Required | Default | Description |
|---|---|---|---|
| `MUSE_API_KEY` | Yes | — | API key. Without it the server exits immediately and explains itself on stderr |
| `MUSE_MODEL` | No | `muse-image-1.0` | Global default model ID |
| `MUSE_EXTRA_PARAMS` | No | `{}` | JSON object string — global default extra parameters |
| `MUSE_OUTPUT_DIR` | No | `<cwd>/generated-images` | Output directory, created if missing |
| `MUSE_BASE_URL` | No | `https://api.meta.ai/v1` | API base URL |
| `MUSE_TIMEOUT_MS` | No | `120000` | Per-request timeout in milliseconds |

> The `cwd` in `MUSE_OUTPUT_DIR`'s default is the working directory the MCP client launched the server from. In Claude Code that's the project root of your session, so images land in that project's `generated-images/`. If your client behaves differently, or you want a fixed location, set `MUSE_OUTPUT_DIR` to an absolute path.
>
> Since v0.1.0 the default output directory changed from `muse-output/` to `generated-images/`. The old directory is not deleted or migrated automatically.

## Switching models and passing new parameters

When a new model ships you don't have to wait for this project to update — switch models with an environment variable, send new parameters through `extra_params`.

### Switching models

Globally, in `.env` or your MCP config:

```
MUSE_MODEL=muse-image-2.0
```

Per call, just ask for it in conversation and the agent will pass `model`:

```jsonc
{ "prompt": "a red fox", "model": "muse-image-2.0" }
```

### Passing new parameters

Global defaults as a JSON object string:

```
MUSE_EXTRA_PARAMS={"quality":"ultra"}
```

Per-call overrides via `extra_params`, merged with the global setting — the per-call value wins:

```jsonc
{ "prompt": "a red fox", "extra_params": { "style_preset": "anime" } }
```

### Protected core fields

`model`, `prompt`, `response_format`, `images`, `input`, `store`, and `previous_response_id` determine the structure of the request and cannot be overwritten by `extra_params`. Setting them there has no effect, and the response will end with a warning listing the ignored keys.

To change models, use the `model` parameter or `MUSE_MODEL` — not `extra_params`.

Outside those core fields, `extra_params` **does** override same-named regular parameters, including `n`, `size`, `output_format`, and `reasoning_strength`. The tool schema's validation for these (for example `n` being limited to 1–10) **does not apply** on this path — that's a deliberate escape hatch so a future model that changes parameter semantics isn't blocked by today's limits. When overriding `n` this way, watch your image count and cost.

## Tools

Every tool saves images locally and returns **absolute paths**, never the image content itself — this keeps base64 out of your conversation context. Open the path with a file-reading tool when you want to see the image.

### `generate_image` — text to image

| Parameter | Required | Default | Description |
|---|---|---|---|
| `prompt` | Yes | — | Image description |
| `n` | No | 1 | Number of images, 1–10 |
| `size` | No | — | **Aspect ratio** string such as `1792x1024` — not an exact pixel resolution |
| `output_format` | No | `png` | `png` / `webp` / `jpeg` |
| `reasoning_strength` | No | `high` | `high` / `low` — priced the same |
| `filename_prefix` | No | `muse` | Output filename prefix |
| `model` | No | — | Model ID; omit to use the server default (see `MUSE_MODEL`) |
| `extra_params` | No | — | Object of extra parameters, merged with `MUSE_EXTRA_PARAMS` with per-call priority; core fields are protected (see above) |

### `edit_image` — edit from reference images

| Parameter | Required | Default | Description |
|---|---|---|---|
| `prompt` | Yes | — | Image description |
| `images` | Yes | — | Array of local file paths (png/jpg/jpeg/webp/gif) or http(s) URLs. Local files are base64-encoded automatically |
| `n` | No | 1 | Number of images, 1–10 |
| `size` | No | — | **Aspect ratio** string such as `1792x1024` — not an exact pixel resolution |
| `output_format` | No | `png` | `png` / `webp` / `jpeg` |
| `reasoning_strength` | No | `high` | `high` / `low` — priced the same |
| `filename_prefix` | No | `muse-edit` | Output filename prefix |
| `model` | No | — | Model ID; omit to use the server default |
| `extra_params` | No | — | Same merge and protection rules as above |

### `iterate_image` — conversational refinement

| Parameter | Required | Description |
|---|---|---|
| `prompt` | Yes | This turn's instruction |
| `previous_response_id` | No | The id returned by the previous turn; omit to start a new conversation |
| `images` | No | Reference images for the first turn |
| `reasoning_strength` | No | Defaults to `high` |
| `filename_prefix` | No | Defaults to `muse-iter` |
| `model` | No | Model ID; omit to use the server default |
| `extra_params` | No | Same merge and protection rules as above |

This tool deliberately has **no** `n`, `size`, or `output_format` parameters — the `/v1/responses` endpoint returns one image at a time and doesn't accept an output format parameter (see the findings below; when unspecified, Meta's default output is webp).

The response **always includes a `response_id`**. Pass it as `previous_response_id` on the next call to continue the same conversation. This server stores no conversation state; Meta does.

## Findings from `/v1/responses`

Meta doesn't publish the response schema for `/v1/responses`. The original implementation was an educated guess modeled on OpenAI's Responses convention; it was later verified against real API calls. The actual structure:

```json
{
  "model": "muse-image-1.0",
  "id": "resp_6aa4c23f99592ae0ac454928",
  "object": "response",
  "status": "completed",
  "output": [
    { "type": "reasoning", "summary": [{ "type": "summary_text", "text": "..." }] },
    { "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": "" }] },
    { "type": "image_generation_call", "id": "ig_...", "status": "completed", "result": "<base64 image data>" }
  ]
}
```

Differences from the guessed shape:

- **`id` location**: `raw.id` was correct, confirmed by testing. No change needed.
- **Image data location**: not in any `b64_json` field, but in the `result` field of the `output[]` entry where `type === "image_generation_call"`, as raw base64 with no data URL prefix. `src/muse-client.ts`'s `extractB64Images` now recognizes both `b64_json` (kept for other possible shapes) and this verified shape.
- **No `output_format` field**: the response has none. The original fallback default of `"png"` was wrong — since the iterate request doesn't send an `output_format` parameter, Meta applies the same default as `/images/generations`, which is `webp`. The returned base64 decodes to a genuine WebP file (RIFF/WEBP header). The fallback is now `"webp"`.

### Multi-turn conversation is verified

Two real API calls were made in sequence: one `iterate_image` to obtain a `response_id`, then a second call using that id as `previous_response_id`. The second turn returned **only the one image generated in that turn** — it did not re-send the first turn's image. `extractB64Images`'s deep-traversal logic needed no changes for this.

(The test tooling in that run didn't capture the second turn's raw response byte-for-byte, so this conclusion rests on filesystem evidence — exactly one output file, with no `-2`/`-3` suffixes — rather than a byte-level comparison. The pinning test added in `tests/muse-client.test.ts` uses the real response shape verified earlier.)

## Pricing

**US$0.01 per generated image**, regardless of `reasoning_strength`. Every tool response discloses the estimated cost of that call.

This server is free and MIT-licensed — you pay Meta for API usage, nothing else.

## Development

```bash
npm test          # Unit tests (never hits the real API)
npm run build     # Compile to dist/
npm run smoke     # Real-API smoke test; needs MUSE_E2E=1 and a real key. Generates 6 images, about US$0.06
```

## License

[MIT](LICENSE) © Kevin Tsai
