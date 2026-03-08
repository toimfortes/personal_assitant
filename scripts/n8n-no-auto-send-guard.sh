#!/bin/bash
set -euo pipefail

MODE="${1:-audit}" # audit | enforce
N8N_BASE_URL="${N8N_BASE_URL:-http://127.0.0.1:5678}"
N8N_EMAIL="${N8N_EMAIL:-}"
N8N_PASSWORD="${N8N_PASSWORD:-}"
ALLOW_SEND_WORKFLOW_PATTERN="${ALLOW_SEND_WORKFLOW_PATTERN:-\\[MANUAL-APPROVAL\\]}"
ALLOW_APPROVAL_GATED_SEND_WORKFLOW_PATTERN="${ALLOW_APPROVAL_GATED_SEND_WORKFLOW_PATTERN:-\\[APPROVAL-GATED\\]}"

if [[ "${MODE}" != "audit" && "${MODE}" != "enforce" ]]; then
  echo "Usage: $0 [audit|enforce]" >&2
  exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required." >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required." >&2
  exit 2
fi

if [[ -z "${N8N_EMAIL}" || -z "${N8N_PASSWORD}" ]]; then
  echo "ERROR: N8N_EMAIL and N8N_PASSWORD must be set." >&2
  exit 2
fi

COOKIE_FILE="$(mktemp)"
trap 'rm -f "${COOKIE_FILE}" /tmp/n8n-login.json /tmp/n8n-wf-list.json /tmp/n8n-wf-one.json /tmp/n8n-deactivate.json' EXIT

curl -sS -c "${COOKIE_FILE}" \
  -H 'Content-Type: application/json' \
  -X POST "${N8N_BASE_URL}/rest/login" \
  -d "{\"emailOrLdapLoginId\":\"${N8N_EMAIL}\",\"password\":\"${N8N_PASSWORD}\"}" \
  > /tmp/n8n-login.json

if ! jq -e '.data.id' /tmp/n8n-login.json >/dev/null 2>&1; then
  echo "ERROR: n8n login failed." >&2
  exit 2
fi

curl -sS -b "${COOKIE_FILE}" \
  "${N8N_BASE_URL}/rest/workflows?page=1&perPage=500" \
  > /tmp/n8n-wf-list.json

mapfile -t WORKFLOW_IDS < <(jq -r '.data[]?.id' /tmp/n8n-wf-list.json)

offender_count=0
deactivated_count=0

