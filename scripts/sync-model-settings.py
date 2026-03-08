#!/usr/bin/env python3
"""Sync model settings from config/model_settings.json into env + n8n workflows."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL_SETTINGS_PATH = ROOT / "config" / "model_settings.json"
ENV_PATH = ROOT / ".env"
ENV_EXAMPLE_PATH = ROOT / ".env.example"

WORKFLOW_TRIAGE_GMAIL = ROOT / "n8n-workflows" / "triage-gmail-to-notion.json"
WORKFLOW_TRIAGE_OUTLOOK = ROOT / "n8n-workflows" / "triage-outlook-to-notion.json"
WORKFLOW_BACKFILL = ROOT / "n8n-workflows" / "backfill-gmail-triage.json"

DEFAULT_OLLAMA_PRIMARY = "glm-4.7-flash"
DEFAULT_OLLAMA_FALLBACK = "glm-4.7-flash"
DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"


def _load_settings() -> dict:
    if not MODEL_SETTINGS_PATH.exists():
        raise FileNotFoundError(f"Missing settings file: {MODEL_SETTINGS_PATH}")
    with MODEL_SETTINGS_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("model_settings.json must be a JSON object")
    return data


def _to_ollama_model(model: str) -> str | None:
    model = model.strip()
    if not model:
        return None
    if model.startswith("ollama/"):
        return model.split("/", 1)[1]
    if "/" in model:
        return None
    return model


def _derive_model_env(settings: dict) -> dict[str, str]:
    llm = settings.get("llm", {}) if isinstance(settings.get("llm", {}), dict) else {}
    primary = str(llm.get("primary", "")).strip()
    fallbacks = llm.get("fallbacks", [])
    if not isinstance(fallbacks, list):
        fallbacks = []

    ollama_candidates: list[str] = []

    primary_ollama = _to_ollama_model(primary)
    if primary_ollama:
        ollama_candidates.append(primary_ollama)

    for entry in fallbacks:
        candidate = _to_ollama_model(str(entry))
        if candidate and candidate not in ollama_candidates:
            ollama_candidates.append(candidate)

    if not ollama_candidates:
        ollama_candidates = [DEFAULT_OLLAMA_PRIMARY, DEFAULT_OLLAMA_FALLBACK]

    if len(ollama_candidates) == 1:
        ollama_candidates.append(DEFAULT_OLLAMA_FALLBACK)

    n8n_section = settings.get("n8n", {}) if isinstance(settings.get("n8n", {}), dict) else {}
    anthropic_model = str(n8n_section.get("anthropic_primary", DEFAULT_ANTHROPIC_MODEL)).strip() or DEFAULT_ANTHROPIC_MODEL

    return {
        "N8N_OLLAMA_MODEL_PRIMARY": ollama_candidates[0],
        "N8N_OLLAMA_MODEL_FALLBACK": ollama_candidates[1],
        "N8N_ANTHROPIC_MODEL_PRIMARY": anthropic_model,
    }


def _upsert_env_file(path: Path, updates: dict[str, str]) -> None:
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
    else:
        lines = []

    existing_keys: dict[str, int] = {}
    for idx, line in enumerate(lines):
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        if key:
            existing_keys[key] = idx

    for key, value in updates.items():
        entry = f"{key}={value}"
        if key in existing_keys:
            lines[existing_keys[key]] = entry
        else:
            lines.append(entry)

    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def _patch_workflow_ollama_model(path: Path) -> bool:
    data = json.loads(path.read_text(encoding="utf-8"))
    changed = False

    for node in data.get("nodes", []):
        if node.get("name") != "AI Triage (Local Ollama)":
            continue
        params = node.get("parameters", {})
        body = params.get("bodyParameters", {})
        parameters = body.get("parameters", [])
        for entry in parameters:
            if entry.get("name") == "model":
                desired = (
                    '={{$env["N8N_OLLAMA_MODEL_PRIMARY"] || '
                    '$env["N8N_OLLAMA_MODEL_FALLBACK"] || "glm-4.7-flash"}}'
                )
                if entry.get("value") != desired:
                    entry["value"] = desired
                    changed = True

    if changed:
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return changed


def _patch_workflow_backfill_model(path: Path) -> bool:
    data = json.loads(path.read_text(encoding="utf-8"))
    changed = False

    for node in data.get("nodes", []):
        if node.get("name") != "AI Triage (Claude)":
            continue
        params = node.get("parameters", {})
        raw = params.get("jsonBody")
        if not isinstance(raw, str):
            continue
        desired_fragment = "model: ($env.N8N_ANTHROPIC_MODEL_PRIMARY || 'claude-haiku-4-5-20251001')"
        updated = re.sub(
            r"model:\s*'[^']+'",
            desired_fragment,
            raw,
            count=1,
        )
        if updated != raw:
            params["jsonBody"] = updated
            changed = True

    if changed:
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return changed


def main() -> int:
    settings = _load_settings()
    env_updates = _derive_model_env(settings)

    _upsert_env_file(ENV_PATH, env_updates)
    _upsert_env_file(ENV_EXAMPLE_PATH, env_updates)

    changed_gmail = _patch_workflow_ollama_model(WORKFLOW_TRIAGE_GMAIL)
    changed_outlook = _patch_workflow_ollama_model(WORKFLOW_TRIAGE_OUTLOOK)
    changed_backfill = _patch_workflow_backfill_model(WORKFLOW_BACKFILL)

    print(f"Synced model env vars from: {MODEL_SETTINGS_PATH}")
    for key, value in env_updates.items():
        print(f"  {key}={value}")

    print("Workflow patches:")
    print(f"  triage-gmail-to-notion.json: {'updated' if changed_gmail else 'unchanged'}")
    print(f"  triage-outlook-to-notion.json: {'updated' if changed_outlook else 'unchanged'}")
    print(f"  backfill-gmail-triage.json: {'updated' if changed_backfill else 'unchanged'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
