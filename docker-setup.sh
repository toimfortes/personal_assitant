#!/bin/bash
set -euo pipefail

echo "🚀 Initializing Email Master Secure Environment..."

# Create persistent directories
mkdir -p openclaw_config openclaw_workspace n8n-workflows

# Backward compatibility for older setup directory naming.
if [ -d n8n_workflows ]; then
    echo "ℹ️ Legacy directory 'n8n_workflows/' detected. Use 'n8n-workflows/' going forward."
fi

# Set permissions for non-root Docker users (node, uid 1000 in most images).
if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo chown -R 1000:1000 openclaw_config openclaw_workspace
else
    echo "⚠️ Skipping ownership change (sudo not available without prompt)."
fi

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✅ Created .env from template. Please add your API keys."
else
    echo "ℹ️ .env already exists. Skipping..."
fi

# Warn about local Ollama runtime artifacts that should stay out of git.
if [ -d ollama_data ]; then
    echo "⚠️ Found local './ollama_data' runtime data. This directory is no longer used by compose and should remain untracked."
fi

echo "✨ Initialization complete. Run 'docker compose up -d' to start."
