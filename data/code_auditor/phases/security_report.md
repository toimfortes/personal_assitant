# Audit Phase: security

- Target: `.`
- Findings: 10
- Duration: 423ms

## Findings (Top 50)

- **high** `./scripts/migrate_notion_data_source.py:60` (B310): Audit url open for permitted schemes. Allowing use of file:/ or custom schemes is often unexpected.
- **high** `./scripts/repair-outlook-backfill-senders.py:58` (B310): Audit url open for permitted schemes. Allowing use of file:/ or custom schemes is often unexpected.
- **high** `./scripts/repair-outlook-backfill-senders.py:72` (B310): Audit url open for permitted schemes. Allowing use of file:/ or custom schemes is often unexpected.
- **high** `./scripts/repair-outlook-backfill-senders.py:116` (B310): Audit url open for permitted schemes. Allowing use of file:/ or custom schemes is often unexpected.
- **high** `./scripts/repair-outlook-backfill-triage.py:339` (B310): Audit url open for permitted schemes. Allowing use of file:/ or custom schemes is often unexpected.
- **high** `./scripts/repair-outlook-backfill-triage.py:413` (B310): Audit url open for permitted schemes. Allowing use of file:/ or custom schemes is often unexpected.
- **high** `./scripts/repair-outlook-backfill-triage.py:420` (B310): Audit url open for permitted schemes. Allowing use of file:/ or custom schemes is often unexpected.
- **high** `./scripts/repair-outlook-backfill-triage.py:430` (B310): Audit url open for permitted schemes. Allowing use of file:/ or custom schemes is often unexpected.
- **high** `./scripts/repair-outlook-backfill-triage.py:528` (B108): Probable insecure usage of temp file/directory.
- **high** `./scripts/set_triage_feedback.py:36` (B310): Audit url open for permitted schemes. Allowing use of file:/ or custom schemes is often unexpected.
