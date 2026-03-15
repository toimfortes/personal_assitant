#!/usr/bin/env python3

import argparse
import json
import time
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

import requests  # type: ignore[import-untyped]


PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKFILL_TEMPLATE = PROJECT_ROOT / "n8n-workflows" / "backfill-gmail-triage.json"
N8N_BASE = "http://127.0.0.1:5678"
DATABASE_ID = "2c91d511-87a6-80a7-8ef0-cede30a9baa7"
DATA_SOURCE_ID = "2c91d511-87a6-805c-ab38-000b18d92545"
NOTION_VERSION = "2025-09-03"


def load_env_values() -> dict:
    env_path = PROJECT_ROOT / ".env"
    values: dict[str, str] = {}
    if not env_path.exists():
        return values
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def load_notion_headers():
    env = load_env_values()
    token = env.get("NOTION_API_KEY")
    if not token:
        raise RuntimeError("NOTION_API_KEY missing from .env")
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": env.get("NOTION_API_VERSION", NOTION_VERSION),
    }
    headers["Content-Type"] = "application/json"
    return headers


def n8n_login_cookie(email: str, password: str) -> str:
    response = requests.post(
        f"{N8N_BASE}/rest/login",
        json={
            "emailOrLdapLoginId": email,
            "password": password,
        },
        timeout=60,
    )
    response.raise_for_status()
    cookies = response.headers.get("set-cookie", "").split(", ")
    cookie = "; ".join(
        [c.split(";", 1)[0] for c in cookies if c.startswith("n8n-auth=")]
    )
    if not cookie:
        raise RuntimeError("Failed to obtain n8n-auth cookie")
    return cookie


def fetch_execution(cookie: str, execution_id: str) -> dict:
    response = requests.get(
        f"{N8N_BASE}/rest/executions/{execution_id}",
        headers={"Cookie": cookie},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()["data"]


def decode_execution_data(flat):
    @lru_cache(None)
    def decode_idx(idx: int):
        return decode(flat[idx])

    def decode(value):
        if isinstance(value, str) and value.isdigit():
            idx = int(value)
            if 0 <= idx < len(flat):
                return decode_idx(idx)
        if isinstance(value, list):
            return [decode(v) for v in value]
        if isinstance(value, dict):
            return {k: decode(v) for k, v in value.items()}
        return value

    return decode_idx(0)


def build_link_sender_map(execution_payload: dict) -> dict[str, str]:
    decoded = decode_execution_data(json.loads(execution_payload["data"]))
    messages = decoded["resultData"]["runData"]["Microsoft 365 Email"][0]["data"][
        "main"
    ][0]
    mapping: dict[str, str] = {}
    for item in messages:
        message = item["json"]
        sender = message.get("from")
        sender_text = None
        if isinstance(sender, dict):
            email_address = sender.get("emailAddress") or {}
            sender_text = email_address.get("address") or email_address.get("name")
        elif isinstance(sender, str):
            sender_text = sender
        if sender_text and message.get("webLink"):
            mapping[message["webLink"]] = sender_text[:100]
    return mapping


def notion_request(
    url: str, headers: dict, body: dict | None = None, method: str = "POST"
) -> dict:
    response = requests.request(method, url, headers=headers, json=body, timeout=60)
    response.raise_for_status()
    return response.json() if response.content else {}


def query_bad_pages(headers: dict, since: str):
    env = load_env_values()
    data_source_id = env.get("NOTION_DATA_SOURCE_ID", DATA_SOURCE_ID)
    cursor = None
    while True:
        body = {
            "page_size": 100,
            "filter": {
                "and": [
                    {"property": "Email Account", "rich_text": {"contains": "Outlook"}},
                    {
                        "property": "Sender",
                        "rich_text": {"contains": "[object Object]"},
                    },
                    {
                        "timestamp": "last_edited_time",
                        "last_edited_time": {"on_or_after": since},
                    },
                ]
            },
        }
        if cursor:
            body["start_cursor"] = cursor
        result = notion_request(
            f"https://api.notion.com/v1/data_sources/{quote(data_source_id)}/query",
            headers,
            body=body,
            method="POST",
        )
        for page in result["results"]:
            yield page
        if not result.get("has_more"):
            break
        cursor = result.get("next_cursor")


def patch_sender(headers: dict, page_id: str, sender: str):
    body = {
        "properties": {
            "Sender": {
                "rich_text": [{"text": {"content": sender[:100]}}],
            }
        }
    }
    notion_request(
        f"https://api.notion.com/v1/pages/{page_id}", headers, body=body, method="PATCH"
    )


def main():
    env = load_env_values()
    parser = argparse.ArgumentParser()
    parser.add_argument("--execution-id", default="361")
    parser.add_argument("--since", default="2026-03-07T15:00:00Z")
    parser.add_argument(
        "--n8n-email", default=env.get("N8N_EMAIL", "cortexcerebral@gmail.com")
    )
    parser.add_argument("--n8n-password", default=env.get("N8N_PASSWORD", ""))
    parser.add_argument("--sleep-ms", type=int, default=150)
    args = parser.parse_args()

    notion_headers = load_notion_headers()
    cookie = n8n_login_cookie(args.n8n_email, args.n8n_password)
    execution = fetch_execution(cookie, args.execution_id)
    link_sender = build_link_sender_map(execution)

    updated = 0
    skipped = 0
    missing_links = []

    for page in query_bad_pages(notion_headers, args.since):
        props = page["properties"]
        link = props.get("Original Link", {}).get("url")
        sender = link_sender.get(link)
        if not sender:
            skipped += 1
            title = "".join(t["plain_text"] for t in props["Name"]["title"])
            missing_links.append({"title": title, "link": link})
            continue
        patch_sender(notion_headers, page["id"], sender)
        updated += 1
        if updated % 50 == 0:
            print(json.dumps({"progress_updated": updated}))
        time.sleep(args.sleep_ms / 1000)

    print(
        json.dumps(
            {
                "execution_id": args.execution_id,
                "updated": updated,
                "skipped": skipped,
                "mapped_links": len(link_sender),
                "missing_links_sample": missing_links[:10],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
