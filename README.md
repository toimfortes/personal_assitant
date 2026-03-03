# Email Master: The AI Executive Assistant Stack

This system is designed to ensure you never miss a critical investor email and stay on top of your tasks through a persistent AI overlay.

## 🏗 Architecture Overview

1. **Inbound Filter (n8n Backend):**
   - **Trigger:** Polls Microsoft 365 Outlook every 5 minutes.
   - **Processor:** AI Triage (GPT-4o/Claude 3.5).
   - **Logic:** Identifies "Investor" or "Urgent Business" emails based on sender domain and context.
   - **Storage:** Creates a "Task" in your **Notion** "Investor Communications" database.

2. **Daily Nag (n8n Backend):**
   - **Trigger:** Scheduled (Daily 8 AM / 4 PM).
   - **Query:** Finds uncompleted tasks in Notion where `Tag = [INVESTOR]`.
   - **Action:** Triggers a proactive message in the **OpenClaw (Moltbot)** overlay.

3. **Live Assistant (OpenClaw Overlay):**
   - **Interface:** Persistent desktop overlay for real-time interaction.
   - **Capabilities:**
     - Summarize unread investor emails on demand.
     - Draft replies directly into your Outlook "Drafts" folder.
     - Provide proactive reminders ("Hey, you still haven't replied to [Investor]...").

---

## 🚀 Setup Instructions

### 1. Notion Database
Create a database in Notion with the following properties:
- **Title (Name):** Subject of the email.
- **Status (Select):** Not Started, In Progress, Completed.
- **Priority (Select):** High (Investor), Medium, Low.
- **Sender (Email):** The email address of the sender.
- **Core Request (Text):** AI-extracted summary of what is needed.
- **Deadline (Date):** Extracted or inferred deadline.
- **Original Link (URL):** Link to the email in Outlook.

### 2. n8n Workflows
Import the workflows from the `n8n-workflows/` directory:
- `triage-outlook-to-notion.json`: Connects Outlook to Notion via AI classification.
- `daily-investor-nag.json`: Schedules daily reminders via OpenClaw.

### 3. OpenClaw (Moltbot) Configuration
1. **Install OpenClaw:** Follow the [official installation guide](https://openclaw.ai/install.sh).
2. **Enable Outlook Skill:**
   - Create an app in [Azure Portal](https://portal.azure.com/) with `Mail.ReadWrite` and `Mail.Send` permissions.
   - Add `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET` to your OpenClaw environment.
3. **Configure Proactive Webhook:**
   - In OpenClaw's `AGENTS.md`, add: *"You will receive incoming messages via webhook from n8n. When you do, present them as a proactive notification in the overlay."*

### 4. Connect the Desktop Overlay (Moltbot UI)
To get the "Persistent Overlay" working with your container:
1.  **Open your OpenClaw Desktop App** (or Moltbot overlay).
2.  Go to **Settings > Gateway**.
3.  Change the Connection Type to **"Custom Gateway"**.
4.  Enter the URL: `http://localhost:18789`.
5.  **Enter your Gateway Token:** You can find this by running `docker exec email-master-openclaw openclaw token`.
6.  The overlay will now "wake up" whenever n8n triggers the nag workflow!

### 5. Git-Safe Repo Initialization
If you want to initialize this directory as a git repository:

```bash
git init
git add .
git commit -m "Initial commit: Email Master stack"
```

This repo now includes `.gitignore` rules so local runtime state and secrets stay untracked (`.env`, `openclaw_config/`, `openclaw_workspace/`, `ollama_data/`).

---

## 🛠 Troubleshooting
If n8n cannot talk to OpenClaw, run `./verify-stack.sh` to diagnose network issues.

- **Read-Only First:** When setting up n8n, use a scoped API key that only has access to the "Investor Communications" database in Notion.
- **Draft Mode:** Configure OpenClaw to **draft** replies rather than sending them. You should always review drafts before they go out.
- **Local Isolation:** Run OpenClaw in a Docker container or dedicated VM if possible.
- **Ollama Data Location:** Compose now uses a named Docker volume for Ollama (`ollama_data`) instead of `./ollama_data`. If you have an old `./ollama_data` folder from a previous setup, it can be deleted once you're sure you no longer need it.
