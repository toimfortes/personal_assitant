# Project Instructions for AI Coding Agents

## Bash Output Safety (CRITICAL - Prevents OOM Crashes)
Running long-running or verbose scripts directly causes V8 "invalid array length" crashes
and JavaScript heap out-of-memory errors that kill the agent process.

### Rules:
- NEVER run verbose or long-running scripts as background tasks
- ALWAYS redirect output to a temp file when running scripts that produce more than ~50 lines:
  ```bash
  node scripts/check-n8n.mjs > /tmp/check-n8n.log 2>&1
  ```
  Then read the log file to inspect results.
- For scripts that poll, loop, or stream output (like check-n8n.mjs), always run in foreground with output redirected
- When running docker, n8n, or any service commands, cap output with `| head -100` or redirect to file
- Prefer `--quiet` or `--silent` flags on CLI tools when available

## Project Overview
AI-powered email triage system: Gmail/Outlook -> n8n -> Ollama (local AI) -> Notion database.
OpenClaw overlay acts as executive assistant with proactive alerts.

## Key Paths
- n8n workflows: `n8n-workflows/`
- OpenClaw agent config: `openclaw-configs/AGENTS.md`
- Stack verification: `scripts/check-n8n.mjs`
- Docker setup: `docker-compose.yml`, `docker-setup.sh`

## Model Routing Source of Truth
- Use `config/model_settings.json` as the single source of truth for model routing in local tools.
- New/updated tools must read primary model, fallback models, and backend defaults from this file.
- Avoid hardcoding model IDs in scripts when this config can be used instead.
- For n8n workflow/env sync, run `python3 scripts/sync-model-settings.py` after editing `config/model_settings.json`.

## goplaces Security Baseline
- Use the hardened wrapper `openclaw_workspace/tools/bin/goplaces`, not the raw binary.
- Keep `GOPLACES_ALLOW_BASE_URL_OVERRIDE=0` in normal operation.
- Keep `GOPLACES_ENFORCE_PROXY=1` and route through `GOPLACES_HTTPS_PROXY=http://host.docker.internal:3128`.
- Do not pass unrestricted proxy/base-url env vars into tool execution contexts.

## Safe Learning Registry
- Use `config/agent_learning_registry.json` as the source of truth for approved learnings.
- Keep `policy.approval_mode=human_gated` for this repo.
- Initialize tiered folders with `./scripts/bootstrap-self-improve-memory.sh`.
- Queue new learnings in `memory/raw/proposed_learnings.json` via `scripts/learning_registry.py propose`.
- Promote learnings only after explicit human review via `scripts/learning_registry.py approve <proposal_id> --approved-by <name>`.
- Track usage and tier governance with:
  - `scripts/learning_registry.py record-use <learning_id>`
  - `scripts/learning_registry.py suggest-tier-changes`
  - `scripts/learning_registry.py apply-tier-change <change_id> --approved-by <name>`
- Do not auto-edit `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or `openclaw-configs/AGENTS.md` as part of self-improvement.
- Run `python3 scripts/skill_risk_scan.py <skill_path> --fail-on high` before adopting third-party skills.
