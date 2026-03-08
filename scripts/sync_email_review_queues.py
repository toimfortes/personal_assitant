#!/usr/bin/env python3
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import requests  # type: ignore[import-untyped]


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_NOTION_VERSION = "2025-09-03"
MAILBOX_MAP_PATH = PROJECT_ROOT / "config" / "mailbox_map.json"


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


def notion_request(url: str, headers: dict[str, str], method: str = "GET", body: dict | None = None) -> dict:
    response = requests.request(method, url, headers=headers, json=body, timeout=60)
    response.raise_for_status()
    return response.json() if response.content else {}


def load_mailbox_map() -> tuple[dict[str, str], str | None]:
    if not MAILBOX_MAP_PATH.exists():
        return {}, None

    raw = json.loads(MAILBOX_MAP_PATH.read_text())
    mapping: dict[str, str] = {}
    outlook_mailbox: str | None = None
    for group in ("gmail", "outlook"):
        for row in raw.get(group, []):
            mailbox = str(row.get("mailbox", "")).strip().lower()
            workflow_id = str(row.get("workflow_id", "")).strip()
            if workflow_id and mailbox:
                mapping[workflow_id] = mailbox
            if group == "outlook" and mailbox and not outlook_mailbox:
                outlook_mailbox = mailbox
    return mapping, outlook_mailbox


def review_queue_for_category(category: str) -> str:
    normalized = (category or "").strip().lower()
    if normalized == "newsletter":
        return "Newsletter Review"
    if normalized == "spam":
        return "Spam Review"
    return "Action"


def retention_start(date_prop: dict | None) -> str | None:
    start = (date_prop or {}).get("start")
    if not start:
        return None
    try:
        if start.endswith("Z"):
            dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        else:
            dt = datetime.fromisoformat(start)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (dt + timedelta(days=14)).date().isoformat()
    except ValueError:
        return None


def main() -> None:
    env = load_env(PROJECT_ROOT / ".env")
    headers = notion_headers(env)
    mailbox_map, outlook_mailbox = load_mailbox_map()
    data_source_id = quote(env["NOTION_DATA_SOURCE_ID"], safe="")
    body = {"page_size": 100}

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

    updates: list[dict[str, str]] = []
    for page in pages:
        props = page.get("properties", {})
        title = "".join(part.get("plain_text", "") for part in props.get("Name", {}).get("title", []))
        category = (props.get("Category", {}).get("select") or {}).get("name", "")
        email_account = "".join(part.get("plain_text", "") for part in props.get("Email Account", {}).get("rich_text", []))
        current_queue = (props.get("Queue", {}).get("select") or {}).get("name")
        current_provider_action = (props.get("Provider Action", {}).get("select") or {}).get("name")
        current_provider_action_status = (props.get("Provider Action Status", {}).get("select") or {}).get("name")
        current_status = (props.get("Status", {}).get("select") or {}).get("name")
        current_mailbox = (props.get("Mailbox", {}) or {}).get("email")
        queue = review_queue_for_category(category)
        provider_action_status = current_provider_action_status
        if not provider_action_status or provider_action_status == "None":
            provider_action_status = "Pending" if queue in {"Newsletter Review", "Spam Review"} else "Skipped"
        elif queue == "Action" and provider_action_status == "Pending" and current_provider_action in {"", "None", None}:
            provider_action_status = "Skipped"

        status = current_status
        if not status and queue in {"Newsletter Review", "Spam Review"}:
            status = "Completed"

        retention = retention_start(props.get("Email Date", {}).get("date")) if queue in {"Newsletter Review", "Spam Review"} else None
        mailbox = current_mailbox
        if not mailbox and "Outlook" in email_account:
            mailbox = outlook_mailbox or "antonio@antharistherapeutics.com"

        properties: dict[str, object] = {}
        if current_queue != queue:
            properties["Queue"] = {"select": {"name": queue}}
        if mailbox != current_mailbox:
            properties["Mailbox"] = {"email": mailbox}
        if not current_provider_action:
            properties["Provider Action"] = {"select": {"name": "None"}}
        if provider_action_status != current_provider_action_status:
            properties["Provider Action Status"] = {"select": {"name": provider_action_status}}
        if retention or props.get("Retention Until", {}).get("date"):
            properties["Retention Until"] = {"date": {"start": retention} if retention else None}
        if status and status != current_status:
            properties["Status"] = {"select": {"name": status}}

        if properties:
            notion_request(
                f"https://api.notion.com/v1/pages/{page['id']}",
                headers,
                method="PATCH",
                body={"properties": properties},
            )
            updates.append({"page_id": page["id"], "title": title, "queue": queue})

    print(json.dumps({"updated": len(updates), "sample": updates[:20]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
