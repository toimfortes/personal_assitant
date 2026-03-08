#!/usr/bin/env python3
"""Local static risk scan for third-party OpenClaw skills before install."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

RULES: list[dict[str, str]] = [
    {"id": "loader.curl_pipe_sh", "severity": "high", "pattern": r"curl\s+[^|]+\|\s*(bash|sh)\b"},
    {"id": "loader.wget_pipe_sh", "severity": "high", "pattern": r"wget\s+[^|]+\|\s*(bash|sh)\b"},
    {"id": "exec.eval", "severity": "high", "pattern": r"\b(eval|exec)\s*\("},
    {"id": "persistence.cron", "severity": "high", "pattern": r"\b(crontab|/etc/cron\.|systemctl\s+enable)\b"},
    {"id": "secret.ssh_key", "severity": "high", "pattern": r"\.ssh/(id_rsa|id_ed25519|known_hosts)"},
    {"id": "secret.env_harvest", "severity": "high", "pattern": r"\b(process\.env|printenv|env\s*\|)"},
    {"id": "network.exfil_webhook", "severity": "medium", "pattern": r"\b(webhook|discord\.com/api/webhooks|pastebin|ngrok)\b"},
    {"id": "obfuscation.base64_exec", "severity": "high", "pattern": r"base64\s+(-d|--decode).*(bash|sh)"},
    {"id": "destructive.rm_rf", "severity": "high", "pattern": r"\brm\s+-rf\b"},
]

TEXT_EXTS = {".md", ".sh", ".bash", ".zsh", ".py", ".js", ".ts", ".json", ".yaml", ".yml", ".txt"}


def iter_files(root: Path) -> list[Path]:
    if root.is_file():
        return [root]
    paths: list[Path] = []
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() in TEXT_EXTS or p.name in {"SKILL.md", "AGENTS.md"}:
            paths.append(p)
    return paths


def scan_text(path: Path, text: str) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for rule in RULES:
        pat = re.compile(rule["pattern"], re.IGNORECASE | re.MULTILINE)
        for m in pat.finditer(text):
            lineno = text.count("\n", 0, m.start()) + 1
            findings.append(
                {
                    "rule_id": rule["id"],
                    "severity": rule["severity"],
                    "file": str(path),
                    "line": lineno,
                    "match": m.group(0)[:160],
                }
            )
    return findings


def summarize(findings: list[dict[str, Any]]) -> dict[str, int]:
    out = {"high": 0, "medium": 0, "low": 0}
    for f in findings:
        sev = f.get("severity", "low")
        out[sev] = out.get(sev, 0) + 1
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Static risk scan for OpenClaw skill files.")
    parser.add_argument("path", help="Path to skill directory or file")
    parser.add_argument("--json", action="store_true", help="Emit JSON output")
    parser.add_argument(
        "--fail-on",
        choices=["high", "medium", "never"],
        default="high",
        help="Exit non-zero on selected severity or above",
    )
    args = parser.parse_args()

    target = Path(args.path).resolve()
    if not target.exists():
        raise SystemExit(f"Path not found: {target}")

    findings: list[dict[str, Any]] = []
    for p in iter_files(target):
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        findings.extend(scan_text(p, text))

    counts = summarize(findings)
    result = {
        "target": str(target),
        "counts": counts,
        "findings": findings,
        "verdict": "pass" if counts["high"] == 0 and (args.fail_on == "never" or counts["medium"] == 0 or args.fail_on == "high") else "fail",
    }

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Target: {result['target']}")
        print(f"Findings: high={counts['high']} medium={counts['medium']} low={counts['low']}")
        for f in findings[:40]:
            print(f"- {f['severity'].upper()} {f['rule_id']} {f['file']}:{f['line']} :: {f['match']}")
        if len(findings) > 40:
            print(f"... {len(findings) - 40} more finding(s)")

    if args.fail_on == "never":
        return 0
    if args.fail_on == "high" and counts["high"] > 0:
        return 2
    if args.fail_on == "medium" and (counts["high"] > 0 or counts["medium"] > 0):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
