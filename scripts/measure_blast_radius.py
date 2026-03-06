#!/usr/bin/env python3
"""Estimate blast radius for a set of changed files."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure blast radius from changed files")
    parser.add_argument("--catalog", default="data/code_catalog.json", help="Code catalog path")
    parser.add_argument("--changed", nargs="*", default=[], help="Changed file paths")
    parser.add_argument("--json", action="store_true", help="Emit JSON output")
    args = parser.parse_args()

    catalog_path = Path(args.catalog)
    changed = sorted(set(args.changed))
    result = {
        "catalog_path": catalog_path.as_posix(),
        "catalog_exists": catalog_path.exists(),
        "changed_files": changed,
        "impacted_files": changed,
        "impact_score": len(changed),
    }

    if args.json:
        print(json.dumps(result))
    else:
        print("Blast radius summary")
        print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
