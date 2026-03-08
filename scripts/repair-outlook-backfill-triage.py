#!/usr/bin/env python3

import argparse
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from functools import lru_cache
from html import unescape
from pathlib import Path
from urllib.parse import quote


PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env"
MODEL_SETTINGS_PATH = PROJECT_ROOT / "config" / "model_settings.json"
RULES_CSV_PATH = PROJECT_ROOT / "config" / "triage_rules.csv"
N8N_BASE = "http://127.0.0.1:5678"
DEFAULT_EXECUTION_ID = "361"
DEFAULT_NOTION_VERSION = "2025-09-03"
DEFAULT_DATA_SOURCE_ID = "2c91d511-87a6-805c-ab38-000b18d92545"
DEFAULT_TIMEOUT = 120
ALLOWED_CATEGORIES = {"Important", "Bill", "Legal", "Personal", "Newsletter", "Spam"}
MARKETING_KEYWORDS = (
    "webinar",
    "register",
    "newsletter",
    "edition",
    "customer agreement",
    "privacy policy",
    "mark your calendars",
    "session",
)


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def load_model_order() -> list[str]:
    settings = json.loads(MODEL_SETTINGS_PATH.read_text())
    llm = settings.get("llm", {})
    order = [llm.get("primary"), *(llm.get("fallbacks") or [])]
    return [str(model) for model in order if model]


def load_rules() -> tuple[set[str], set[str], set[str]]:
    important_domains: set[str] = set()
    important_emails: set[str] = set()
    bill_keywords = {
        "bill",
        "billing",
        "invoice",
        "statement",
        "payment due",
        "past due",
        "autopay",
        "phone bill",
        "insurance",
        "mortgage",
        "rent",
        "credit card",
        "due date",
    }
    for raw_line in RULES_CSV_PATH.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("type,"):
            continue
        cols = [part.strip() for part in line.split(",")]
        if len(cols) < 2:
            continue
        kind = cols[0].lower()
        value = cols[1].lower()
        if kind == "domain":
            important_domains.add(value)
        elif kind == "email":
            important_emails.add(value)
        elif kind in {"bill_keyword", "keyword", "bill"}:
            bill_keywords.add(value)
    return important_domains, important_emails, bill_keywords


