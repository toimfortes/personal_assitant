# Structured Memory and Contracts

This repo uses a strict governance layer so the assistant does not drift into ad hoc behavior.

## 1) Matter Memory (single source of truth)

- Index file: `memory/matter-index.json`
- Matter files: `memory/matters/MTR-YYYY-NNN-*.json`
- Template for new matters: `memory/templates/matter.template.json`

Rules:
- Every major initiative must have one matter file.
- Every matter must be listed in `memory/matter-index.json`.
- Matter status/priority/owner in the index must match the matter file.
- Matter files must stay summarized. Do not store raw logs here.

## 2) Function Registry (all behavior is declared)

- Registry file: `contracts/function-registry.json`

Rules:
- Any new automation function must be registered before activation.
- Each function must include risk level and approval requirement.
- Each function must reference an implemented artifact path.
- High-risk functions must be approval-gated in runtime configuration.

## 3) JSON Schema Contracts

Schemas are in `contracts/schemas/`:
- `matter.schema.json`
- `matter-index.schema.json`
- `function-registry.schema.json`
- `openclaw-hook-agent.schema.json`
- `openclaw-mcp-config.schema.json`
- `n8n-workflow.schema.json`

Additional hygiene enforced by `scripts/validate-contracts.py`:
- MCP env values for secret-like keys (`*TOKEN*`, `*KEY*`, `*SECRET*`, `*PASSWORD*`, `DATABASE_URL`) must reference env vars (start with `$`).
- `MEMORY_FILE_PATH` in MCP config must stay under `/home/node/.openclaw/workspace/`.

## 4) Validation Gate

Run:

```bash
./scripts/governance-check.sh
```

This validates:
- Matter index + matter file schema compliance.
- Function registry schema compliance.
- Function references to real files.
- OpenClaw hook sample payload schema compliance.
- MCP config schema compliance.
- n8n workflow schema + graph integrity (connections point to existing nodes).

## 5) Required Workflow for Changes

1. Update matter memory for the initiative.
2. Update function registry for new/changed automation behavior.
3. Run governance check.
4. Run smoke test.
5. Commit.

Runtime assistant files are synced from templates with:

```bash
./scripts/sync-openclaw-agent-files.sh --force
```

Suggested command sequence:

```bash
./scripts/governance-check.sh
./scripts/smoke-test.sh
```
