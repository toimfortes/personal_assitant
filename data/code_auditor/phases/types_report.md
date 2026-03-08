# Audit Phase: types

- Target: `.`
- Findings: 35
- Duration: 2.6s

## Findings (Top 50)

- **high** `scripts/cleanup_outlook_feedback_categories.py:7` (import-untyped): Library stubs not installed for "requests"
- **high** `scripts/archive_newsletters.py:8` (import-untyped): Library stubs not installed for "requests"
- **high** `scripts/archive_newsletters.py:8`: Hint: "python3 -m pip install types-requests"
- **high** `scripts/archive_newsletters.py:8`: (or run "mypy --install-types" to install all missing stub packages)
- **high** `scripts/archive_newsletters.py:8`: See https://mypy.readthedocs.io/en/stable/running_mypy.html#missing-imports
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/run_instagram_recent_posts_capture.py:100` (call-overload): No overload variant of "int" matches argument type "object"
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/run_instagram_recent_posts_capture.py:100`: Possible overload variants:
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/run_instagram_recent_posts_capture.py:100`: def __new__(cls, str | Buffer | SupportsInt | SupportsIndex | SupportsTrunc = ..., /) -> int
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/run_instagram_recent_posts_capture.py:100`: def __new__(cls, str | bytes | bytearray, /, base: SupportsIndex) -> int
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:159` (call-overload): No overload variant of "list" matches argument type "object"
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:159`: Possible overload variants:
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:159`: def [_T] __init__(self) -> list[_T]
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:159`: def [_T] __init__(self, Iterable[_T], /) -> list[_T]
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:163` (call-overload): No overload variant of "list" matches argument type "object"
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:163`: Possible overload variants:
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:163`: def [_T] __init__(self) -> list[_T]
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:163`: def [_T] __init__(self, Iterable[_T], /) -> list[_T]
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:167` (call-overload): No overload variant of "list" matches argument type "object"
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:167`: Possible overload variants:
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:167`: def [_T] __init__(self) -> list[_T]
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:167`: def [_T] __init__(self, Iterable[_T], /) -> list[_T]
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:173` (index): Value of type "object" is not indexable
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:174` (index): Value of type "object" is not indexable
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:175` (index): Value of type "object" is not indexable
- **high** `openclaw_workspace/skills/browser-research-capture/scripts/parse_instagram_post_capture.py:176` (index): Value of type "object" is not indexable
- **high** `scripts/sync_email_review_queues.py:9` (import-untyped): Library stubs not installed for "requests"
- **high** `scripts/sync_email_review_queues.py:140` (dict-item): Dict entry 0 has incompatible type "str": "Any | None"; expected "str": "dict[str, str]"
- **high** `scripts/sync_email_review_queues.py:146` (dict-item): Dict entry 0 has incompatible type "str": "dict[str, str] | None"; expected "str": "dict[str, str]"
- **high** `scripts/repair-outlook-backfill-triage.py:563` (attr-defined): "object" has no attribute "append"
- **high** `scripts/repair-outlook-backfill-triage.py:581` (attr-defined): "object" has no attribute "append"
- **high** `scripts/repair-outlook-backfill-triage.py:591` (operator): Unsupported operand types for + ("object" and "int")
- **high** `scripts/repair-outlook-backfill-triage.py:592` (index): Unsupported target for indexed assignment ("object")
- **high** `scripts/repair-outlook-backfill-triage.py:592` (attr-defined): "object" has no attribute "get"
- **high** `scripts/repair-outlook-backfill-triage.py:594` (operator): Unsupported operand types for + ("object" and "int")
- **high** `scripts/repair-outlook-backfill-triage.py:596` (operator): Unsupported operand types for + ("object" and "int")