def strip_html(value: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\\1>", " ", value or "")
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def contains_keyword(content: str, keyword: str) -> bool:
    escaped_parts = [re.escape(part) for part in keyword.lower().split()]
    if not escaped_parts:
        return False
    pattern = r"\b" + r"\s+".join(escaped_parts) + r"\b"
    return re.search(pattern, content) is not None


def normalize_message(message: dict, important_domains: set[str], important_emails: set[str], bill_keywords: set[str]) -> dict:
    from_field = message.get("from")
    sender_raw = ""
    if isinstance(from_field, dict):
        email_address = from_field.get("emailAddress") or {}
        sender_raw = email_address.get("address") or email_address.get("name") or ""
    elif isinstance(from_field, str):
        sender_raw = from_field
    email_match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", sender_raw or "")
    sender_email = (email_match.group(0) if email_match else sender_raw).lower()
    sender_domain = sender_email.split("@", 1)[1] if "@" in sender_email else ""
    subject = str(message.get("subject") or "")
    body_field = message.get("body")
    if isinstance(body_field, dict):
        body_raw = body_field.get("content") or ""
    else:
        body_raw = body_field or ""
    body = strip_html(str(body_raw or message.get("bodyPreview") or ""))[:3500]
    to_recipients = []
    for item in message.get("toRecipients") or []:
        email_address = (item or {}).get("emailAddress") or {}
        addr = email_address.get("address")
        if addr:
            to_recipients.append(addr.lower())
    content = f"{subject}\n{body}".lower()
    mentions_antonio = "antonio" in content or any("antonio" in value for value in to_recipients)
    request_keywords = (
        "please",
        "can you",
        "could you",
        "would you",
        "need you",
        "action required",
        "review",
        "approve",
        "sign",
        "help",
        "let me know",
        "respond",
        "reply",
        "asap",
        "urgent",
        "follow up",
    )
    funds_info_keywords = (
        "received funds",
        "you received funds",
        "transfer settled",
        "has settled",
        "payment is pending",
        "scheduled payment is pending",
        "payment posted",
        "payment completed",
        "deposit received",
    )
    direct_request_detected = any(contains_keyword(content, keyword) for keyword in request_keywords)
    funds_info_detected = any(contains_keyword(content, keyword) for keyword in funds_info_keywords)
    important_email_match = sender_email in important_emails
    important_domain_match = any(sender_domain == value or sender_domain.endswith(f".{value}") for value in important_domains)
    bill_detected = any(contains_keyword(content, keyword) for keyword in bill_keywords)
    bill_escalation_detected = bill_detected and direct_request_detected and mentions_antonio
    reasons = []
    if bill_detected:
        reasons.append("bill_keyword")
    if important_email_match:
        reasons.append("important_email")
    if important_domain_match:
        reasons.append("important_domain")
    if bill_escalation_detected:
        reasons.append("bill_escalation")
    if funds_info_detected:
        reasons.append("informational_finance")
    return {
        "sender_email": sender_email,
        "sender_domain": sender_domain,
        "subject": subject,
        "body": body,
        "to_recipients": to_recipients,
        "bill_detected": bill_detected,
        "bill_escalation_detected": bill_escalation_detected,
        "direct_request_detected": direct_request_detected,
        "funds_info_detected": funds_info_detected,
        "mentions_antonio": mentions_antonio,
        "important_list_match": important_email_match or important_domain_match,
        "rule_reason": ",".join(reasons),
    }


def triage_prompt(context: dict) -> str:
    payload = {
        "from": context["sender_email"],
        "domain": context["sender_domain"],
        "to": context["to_recipients"],
        "subject": context["subject"],
        "body": context["body"],
        "bill_detected": context["bill_detected"],
        "bill_escalation_detected": context["bill_escalation_detected"],
        "direct_request_detected": context["direct_request_detected"],
        "funds_info_detected": context["funds_info_detected"],
        "mentions_antonio": context["mentions_antonio"],
        "important_list_match": context["important_list_match"],
        "rule_reason": context["rule_reason"],
    }
    return (
        "You are triaging Antonio Fortes' work Outlook inbox. "
        "Return ONLY valid JSON with keys: is_important (boolean), is_bill (boolean), "
        "category (string), reason (string), summary (string), suggested_action (string). "
        "Allowed category values: Important, Bill, Legal, Personal, Newsletter, Spam. "
        "Important means Antonio personally needs to act, decide, approve, reply, or help with an escalation. "
        "Bills in Antonio's work inbox are NOT important by default; assume accounting or operations owns them unless the email specifically asks Antonio for help, approval, or escalation. "
        "Emails saying funds were received, transfers settled, or routine payments posted are informational unless there is a direct request. "
        "Marketing, webinars, policy updates, promos, newsletters, and routine FYI notices are not important. "
        "Known domains and VIP senders are strong signals but not automatic if the message is plainly FYI. "
        f"Email context:\n{json.dumps(payload, ensure_ascii=True)}"
    )


def clean_json_text(raw: str) -> str:
    text = (raw or "").strip()
    text = text.replace("```json", "").replace("```", "").strip()
    if text.startswith("{") and text.endswith("}"):
        return text
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1]
    raise ValueError(f"No JSON object found in: {text[:200]}")


def parse_gemini_output(stdout: str) -> dict:
    outer = json.loads(stdout)
    return json.loads(clean_json_text(outer.get("response", "")))


def parse_claude_output(stdout: str) -> dict:
    outer = json.loads(stdout)
    return json.loads(clean_json_text(outer.get("result", "")))


def parse_codex_output(path: str) -> dict:
    return json.loads(clean_json_text(Path(path).read_text()))


