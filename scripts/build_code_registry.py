#!/usr/bin/env python3
"""Build a lightweight code catalog artifact for audit tooling."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Build code catalog")
    parser.add_argument("--project-root", default=".", help="Project root to scan")
    parser.add_argument("--out", default="data/code_catalog.json", help="Output catalog path")
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    out_path = (root / args.out).resolve()

    entries: list[dict[str, object]] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if rel.startswith((".git/", "node_modules/", "ollama_data/", "openclaw_config/")):
            continue
        if rel.endswith((".py", ".js", ".mjs", ".sh", ".json", ".md", ".yml", ".yaml")):
            entries.append(
                {
                    "path": rel,
                    "size_bytes": path.stat().st_size,
                }
            )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "project_root": root.as_posix(),
        "file_count": len(entries),
        "files": sorted(entries, key=lambda item: str(item["path"])),
    }
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote code catalog: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
