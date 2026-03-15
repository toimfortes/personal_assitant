#!/usr/bin/env node
/**
 * Email Cleanup Actions
 * Executes cleanup actions: unsubscribe, create filter, bulk trash, add to spam rules.
 *
 * Usage:
 *   node scripts/email-cleanup-actions.mjs --action unsubscribe --sender "news@example.com" --account "cortexcerebral@gmail.com"
 *   node scripts/email-cleanup-actions.mjs --action block --sender "spam@example.com" --account "cortexcerebral@gmail.com"
 *   node scripts/email-cleanup-actions.mjs --action filter-skip-inbox --sender "updates@example.com" --account "cortexcerebral@gmail.com"
 *   node scripts/email-cleanup-actions.mjs --action trash-existing --sender "spam@example.com" --account "cortexcerebral@gmail.com"
 *
 * Actions:
 *   unsubscribe          - Send one-click unsubscribe POST (if available)
 *   block                - Create Gmail filter to auto-trash + trash existing + add to spam rules
 *   filter-skip-inbox    - Create Gmail filter to skip inbox (archive)
 *   trash-existing       - Bulk trash all existing emails from sender
 *   add-spam-rule        - Add sender/domain to config/triage_rules.csv spam list
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import n8nConfig from "./n8n-script-config.cjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const RULES_FILE = join(PROJECT_ROOT, "config", "triage_rules.csv");

const { N8N_URL, N8N_EMAIL, N8N_PASSWORD } = n8nConfig;

const ACCOUNTS = {
  "cortexcerebral@gmail.com": { id: "0YJAOX0ZGvKDcpAt", name: "Gmail account 1" },
  "antonio.maya.official@gmail.com": { id: "MrF40yK3dky3O7Cz", name: "Gmail account 2" },
  "antonioandmayaadventures@gmail.com": { id: "JaJpq3hIJWFJXv4S", name: "Gmail account 3" },
  "larissasrhsbparents@gmail.com": { id: "TEZwdWAZWeaN7IL1", name: "Gmail account 4" },
  "antonioforteslegal@gmail.com": { id: "Xhbgajo1Ghik9Uf8", name: "Gmail account 5" },
  "toimusa@gmail.com": { id: "PkoNf6XXZsGr9QVk", name: "Gmail account 6" },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { action: null, sender: null, account: null, domain: null, unsubUrl: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--action" && args[i + 1]) opts.action = args[++i];
    if (args[i] === "--sender" && args[i + 1]) opts.sender = args[++i].toLowerCase();
    if (args[i] === "--account" && args[i + 1]) opts.account = args[++i].toLowerCase();
    if (args[i] === "--domain" && args[i + 1]) opts.domain = args[++i].toLowerCase();
    if (args[i] === "--unsub-url" && args[i + 1]) opts.unsubUrl = args[++i];
    if (args[i] === "--dry-run") opts.dryRun = true;
  }
  if (!opts.domain && opts.sender) opts.domain = opts.sender.split("@")[1] || "";
  return opts;
}

async function getCookie() {
  const resp = await fetch(`${N8N_URL}/rest/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrLdapLoginId: N8N_EMAIL, password: N8N_PASSWORD }),
  });
  return resp.headers.getSetCookie()?.find((c) => c.startsWith("n8n-auth="))?.split(";")[0] || "";
}

async function runTempWorkflow(cookie, account, nodes, connections) {
  const wf = {
    name: `_temp_action_${Date.now()}`,
    nodes: [
      { parameters: {}, name: "Start", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [100, 300] },
      ...nodes,
    ],
    connections: { Start: { main: [[{ node: nodes[0].name, type: "main", index: 0 }]] }, ...connections },
    settings: {},
  };

  const createResp = await fetch(`${N8N_URL}/rest/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(wf),
  });
  const created = (await createResp.json()).data;

  try {
    const execResp = await fetch(`${N8N_URL}/rest/workflows/${created.id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ runData: {} }),
    });
    return (await execResp.json()).data;
  } finally {
    await fetch(`${N8N_URL}/rest/workflows/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
  }
}

async function unsubscribe(opts) {
  if (!opts.unsubUrl) {
    return { success: false, error: "No unsubscribe URL provided. Use --unsub-url" };
  }

  if (opts.dryRun) {
    return {
      success: true,
      dry_run: true,
      sender: opts.sender,
      action: "unsubscribe",
      message: `Would send one-click unsubscribe to ${opts.unsubUrl}`,
    };
  }

  try {
    const resp = await fetch(opts.unsubUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
      redirect: "follow",
    });
    return {
      success: resp.ok,
      status: resp.status,
      sender: opts.sender,
      action: "unsubscribe",
      message: resp.ok ? "One-click unsubscribe sent" : `HTTP ${resp.status}`,
    };
  } catch (e) {
    return { success: false, error: e.message, sender: opts.sender };
  }
}

async function createFilter(cookie, opts, filterAction) {
  const cred = ACCOUNTS[opts.account];
  if (!cred) {
    return { success: false, error: `Unknown account: ${opts.account}` };
  }

  const filterFrom = opts.sender || opts.domain;
  if (!filterFrom) {
    return { success: false, error: "Missing sender or domain for filter creation", account: opts.account };
  }

  // Build Gmail filter via n8n HTTP Request node
  const filterBody = {
    criteria: { from: filterFrom },
    action: filterAction,
  };

  if (opts.dryRun) {
    return {
      success: true,
      dry_run: true,
      sender: opts.sender || opts.domain,
      account: opts.account,
      action: filterAction.addLabelIds?.includes("TRASH") ? "block-filter" : "skip-inbox-filter",
      filterBody,
    };
  }

  const nodes = [
    {
      parameters: {
        method: "POST",
        url: "https://gmail.googleapis.com/gmail/v1/users/me/settings/filters",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "gmailOAuth2",
        sendBody: true,
        specifyBody: "json",
        jsonBody: JSON.stringify(filterBody),
        options: {},
      },
      name: "Create Filter",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4,
      position: [300, 300],
      credentials: { gmailOAuth2: { id: cred.id, name: cred.name } },
    },
  ];

  const result = await runTempWorkflow(cookie, opts.account, nodes, {});
  const rd = result?.resultData?.runData?.["Create Filter"]?.[0];
  const success = !rd?.error;
  return {
    success,
    sender: opts.sender,
    account: opts.account,
    action: filterAction.addLabelIds?.includes("TRASH") ? "block-filter" : "skip-inbox-filter",
    error: rd?.error?.message || null,
  };
}

async function trashExisting(cookie, opts) {
  const cred = ACCOUNTS[opts.account];
  if (!cred) {
    return { success: false, error: `Unknown account: ${opts.account}` };
  }

  const queryFrom = opts.sender || opts.domain;
  if (!queryFrom) {
    return { success: false, error: "Missing sender or domain for trash query", account: opts.account };
  }

  if (opts.dryRun) {
    return {
      success: true,
      dry_run: true,
      sender: opts.sender || opts.domain,
      account: opts.account,
      action: "trash-existing",
      query: `from:${queryFrom}`,
    };
  }

  const nodes = [
    {
      parameters: {
        operation: "getAll",
        returnAll: true,
        filters: { q: `from:${queryFrom}` },
        options: {},
      },
      name: "Find Emails",
      type: "n8n-nodes-base.gmail",
      typeVersion: 2,
      position: [300, 300],
      credentials: { gmailOAuth2: { id: cred.id, name: cred.name } },
    },
    {
      parameters: {
        jsCode: `const items = $input.all();
const ids = items.map(i => i.json.id).filter(Boolean);
if (ids.length === 0) return [{ json: { trashed: 0 } }];

// Batch trash via Gmail API
const batches = [];
for (let i = 0; i < ids.length; i += 1000) {
  batches.push(ids.slice(i, i + 1000));
}

let trashed = 0;
for (const batch of batches) {
  // Use batchModify to move to trash
  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + $credentials.gmailOAuth2?.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids: batch, addLabelIds: ['TRASH'], removeLabelIds: ['INBOX'] }),
  });
  if (resp.ok) trashed += batch.length;
}
return [{ json: { trashed, total: ids.length } }];`,
        mode: "runOnceForAllItems",
      },
      name: "Batch Trash",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [500, 300],
      credentials: { gmailOAuth2: { id: cred.id, name: cred.name } },
    },
  ];

  const connections = {
    "Find Emails": { main: [[{ node: "Batch Trash", type: "main", index: 0 }]] },
  };

  const result = await runTempWorkflow(cookie, opts.account, nodes, connections);
  const rd = result?.resultData?.runData?.["Batch Trash"]?.[0];
  const data = rd?.data?.main?.[0]?.[0]?.json || {};
  return {
    success: !rd?.error,
    sender: opts.sender || opts.domain,
    account: opts.account,
    action: "trash-existing",
    trashed: data.trashed || 0,
    total: data.total || 0,
    error: rd?.error?.message || null,
  };
}

function addSpamRule(opts) {
  const target = opts.domain || opts.sender;
  const type = opts.domain ? "spam_domain" : "spam_sender";
  const label = opts.sender || opts.domain;

  if (!existsSync(RULES_FILE)) {
    return { success: false, error: "Rules file not found: " + RULES_FILE };
  }

  if (opts.dryRun) {
    return {
      success: true,
      dry_run: true,
      action: "add-spam-rule",
      type,
      target,
      label,
    };
  }

  const content = readFileSync(RULES_FILE, "utf8");

  // Check if already exists
  if (content.includes(target)) {
    return { success: true, sender: target, action: "add-spam-rule", message: "Already in rules" };
  }

  // Append rule
  const newLine = `${type},${target},Auto-blocked via cleanup`;
  writeFileSync(RULES_FILE, content.trimEnd() + "\n" + newLine + "\n");
  return { success: true, sender: target, action: "add-spam-rule", message: `Added ${type}: ${target}` };
}

async function blockSender(cookie, opts) {
  // 1. Create auto-trash filter
  const filter = await createFilter(cookie, opts, { addLabelIds: ["TRASH"], removeLabelIds: ["INBOX"] });

  // 2. Trash existing emails
  const trash = await trashExisting(cookie, opts);

  // 3. Add to spam rules for future triage
  const rule = addSpamRule(opts);

  return {
    success: Boolean(filter?.success && trash?.success && rule?.success),
    action: "block",
    sender: opts.sender || opts.domain,
    account: opts.account || null,
    steps: { filter, trash, rule },
  };
}

(async () => {
  const opts = parseArgs();
  if (!opts.action) {
    console.error("Usage: --action <unsubscribe|block|filter-skip-inbox|trash-existing|add-spam-rule> --sender <email> --account <email>");
    process.exit(1);
  }

  const cookie = ["block", "filter-skip-inbox", "trash-existing"].includes(opts.action)
    ? await getCookie()
    : null;

  let result;
  switch (opts.action) {
    case "unsubscribe":
      result = await unsubscribe(opts);
      break;
    case "block":
      result = await blockSender(cookie, opts);
      break;
    case "filter-skip-inbox":
      result = await createFilter(cookie, opts, { removeLabelIds: ["INBOX"] });
      break;
    case "trash-existing":
      result = await trashExisting(cookie, opts);
      break;
    case "add-spam-rule":
      result = addSpamRule(opts);
      break;
    default:
      console.error(`Unknown action: ${opts.action}`);
      process.exit(1);
  }

  console.log(JSON.stringify(result));
})();
