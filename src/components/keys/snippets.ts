/**
 * Quickstart snippets for the Keys page — verbatim from
 * docs/inference/quickstart.mdx and docs/inference/external-use/*.
 * Keep these in sync with the docs; they are the canonical setup flow.
 */

export const COMPOSE_API_URL = "https://api.compose.market";
export const EXTERNAL_BASE_URL = "https://api.compose.market/external/v1";
export const MODELS_ENDPOINT = "https://api.compose.market/external/v1/models";
export const BEARER_FORMAT = "Authorization: Bearer compose-...";
export const DOCS_EXTERNAL_USE = "https://docs.compose.market/inference/external-use";
export const DOCS_KEYS = "https://docs.compose.market/x402/key";
export const DOCS_API = "https://docs.compose.market/inference/quickstart";

export const ENV_EXPORT = `export COMPOSE_MARKET_API_KEY="compose-..."`;

/**
 * Native Responses API — the proprietary unified surface.
 * One endpoint for every modality and operation.
 */
export const CURL_RESPONSES = `curl https://api.compose.market/v1/responses \\
  -H "Authorization: Bearer $COMPOSE_MARKET_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "x-network-id: eip155:* | solana:*" \\
  -d '{
    "model": "gemini-2.5-flash",
    "input": "Write a terse deployment checklist."
  }'`;

/** OpenAI-compatible external surface — drop-in for existing SDKs. */
export const CURL_EXTERNAL = `curl https://api.compose.market/external/v1/chat/completions \\
  -H "Authorization: Bearer $COMPOSE_MARKET_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "x-network-id: eip155:* | solana:*" \\
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [
      { "role": "user", "content": "Hello from an OpenAI-compatible client." }
    ]
  }'`;

export const SDK_PYTHON = `import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["COMPOSE_MARKET_API_KEY"],
    base_url="https://api.compose.market/external/v1",
)

response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Hello from Compose."}],
)

print(response.choices[0].message.content)`;

export const SDK_TYPESCRIPT = `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.COMPOSE_MARKET_API_KEY,
  baseURL: "https://api.compose.market/external/v1",
});

const response = await client.chat.completions.create({
  model: "gemini-2.5-flash",
  messages: [{ role: "user", content: "Hello from Compose." }],
});

console.log(response.choices[0].message.content);`;

/** OpenCode — docs/inference/external-use/configs/well-known-opencode.mdx */
export const OPENCODE_JSON = `{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "compose-market": {
      "name": "Compose.Market",
      "npm": "@ai-sdk/openai",
      "options": {
        "baseURL": "https://api.compose.market/external/v1"
      }
    }
  }
}`;

export const OPENCODE_AUTH = `opencode auth login https://api.compose.market`;

export const OPENCODE_START = `opencode`;
