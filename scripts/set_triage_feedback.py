#!/usr/bin/env python3

import argparse
import json
import sys
from pathlib import Path

import requests  # type: ignore[import-untyped]


PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env"
DEFAULT_VERSION = "2025-09-03"
VALID_FEEDBACK = {"Not Important", "Misflagged", "Needs Rule", "clear"}


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def notion_request(url: str, headers: dict[str, str], method: str, body: dict) -> dict:
    try:
        response = requests.request(method, url, headers=headers, json=body, timeout=60)
        response.raise_for_status()
        return response.json() if response.content else {}
    except requests.HTTPError as exc:  # type: ignore[attr-defined]
        detail = exc.response.text if exc.response is not None else str(exc)
        raise RuntimeError(f"Notion PATCH failed for {url}: {detail}") from exc


def main() -> None:
    parser = argparse.ArgumentParser(description="Set or clear Triage Feedback on specific Notion pages.")
    parser.add_argument("--page-id", action="append", required=True, help="Notion page ID to update. Repeatable.")
    parser.add_argument("--feedback", required=True, choices=sorted(VALID_FEEDBACK))
    args = parser.parse_args()

    env = load_env()
    token = env.get("NOTION_API_KEY")
    if not token:
        raise RuntimeError("NOTION_API_KEY missing from .env")

    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": env.get("NOTION_API_VERSION", DEFAULT_VERSION),
        "Content-Type": "application/json",
    }

    updated = []
    for page_id in args.page_id:
        value = None if args.feedback == "clear" else {"name": args.feedback}
        body = {
            "properties": {
                "Triage Feedback": {
                    "select": value,
                }
            }
        }
        result = notion_request(f"https://api.notion.com/v1/pages/{page_id}", headers, "PATCH", body)
        select_value = (
            result.get("properties", {})
            .get("Triage Feedback", {})
            .get("select")
        )
        updated.append({
            "page_id": result.get("id", page_id),
            "triage_feedback": (select_value or {}).get("name"),
        })

    print(json.dumps({"updated": updated}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise
