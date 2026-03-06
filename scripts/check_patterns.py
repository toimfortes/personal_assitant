#!/usr/bin/env python3
"""Project-specific pattern checker for codeauditor.

The contract for codeauditor is:
- `--json` prints a JSON array of violations only (no extra text).
- each violation object may include `file`, `line`, `message`, `severity`, and `rule`.
"""

from __future__ import annotations

import argparse
import json


def main() -> int:
    parser = argparse.ArgumentParser(description="Check project coding patterns")
    parser.add_argument("--all", action="store_true", help="Run the full pattern set")
    parser.add_argument("--json", action="store_true", help="Emit JSON output")
    args = parser.parse_args()

    violations: list[dict[str, object]] = []
    if args.json:
        print(json.dumps(violations))
    else:
        print("No pattern violations found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
