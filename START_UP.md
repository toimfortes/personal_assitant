# 🚀 Email Master: Start-Up Guide (2026 RTX 3090 Edition)

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
2.  **Import Triage:** Import `n8n-workflows/triage-outlook-to-notion.json`.
3.  **Import Nag:** Import `n8n-workflows/daily-investor-nag.json`.

---

## Phase 3: OpenClaw (Moltbot) Persona
1.  **Open OpenClaw UI:** Go to `http://localhost:18789`.
2.  **Configure Agent:** Copy `openclaw-configs/AGENTS.md` into your agent's persona.
3.  **Enable Outlook Skill:** Ensure the `outlook-skill` is installed.

---

## Phase 4: Launching the Secure Stack
Open your terminal in the project directory and run:

```bash
# 1. Initialize folders and .env
chmod +x docker-setup.sh verify-stack.sh
./docker-setup.sh

# 2. Start the isolated containers
docker compose up -d

# 3. Verify the connection
./verify-stack.sh
```

---

## Phase 5: Local Models (Ollama for 3090)
The system is optimized for your **RTX 3090 (24GB VRAM)**. 

### 1. Pull the 2026 Recommended Stack:
```bash
# Optimal reasoning brain for 3090 (27B Dense)
docker exec -it email-master-ollama ollama pull qwen3.5:27b

# Fast reasoning & tool-use expert (30B Flash)
docker exec -it email-master-ollama ollama pull glm-4.7-flash

# Background triage specialist
docker exec -it email-master-ollama ollama pull llama3.1:8b
```

---

## 🛡 Security Reminder
- Your AI agent is **isolated** and cannot see files outside of `openclaw_workspace/`.
- The assistant is configured to **Draft Only**. You must hit "Send" in Outlook yourself.
