#!/bin/bash
set -euo pipefail

N8N_BASE_URL="${N8N_BASE_URL:-http://127.0.0.1:5678}"
N8N_EMAIL="${N8N_EMAIL:-}"
N8N_PASSWORD="${N8N_PASSWORD:-}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}"

WORKFLOW_NAME="${WORKFLOW_NAME:-Gmail to Notion (Investor Triage)}"
NOTION_CRED_ID="${NOTION_CRED_ID:-notionApiMain}"
NOTION_CRED_NAME="${NOTION_CRED_NAME:-Notion account}"

CRED_NAME="${1:-Gmail account 1}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_var() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    fail "Missing required env var: ${name}"
  fi
}

require_var "N8N_EMAIL" "${N8N_EMAIL}"
require_var "N8N_PASSWORD" "${N8N_PASSWORD}"
require_var "GOOGLE_CLIENT_ID" "${GOOGLE_CLIENT_ID}"
require_var "GOOGLE_CLIENT_SECRET" "${GOOGLE_CLIENT_SECRET}"

if ! command -v curl >/dev/null 2>&1; then
  fail "curl is required."
fi
if ! command -v jq >/dev/null 2>&1; then
  fail "jq is required."
fi

COOKIE_FILE="$(mktemp)"
trap 'rm -f "${COOKIE_FILE}" /tmp/n8n-login.json /tmp/n8n-workflows.json /tmp/n8n-creds.json /tmp/n8n-workflow-get.json /tmp/n8n-workflow-patch.json /tmp/n8n-workflow-update.json /tmp/n8n-cred-create.json /tmp/n8n-cred-update.json /tmp/n8n-oauth-url.json' EXIT

echo "Logging into n8n at ${N8N_BASE_URL}..."
curl -sS -c "${COOKIE_FILE}" \
  -H 'Content-Type: application/json' \
  -X POST "${N8N_BASE_URL}/rest/login" \
  -d "{\"emailOrLdapLoginId\":\"${N8N_EMAIL}\",\"password\":\"${N8N_PASSWORD}\"}" \
  > /tmp/n8n-login.json

if ! jq -e '.data.id' /tmp/n8n-login.json >/dev/null 2>&1; then
  fail "n8n login failed. Check N8N_EMAIL/N8N_PASSWORD."
fi

curl -sS -b "${COOKIE_FILE}" \
  "${N8N_BASE_URL}/rest/workflows?page=1&perPage=200" \
  > /tmp/n8n-workflows.json

WORKFLOW_ID="$(jq -r --arg n "${WORKFLOW_NAME}" '.data[] | select(.name == $n) | .id' /tmp/n8n-workflows.json | head -n1)"
if [ -z "${WORKFLOW_ID}" ]; then
  fail "Workflow not found: ${WORKFLOW_NAME}"
fi

curl -sS -b "${COOKIE_FILE}" \
  "${N8N_BASE_URL}/rest/credentials?page=1&perPage=200" \
  > /tmp/n8n-creds.json

CRED_ID="$(jq -r --arg n "${CRED_NAME}" '.data[] | select(.name == $n and .type == "gmailOAuth2") | .id' /tmp/n8n-creds.json | head -n1)"

if [ -z "${CRED_ID}" ]; then
  echo "Creating credential: ${CRED_NAME}"
  curl -sS -b "${COOKIE_FILE}" \
    -H 'Content-Type: application/json' \
    -X POST "${N8N_BASE_URL}/rest/credentials" \
    -d "{\"name\":\"${CRED_NAME}\",\"type\":\"gmailOAuth2\",\"data\":{}}" \
    > /tmp/n8n-cred-create.json
  CRED_ID="$(jq -r '.data.id' /tmp/n8n-cred-create.json)"
fi

if [ -z "${CRED_ID}" ] || [ "${CRED_ID}" = "null" ]; then
  fail "Could not create/find Gmail credential."
fi

echo "Updating Gmail OAuth client config on credential ${CRED_ID}..."
curl -sS -b "${COOKIE_FILE}" \
  -H 'Content-Type: application/json' \
  -X PATCH "${N8N_BASE_URL}/rest/credentials/${CRED_ID}" \
  -d "{\"name\":\"${CRED_NAME}\",\"type\":\"gmailOAuth2\",\"data\":{\"clientId\":\"${GOOGLE_CLIENT_ID}\",\"clientSecret\":\"${GOOGLE_CLIENT_SECRET}\"}}" \
  > /tmp/n8n-cred-update.json

curl -sS -b "${COOKIE_FILE}" \
  "${N8N_BASE_URL}/rest/workflows/${WORKFLOW_ID}" \
  > /tmp/n8n-workflow-get.json

jq --arg gcid "${CRED_ID}" --arg gcname "${CRED_NAME}" --arg ncid "${NOTION_CRED_ID}" --arg ncname "${NOTION_CRED_NAME}" '
  .data
  | .nodes = (
      .nodes
      | map(
          if .name == "Gmail Trigger" then
            .parameters = ((.parameters // {}) + {"authentication":"oAuth2"})
            | .credentials = ((.credentials // {}) + {"gmailOAuth2":{"id":$gcid,"name":$gcname}})
          elif .name == "Add to Notion" then
            .credentials = ((.credentials // {}) + {"notionApi":{"id":$ncid,"name":$ncname}})
          else
            .
          end
        )
    )
  | {name,nodes,connections,settings,staticData,pinData,meta,versionId}
' /tmp/n8n-workflow-get.json > /tmp/n8n-workflow-patch.json

echo "Binding Gmail + Notion credentials in workflow ${WORKFLOW_ID}..."
curl -sS -b "${COOKIE_FILE}" \
  -H 'Content-Type: application/json' \
  -X PATCH "${N8N_BASE_URL}/rest/workflows/${WORKFLOW_ID}" \
  --data-binary @/tmp/n8n-workflow-patch.json \
  > /tmp/n8n-workflow-update.json

curl -sS -b "${COOKIE_FILE}" \
  "${N8N_BASE_URL}/rest/oauth2-credential/auth?id=${CRED_ID}" \
  > /tmp/n8n-oauth-url.json

OAUTH_URL="$(jq -r '.data' /tmp/n8n-oauth-url.json)"
if [ -z "${OAUTH_URL}" ] || [ "${OAUTH_URL}" = "null" ]; then
  fail "Could not generate Gmail OAuth URL."
fi

echo
echo "✅ Gmail credential is configured and linked."
echo "Credential ID: ${CRED_ID}"
echo "Workflow ID:   ${WORKFLOW_ID}"
echo
echo "Open this URL in your browser to complete Gmail OAuth:"
echo "${OAUTH_URL}"
echo
echo "After OAuth succeeds, activate workflow:"
echo "  ${N8N_BASE_URL}/workflow/${WORKFLOW_ID}"
