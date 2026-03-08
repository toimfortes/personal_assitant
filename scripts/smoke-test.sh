#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

EXPECTED_DEFAULT="ollama/qwen2.5:32b-instruct-q4_K_M"
EXPECTED_FIRST_FALLBACK="ollama/llama3.1:8b"
REQUIRED_MODELS=(
  "qwen2.5:32b-instruct-q4_K_M"
  "llama3.1:8b"
)

FAILURES=0

pass() {
  echo "✅ $1"
}

fail() {
  echo "❌ $1"
  FAILURES=$((FAILURES + 1))
}

if docker info >/dev/null 2>&1; then
  DOCKER_MODE="direct"
elif command -v sg >/dev/null 2>&1 && sg docker -c "docker info >/dev/null 2>&1"; then
  DOCKER_MODE="sg"
else
  echo "❌ Docker is not reachable (neither direct access nor 'sg docker')."
  exit 1
fi

run_docker() {
  if [ "${DOCKER_MODE}" = "direct" ]; then
    docker "$@"
  else
    local quoted=()
    local arg
    for arg in "$@"; do
      quoted+=("$(printf '%q' "${arg}")")
    done
    sg docker -c "docker ${quoted[*]}"
  fi
}

echo "🧪 Running smoke test..."

echo "0) Governance contracts"
if ./scripts/governance-check.sh; then
  pass "Governance contracts passed."
else
  fail "Governance contracts failed."
fi

echo "1) Stack verification"
if [ "${DOCKER_MODE}" = "direct" ]; then
  if ./verify-stack.sh; then
    pass "verify-stack passed."
  else
    fail "verify-stack failed."
  fi
else
  if sg docker -c "$(printf '%q' "${ROOT_DIR}/verify-stack.sh")"; then
    pass "verify-stack passed (via sg docker)."
  else
    fail "verify-stack failed (via sg docker)."
  fi
fi

echo "2) Security baseline checks"
if mounts_json="$(run_docker inspect -f '{{json .Mounts}}' email-master-openclaw-gateway 2>/dev/null)"; then
  if printf '%s\n' "${mounts_json}" | grep -Fq '/var/run/docker.sock'; then
    fail "Gateway container should not mount /var/run/docker.sock by default."
  else
    pass "Gateway container is not mounting /var/run/docker.sock."
  fi
else
  fail "Could not inspect gateway mounts."
fi

if ports_json="$(run_docker inspect -f '{{json .NetworkSettings.Ports}}' email-master-openclaw-gateway 2>/dev/null)"; then
  if printf '%s\n' "${ports_json}" | grep -Fq '"HostIp":"0.0.0.0"'; then
    fail "Gateway port publish detected on 0.0.0.0; expected localhost-only bind."
  else
    pass "Gateway ports are localhost-only."
  fi
else
  fail "Could not inspect gateway port bindings."
fi

echo "3) OpenClaw model routing"
if model_status="$(run_docker compose --profile tools run --rm openclaw-cli models status 2>&1)"; then
  if printf '%s\n' "${model_status}" | grep -Fq "Default       : ${EXPECTED_DEFAULT}"; then
    pass "Default model is ${EXPECTED_DEFAULT}."
  else
    fail "Default model is not ${EXPECTED_DEFAULT}."
  fi

  fallback_line="$(printf '%s\n' "${model_status}" | grep -F "Fallbacks (" | tail -n 1 || true)"
  if [[ "${fallback_line}" =~ Fallbacks\ \([0-9]+\)\ :\ ${EXPECTED_FIRST_FALLBACK} ]]; then
    pass "First fallback is ${EXPECTED_FIRST_FALLBACK}."
  else
    fail "First fallback is not ${EXPECTED_FIRST_FALLBACK}."
  fi
else
  fail "Failed to query OpenClaw model status."
fi

echo "4) Ollama model inventory"
if ollama_list="$(run_docker exec email-master-ollama ollama list 2>&1)"; then
  model_names="$(printf '%s\n' "${ollama_list}" | awk 'NR > 1 && $1 != "" {print $1}')"
  for model in "${REQUIRED_MODELS[@]}"; do
    if printf '%s\n' "${model_names}" | grep -Fxq "${model}"; then
      pass "Model present: ${model}"
    else
      fail "Model missing: ${model}"
    fi
  done
else
  fail "Could not query ollama model list."
fi

echo "5) Live generation checks"
if ! command -v curl >/dev/null 2>&1; then
  fail "curl is required for live generation checks."
else
  run_gen_check() {
    local model="$1"
    local expected="$2"
    local timeout="$3"
    local response

    response="$(
      curl -sS --max-time "${timeout}" \
        -H 'Content-Type: application/json' \
        http://127.0.0.1:11434/api/generate \
        -d "{\"model\":\"${model}\",\"prompt\":\"Reply with exactly ${expected}\",\"stream\":false}" \
        || true
    )"

    if [ -z "${response}" ]; then
      fail "${model} produced no response."
      return
    fi

    if printf '%s\n' "${response}" | grep -Fq '"error"'; then
      fail "${model} returned an error: ${response}"
      return
    fi

    if printf '%s\n' "${response}" | grep -Fq "${expected}"; then
      pass "${model} generation check passed (${expected})."
    else
      fail "${model} response did not contain ${expected}."
    fi
  }

  run_gen_check "llama3.1:8b" "LOCAL_OK" 90
  run_gen_check "qwen2.5:32b-instruct-q4_K_M" "QWEN_OK" 240
fi

if [ "${FAILURES}" -gt 0 ]; then
  echo
  echo "Smoke test completed with ${FAILURES} failure(s)."
  exit 1
fi

echo
echo "Smoke test passed with no failures."
