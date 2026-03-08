#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote

import requests  # type: ignore[import-untyped]


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_NOTION_VERSION = "2025-09-03"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key] = value
    return env


def notion_request(url: str, headers: dict[str, str], method: str = "GET", body: dict | None = None) -> dict:
    response = requests.request(method, url, headers=headers, json=body, timeout=60)
    response.raise_for_status()
    return response.json() if response.content else {}


def main() -> None:
    env = load_env(PROJECT_ROOT / ".env")
    headers = {
        "Authorization": f"Bearer {env['NOTION_API_KEY']}",
        "Notion-Version": env.get("NOTION_API_VERSION", DEFAULT_NOTION_VERSION),
        "Content-Type": "application/json",
    }
    data_source_id = quote(env["NOTION_DATA_SOURCE_ID"], safe="")
    body = {
        "page_size": 100,
        "filter": {"property": "Category", "select": {"equals": "Newsletter"}},
    }

    pages: list[dict] = []
    cursor = None
    while True:
        payload = dict(body)
        if cursor:
            payload["start_cursor"] = cursor
        result = notion_request(
            f"https://api.notion.com/v1/data_sources/{data_source_id}/query",
            headers,
            method="POST",
            body=payload,
        )
        pages.extend(result.get("results", []))
        if not result.get("has_more"):
            break
        cursor = result.get("next_cursor")

    archived: list[dict[str, str]] = []
    for page in pages:
        title = "".join(part.get("plain_text", "") for part in page["properties"]["Name"]["title"])
        notion_request(
            f"https://api.notion.com/v1/pages/{page['id']}",
            headers,
            method="PATCH",
            body={"archived": True},
        )
        archived.append({"page_id": page["id"], "title": title})

    print(json.dumps({"matched": len(pages), "archived": len(archived), "sample": archived[:20]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
