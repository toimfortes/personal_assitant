#!/bin/bash
set -euo pipefail

echo "🚀 Initializing Email Master Secure Environment..."

# Create persistent directories
mkdir -p openclaw_config openclaw_workspace n8n-workflows

# Backward compatibility for older setup directory naming.
if [ -d n8n_workflows ]; then
    echo "ℹ️ Legacy directory 'n8n_workflows/' detected. Use 'n8n-workflows/' going forward."
fi

token() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    else
        tr -dc 'a-f0-9' </dev/urandom | head -c 64
    fi
}

ensure_env_value() {
    local key="$1"
    local value="$2"
    if grep -q "^${key}=" .env; then
        sed -i "s|^${key}=.*|${key}=${value}|" .env
    else
        echo "${key}=${value}" >> .env
    fi
}

get_env_value() {
    local key="$1"
    grep -E "^${key}=" .env | tail -n 1 | cut -d= -f2-
}

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✅ Created .env from template. Please add your API keys."
else
    echo "ℹ️ .env already exists. Skipping..."
fi

# Generate tokens if placeholders are still present.
OPENCLAW_GATEWAY_TOKEN_VALUE="$(get_env_value OPENCLAW_GATEWAY_TOKEN || true)"
if [ -z "${OPENCLAW_GATEWAY_TOKEN_VALUE}" ] || [[ "${OPENCLAW_GATEWAY_TOKEN_VALUE}" == replace_with_* ]]; then
    OPENCLAW_GATEWAY_TOKEN_VALUE="$(token)"
    ensure_env_value OPENCLAW_GATEWAY_TOKEN "${OPENCLAW_GATEWAY_TOKEN_VALUE}"
    echo "✅ Generated OPENCLAW_GATEWAY_TOKEN."
fi

OPENCLAW_HOOKS_TOKEN_VALUE="$(get_env_value OPENCLAW_HOOKS_TOKEN || true)"
if [ -z "${OPENCLAW_HOOKS_TOKEN_VALUE}" ] || [[ "${OPENCLAW_HOOKS_TOKEN_VALUE}" == replace_with_* ]]; then
    OPENCLAW_HOOKS_TOKEN_VALUE="$(token)"
    ensure_env_value OPENCLAW_HOOKS_TOKEN "${OPENCLAW_HOOKS_TOKEN_VALUE}"
    echo "✅ Generated OPENCLAW_HOOKS_TOKEN."
fi

# Ensure required OpenClaw defaults exist in .env
if [ -z "$(get_env_value OPENCLAW_IMAGE || true)" ]; then
    ensure_env_value OPENCLAW_IMAGE "ghcr.io/openclaw/openclaw:latest"
fi
if [ -z "$(get_env_value OPENCLAW_GATEWAY_BIND || true)" ]; then
    ensure_env_value OPENCLAW_GATEWAY_BIND "lan"
fi
if [ -z "$(get_env_value OPENCLAW_GATEWAY_PORT || true)" ]; then
    ensure_env_value OPENCLAW_GATEWAY_PORT "18789"
fi
if [ -z "$(get_env_value OPENCLAW_BRIDGE_PORT || true)" ]; then
    ensure_env_value OPENCLAW_BRIDGE_PORT "18790"
fi
if [ -z "$(get_env_value OLLAMA_API_KEY || true)" ]; then
    ensure_env_value OLLAMA_API_KEY "ollama-local"
fi

# Set permissions for non-root Docker users (node, uid 1000 in most images).
if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo chown -R 1000:1000 openclaw_config openclaw_workspace
else
    echo "⚠️ Skipping ownership change (sudo not available without prompt)."
fi

# Ensure OpenClaw base config includes secure gateway auth + hook ingress.
OPENCLAW_GATEWAY_BIND_VALUE="$(get_env_value OPENCLAW_GATEWAY_BIND || true)"
if [ -z "${OPENCLAW_GATEWAY_BIND_VALUE}" ]; then
    OPENCLAW_GATEWAY_BIND_VALUE="lan"
fi

if [ ! -f openclaw_config/openclaw.json ]; then
    cat > openclaw_config/openclaw.json <<EOF
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "google-gemini-cli/gemini-3.1-pro-preview",
        "fallbacks": [
          "anthropic/claude-opus-4-6",
          "ollama/qwen3.5:27b",
          "ollama/glm-4.7-flash",
          "ollama/llama3.1:8b",
          "google-gemini-cli/gemini-3.1-pro-preview",
          "kilocode/anthropic/claude-opus-4.6"
        ]
      },
      "models": {
        "ollama/qwen3.5:27b": { "alias": "Ollama Qwen 3.5 27B (Local Default)" },
        "ollama/glm-4.7-flash": { "alias": "Ollama GLM 4.7 Flash (Local Fast)" },
        "openai-codex/gpt-5.3-codex": { "alias": "Codex GPT-5.3" },
        "anthropic/claude-opus-4-6": { "alias": "Claude Opus 4.6" },
        "google-gemini-cli/gemini-3.1-pro-preview": { "alias": "Gemini 3.1 Pro Preview (Web Auth)" },
        "ollama/llama3.1:8b": { "alias": "Ollama Llama 3.1 8B (Local)" },
        "kilocode/anthropic/claude-opus-4.6": { "alias": "Kilo Claude Opus 4.6" }
      }
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "ollama": {
        "baseUrl": "http://ollama:11434",
        "api": "ollama",
        "apiKey": "ollama-local",
        "models": [
          {
            "id": "qwen3.5:27b",
            "name": "Qwen 3.5 27B (Dense, Local Default)",
            "reasoning": true,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 32768,
            "maxTokens": 327680
          },
          {
            "id": "glm-4.7-flash",
            "name": "GLM 4.7 Flash (MoE, Fast)",
            "reasoning": true,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 32768,
            "maxTokens": 327680
          },
          {
            "id": "llama3.1:8b",
            "name": "Llama 3.1 8B",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 8192,
            "maxTokens": 81920
          }
        ]
      }
    }
  },
  "gateway": {
    "mode": "local",
    "bind": "${OPENCLAW_GATEWAY_BIND_VALUE}",
    "auth": {
      "token": "${OPENCLAW_GATEWAY_TOKEN_VALUE}"
    }
  },
  "hooks": {
    "enabled": true,
    "token": "${OPENCLAW_HOOKS_TOKEN_VALUE}",
    "path": "/hooks",
    "defaultSessionKey": "hook:ingress",
    "allowRequestSessionKey": false,
    "allowedSessionKeyPrefixes": ["hook:"]
  }
}
EOF
    echo "✅ Created openclaw_config/openclaw.json with hooks enabled."
