# 🚀 Email Master: Start-Up Guide

Follow these steps to get your AI Executive Assistant live and protecting your inbox.

---

## Phase 1: Notion Database Setup
Create a new **Database** in Notion and add these exact properties:

1.  **Name** (Title): The email subject.
2.  **Status** (Select): Options: `Not Started`, `In Progress`, `Completed`.
3.  **Priority** (Select): Options: `High (Investor)`, `Medium`, `Low`.
4.  **Sender** (Email): The sender's email address.
5.  **Core Request** (Text): The AI's summary of what is needed.
6.  **Deadline** (Date): Any deadline extracted by the AI.
7.  **Original Link** (URL): Link back to the Outlook email.

---

## Phase 2: n8n Workflow Import
1.  **Open n8n:** Go to `http://localhost:5678`.
2.  **Import Triage:** Go to **Workflows > Import from File** and select `n8n-workflows/triage-outlook-to-notion.json`.
    - **Connect Outlook:** Click the "Microsoft 365 Email" node and add your credentials.
    - **Connect OpenAI:** Click the "AI Triage" node and add your OpenAI credential.
    - **Connect Notion:** Click the "Add to Notion" node and select your new database.
3.  **Import Nag:** Repeat for `n8n-workflows/daily-investor-nag.json`.

---

## Phase 3: OpenClaw (Moltbot) Persona
1.  **Open OpenClaw UI:** Go to `http://localhost:18789`.
2.  **Configure Agent:** Copy the content of `openclaw-configs/AGENTS.md` into your agent's system prompt or `AGENTS.md` file.
3.  **Enable Outlook Skill:** Ensure the `outlook-skill` is installed so the agent can draft replies.

---

## Phase 4: Launching the Secure Stack
Open your terminal in the project directory and run:

```bash
# 1. Initialize folders and .env (already populated with your keys)
chmod +x docker-setup.sh verify-stack.sh
./docker-setup.sh

# 2. Start the isolated containers
docker compose up -d

# 3. Verify the connection
./verify-stack.sh
```

If you previously used a host folder at `./ollama_data`, you can archive or remove it after confirming you no longer need that local model cache. The stack now uses a named Docker volume for Ollama state.

---

## Phase 5: Connecting the "Nag" Overlay
To see the proactive reminders on your screen:
1.  Open your **OpenClaw Desktop App** (Moltbot overlay).
2.  Go to **Settings > Gateway** and choose **"Custom Gateway"**.
3.  Set URL to: `http://localhost:18789`.
4.  Get your token: `docker exec email-master-openclaw openclaw token`.
5.  Paste the token into the Desktop App.

---

## 🛡 Security Reminder
- Your AI agent is **isolated** and cannot see files outside of `openclaw_workspace/`.
- The assistant is configured to **Draft Only**. You must hit "Send" in Outlook yourself.
