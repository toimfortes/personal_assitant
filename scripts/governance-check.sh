#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

echo "🔎 Running governance contract checks..."
python3 scripts/validate-contracts.py
echo "✅ Governance contract checks passed."
