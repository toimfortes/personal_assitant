#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${ROOT_DIR}/openclaw-configs"
TARGET_DIR="${ROOT_DIR}/openclaw_config/agents/main/agent"

FORCE=0
if [ "${1:-}" = "--force" ]; then
  FORCE=1
fi

FILES=(
  "AGENTS.md"
  "SOUL.md"
  "USER.md"
  "HEARTBEAT.md"
)

mkdir -p "${TARGET_DIR}"

for file in "${FILES[@]}"; do
  src="${SOURCE_DIR}/${file}"
  dst="${TARGET_DIR}/${file}"

  if [ ! -f "${src}" ]; then
    echo "⚠️ Missing source template: ${src}"
    continue
  fi

  if [ "${FORCE}" -eq 1 ] || [ ! -f "${dst}" ]; then
    cp "${src}" "${dst}"
    echo "✅ Synced ${file}"
  else
    echo "ℹ️ Kept existing ${file} (use --force to overwrite)"
  fi
done
