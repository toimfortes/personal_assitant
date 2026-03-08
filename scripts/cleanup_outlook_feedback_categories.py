#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

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


def notion_headers(env: dict[str, str]) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {env['NOTION_API_KEY']}",
        "Notion-Version": env.get("NOTION_API_VERSION", DEFAULT_NOTION_VERSION),
        "Content-Type": "application/json",
    }


def notion_query(env: dict[str, str], body: dict) -> dict:
    headers = notion_headers(env)
    response = requests.post(
        f"https://api.notion.com/v1/data_sources/{env['NOTION_DATA_SOURCE_ID']}/query",
        headers=headers,
        json=body,
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def update_category(env: dict[str, str], page_id: str, category: str) -> None:
    headers = notion_headers(env)
    response = requests.patch(
        f"https://api.notion.com/v1/pages/{page_id}",
        headers=headers,
        json={"properties": {"Category": {"select": {"name": category}}}},
        timeout=60,
    )
    response.raise_for_status()


def classify_cleanup(title: str, feedback: str, reason: str) -> str | None:
    title_l = title.lower()
    reason_l = reason.lower()
    combined = f"{title_l}\n{reason_l}"

    legal_keywords = (
        "statement of information",
        "tps",
        "termination",
        "filing window",
    )
    if any(keyword in combined for keyword in legal_keywords):
        return "Legal"

    newsletter_keywords = (
        "discount",
        "sale",
        "private session",
        "webinar",
        "vacation",
        "yacht",
        "valentines",
        "lunch on us",
        "board intro",
        "unlock 3 ap features",
        "faster, better talent acquisition",
        "struggling with lab inventory",
        "session",
        "marketing",
        "promotional",
        "promotion",
        "advertisement",
        "newsletter",
        "payment is pending",
        "has settled",
        "received your",
        "withdrawal request initiated",
        "daily activity statement",
        "closing 2025",
    )
    if any(keyword in combined for keyword in newsletter_keywords):
        return "Newsletter"

    if feedback == "Not Important":
        return "Newsletter"

    return None


def main() -> None:
    env = load_env(PROJECT_ROOT / ".env")
    body = {
        "page_size": 100,
        "filter": {
            "and": [
                {"property": "Email Account", "rich_text": {"contains": "Outlook"}},
                {"property": "Triage Feedback", "select": {"is_not_empty": True}},
                {"property": "Category", "select": {"equals": "Bill"}},
            ]
        },
    }

    pages: list[dict] = []
    cursor = None
    while True:
        payload = dict(body)
        if cursor:
            payload["start_cursor"] = cursor
        result = notion_query(env, payload)
        pages.extend(result.get("results", []))
        if not result.get("has_more"):
            break
        cursor = result.get("next_cursor")

    changes: list[dict[str, str]] = []
    for page in pages:
        props = page["properties"]
        title = "".join(part.get("plain_text", "") for part in props["Name"]["title"])
        feedback = (props.get("Triage Feedback", {}).get("select") or {}).get("name", "")
        reason = "".join(part.get("plain_text", "") for part in props.get("Importance Reason", {}).get("rich_text", []))
        new_category = classify_cleanup(title, feedback, reason)
        if not new_category or new_category == "Bill":
            continue
        update_category(env, page["id"], new_category)
        changes.append({"page_id": page["id"], "title": title, "category": new_category, "feedback": feedback})

    print(json.dumps({"scanned": len(pages), "updated": len(changes), "changes": changes}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
