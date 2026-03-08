# Bug Report: Gemini CLI provider sends wrong User-Agent, causing aggressive rate limiting

## Component
`@mariozechner/pi-ai` v0.55.3 — `dist/providers/google-gemini-cli.js`

## Description

The `google-gemini-cli` provider hardcodes the `User-Agent` header as:

```js
const GEMINI_CLI_HEADERS = {
    "User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    ...
};
```

This causes Google's Code Assist API to apply extremely aggressive rate limits (~1 request per minute, 429 after a single request with a 58-second cooldown), even for users on Google One AI Ultra tier.

## Root Cause

The official Gemini CLI (v0.32.x, `@google/gemini-cli-core`) sends:

```
User-Agent: GeminiCLI/{version}/{model} ({platform}; {arch})
```

For example: `GeminiCLI/0.32.1/gemini-3-flash-preview (linux; x64)`

Google's backend uses the `User-Agent` header to determine rate limit tiers. The `google-cloud-sdk vscode_cloudshelleditor/0.1` agent string is treated as a legacy VS Code extension and receives minimal quotas.

## Evidence

Same OAuth token, same project (`western-synthesizer-ffdzw`), same `paidTier: g1-ultra-tier`:

| User-Agent | Result |
|---|---|
| `google-cloud-sdk vscode_cloudshelleditor/0.1` | 1/3 succeeded, 429 after first request |
| `GeminiCLI/0.32.1/gemini-3-flash-preview (linux; x64)` | 5/5 succeeded, ~1-1.5s each |

## Suggested Fix

Replace the hardcoded User-Agent with the format used by the official Gemini CLI:

```js
const GEMINI_CLI_HEADERS = {
    "User-Agent": `GeminiCLI/0.32.1/${model} (${process.platform}; ${process.arch})`,
    ...
};
```

Or ideally, make it configurable via an environment variable (e.g. `PI_AI_GEMINI_CLI_USER_AGENT`).

## Workaround

Patch the file at container startup with sed:

```sh
TARGET=$(find /app/node_modules -path "*/providers/google-gemini-cli.js" -print -quit)
sed -i 's|"User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1"|"User-Agent": "GeminiCLI/0.32.1/gemini-3-flash-preview (linux; x64)"|' "$TARGET"
```

## Environment

- OpenClaw: 2026.3.2
- @mariozechner/pi-ai: 0.55.3
- Google One AI Ultra subscription
- Code Assist project tier: `g1-ultra-tier` (confirmed via `loadCodeAssist` API)
