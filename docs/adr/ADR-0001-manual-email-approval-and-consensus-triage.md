# ADR-0001: Manual Email Approval and Consensus Triage

- Status: Accepted
- Date: 2026-03-04
- Owners: Email Master maintainers

## Context

Email triage is high-risk when an agent can both read untrusted inbound content and send outbound messages. Prompt injection in inbound email can lead to unauthorized actions if auto-send is enabled.

We also need high precision in triage while controlling cost:
- Local models can be fast and private but may be less reliable on ambiguous cases.
- Frontier models are stronger but expensive if used for every message.

## Decision

1. Outbound email is **manual approval only**.
- No background workflow may auto-send replies.
- Any send-capable workflow must be explicitly marked for manual approval and use a manual interaction entrypoint.

2. Enforce policy in automation guardrails.
- `scripts/n8n-no-auto-send-guard.sh` is the policy gate.
- Send-capable workflows are allowed only when:
  - Workflow name matches `\[MANUAL-APPROVAL\]`
  - Workflow contains `manualTrigger` or `formTrigger`
  - Workflow contains no automatic trigger nodes (cron, schedule, Gmail/Outlook trigger, webhook)
  - OR workflow name matches `\[APPROVAL-GATED\]` and explicitly checks for Notion `Approved to Send` state before sending

3. Provide explicit manual-send path.
- Workflow template: `n8n-workflows/manual-gmail-reply-manual-approval.json`
- This path is human-initiated only and intended for explicit operator action.

4. Provide explicit Notion status-gated send path.
- Workflow template: `n8n-workflows/notion-approved-gmail-send-approval-gated.json`
- This path is timer-polled but only sends when Notion item status is explicitly set to `Approved to Send` and contains a human-reviewed draft.

5. Triage model routing uses staged confidence.
- Primary pass: local model (`ollama`, target strong local model when available).
- Disagreement/low-confidence path: escalate to `gemini-3.1-pro-preview`.
- Never couple triage confidence directly to auto-send.

## Rationale

- Reduces blast radius from prompt injection and model misclassification.
- Preserves operator control for irreversible actions.
- Balances cost and quality with a deterministic escalation path.

## Consequences

Positive:
- Stronger safety posture for email automation.
- Better auditability: manual send actions are explicit and reviewable.
- Cost control via local-first triage.

Tradeoffs:
- More operator steps before sending.
- Slightly longer resolution time for urgent responses.

## Implementation Notes

- Run policy audit regularly:

```bash
N8N_EMAIL=... N8N_PASSWORD=... ./scripts/n8n-no-auto-send-guard.sh audit
```

- Enforce by deactivating non-compliant workflows:

```bash
N8N_EMAIL=... N8N_PASSWORD=... ./scripts/n8n-no-auto-send-guard.sh enforce
```

- Keep function contracts updated for any new send-capable workflow and mark `approval_required: true`.
