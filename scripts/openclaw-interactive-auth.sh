#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

GATEWAY_CONTAINER="${OPENCLAW_GATEWAY_CONTAINER:-email-master-openclaw-gateway}"
CLI_SERVICE="${OPENCLAW_CLI_SERVICE:-openclaw-cli}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/openclaw-interactive-auth.sh [provider] [--skip-status]

Providers:
  all      Run Codex + Claude + Gemini interactive auth (default)
  codex    Run OpenAI Codex OAuth login
  claude   Run Anthropic setup-token flow
  gemini   Run Gemini OAuth login

Examples:
  ./scripts/openclaw-interactive-auth.sh
  ./scripts/openclaw-interactive-auth.sh all
  ./scripts/openclaw-interactive-auth.sh gemini
  ./scripts/openclaw-interactive-auth.sh codex --skip-status

Env:
  OPENCLAW_CODEX_FALLBACK=onboard|skip (default: onboard)
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

PROVIDER="all"
SKIP_STATUS="false"
CODEX_FALLBACK="${OPENCLAW_CODEX_FALLBACK:-onboard}"

for arg in "$@"; do
  case "$arg" in
    all|codex|claude|gemini)
      PROVIDER="$arg"
      ;;
    --skip-status)
      SKIP_STATUS="true"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $arg (use --help)"
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  fail "Docker is required but not found in PATH."
fi

if [ ! -t 0 ] || [ ! -t 1 ]; then
  fail "Interactive auth requires a TTY terminal."
fi

run_cli() {
  docker compose --profile tools run --rm "${CLI_SERVICE}" "$@"
}

list_loaded_auth_providers() {
  docker exec "${GATEWAY_CONTAINER}" node -e '
    const cp = require("child_process");
    const raw = cp.execSync("node dist/index.js plugins list --json", { encoding: "utf8" });
    const data = JSON.parse(raw);
    const providers = new Set();
    for (const plugin of data.plugins || []) {
      for (const id of plugin.providerIds || []) providers.add(id);
    }
    process.stdout.write(Array.from(providers).sort().join("\n"));
  '
}

has_loaded_auth_provider() {
  local provider="$1"
  if [ -z "${LOADED_AUTH_PROVIDERS_CACHE:-}" ]; then
    LOADED_AUTH_PROVIDERS_CACHE="$(list_loaded_auth_providers || true)"
  fi
  grep -qx "${provider}" <<<"${LOADED_AUTH_PROVIDERS_CACHE}"
}

ensure_gateway_running() {
  echo "Ensuring OpenClaw gateway is running..."
  docker compose up -d openclaw-gateway
}

enable_gemini_plugin() {
  echo "Ensuring Gemini OAuth plugin is enabled..."
  run_cli plugins enable google-gemini-cli-auth || true
}

ensure_gemini_cli_installed() {
  if docker exec "${GATEWAY_CONTAINER}" sh -lc 'command -v gemini >/dev/null 2>&1 || command -v gemini-cli >/dev/null 2>&1'; then
    echo "Gemini CLI is already installed in ${GATEWAY_CONTAINER}."
    return
  fi

  echo "Installing Gemini CLI in ${GATEWAY_CONTAINER} (one-time per container rebuild)..."
  docker exec -u 0 "${GATEWAY_CONTAINER}" sh -lc 'npm install -g @google/gemini-cli'
}

login_codex() {
  echo
  echo "1) Codex OAuth login"
  if ! has_loaded_auth_provider "openai-codex"; then
    echo "Provider 'openai-codex' is not loaded for 'models auth login' in this OpenClaw build."
    if [ "${CODEX_FALLBACK}" = "onboard" ]; then
      echo "Running onboarding fallback for Codex OAuth."
      echo "When prompted, choose: OpenAI Code subscription (OAuth)."
      docker exec -it "${GATEWAY_CONTAINER}" node dist/index.js onboard
    else
      echo "Skipping Codex OAuth (set OPENCLAW_CODEX_FALLBACK=onboard to run wizard fallback)."
    fi
    return
  fi
  docker exec -it "${GATEWAY_CONTAINER}" node dist/index.js models auth login --provider openai-codex
}

login_claude() {
  echo
  echo "2) Claude setup-token login"
  echo "Run 'claude setup-token' on your host first, then paste the token in the prompt below."
  docker exec -it "${GATEWAY_CONTAINER}" node dist/index.js models auth setup-token --provider anthropic
}

login_gemini() {
  echo
  echo "3) Gemini OAuth login"
  enable_gemini_plugin
  ensure_gemini_cli_installed
  LOADED_AUTH_PROVIDERS_CACHE=""
  if ! has_loaded_auth_provider "google-gemini-cli"; then
    fail "Gemini provider plugin is still unavailable after enabling google-gemini-cli-auth."
  fi
  echo "Open the Google URL shown in terminal, then paste the full callback URL back in the prompt."
  docker exec -it "${GATEWAY_CONTAINER}" node dist/index.js models auth login --provider google-gemini-cli
}

ensure_gateway_running
LOADED_AUTH_PROVIDERS_CACHE="$(list_loaded_auth_providers || true)"
if [ -n "${LOADED_AUTH_PROVIDERS_CACHE}" ]; then
  echo "Loaded auth providers:"
  echo "${LOADED_AUTH_PROVIDERS_CACHE}" | sed 's/^/  - /'
else
  echo "Loaded auth providers: none"
fi

case "${PROVIDER}" in
  all)
    login_codex
    login_claude
    login_gemini
    ;;
  codex)
    login_codex
    ;;
  claude)
    login_claude
    ;;
  gemini)
    login_gemini
    ;;
esac

if [ "${SKIP_STATUS}" != "true" ]; then
  echo
  echo "Model/auth status:"
  run_cli models status
fi

echo
echo "Interactive auth flow complete."
