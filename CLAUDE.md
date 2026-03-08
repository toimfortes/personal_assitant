# Project Instructions

## Bash Output Safety
- NEVER run long-running or verbose scripts as background bash tasks
- Always redirect verbose script output to a temp file: `cmd > /tmp/output.log 2>&1`
- Then read the log file to inspect results
- For scripts that poll or loop (like check-n8n.mjs), always run in foreground with output capped or redirected