def parse_ollama_output(raw: str) -> dict:
    outer = json.loads(raw)
    candidate = outer.get("response") or outer.get("thinking") or ""
    return json.loads(clean_json_text(candidate))


def run_command(args: list[str], prompt: str, timeout: int) -> subprocess.CompletedProcess:
    return subprocess.run(
        args,
        input=prompt,
        text=True,
        capture_output=True,
        timeout=timeout,
        cwd=str(PROJECT_ROOT),
        check=False,
    )


def call_provider(provider_model: str, prompt: str, timeout: int) -> tuple[dict, dict]:
    provider, model = provider_model.split("/", 1)
    if provider == "google-gemini-cli":
        proc = run_command(["gemini", "-m", model, "-p", "", "--output-format", "json"], prompt, timeout)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"{provider_model} exited {proc.returncode}")
        return parse_gemini_output(proc.stdout), {"provider": provider_model}

    if provider == "anthropic":
        proc = run_command(
            [
                "claude",
                "-p",
                "--model",
                model,
                "--output-format",
                "json",
                "--permission-mode",
                "bypassPermissions",
                "--tools",
                "",
            ],
            prompt,
            timeout,
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"{provider_model} exited {proc.returncode}")
        return parse_claude_output(proc.stdout), {"provider": provider_model}

    if provider == "openai-codex":
        with tempfile.NamedTemporaryFile("w+", delete=False) as handle:
            output_path = handle.name
        try:
            proc = run_command(
                [
                    "codex",
                    "exec",
                    "-C",
                    str(PROJECT_ROOT),
                    "--sandbox",
                    "danger-full-access",
                    "--skip-git-repo-check",
                    "-m",
                    model,
                    "-o",
                    output_path,
                    "-",
                ],
                prompt,
                timeout,
            )
            if proc.returncode != 0:
                raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"{provider_model} exited {proc.returncode}")
            return parse_codex_output(output_path), {"provider": provider_model}
        finally:
            try:
                Path(output_path).unlink(missing_ok=True)
            except Exception:
                pass

    if provider == "ollama":
        body = {"model": model, "stream": False, "format": "json", "prompt": prompt}
        req = urllib.request.Request(
            "http://127.0.0.1:11434/api/generate",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
        return parse_ollama_output(raw), {"provider": provider_model}

    raise RuntimeError(f"Unsupported provider {provider_model}")


def derived_category(context: dict) -> str:
    content = f"{context['subject']} {context['body']}".lower()
    if context["bill_detected"]:
        return "Bill"
    if any(keyword in content for keyword in MARKETING_KEYWORDS):
        return "Newsletter"
    return "Personal"


def feedback_for(context: dict, ai: dict) -> str | None:
    if ai["is_important"]:
        return None
    if context["funds_info_detected"] or (context["bill_detected"] and not context["bill_escalation_detected"]):
        return "Needs Rule"
    if context["important_list_match"]:
        return "Misflagged"
    return "Not Important"


def postprocess_ai(context: dict, ai: dict) -> dict:
    result = {
        "is_important": bool(ai.get("is_important")),
        "is_bill": bool(ai.get("is_bill")),
        "category": str(ai.get("category") or "").strip() or "Important",
        "reason": str(ai.get("reason") or "").strip(),
        "summary": str(ai.get("summary") or "").strip(),
        "suggested_action": str(ai.get("suggested_action") or "").strip(),
    }
    if context["funds_info_detected"] and not context["bill_escalation_detected"]:
        result["is_important"] = False
        result["is_bill"] = False
        if result["category"] in {"Bill", "Important"}:
            result["category"] = "Newsletter"
    if context["bill_detected"] and not context["bill_escalation_detected"]:
        result["is_important"] = False
        result["is_bill"] = True
    if result["category"] not in ALLOWED_CATEGORIES:
        result["category"] = derived_category(context) if not result["is_important"] else ("Bill" if result["is_bill"] else "Important")
    if not result["is_important"]:
        if context["bill_detected"]:
            result["category"] = "Bill"
        elif result["category"] == "Important":
            result["category"] = derived_category(context)
        if not result["suggested_action"]:
            result["suggested_action"] = "No action needed."
    if result["is_important"] and not result["suggested_action"]:
        result["suggested_action"] = "Review and reply if needed."
    if not result["reason"]:
        result["reason"] = context["rule_reason"] or ("Actionable work email." if result["is_important"] else "Informational email.")
    if not result["summary"]:
        result["summary"] = context["subject"][:180] or "Email reviewed."
    result["triage_feedback"] = feedback_for(context, result)
    result["status"] = "Not Started" if result["is_important"] else "Completed"
    return result


def notion_headers(env: dict[str, str]) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {env['NOTION_API_KEY']}",
        "Notion-Version": env.get("NOTION_API_VERSION", DEFAULT_NOTION_VERSION),
        "Content-Type": "application/json",
    }


