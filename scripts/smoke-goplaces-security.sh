#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

GATEWAY_CONTAINER="${OPENCLAW_GATEWAY_CONTAINER:-email-master-openclaw-gateway}"
HOST_PROXY="${GOPLACES_HOST_PROXY:-http://127.0.0.1:3128}"
CONTAINER_PROXY="${GOPLACES_CONTAINER_PROXY:-http://host.docker.internal:3128}"
DENY_TARGET="${GOPLACES_DENY_TARGET:-https://example.com}"
ALLOW_TARGET="${GOPLACES_ALLOW_TARGET:-https://places.googleapis.com}"

FAILURES=0

pass() {
  echo "PASS: $1"
}

fail() {
  echo "FAIL: $1"
  FAILURES=$((FAILURES + 1))
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

request_host_headers() {
  local proxy="$1"
  local url="$2"
  set +e
  local output
  output="$(curl -sS -I --proxy "${proxy}" "${url}" -m 12 2>&1)"
  set -e
  printf '%s\n' "${output}"
}

request_container_headers() {
  local proxy="$1"
  local url="$2"
  set +e
  local output
  output="$(docker exec "${GATEWAY_CONTAINER}" sh -c "curl -sS -I --proxy '${proxy}' '${url}' -m 12" 2>&1)"
  set -e
  printf '%s\n' "${output}"
}

is_denied() {
  local headers="$1"
  grep -Eq '403 Forbidden|ERR_ACCESS_DENIED|CONNECT tunnel failed' <<<"${headers}"
}

is_allowed() {
  local headers="$1"
  grep -Eq 'HTTP/1\.1 200 Connection established|HTTP/2 [0-9]{3}|HTTP/1\.1 [0-9]{3}' <<<"${headers}" &&
    ! grep -Eq '403 Forbidden|ERR_ACCESS_DENIED|CONNECT tunnel failed' <<<"${headers}"
}

require_cmd curl
require_cmd docker

echo "Running goplaces security smoke test..."

if docker inspect "${GATEWAY_CONTAINER}" >/dev/null 2>&1; then
  pass "Container exists: ${GATEWAY_CONTAINER}"
else
  echo "Container not found: ${GATEWAY_CONTAINER}" >&2
  exit 1
fi

echo "1) Host egress policy"
host_deny_headers="$(request_host_headers "${HOST_PROXY}" "${DENY_TARGET}")"
if is_denied "${host_deny_headers}"; then
  pass "Host proxy blocks non-allowlisted destination (${DENY_TARGET})"
else
  fail "Host proxy did not block ${DENY_TARGET}"
fi

host_allow_headers="$(request_host_headers "${HOST_PROXY}" "${ALLOW_TARGET}")"
if is_allowed "${host_allow_headers}"; then
  pass "Host proxy allows allowlisted destination (${ALLOW_TARGET})"
else
  fail "Host proxy did not allow ${ALLOW_TARGET}"
fi

echo "2) Container egress policy"
container_deny_headers="$(request_container_headers "${CONTAINER_PROXY}" "${DENY_TARGET}")"
if is_denied "${container_deny_headers}"; then
  pass "Container proxy path blocks non-allowlisted destination (${DENY_TARGET})"
else
  fail "Container proxy path did not block ${DENY_TARGET}"
fi

container_allow_headers="$(request_container_headers "${CONTAINER_PROXY}" "${ALLOW_TARGET}")"
if is_allowed "${container_allow_headers}"; then
  pass "Container proxy path allows allowlisted destination (${ALLOW_TARGET})"
else
  fail "Container proxy path did not allow ${ALLOW_TARGET}"
fi

echo "3) Wrapper hardening"
set +e
base_url_override_output="$(
  docker exec "${GATEWAY_CONTAINER}" sh -c \
    "goplaces search --base-url https://example.com --query test" 2>&1
)"
base_url_override_exit=$?
set -e

if [[ ${base_url_override_exit} -ne 0 ]] &&
  grep -q "base URL override flags are blocked" <<<"${base_url_override_output}"; then
  pass "goplaces wrapper blocks --base-url override"
else
  fail "goplaces wrapper did not block --base-url override"
fi

wrapper_path="$(docker exec "${GATEWAY_CONTAINER}" sh -c 'which goplaces' 2>/dev/null || true)"
if [[ "${wrapper_path}" == "/home/node/.openclaw/workspace/tools/bin/goplaces" ]]; then
  pass "Container uses pinned goplaces wrapper"
else
  fail "Container goplaces path unexpected: ${wrapper_path:-<empty>}"
fi

if [[ "${FAILURES}" -gt 0 ]]; then
  echo
  echo "goplaces security smoke test completed with ${FAILURES} failure(s)."
  exit 1
fi

echo
echo "goplaces security smoke test passed with no failures."
