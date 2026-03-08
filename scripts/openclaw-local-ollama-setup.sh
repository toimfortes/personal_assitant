#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

MODEL="${1:-llama3.1:8b}"

echo "🧠 OpenClaw local model setup (Ollama)"
echo "Target model: ${MODEL}"

docker compose up -d ollama openclaw-gateway

echo "Pulling model in Ollama container..."
docker exec email-master-ollama ollama pull "${MODEL}"

echo "Verifying model in Ollama..."
docker exec email-master-ollama ollama list

echo "Checking OpenClaw model visibility..."
docker compose --profile tools run --rm openclaw-cli models list --provider ollama || true
docker compose --profile tools run --rm openclaw-cli models status

echo "✨ Local Ollama setup complete."