def notion_request(url: str, headers: dict[str, str], method: str = "GET", body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def login_cookie(email: str, password: str) -> str:
    body = json.dumps({"emailOrLdapLoginId": email, "password": password}).encode()
    req = urllib.request.Request(f"{N8N_BASE}/rest/login", data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req) as resp:
        cookies = resp.headers.get_all("Set-Cookie") or []
    cookie = "; ".join([value.split(";", 1)[0] for value in cookies if value.startswith("n8n-auth=")])
    if not cookie:
        raise RuntimeError("Failed to obtain n8n-auth cookie")
    return cookie


def fetch_execution(cookie: str, execution_id: str) -> dict:
    req = urllib.request.Request(f"{N8N_BASE}/rest/executions/{execution_id}", headers={"Cookie": cookie}, method="GET")
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)["data"]


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


def build_message_map(execution_payload: dict) -> dict[str, dict]:
    decoded = decode_execution_data(json.loads(execution_payload["data"]))
    messages = decoded["resultData"]["runData"]["Microsoft 365 Email"][0]["data"]["main"][0]
    mapping: dict[str, dict] = {}
    for item in messages:
        message = item["json"]
        link = message.get("webLink")
        if link:
            mapping[link] = message
    return mapping


def query_failed_pages(headers: dict[str, str], data_source_id: str, limit: int | None) -> list[dict]:
    body = {
        "page_size": 100,
        "filter": {
            "and": [
                {"property": "Email Account", "rich_text": {"contains": "Outlook"}},
                {"property": "Core Request", "rich_text": {"contains": "AI triage failed"}},
            ]
        },
    }
    pages: list[dict] = []
    cursor = None
    while True:
        if cursor:
            body["start_cursor"] = cursor
        data = notion_request(
            f"https://api.notion.com/v1/data_sources/{quote(data_source_id)}/query",
            headers,
            method="POST",
            body=body,
        )
        pages.extend(data.get("results", []))
        if limit and len(pages) >= limit:
            return pages[:limit]
        if not data.get("has_more"):
            return pages
        cursor = data.get("next_cursor")


def fetch_pages_by_id(headers: dict[str, str], page_ids: list[str]) -> list[dict]:
    pages = []
    for page_id in page_ids:
        pages.append(notion_request(f"https://api.notion.com/v1/pages/{quote(page_id)}", headers, method="GET"))
    return pages


def update_page(headers: dict[str, str], page_id: str, triage: dict) -> None:
    body = {
        "properties": {
            "Core Request": {"rich_text": [{"text": {"content": triage["summary"][:2000]}}]},
            "Importance Reason": {"rich_text": [{"text": {"content": triage["reason"][:2000]}}]},
            "Category": {"select": {"name": triage["category"]}},
            "Reply Draft": {"rich_text": [{"text": {"content": triage["suggested_action"][:2000]}}]},
            "Status": {"select": {"name": triage["status"]}},
            "Triage Feedback": {"select": ({"name": triage["triage_feedback"]} if triage["triage_feedback"] else None)},
        }
    }
    notion_request(f"https://api.notion.com/v1/pages/{page_id}", headers, method="PATCH", body=body)


