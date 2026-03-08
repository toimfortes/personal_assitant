# Gemini CLI Project Log: Email Master

## Bash Output Safety (CRITICAL - Prevents OOM Crashes)
Running long-running or verbose scripts directly causes V8 "invalid array length" crashes
and JavaScript heap out-of-memory errors that kill the agent process.

### Rules:
- NEVER run verbose or long-running scripts as background tasks
- ALWAYS redirect output to a temp file when running scripts that produce more than ~50 lines:
  ```bash
  node scripts/check-n8n.mjs > /tmp/check-n8n.log 2>&1
  ```
  Then read the log file to inspect results.
- For scripts that poll, loop, or stream output, always redirect to file
- When running docker, n8n, or any service commands, cap output with `| head -100` or redirect to file
- Prefer `--quiet` or `--silent` flags on CLI tools when available

## 🎯 Goal
Build an AI-powered system to triage investor emails, sync them to Notion, and provide daily reminders through a persistent AI overlay (OpenClaw/Moltbot).

## 🏗 Implemented Architecture

### 1. Inbound Triage (n8n)
- **File:** `n8n-workflows/triage-outlook-to-notion.json`
- **Logic:** Polls Outlook -> AI Classification -> Add to Notion.
- **Action Required:** User must import this into n8n and set up Microsoft 365 (or Gmail) and Notion credentials. AI triage is local via Ollama.
- **Gmail Variant:** `n8n-workflows/triage-gmail-to-notion.json` (recommended for Gmail inboxes).

### 2. Daily Reminders (n8n)
- **File:** `n8n-workflows/daily-investor-nag.json`
- **Logic:** Scheduled query of Notion -> Proactive Webhook to OpenClaw.
- **Action Required:** User must import this into n8n and set the Notion Database ID.

### 3. Live Assistant Persona (OpenClaw)
- **File:** `openclaw-configs/AGENTS.md`
- **Logic:** System prompt for OpenClaw to handle the "Nag," suggest answers, and manage the overlay.
- **Action Required:** User should copy this content into their OpenClaw `AGENTS.md` or system prompt settings.

## 🛠 Next Steps for User
1. **Notion Setup:** Create a database with the properties listed in `README.md`.
2. **n8n Credentials:** Set up OAuth for Gmail (or Outlook) and Notion in n8n.
3. **OpenClaw (Moltbot) Installation:** Install OpenClaw and enable the `outlook-skill`.
4. **Integration:** Connect n8n to OpenClaw via the local webhook URL.

## 🛡 Safety Guidelines
- **Draft Only:** OpenClaw is configured to only *draft* replies, never send them.
- **Read-Only Outlook:** When setting up n8n, prefer read-only permissions for the triage phase.
