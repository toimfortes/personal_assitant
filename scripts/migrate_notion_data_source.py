#!/usr/bin/env python3

import json
import sys
import urllib.request
from pathlib import Path
from urllib.parse import quote


PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env"
DEFAULT_DATA_SOURCE_ID = "2c91d511-87a6-805c-ab38-000b18d92545"
DEFAULT_VERSION = "2025-09-03"
FEEDBACK_PROPERTY = "Triage Feedback"
FEEDBACK_OPTIONS = [
    {"name": "Not Important", "color": "gray"},
    {"name": "Misflagged", "color": "orange"},
    {"name": "Needs Rule", "color": "blue"},
]


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def notion_request(url: str, headers: dict[str, str], method: str = "GET", body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, headers=headers, data=data, method=method)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def build_headers(env: dict[str, str]) -> dict[str, str]:
    token = env.get("NOTION_API_KEY")
    if not token:
        raise RuntimeError("NOTION_API_KEY missing from .env")
    return {
        "Authorization": f"Bearer {token}",
        "Notion-Version": env.get("NOTION_API_VERSION", DEFAULT_VERSION),
        "Content-Type": "application/json",
    }


def main() -> None:
    env = load_env()
    data_source_id = env.get("NOTION_DATA_SOURCE_ID", DEFAULT_DATA_SOURCE_ID)
    headers = build_headers(env)
    encoded_id = quote(data_source_id)

    current = notion_request(f"https://api.notion.com/v1/data_sources/{encoded_id}", headers)
    properties = current.get("properties", {})
    existing = properties.get(FEEDBACK_PROPERTY)

    payload = {
        "properties": {
            FEEDBACK_PROPERTY: {
                "select": {
                    "options": FEEDBACK_OPTIONS,
                }
            }
        }
    }

    updated = notion_request(
        f"https://api.notion.com/v1/data_sources/{encoded_id}",
        headers,
        method="PATCH",
        body=payload,
    )

    updated_property = updated.get("properties", {}).get(FEEDBACK_PROPERTY, {})
    option_names = [opt.get("name") for opt in updated_property.get("select", {}).get("options", [])]
    print(json.dumps({
        "data_source_id": data_source_id,
        "property_previously_present": existing is not None,
        "feedback_options": option_names,
    }, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise
