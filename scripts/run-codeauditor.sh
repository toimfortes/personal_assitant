#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODE_AUDITOR_VENV="/home/antoniofortes/Projects/code_auditor/.venv/bin"
CODEAUDITOR_BIN="${CODE_AUDITOR_VENV}/codeauditor"

if [[ -n "${CODEAUDITOR_BIN_OVERRIDE:-}" ]]; then
  CODEAUDITOR_BIN="${CODEAUDITOR_BIN_OVERRIDE}"
fi

if [[ -x "${CODEAUDITOR_BIN}" ]]; then
  export PATH="${CODE_AUDITOR_VENV}:${PATH}"
elif command -v codeauditor >/dev/null 2>&1; then
  CODEAUDITOR_BIN="$(command -v codeauditor)"
else
  echo "ERROR: codeauditor not found." >&2
  echo "Checked:" >&2
  echo "  - ${CODEAUDITOR_BIN}" >&2
  echo "  - \$PATH (codeauditor)" >&2
  echo "Install code-auditor or set CODEAUDITOR_BIN_OVERRIDE." >&2
  exit 1
fi

# Ensure toolchain checks can find pytest/mypy/ruff/bandit/vulture/radon.
BIN_DIR="$(cd "$(dirname "${CODEAUDITOR_BIN}")" && pwd)"
export PATH="${BIN_DIR}:${PATH}"

cd "${ROOT_DIR}"
"${CODEAUDITOR_BIN}" audit --full --project . "$@"
