#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

run_cli() {
  docker compose --profile tools run --rm openclaw-cli "$@"
}

echo "🔐 OpenClaw web-auth setup"
echo "This script runs interactive auth for Codex + Claude + Gemini."
echo "Kilo currently requires API key auth (KILOCODE_API_KEY)."
echo "OpenAI/Anthropic API-key env vars are intentionally not used by OpenClaw containers."

echo "1) Running interactive auth (Codex -> Claude -> Gemini)..."
"${ROOT_DIR}/scripts/openclaw-interactive-auth.sh" all --skip-status

echo "   Keeping existing default model unchanged (local-first policy)."

if [ -z "${KILOCODE_API_KEY:-}" ]; then
  echo "⚠️ KILOCODE_API_KEY is not set. Kilo provider will remain unavailable."
else
  echo "✅ KILOCODE_API_KEY is set."
fi

echo "5) Current model/auth status:"
run_cli models status

echo "✨ Web-auth setup flow complete."