elif command -v jq >/dev/null 2>&1; then
    tmp_file="$(mktemp)"
    jq \
      --arg gatewayToken "${OPENCLAW_GATEWAY_TOKEN_VALUE}" \
      --arg hooksToken "${OPENCLAW_HOOKS_TOKEN_VALUE}" \
      --arg bind "${OPENCLAW_GATEWAY_BIND_VALUE}" \
      '
      def dedup_preserve:
        reduce .[] as $item ([]; if index($item) then . else . + [$item] end);

      .agents = (.agents // {}) |
      .agents.defaults = (.agents.defaults // {}) |
      .agents.defaults.model = (
        if (.agents.defaults.model? | type) == "string" then
          { "primary": .agents.defaults.model }
        else
          (.agents.defaults.model // {})
        end
      ) |
      .agents.defaults.model.primary = (.agents.defaults.model.primary // "google-gemini-cli/gemini-3.1-pro-preview") |
      .agents.defaults.model.fallbacks = (
        ([
          "anthropic/claude-opus-4-6",
          "ollama/qwen3.5:27b",
          "ollama/glm-4.7-flash",
          "ollama/llama3.1:8b",
          "google-gemini-cli/gemini-3.1-pro-preview",
          "kilocode/anthropic/claude-opus-4.6"
        ] + (.agents.defaults.model.fallbacks // [])) | dedup_preserve
      ) |
      .agents.defaults.models = ((.agents.defaults.models // {}) + {
        "ollama/qwen3.5:27b": ((.agents.defaults.models["ollama/qwen3.5:27b"] // {}) + { "alias": "Ollama Qwen 3.5 27B (Local Default)" }),
        "ollama/glm-4.7-flash": ((.agents.defaults.models["ollama/glm-4.7-flash"] // {}) + { "alias": "Ollama GLM 4.7 Flash (Local Fast)" }),
        "openai-codex/gpt-5.3-codex": ((.agents.defaults.models["openai-codex/gpt-5.3-codex"] // {}) + { "alias": "Codex GPT-5.3" }),
        "anthropic/claude-opus-4-6": ((.agents.defaults.models["anthropic/claude-opus-4-6"] // {}) + { "alias": "Claude Opus 4.6" }),
        "google-gemini-cli/gemini-3.1-pro-preview": ((.agents.defaults.models["google-gemini-cli/gemini-3.1-pro-preview"] // {}) + { "alias": "Gemini 3.1 Pro Preview (Web Auth)" }),
        "ollama/llama3.1:8b": ((.agents.defaults.models["ollama/llama3.1:8b"] // {}) + { "alias": "Ollama Llama 3.1 8B (Local)" }),
        "kilocode/anthropic/claude-opus-4.6": ((.agents.defaults.models["kilocode/anthropic/claude-opus-4.6"] // {}) + { "alias": "Kilo Claude Opus 4.6" })
      }) |
      .models = (.models // {}) |
      .models.mode = (.models.mode // "merge") |
      .models.providers = (.models.providers // {}) |
      .models.providers.ollama = (.models.providers.ollama // {}) |
      .models.providers.ollama.baseUrl = (.models.providers.ollama.baseUrl // "http://ollama:11434") |
      .models.providers.ollama.api = (.models.providers.ollama.api // "ollama") |
      .models.providers.ollama.apiKey = (.models.providers.ollama.apiKey // "ollama-local") |
      .models.providers.ollama.models = (
        if ((.models.providers.ollama.models // []) | length) > 0 then
          .models.providers.ollama.models
        else
          [
            {
              "id": "qwen3.5:27b",
              "name": "Qwen 3.5 27B (Dense, Local Default)",
              "reasoning": true,
              "input": ["text"],
              "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
              "contextWindow": 32768,
              "maxTokens": 327680
            },
            {
              "id": "glm-4.7-flash",
              "name": "GLM 4.7 Flash (MoE, Fast)",
              "reasoning": true,
              "input": ["text"],
              "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
              "contextWindow": 32768,
              "maxTokens": 327680
            },
            {
              "id": "llama3.1:8b",
              "name": "Llama 3.1 8B",
              "reasoning": false,
              "input": ["text"],
              "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
              "contextWindow": 8192,
              "maxTokens": 81920
            }
          ]
        end
      ) |
      .gateway = ((.gateway // {}) + {
        "mode": "local",
        "bind": $bind,
        "auth": ((.gateway.auth // {}) + {"token": $gatewayToken})
      }) |
      .hooks = ((.hooks // {}) + {
        "enabled": true,
        "token": $hooksToken,
        "path": "/hooks",
        "defaultSessionKey": "hook:ingress",
        "allowRequestSessionKey": false,
        "allowedSessionKeyPrefixes": ["hook:"]
      })
      ' openclaw_config/openclaw.json > "${tmp_file}"
    mv "${tmp_file}" openclaw_config/openclaw.json
    echo "✅ Updated openclaw_config/openclaw.json with gateway, hooks, and model routing defaults."
else
    echo "⚠️ openclaw_config/openclaw.json exists and jq is unavailable; skipping auto-merge."
    echo "   Ensure hooks.enabled=true with hooks.token=OPENCLAW_HOOKS_TOKEN in that file."
fi

if [ -f scripts/sync-openclaw-agent-files.sh ]; then
    bash scripts/sync-openclaw-agent-files.sh
fi

# Warn about local Ollama runtime artifacts that should stay out of git.
if [ -d ollama_data ]; then
    echo "⚠️ Found local './ollama_data' runtime data. This directory is no longer used by compose and should remain untracked."
fi

echo "✨ Initialization complete. Run 'docker compose up -d' to start."
