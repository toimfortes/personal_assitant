#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import n8nConfig from "./n8n-script-config.cjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const MAILBOX_MAP_PATH = join(PROJECT_ROOT, "config", "mailbox_map.json");

const { N8N_URL, N8N_EMAIL: LOGIN_EMAIL, N8N_PASSWORD: LOGIN_PASSWORD } = n8nConfig;

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

const CLI = parseArgs(process.argv.slice(2));

function loadMailboxMap() {
  const raw = JSON.parse(readFileSync(MAILBOX_MAP_PATH, "utf8"));
  return [...(raw.gmail || []), ...(raw.outlook || [])];
}

async function jsonFetch(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${url}: ${JSON.stringify(data)}`);
  }
  return { resp, data };
}

async function login() {
  const { resp } = await jsonFetch(`${N8N_URL}/rest/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emailOrLdapLoginId: LOGIN_EMAIL,
      password: LOGIN_PASSWORD,
    }),
  });

  const cookie = (resp.headers.getSetCookie?.() || [])
    .map((value) => value.split(";", 1)[0])
    .find((value) => value.startsWith("n8n-auth="));

  if (!cookie) {
    throw new Error("n8n-auth cookie missing after login");
  }

  return cookie;
}

function injectMailbox(jsonBody, mailbox) {
  const mailboxSnippet = `Mailbox: { email: '${mailbox}' }, `;

  if (jsonBody.includes("Mailbox: { email:")) {
    return jsonBody.replace(/Mailbox: \{ email: '.*?' \},\s*/g, mailboxSnippet);
  }

  if (jsonBody.includes("'Sender Domain':")) {
    return jsonBody.replace(/('Sender Domain': \{[^}]+\}\s*,\s*)/, `$1${mailboxSnippet}`);
  }

  throw new Error("Could not find insertion point for Mailbox property");
}

async function patchWorkflow(cookie, workflowId, mailbox) {
  const { data: getPayload } = await jsonFetch(`${N8N_URL}/rest/workflows/${workflowId}`, {
    headers: { Cookie: cookie },
  });

  const workflow = getPayload.data;
  const node = workflow.nodes.find((entry) => entry.name === "Add to Notion");
  if (!node?.parameters?.jsonBody) {
    throw new Error(`Workflow ${workflowId} is missing Add to Notion jsonBody`);
  }

  const nextJsonBody = injectMailbox(node.parameters.jsonBody, mailbox);
  const changed = nextJsonBody !== node.parameters.jsonBody;
  if (!changed || CLI.dryRun) {
    return { workflowId, mailbox, changed, dryRun: CLI.dryRun };
  }

  node.parameters.jsonBody = nextJsonBody;

  const updatePayload = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings || {},
    staticData: workflow.staticData || null,
    pinData: workflow.pinData || {},
    versionId: workflow.versionId,
  };

  await jsonFetch(`${N8N_URL}/rest/workflows/${workflowId}`, {
    method: "PUT",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updatePayload),
  });

  return { workflowId, mailbox, changed, dryRun: false };
}

async function main() {
  const cookie = await login();
  const results = [];
  for (const row of loadMailboxMap()) {
    results.push(await patchWorkflow(cookie, row.workflow_id, row.mailbox));
  }
  console.log(JSON.stringify({ dryRun: CLI.dryRun, results }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