def append_jsonl(path: Path, payload: dict) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=True) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execution-id", default=DEFAULT_EXECUTION_ID)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--n8n-email", default="cortexcerebral@gmail.com")
    parser.add_argument("--n8n-password", default="Hjkhjk.,23")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    parser.add_argument("--sleep-ms", type=int, default=250)
    parser.add_argument("--debug-log", default="/tmp/outlook_retriage_debug.jsonl")
    parser.add_argument("--page-id", action="append", default=[])
    parser.add_argument("--stop-on-provider-failure", action="store_true", default=True)
    args = parser.parse_args()

    env = load_env()
    model_order = load_model_order()
    important_domains, important_emails, bill_keywords = load_rules()
    headers = notion_headers(env)
    cookie = login_cookie(args.n8n_email, args.n8n_password)
    execution = fetch_execution(cookie, args.execution_id)
    message_map = build_message_map(execution)
    if args.page_id:
        pages = fetch_pages_by_id(headers, args.page_id)
    else:
        pages = query_failed_pages(headers, env.get("NOTION_DATA_SOURCE_ID", DEFAULT_DATA_SOURCE_ID), args.limit)
    debug_path = Path(args.debug_log)
    if debug_path.exists():
        debug_path.unlink()

    summary = {
        "target_pages": len(pages),
        "processed": 0,
        "important_kept": 0,
        "feedback_marked": 0,
        "provider_counts": {},
        "provider_failures": [],
        "missing_messages": [],
    }

    for idx, page in enumerate(pages, start=1):
        title = "".join(part.get("plain_text", "") for part in page["properties"]["Name"]["title"])
        link = page["properties"].get("Original Link", {}).get("url")
        if not link or link not in message_map:
            missing = {"page_id": page["id"], "title": title, "link": link}
            summary["missing_messages"].append(missing)
            append_jsonl(debug_path, {"index": idx, "title": title, "error": "missing_message", "link": link})
            continue

        message = message_map[link]
        context = normalize_message(message, important_domains, important_emails, bill_keywords)
        prompt = triage_prompt(context)
        ai_raw = None
        failures = []
        provider_used = None

        for provider_model in model_order:
            try:
                ai_raw, provider_meta = call_provider(provider_model, prompt, args.timeout)
                provider_used = provider_meta["provider"]
                break
            except Exception as exc:
                failures.append({"provider": provider_model, "error": str(exc)})
                summary["provider_failures"].append({"page_id": page["id"], "title": title, "provider": provider_model, "error": str(exc)})
                if args.stop_on_provider_failure:
                    append_jsonl(debug_path, {"index": idx, "title": title, "provider_failures": failures, "stopped": True})
                    raise

        if ai_raw is None or provider_used is None:
            raise RuntimeError(f"All providers failed for page {page['id']} {title}")

        triage = postprocess_ai(context, ai_raw)
        update_page(headers, page["id"], triage)
        summary["processed"] += 1
        summary["provider_counts"][provider_used] = summary["provider_counts"].get(provider_used, 0) + 1
        if triage["triage_feedback"]:
            summary["feedback_marked"] += 1
        else:
            summary["important_kept"] += 1

        append_jsonl(
            debug_path,
            {
                "index": idx,
                "page_id": page["id"],
                "title": title,
                "provider": provider_used,
                "provider_failures": failures,
                "triage": triage,
                "context": {
                    "sender_email": context["sender_email"],
                    "subject": context["subject"],
                    "bill_detected": context["bill_detected"],
                    "funds_info_detected": context["funds_info_detected"],
                    "direct_request_detected": context["direct_request_detected"],
                    "important_list_match": context["important_list_match"],
                },
            },
        )
        time.sleep(args.sleep_ms / 1000)

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
