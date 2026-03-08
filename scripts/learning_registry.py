#!/usr/bin/env python3
"""Safe JSON learning registry with explicit human approval and tier governance."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REGISTRY = REPO_ROOT / "config" / "agent_learning_registry.json"

SECRET_PATTERNS: list[tuple[re.Pattern[str], str | Callable[[re.Match[str]], str]]] = [
    (re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"), "sk-REDACTED"),
    (re.compile(r"\bntn_[A-Za-z0-9]{10,}\b"), "ntn_REDACTED"),
    (re.compile(r"\bghp_[A-Za-z0-9]{20,}\b"), "ghp_REDACTED"),
    (re.compile(r"\bAIza[0-9A-Za-z\-_]{30,}\b"), "AIzaREDACTED"),
    (re.compile(r"(?i)\b(authorization)\s*:\s*bearer\s+[A-Za-z0-9._\-]+"), r"\1: bearer REDACTED"),
    (
        re.compile(r"(?i)\b(api[_-]?key|token|secret|password)\s*[:=]\s*([^\s,;]+)"),
        lambda m: f"{m.group(1)}=REDACTED",
    ),
]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_utc(ts: str | None) -> datetime | None:
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def load_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def sanitize(text: str) -> str:
    output = (text or "").strip()
    for pattern, replacement in SECRET_PATTERNS:
        output = pattern.sub(replacement, output)
    return output


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def resolve_policy_path(registry: dict[str, Any], registry_path: Path, key: str, default_rel: str) -> Path:
    rel = registry.get("policy", {}).get(key, default_rel)
    path = Path(rel)
    if path.is_absolute():
        return path
    return registry_path.parent.parent / path


def load_registry(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Registry not found: {path}")
    registry = json.loads(path.read_text(encoding="utf-8"))
    if "approved_learnings" not in registry or "policy" not in registry:
        raise SystemExit(f"Invalid registry format: {path}")
    return registry


def load_queue(path: Path) -> dict[str, Any]:
    default_queue = {"schema_version": 1, "updated_at": utc_now(), "proposals": []}
    queue = load_json(path, default_queue)
    if "proposals" not in queue:
        queue = default_queue
    return queue


def load_tier_change_queue(path: Path) -> dict[str, Any]:
    default_queue = {"schema_version": 1, "updated_at": utc_now(), "changes": []}
    queue = load_json(path, default_queue)
    if "changes" not in queue:
        queue = default_queue
    return queue


def append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=True) + "\n")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def next_learning_id(registry: dict[str, Any]) -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    prefix = f"L-{today}-"
    same_day = [x for x in registry["approved_learnings"] if str(x.get("id", "")).startswith(prefix)]
    return f"{prefix}{len(same_day) + 1:04d}"


def find_learning(registry: dict[str, Any], learning_id: str) -> dict[str, Any] | None:
    for item in registry["approved_learnings"]:
        if item.get("id") == learning_id:
            return item
    return None


def cmd_propose(args: argparse.Namespace) -> int:
    registry_path = Path(args.registry).resolve()
    registry = load_registry(registry_path)
    queue_path = resolve_policy_path(registry, registry_path, "proposal_queue_file", "memory/raw/proposed_learnings.json")
    queue = load_queue(queue_path)

    pending_count = sum(1 for p in queue["proposals"] if p.get("status") == "pending")
    max_proposals = int(registry["policy"].get("max_proposals_per_day", 20))
    if pending_count >= max_proposals:
        raise SystemExit(f"Too many pending proposals ({pending_count}/{max_proposals}). Review first.")

    risk_scores = {"low": 0.2, "medium": 0.5, "high": 0.8, "critical": 0.95}
    raw_source = args.raw_source or args.statement
    proposal = {
        "id": f"P-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}",
        "title": sanitize(args.title),
        "statement": sanitize(args.statement),
        "rationale": sanitize(args.rationale or ""),
        "source": sanitize(args.source or "manual"),
        "source_ref": sanitize(args.source_ref or "manual"),
        "provenance_hash": sha256_hex(raw_source),
        "author": sanitize(args.author or "agent"),
        "risk": args.risk,
        "risk_score": risk_scores[args.risk],
        "status": "pending",
        "created_at": utc_now(),
        "human_review_required": True,
    }
    queue["proposals"].append(proposal)
    queue["updated_at"] = utc_now()
    save_json(queue_path, queue)
    print(f"Proposed learning {proposal['id']}")
    print(f"Queue file: {queue_path}")
    return 0


def cmd_list_pending(args: argparse.Namespace) -> int:
    registry_path = Path(args.registry).resolve()
    registry = load_registry(registry_path)
    queue_path = resolve_policy_path(registry, registry_path, "proposal_queue_file", "memory/raw/proposed_learnings.json")
    queue = load_queue(queue_path)
    pending = [p for p in queue["proposals"] if p.get("status") == "pending"]
    if args.json:
        print(json.dumps(pending, indent=2))
        return 0
    if not pending:
        print("No pending learning proposals.")
        return 0
    for p in pending:
        print(f"{p['id']} | {p['risk']} | {p['title']}")
    return 0


def cmd_list_approved(args: argparse.Namespace) -> int:
    registry = load_registry(Path(args.registry).resolve())
    approved = registry["approved_learnings"]
    if args.json:
        print(json.dumps(approved, indent=2))
        return 0
    for item in approved:
        print(f"{item.get('id')} | {item.get('tier', 'warm')} | {item.get('title')}")
    return 0


def cmd_approve(args: argparse.Namespace) -> int:
    registry_path = Path(args.registry).resolve()
    registry = load_registry(registry_path)
    queue_path = resolve_policy_path(registry, registry_path, "proposal_queue_file", "memory/raw/proposed_learnings.json")
    queue = load_queue(queue_path)

    target = None
    for p in queue["proposals"]:
        if p.get("id") == args.proposal_id:
            target = p
            break
    if target is None:
        raise SystemExit(f"Proposal not found: {args.proposal_id}")
    if target.get("status") != "pending":
        raise SystemExit(f"Proposal is not pending: {args.proposal_id}")

    learning = {
        "id": next_learning_id(registry),
        "title": target.get("title", ""),
        "statement": target.get("statement", ""),
        "rationale": target.get("rationale", ""),
        "source": target.get("source", ""),
        "source_ref": target.get("source_ref", ""),
        "provenance_hash": target.get("provenance_hash", ""),
        "risk_score": target.get("risk_score", 0.5),
        "added_on": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "approved_by": sanitize(args.approved_by),
        "tier": args.tier,
        "use_count_total": 0,
        "last_used_at": None,
    }
    registry["approved_learnings"].append(learning)
    registry["updated_at"] = utc_now()

    target["status"] = "approved"
    target["approved_at"] = utc_now()
    target["approved_by"] = sanitize(args.approved_by)
    queue["updated_at"] = utc_now()

    save_json(registry_path, registry)
    save_json(queue_path, queue)
    print(f"Approved proposal {args.proposal_id} as {learning['id']} ({args.tier})")
    return 0


def cmd_reject(args: argparse.Namespace) -> int:
    registry_path = Path(args.registry).resolve()
    registry = load_registry(registry_path)
    queue_path = resolve_policy_path(registry, registry_path, "proposal_queue_file", "memory/raw/proposed_learnings.json")
    queue = load_queue(queue_path)
    for p in queue["proposals"]:
        if p.get("id") == args.proposal_id:
            if p.get("status") != "pending":
                raise SystemExit(f"Proposal is not pending: {args.proposal_id}")
            p["status"] = "rejected"
            p["rejected_at"] = utc_now()
            p["rejected_by"] = sanitize(args.rejected_by)
            p["rejection_reason"] = sanitize(args.reason or "")
            queue["updated_at"] = utc_now()
            save_json(queue_path, queue)
            print(f"Rejected proposal {args.proposal_id}")
            return 0
    raise SystemExit(f"Proposal not found: {args.proposal_id}")


def cmd_record_use(args: argparse.Namespace) -> int:
    registry_path = Path(args.registry).resolve()
    registry = load_registry(registry_path)
    usage_events_path = resolve_policy_path(registry, registry_path, "usage_events_file", "memory/raw/learning_usage_events.jsonl")
    learning = find_learning(registry, args.learning_id)
    if learning is None:
        raise SystemExit(f"Learning not found: {args.learning_id}")

    learning["use_count_total"] = int(learning.get("use_count_total", 0)) + 1
    learning["last_used_at"] = utc_now()
    registry["updated_at"] = utc_now()
    save_json(registry_path, registry)

    append_jsonl(
        usage_events_path,
        {
            "learning_id": args.learning_id,
            "source": sanitize(args.source or "manual"),
            "timestamp": utc_now(),
        },
    )
    print(f"Recorded use for {args.learning_id}")
    return 0


def _build_tier_change(learning_id: str, from_tier: str, to_tier: str, reason: str) -> dict[str, Any]:
    return {
        "id": f"TC-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}",
        "learning_id": learning_id,
        "from_tier": from_tier,
        "to_tier": to_tier,
        "reason": reason,
        "status": "pending",
        "created_at": utc_now(),
    }


def cmd_suggest_tier_changes(args: argparse.Namespace) -> int:
    registry_path = Path(args.registry).resolve()
    registry = load_registry(registry_path)
    usage_events_path = resolve_policy_path(registry, registry_path, "usage_events_file", "memory/raw/learning_usage_events.jsonl")
    tier_queue_path = resolve_policy_path(
        registry,
        registry_path,
        "tier_change_queue_file",
        "memory/raw/pending_tier_changes.json",
    )
    tier_queue = load_tier_change_queue(tier_queue_path)
    events = load_jsonl(usage_events_path)
    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=7)

    rules = registry.get("policy", {}).get("promotion_rules", {})
    warm_to_hot_min_uses_7d = int(rules.get("warm_to_hot_min_uses_7d", 3))
    hot_to_warm_inactive_days = int(rules.get("hot_to_warm_inactive_days", 30))
    warm_to_cold_inactive_days = int(rules.get("warm_to_cold_inactive_days", 90))

    pending_by_learning = {
        c.get("learning_id")
        for c in tier_queue["changes"]
        if c.get("status") == "pending"
    }
    added = 0

    for learning in registry["approved_learnings"]:
        learning_id = str(learning.get("id", ""))
        if not learning_id or learning_id in pending_by_learning:
            continue

        tier = str(learning.get("tier", "warm"))
        last_used = parse_utc(learning.get("last_used_at"))
        inactivity_days = (now - last_used).days if last_used else 9999

        uses_7d = 0
        for ev in events:
            if ev.get("learning_id") != learning_id:
                continue
            ev_ts = parse_utc(ev.get("timestamp"))
            if ev_ts and ev_ts >= seven_days_ago:
                uses_7d += 1

        if tier == "warm" and uses_7d >= warm_to_hot_min_uses_7d:
            tier_queue["changes"].append(
                _build_tier_change(
                    learning_id,
                    "warm",
                    "hot",
                    f"{uses_7d} uses in last 7d (threshold={warm_to_hot_min_uses_7d})",
                )
            )
            added += 1
            continue
        if tier == "hot" and inactivity_days >= hot_to_warm_inactive_days:
            tier_queue["changes"].append(
                _build_tier_change(
                    learning_id,
                    "hot",
                    "warm",
                    f"inactive {inactivity_days}d (threshold={hot_to_warm_inactive_days})",
                )
            )
            added += 1
            continue
        if tier == "warm" and inactivity_days >= warm_to_cold_inactive_days:
            tier_queue["changes"].append(
                _build_tier_change(
                    learning_id,
                    "warm",
                    "cold",
                    f"inactive {inactivity_days}d (threshold={warm_to_cold_inactive_days})",
                )
            )
            added += 1
            continue

    tier_queue["updated_at"] = utc_now()
    save_json(tier_queue_path, tier_queue)
    print(f"Suggested {added} tier change(s)")
    print(f"Tier queue file: {tier_queue_path}")
    return 0


def cmd_list_tier_changes(args: argparse.Namespace) -> int:
    registry_path = Path(args.registry).resolve()
    registry = load_registry(registry_path)
    tier_queue_path = resolve_policy_path(
        registry,
        registry_path,
        "tier_change_queue_file",
        "memory/raw/pending_tier_changes.json",
    )
    tier_queue = load_tier_change_queue(tier_queue_path)
    changes = tier_queue["changes"]
    if not args.all:
        changes = [c for c in changes if c.get("status") == "pending"]
    if args.json:
        print(json.dumps(changes, indent=2))
        return 0
    if not changes:
        print("No tier changes.")
        return 0
    for c in changes:
        print(
            f"{c.get('id')} | {c.get('status')} | "
            f"{c.get('learning_id')} {c.get('from_tier')}->{c.get('to_tier')} | {c.get('reason')}"
        )
    return 0


def cmd_apply_tier_change(args: argparse.Namespace) -> int:
    registry_path = Path(args.registry).resolve()
    registry = load_registry(registry_path)
    tier_queue_path = resolve_policy_path(
        registry,
        registry_path,
        "tier_change_queue_file",
        "memory/raw/pending_tier_changes.json",
    )
    tier_queue = load_tier_change_queue(tier_queue_path)

    change = None
    for c in tier_queue["changes"]:
        if c.get("id") == args.change_id:
            change = c
            break
    if change is None:
        raise SystemExit(f"Tier change not found: {args.change_id}")
    if change.get("status") != "pending":
        raise SystemExit(f"Tier change is not pending: {args.change_id}")

    learning = find_learning(registry, str(change.get("learning_id")))
    if learning is None:
        raise SystemExit(f"Learning not found: {change.get('learning_id')}")

    from_tier = str(change.get("from_tier"))
    to_tier = str(change.get("to_tier"))
    current_tier = str(learning.get("tier", "warm"))
    if current_tier != from_tier:
        raise SystemExit(
            f"Tier mismatch for {learning.get('id')}: expected {from_tier}, found {current_tier}. "
            "Refuse to auto-correct."
        )

    learning["tier"] = to_tier
    learning["last_tier_change_at"] = utc_now()
    registry["updated_at"] = utc_now()

    change["status"] = "approved"
    change["approved_by"] = sanitize(args.approved_by)
    change["approved_at"] = utc_now()
    tier_queue["updated_at"] = utc_now()

    save_json(registry_path, registry)
    save_json(tier_queue_path, tier_queue)
    print(f"Applied tier change {args.change_id}: {learning.get('id')} {from_tier}->{to_tier}")
    return 0


def cmd_reject_tier_change(args: argparse.Namespace) -> int:
    registry_path = Path(args.registry).resolve()
    registry = load_registry(registry_path)
    tier_queue_path = resolve_policy_path(
        registry,
        registry_path,
        "tier_change_queue_file",
        "memory/raw/pending_tier_changes.json",
    )
    tier_queue = load_tier_change_queue(tier_queue_path)

    for change in tier_queue["changes"]:
        if change.get("id") == args.change_id:
            if change.get("status") != "pending":
                raise SystemExit(f"Tier change is not pending: {args.change_id}")
            change["status"] = "rejected"
            change["rejected_by"] = sanitize(args.rejected_by)
            change["rejected_at"] = utc_now()
            change["rejection_reason"] = sanitize(args.reason or "")
            tier_queue["updated_at"] = utc_now()
            save_json(tier_queue_path, tier_queue)
            print(f"Rejected tier change {args.change_id}")
            return 0
    raise SystemExit(f"Tier change not found: {args.change_id}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage safe JSON learning registry.")
    parser.add_argument(
        "--registry",
        default=str(DEFAULT_REGISTRY),
        help="Path to registry JSON (default: config/agent_learning_registry.json)",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    propose = sub.add_parser("propose", help="Create a pending learning proposal.")
    propose.add_argument("--title", required=True)
    propose.add_argument("--statement", required=True)
    propose.add_argument("--rationale")
    propose.add_argument("--source")
    propose.add_argument("--source-ref", help="Stable source reference (turn ID, URL hash, etc).")
    propose.add_argument("--raw-source", help="Raw source text to hash for provenance.")
    propose.add_argument("--author")
    propose.add_argument("--risk", choices=["low", "medium", "high", "critical"], default="medium")
    propose.set_defaults(func=cmd_propose)

    pending = sub.add_parser("list-pending", help="List pending proposals.")
    pending.add_argument("--json", action="store_true")
    pending.set_defaults(func=cmd_list_pending)

    approved = sub.add_parser("list-approved", help="List approved learnings.")
    approved.add_argument("--json", action="store_true")
    approved.set_defaults(func=cmd_list_approved)

    approve = sub.add_parser("approve", help="Approve one pending proposal.")
    approve.add_argument("proposal_id")
    approve.add_argument("--approved-by", required=True)
    approve.add_argument("--tier", choices=["hot", "warm", "cold"], default="warm")
    approve.set_defaults(func=cmd_approve)

    reject = sub.add_parser("reject", help="Reject one pending proposal.")
    reject.add_argument("proposal_id")
    reject.add_argument("--rejected-by", required=True)
    reject.add_argument("--reason")
    reject.set_defaults(func=cmd_reject)

    record_use = sub.add_parser("record-use", help="Record one successful use of an approved learning.")
    record_use.add_argument("learning_id")
    record_use.add_argument("--source")
    record_use.set_defaults(func=cmd_record_use)

    suggest_tier = sub.add_parser("suggest-tier-changes", help="Suggest tier changes from usage/inactivity.")
    suggest_tier.set_defaults(func=cmd_suggest_tier_changes)

    list_tier = sub.add_parser("list-tier-changes", help="List pending tier change proposals.")
    list_tier.add_argument("--all", action="store_true", help="Include non-pending changes.")
    list_tier.add_argument("--json", action="store_true")
    list_tier.set_defaults(func=cmd_list_tier_changes)

    apply_tier = sub.add_parser("apply-tier-change", help="Apply one pending tier change after human review.")
    apply_tier.add_argument("change_id")
    apply_tier.add_argument("--approved-by", required=True)
    apply_tier.set_defaults(func=cmd_apply_tier_change)

    reject_tier = sub.add_parser("reject-tier-change", help="Reject one pending tier change.")
    reject_tier.add_argument("change_id")
    reject_tier.add_argument("--rejected-by", required=True)
    reject_tier.add_argument("--reason")
    reject_tier.set_defaults(func=cmd_reject_tier_change)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
