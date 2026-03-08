#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

mkdir -p \
  memory/self_improving/hot \
  memory/self_improving/warm/domains \
  memory/self_improving/warm/projects \
  memory/self_improving/cold/archive \
  memory/self_improving/reports \
  memory/raw

touch memory/self_improving/hot/.gitkeep
touch memory/self_improving/warm/domains/.gitkeep
touch memory/self_improving/warm/projects/.gitkeep
touch memory/self_improving/cold/archive/.gitkeep
touch memory/self_improving/reports/.gitkeep
touch memory/raw/.gitkeep

echo "Self-improving memory directories are ready under memory/self_improving/"