for wf_id in "${WORKFLOW_IDS[@]}"; do
  curl -sS -b "${COOKIE_FILE}" \
    "${N8N_BASE_URL}/rest/workflows/${wf_id}" \
    > /tmp/n8n-wf-one.json

  wf_name="$(jq -r '.data.name' /tmp/n8n-wf-one.json)"
  wf_active="$(jq -r '.data.active' /tmp/n8n-wf-one.json)"
  wf_version_id="$(jq -r '.data.versionId' /tmp/n8n-wf-one.json)"

  offenders="$(jq -r '
    .data.nodes[]
    | select(
        (.type == "n8n-nodes-base.emailSend")
        or (.type == "n8n-nodes-base.smtp")
        or (
          (.type | ascii_downcase | test("gmail"))
          and ((.parameters.operation // .parameters.action // "") | ascii_downcase | test("send"))
        )
        or (
          (.type | ascii_downcase | test("outlook"))
          and ((.parameters.operation // .parameters.action // "") | ascii_downcase | test("send"))
        )
      )
    | "\(.name) [\(.type)] operation=\(.parameters.operation // .parameters.action // "n/a")"
  ' /tmp/n8n-wf-one.json || true)"

  if [[ -n "${offenders}" ]]; then
    manual_trigger_count="$(jq -r '
      [.data.nodes[]
       | select(
           .type == "n8n-nodes-base.manualTrigger"
           or .type == "n8n-nodes-base.formTrigger"
         )
      ] | length
    ' /tmp/n8n-wf-one.json)"
    auto_trigger_count="$(jq -r '
      [.data.nodes[]
       | select(
           .type == "n8n-nodes-base.cron"
           or .type == "n8n-nodes-base.scheduleTrigger"
           or .type == "n8n-nodes-base.gmailTrigger"
           or .type == "n8n-nodes-base.microsoftOutlookTrigger"
           or .type == "n8n-nodes-base.webhook"
         )
      ] | length
    ' /tmp/n8n-wf-one.json)"
    blocked_auto_trigger_count="$(jq -r '
      [.data.nodes[]
       | select(
           .type == "n8n-nodes-base.gmailTrigger"
           or .type == "n8n-nodes-base.microsoftOutlookTrigger"
           or .type == "n8n-nodes-base.webhook"
         )
      ] | length
    ' /tmp/n8n-wf-one.json)"
    timed_trigger_count="$(jq -r '
      [.data.nodes[]
       | select(
           .type == "n8n-nodes-base.cron"
           or .type == "n8n-nodes-base.scheduleTrigger"
         )
      ] | length
    ' /tmp/n8n-wf-one.json)"
    has_approval_string="$(jq -r '
      ([.data.nodes[] | tostring] | join("\n"))
      | test("Approved to Send")
    ' /tmp/n8n-wf-one.json)"
    has_notion_processing="$(jq -r '
      ([.data.nodes[] | tostring] | join("\n"))
      | test("n8n-nodes-base\\.notion|api\\.notion\\.com")
    ' /tmp/n8n-wf-one.json)"

    allowed_manual_send=false
    if [[ "${wf_name}" =~ ${ALLOW_SEND_WORKFLOW_PATTERN} ]] && [[ "${manual_trigger_count}" -gt 0 ]] && [[ "${auto_trigger_count}" -eq 0 ]]; then
      allowed_manual_send=true
    fi
    allowed_approval_gated_send=false
    if [[ "${wf_name}" =~ ${ALLOW_APPROVAL_GATED_SEND_WORKFLOW_PATTERN} ]] \
      && [[ "${timed_trigger_count}" -gt 0 ]] \
      && [[ "${blocked_auto_trigger_count}" -eq 0 ]] \
      && [[ "${has_approval_string}" == "true" ]] \
      && [[ "${has_notion_processing}" == "true" ]]; then
      allowed_approval_gated_send=true
    fi

    if [[ "${allowed_manual_send}" == "true" ]]; then
      echo "✅ Manual-approval send workflow allowed: ${wf_name} (${wf_id})"
      continue
    fi
    if [[ "${allowed_approval_gated_send}" == "true" ]]; then
      echo "✅ Approval-gated send workflow allowed: ${wf_name} (${wf_id})"
      continue
    fi

    offender_count=$((offender_count + 1))
    echo "❌ Send-capable nodes found in workflow: ${wf_name} (${wf_id})"
    echo "${offenders}" | sed 's/^/   - /'
    if [[ "${wf_name}" =~ ${ALLOW_SEND_WORKFLOW_PATTERN} ]]; then
      if [[ "${manual_trigger_count}" -eq 0 ]]; then
        echo "   - policy: missing manual/form trigger."
      fi
      if [[ "${auto_trigger_count}" -gt 0 ]]; then
        echo "   - policy: contains automatic trigger nodes."
      fi
    elif [[ "${wf_name}" =~ ${ALLOW_APPROVAL_GATED_SEND_WORKFLOW_PATTERN} ]]; then
      if [[ "${timed_trigger_count}" -eq 0 ]]; then
        echo "   - policy: missing schedule trigger."
      fi
      if [[ "${blocked_auto_trigger_count}" -gt 0 ]]; then
        echo "   - policy: approval-gated flows cannot use inbox/webhook triggers."
      fi
      if [[ "${has_approval_string}" != "true" ]]; then
        echo "   - policy: missing explicit 'Approved to Send' condition."
      fi
      if [[ "${has_notion_processing}" != "true" ]]; then
        echo "   - policy: missing Notion query/update processing."
      fi
    else
      echo "   - policy: workflow name must match ${ALLOW_SEND_WORKFLOW_PATTERN} or ${ALLOW_APPROVAL_GATED_SEND_WORKFLOW_PATTERN}."
    fi

    if [[ "${MODE}" == "enforce" && "${wf_active}" == "true" && "${wf_version_id}" != "null" ]]; then
      curl -sS -b "${COOKIE_FILE}" \
        -H 'Content-Type: application/json' \
        -X POST "${N8N_BASE_URL}/rest/workflows/${wf_id}/deactivate" \
        -d "{\"versionId\":\"${wf_version_id}\"}" \
        > /tmp/n8n-deactivate.json
      deactivated_count=$((deactivated_count + 1))
      echo "   -> Deactivated workflow."
    fi
  fi
done

if [[ "${offender_count}" -eq 0 ]]; then
  echo "✅ No auto-send nodes found across workflows."
  exit 0
fi

echo "Found ${offender_count} workflow(s) with send-capable nodes."
if [[ "${MODE}" == "enforce" ]]; then
  echo "Deactivated ${deactivated_count} active workflow(s)."
fi
exit 1
