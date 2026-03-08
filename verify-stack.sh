#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

echo "🔍 Verifying Email Master Stack..."

if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
fi

OPENCLAW_GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
OPENCLAW_HOOKS_TOKEN="${OPENCLAW_HOOKS_TOKEN:-}"
FAILURES=0

mark_failure() {
    local msg="$1"
    echo "❌ ${msg}"
    FAILURES=$((FAILURES + 1))
}

# 1. Check if Docker is running
if docker info > /dev/null 2>&1; then
    DOCKER_MODE="direct"
elif command -v sg >/dev/null 2>&1 && sg docker -c "docker info >/dev/null 2>&1"; then
    DOCKER_MODE="sg"
else
    echo "❌ Error: Docker is not reachable (neither direct access nor 'sg docker')."
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

# 2. Check if containers are up
containers=("email-master-n8n" "email-master-openclaw-gateway" "email-master-ollama")
N8N_RUNNING=false
GATEWAY_RUNNING=false
for container in "${containers[@]}"; do
    if [ "$(run_docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" == "true" ]; then
        echo "✅ $container is running."
        if [ "$container" = "email-master-n8n" ]; then
            N8N_RUNNING=true
        fi
        if [ "$container" = "email-master-openclaw-gateway" ]; then
            GATEWAY_RUNNING=true
        fi
    else
        mark_failure "$container is NOT running."
    fi
done

# 3. Test internal service DNS + HTTP reachability.
echo "📡 Testing n8n -> OpenClaw gateway connectivity..."
if [ "${N8N_RUNNING}" = true ]; then
    n8n_probe_ok=false
    for _ in {1..10}; do
        if run_docker exec email-master-n8n /bin/sh -lc "if command -v curl >/dev/null 2>&1; then curl -fsS -o /dev/null http://openclaw-gateway:18789/; elif command -v wget >/dev/null 2>&1; then wget -q --spider http://openclaw-gateway:18789/; else exit 2; fi"; then
            n8n_probe_ok=true
            break
        fi
        sleep 2
    done

    if [ "${n8n_probe_ok}" = true ]; then
        echo "✅ n8n can reach OpenClaw gateway at openclaw-gateway:18789."
    else
        mark_failure "n8n cannot reach OpenClaw gateway at openclaw-gateway:18789."
    fi
else
    mark_failure "n8n is not running; skipping gateway connectivity check."
fi

# 4. Verify hook ingress auth works.
echo "🪝 Testing authenticated OpenClaw hook ingress..."
if [ "${GATEWAY_RUNNING}" != true ]; then
    echo "⚠️ OpenClaw gateway is down; skipping hook auth test."
elif [ -z "${OPENCLAW_HOOKS_TOKEN}" ]; then
    echo "⚠️ OPENCLAW_HOOKS_TOKEN is not set in .env; skipping hook auth test."
else
    HOOK_STATUS="000"
    for _ in {1..10}; do
        HOOK_STATUS="$(curl -s -o /dev/null -w '%{http_code}' \
          -X POST "http://127.0.0.1:${OPENCLAW_GATEWAY_PORT}/hooks/wake" \
          -H "Authorization: Bearer ${OPENCLAW_HOOKS_TOKEN}" \
          -H "Content-Type: application/json" \
          -d '{"text":"verify-stack hook probe","mode":"next-heartbeat"}' || true)"
        if [ "${HOOK_STATUS}" = "200" ]; then
            break
        fi
        sleep 2
    done
    if [ "${HOOK_STATUS}" = "200" ]; then
        echo "✅ Hook ingress accepted authenticated request."
    else
        mark_failure "Hook ingress failed (HTTP ${HOOK_STATUS})."
    fi
fi

# 5. Check OpenClaw runtime directory
echo "🛡 Checking OpenClaw runtime directory..."
if [ "${GATEWAY_RUNNING}" != true ]; then
    echo "⚠️ OpenClaw gateway is down; skipping runtime directory check."
else
    AGENT_HOME="$(run_docker exec email-master-openclaw-gateway pwd)"
    if [[ "${AGENT_HOME}" == "/home/node" || "${AGENT_HOME}" == "/app" ]]; then
        echo "✅ OpenClaw gateway working directory is ${AGENT_HOME}."
    else
        echo "⚠️ OpenClaw gateway working directory is ${AGENT_HOME}."
    fi
fi

if [ "${FAILURES}" -gt 0 ]; then
    echo "❌ Verification failed with ${FAILURES} issue(s)."
    exit 1
fi

echo "✨ Verification complete."
