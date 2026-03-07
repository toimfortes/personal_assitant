#!/usr/bin/env node

import { readFileSync } from "fs";
import { resolve } from "path";

const N8N_URL = process.env.N8N_URL || "http://127.0.0.1:5678";
const LOGIN_EMAIL = process.env.N8N_EMAIL || "cortexcerebral@gmail.com";
const LOGIN_PASSWORD = process.env.N8N_PASSWORD || "Hjkhjk.,23";
const LIVE_WORKFLOW_ID = process.env.OUTLOOK_TRIAGE_WORKFLOW_ID || "PGA0GAmNmnYEKWyR";
const TEMPLATE_PATH = resolve("n8n-workflows/triage-outlook-to-notion.json");
const GMAIL_BACKFILL_TEMPLATE_PATH = resolve("n8n-workflows/backfill-gmail-triage.json");
const MODEL_SETTINGS_PATH = resolve("config/model_settings.json");

function parseArgs(argv) {
  const opts = {
    days: 30,
    limit: null,
    notify: false,
    keepWorkflow: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--days" && argv[i + 1]) opts.days = Number(argv[++i]);
    else if (arg === "--limit" && argv[i + 1]) opts.limit = Number(argv[++i]);
    else if (arg === "--notify") opts.notify = true;
    else if (arg === "--keep-workflow") opts.keepWorkflow = true;
    else if (arg === "--dry-run") opts.dryRun = true;
  }

  if (!Number.isFinite(opts.days) || opts.days <= 0) {
    throw new Error(`Invalid --days value: ${opts.days}`);
  }
  if (opts.limit !== null && (!Number.isFinite(opts.limit) || opts.limit <= 0)) {
    throw new Error(`Invalid --limit value: ${opts.limit}`);
  }
  return opts;
}

async function jsonFetch(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
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

  const setCookies = resp.headers.getSetCookie?.() || [];
  const n8nCookie = setCookies
    .map((value) => value.split(";", 1)[0])
    .find((value) => value.startsWith("n8n-auth="));

  if (!n8nCookie) {
    throw new Error("n8n-auth cookie missing after login");
  }

  return n8nCookie;
}

async function fetchLiveWorkflow(cookie) {
  const { data } = await jsonFetch(`${N8N_URL}/rest/workflows/${LIVE_WORKFLOW_ID}`, {
    method: "GET",
    headers: { Cookie: cookie },
  });
  return data.data;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pickOllamaModel() {
  try {
    const settings = JSON.parse(readFileSync(MODEL_SETTINGS_PATH, "utf8"));
    const llm = settings?.llm || {};
    const candidates = [llm.primary, ...(llm.fallbacks || [])].filter(Boolean);
    const ollama = candidates.find((model) => String(model).startsWith("ollama/"));
    if (ollama) return String(ollama).replace(/^ollama\//, "");
  } catch {
    // Fall back below.
  }
  return "glm-4.7-flash";
}

function buildFetchNode(templateNode, credentials, opts) {
  const now = new Date();
  const start = new Date(now.getTime() - opts.days * 24 * 60 * 60 * 1000);
  const parameters = {
    resource: "message",
    operation: "getAll",
    output: "fields",
    fields: [
      "body",
      "bodyPreview",
      "categories",
      "conversationId",
      "from",
      "hasAttachments",
      "receivedDateTime",
      "subject",
      "toRecipients",
      "webLink",
    ],
    filtersUI: {
      values: {
        filterBy: "filters",
        filters: {
          readStatus: "both",
          receivedAfter: start.toISOString(),
          receivedBefore: now.toISOString(),
        },
      },
    },
    options: {},
  };

  if (opts.limit !== null) {
    parameters.returnAll = false;
    parameters.limit = opts.limit;
  } else {
    parameters.returnAll = true;
  }

  return {
    ...templateNode,
    type: "n8n-nodes-base.microsoftOutlook",
    typeVersion: 2,
    parameters,
    credentials,
  };
}

function buildNormalizeNode(templateNode) {
  return {
    ...templateNode,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    continueOnFail: true,
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: `const fs = require('fs');

const RULES_CSV_PATH = '/home/node/config/triage_rules.csv';

const defaultBillKeywords = [
  'bill',
  'billing',
  'invoice',
  'statement',
  'payment due',
  'past due',
  'autopay',
  'utility',
  'electric',
  'gas',
  'water',
  'internet',
  'phone bill',
  'insurance',
  'mortgage',
  'rent',
  'credit card',
  'due date'
];

const parseCsv = (raw) => {
  const lines = String(raw || '')
    .split(/\\r?\\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  if (!lines.length) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] || '').trim();
    });
    return row;
  });
};

let rows = [];
try {
  rows = parseCsv(fs.readFileSync(RULES_CSV_PATH, 'utf8'));
} catch (e) {
  rows = [];
}

const importantDomains = new Set();
const importantEmails = new Set();
const billKeywords = new Set(defaultBillKeywords);
const requestKeywords = [
  'please',
  'can you',
  'could you',
  'would you',
  'need you',
  'action required',
  'review',
  'approve',
  'sign',
  'help',
  'let me know',
  'respond',
  'reply',
  'asap',
  'urgent',
  'follow up',
];
const fundsInfoKeywords = [
  'received funds',
  'you received funds',
  'transfer settled',
  'has settled',
  'payment is pending',
  'scheduled payment is pending',
  'payment posted',
  'payment completed',
  'deposit received',
];

for (const row of rows) {
  const type = String(row.type || row.rule_type || row.kind || '').trim().toLowerCase();
  const value = String(row.value || row.pattern || row.entry || '').trim().toLowerCase();
  if (!type || !value) continue;

  if (type === 'domain') importantDomains.add(value);
  else if (type === 'email') importantEmails.add(value);
  else if (type === 'bill_keyword' || type === 'keyword' || type === 'bill') billKeywords.add(value);
}

return $input.all().map((item) => {
  const fromField = item.json.from;
  const senderRaw =
    (typeof fromField === 'string' ? fromField : fromField?.emailAddress?.address) ||
    item.json.From ||
    item.json.sender ||
    item.json.email ||
    '';
  const emailMatch = String(senderRaw).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/);
  const senderEmail = (emailMatch ? emailMatch[0] : String(senderRaw)).toLowerCase();
  const senderDomain = senderEmail.includes('@') ? senderEmail.split('@').pop() : '';
  const subject = String(item.json.subject || item.json.Subject || item.json.snippet || '');
  const bodyField = item.json.body;
  const body =
    (typeof bodyField === 'string' ? bodyField : bodyField?.content) ||
    item.json.textPlain ||
    item.json.bodyPreview ||
    item.json.snippet ||
    '';
  const bodyNormalized = String(body).substring(0, 3000);
  const content = (subject + '\\n' + bodyNormalized).toLowerCase();
  const toRecipients = Array.isArray(item.json.toRecipients)
    ? item.json.toRecipients.map((recipient) => recipient?.emailAddress?.address || '').filter(Boolean)
    : [];
  const mentionsAntonio = content.includes('antonio') || toRecipients.some((value) => String(value).toLowerCase().includes('antonio'));
  const directRequestDetected = requestKeywords.some((keyword) => content.includes(keyword));
  const fundsInfoDetected = fundsInfoKeywords.some((keyword) => content.includes(keyword));

  const importantEmailMatch = senderEmail && importantEmails.has(senderEmail);
  const importantDomainMatch = senderDomain && Array.from(importantDomains).some((d) => senderDomain === d || senderDomain.endsWith('.' + d));
  const billDetected = Array.from(billKeywords).some((k) => content.includes(k));
  const billEscalationDetected = billDetected && directRequestDetected && mentionsAntonio;

  const reasons = [];
  if (billDetected) reasons.push('bill_keyword');
  if (importantEmailMatch) reasons.push('important_email');
  if (importantDomainMatch) reasons.push('important_domain');
  if (billEscalationDetected) reasons.push('bill_escalation');
  if (fundsInfoDetected) reasons.push('informational_finance');

  return {
    json: {
      ...item.json,
      to_recipients_normalized: toRecipients,
      sender_email: senderEmail,
      sender_domain: senderDomain,
      subject_normalized: subject,
      body_normalized: bodyNormalized,
      _triage: {
        bill_detected: billDetected,
        bill_escalation_detected: billEscalationDetected,
        direct_request_detected: directRequestDetected,
        funds_info_detected: fundsInfoDetected,
        mentions_antonio: mentionsAntonio,
        important_list_match: importantEmailMatch || importantDomainMatch,
        force_important: importantEmailMatch || importantDomainMatch || billEscalationDetected,
        rule_reason: reasons.join(',') || '',
      },
    },
  };
});`,
    },
  };
}

function buildAiNode(templateNode) {
  const model = pickOllamaModel();
  return {
    ...templateNode,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4,
    continueOnFail: true,
    parameters: {
      method: "POST",
      url: "http://ollama:11434/api/generate",
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: "Content-Type", value: "application/json" }],
      },
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody:
        `={{ ({ model: '${model}', stream: false, format: 'json', prompt: 'You are triaging Antonio Fortes\\' work Outlook inbox. Return strict JSON with keys: is_important (boolean), is_bill (boolean), category (string), reason (string), summary (string), suggested_action (string). Important means Antonio personally needs to act, decide, approve, reply, or help with an escalation. Not important means informational, automated, routine operations, marketing, webinar, or FYI only. Bills in Antonio\\'s work inbox are NOT important by default; assume accounting/operations owns them unless the email specifically asks Antonio for help, approval, or escalation. Emails saying funds were received, transfers settled, or routine payments are informational unless there is a direct request. Important domains and VIP senders are strong signals, but they are not automatically important if the email is plainly promotional or FYI with no action. If bill_escalation_detected is true, treat that as important. If funds_info_detected is true and there is no direct request, treat that as not important. Context: ' + JSON.stringify({ from: $node['Normalize Sender & Rules'].json['sender_email'], domain: $node['Normalize Sender & Rules'].json['sender_domain'], to: $node['Normalize Sender & Rules'].json['to_recipients_normalized'], subject: $node['Normalize Sender & Rules'].json['subject_normalized'], body: $node['Normalize Sender & Rules'].json['body_normalized'], force_important: $node['Normalize Sender & Rules'].json['_triage']['force_important'], bill_detected: $node['Normalize Sender & Rules'].json['_triage']['bill_detected'], bill_escalation_detected: $node['Normalize Sender & Rules'].json['_triage']['bill_escalation_detected'], direct_request_detected: $node['Normalize Sender & Rules'].json['_triage']['direct_request_detected'], funds_info_detected: $node['Normalize Sender & Rules'].json['_triage']['funds_info_detected'], mentions_antonio: $node['Normalize Sender & Rules'].json['_triage']['mentions_antonio'], important_list_match: $node['Normalize Sender & Rules'].json['_triage']['important_list_match'], rule_reason: $node['Normalize Sender & Rules'].json['_triage']['rule_reason'] }) }) }}`,
      options: {},
    },
  };
}

function buildNotionWriteNode(templateNode) {
  const gmailBackfill = JSON.parse(readFileSync(GMAIL_BACKFILL_TEMPLATE_PATH, "utf8"));
  const gmailNotionNode = gmailBackfill.nodes.find((node) => node.name === "Add to Notion");
  const headerParameters = clone(gmailNotionNode?.parameters?.headerParameters || { parameters: [] });

  if (!headerParameters.parameters?.length) {
    throw new Error("Could not load Notion API headers from Gmail backfill template");
  }

  return {
    ...templateNode,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4,
    continueOnFail: true,
    parameters: {
      method: "POST",
      url: "https://api.notion.com/v1/pages",
      sendHeaders: true,
      headerParameters,
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ (() => { let ai = {}; try { ai = JSON.parse($node['AI Triage (Local Ollama)'].json['response'] || $node['AI Triage (Local Ollama)'].json['thinking'] || '{}'); } catch (e) {} const fromField = $node['Microsoft 365 Email'].json['from']; const senderText = (typeof fromField === 'string' ? fromField : (fromField?.emailAddress?.address || fromField?.emailAddress?.name || 'unknown')); return ({ parent: { data_source_id: ($env['NOTION_DATA_SOURCE_ID'] || '2c91d511-87a6-805c-ab38-000b18d92545') }, properties: { Name: { title: [{ text: { content: ((($node['Microsoft 365 Email'].json['subject'] || 'No Subject') + ' [INVESTOR]').substring(0, 100)) } }] }, Sender: { rich_text: [{ text: { content: (senderText.substring(0, 100)) } }] }, 'Sender Domain': { rich_text: [{ text: { content: (($node['Normalize Sender & Rules'].json['sender_domain'] || '').substring(0, 100)) } }] }, 'Core Request': { rich_text: [{ text: { content: ((ai.summary || 'AI triage failed').substring(0, 2000)) } }] }, 'Importance Reason': { rich_text: [{ text: { content: ((($node['Normalize Sender & Rules'].json['_triage']['rule_reason'] || ai.reason || '')).substring(0, 2000)) } }] }, Category: { select: { name: ($node['Normalize Sender & Rules'].json['_triage']['bill_detected'] && !$node['Normalize Sender & Rules'].json['_triage']['funds_info_detected'] ? 'Bill' : (ai.category || 'Important')) } }, 'Reply Draft': { rich_text: [{ text: { content: ((ai.suggested_action || '').substring(0, 2000)) } }] }, Status: { select: { name: 'Not Started' } }, 'Original Link': { url: $node['Microsoft 365 Email'].json['webLink'] || null }, 'Email Date': { date: { start: $node['Microsoft 365 Email'].json['receivedDateTime'] || null } }, 'Email Account': { rich_text: [{ text: { content: 'Outlook' } }] } } }); })() }}",
      options: {},
    },
  };
}

function buildIfNode(templateNode) {
  return {
    ...templateNode,
    continueOnFail: true,
    parameters: {
      conditions: {
        boolean: [
          {
            value1:
              "={{ (() => { try { const parsed = JSON.parse($node['AI Triage (Local Ollama)'].json['response'] || $node['AI Triage (Local Ollama)'].json['thinking'] || '{}'); return $node['Normalize Sender & Rules'].json['_triage']['force_important'] || parsed.is_important === true; } catch (e) { return $node['Normalize Sender & Rules'].json['_triage']['force_important'] || false; } })() }}",
            operation: "equal",
            value2: true,
          },
        ],
      },
      combineOperation: "all",
    },
  };
}

function buildTempWorkflow(liveWorkflow, opts) {
  const template = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const liveTrigger = liveWorkflow.nodes.find((node) => node.name === "Microsoft 365 Email");

  if (!liveTrigger?.credentials?.microsoftOutlookOAuth2Api) {
    throw new Error("Live Outlook credential binding not found");
  }

  const templateTrigger = template.nodes.find((node) => node.name === "Microsoft 365 Email");
  if (!templateTrigger) {
    throw new Error("Template Outlook trigger node not found");
  }

  const nodes = [
    {
      parameters: {},
      name: "Start",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [-80, 300],
    },
  ];

  for (const originalNode of template.nodes) {
    if (originalNode.name === "Microsoft 365 Email") {
      nodes.push(
        buildFetchNode(originalNode, {
          microsoftOutlookOAuth2Api: liveTrigger.credentials.microsoftOutlookOAuth2Api,
        }, opts),
      );
      continue;
    }

    if (originalNode.name === "Notify OpenClaw Bot" && !opts.notify) {
      continue;
    }

    const node = clone(originalNode);
    if (node.name === "Normalize Sender & Rules") {
      nodes.push(buildNormalizeNode(node));
      continue;
    }
    if (node.name === "AI Triage (Local Ollama)") {
      nodes.push(buildAiNode(node));
      continue;
    }
    if (node.name === "Is Important?") {
      nodes.push(buildIfNode(node));
      continue;
    }
    if (node.name === "Add to Notion") {
      nodes.push(buildNotionWriteNode(node));
      continue;
    }
    nodes.push(node);
  }

  const connections = clone(template.connections);
  connections.Start = {
    main: [[{ node: "Microsoft 365 Email", type: "main", index: 0 }]],
  };

  if (!opts.notify) {
    delete connections["Add to Notion"];
  }

  return {
    name: `_temp_outlook_backfill_${Date.now()}`,
    nodes,
    connections,
    settings: {},
  };
}

function summarizeRun(result) {
  const runData = result?.resultData?.runData || result?.data?.resultData?.runData || {};
  const getCount = (nodeName) => {
    const entries = runData[nodeName];
    if (!Array.isArray(entries) || !entries.length) return 0;
    return entries.reduce((sum, entry) => {
      const count = entry?.data?.main?.[0]?.length || 0;
      return sum + count;
    }, 0);
  };

  const samples = (runData["Microsoft 365 Email"]?.[0]?.data?.main?.[0] || [])
    .slice(0, 5)
    .map((item) => ({
      receivedDateTime: item.json.receivedDateTime || null,
      from: item.json.from || null,
      subject: item.json.subject || null,
      webLink: item.json.webLink || null,
    }));

  const errors = [];
  for (const [nodeName, entries] of Object.entries(runData)) {
    for (const entry of entries || []) {
      if (entry?.error) {
        errors.push({
          node: nodeName,
          message: entry.error.message || "Unknown error",
        });
      }
    }
  }

  return {
    fetched: getCount("Microsoft 365 Email"),
    normalized: getCount("Normalize Sender & Rules"),
    triaged: getCount("AI Triage (Local Ollama)"),
    important: getCount("Is Important?"),
    notionWrites: getCount("Add to Notion"),
    notified: getCount("Notify OpenClaw Bot"),
    sampleMessages: samples,
    errors,
  };
}

async function createWorkflow(cookie, workflow) {
  const { data } = await jsonFetch(`${N8N_URL}/rest/workflows`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(workflow),
  });
  return data.data;
}

async function runWorkflow(cookie, workflowData) {
  const { data } = await jsonFetch(`${N8N_URL}/rest/workflows/${workflowData.id}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ workflowData }),
  });
  return data.data || data;
}

async function fetchExecution(cookie, executionId) {
  const { data } = await jsonFetch(`${N8N_URL}/rest/executions/${executionId}`, {
    method: "GET",
    headers: { Cookie: cookie },
  });
  return data.data;
}

async function waitForExecution(cookie, executionId, timeoutMs = 30 * 60 * 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const execution = await fetchExecution(cookie, executionId);
    if (execution?.status !== "running" && execution?.status !== "waiting" && execution?.status !== "new") {
      return execution;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for execution ${executionId}`);
}

function inflateExecutionData(flat) {
  const cache = new Map();

  const decodeIndex = (idx) => {
    if (cache.has(idx)) return cache.get(idx);
    const raw = flat[idx];
    let decoded;
    if (Array.isArray(raw)) {
      decoded = raw.map(decodeValue);
    } else if (raw && typeof raw === "object") {
      decoded = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, decodeValue(value)]));
    } else {
      decoded = raw;
    }
    cache.set(idx, decoded);
    return decoded;
  };

  const decodeValue = (value) => {
    if (typeof value === "string" && /^\d+$/.test(value)) {
      const idx = Number(value);
      if (idx >= 0 && idx < flat.length) return decodeIndex(idx);
    }
    if (Array.isArray(value)) return value.map(decodeValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, decodeValue(inner)]));
    }
    return value;
  };

  return decodeIndex(0);
}

function summarizeExecution(execution) {
  if (!execution?.data) {
    return {
      status: execution?.status || "unknown",
      fetched: 0,
      normalized: 0,
      triaged: 0,
      important: 0,
      notionWrites: 0,
      notified: 0,
      sampleMessages: [],
      errors: [],
    };
  }

  const flattened = typeof execution.data === "string" ? JSON.parse(execution.data) : execution.data;
  const inflated = inflateExecutionData(flattened);
  return {
    status: execution.status,
    executionId: execution.id,
    ...summarizeRun(inflated),
  };
}

async function deleteWorkflow(cookie, workflowId) {
  await jsonFetch(`${N8N_URL}/rest/workflows/${workflowId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      active: false,
      isArchived: true,
    }),
  });
  await jsonFetch(`${N8N_URL}/rest/workflows/${workflowId}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cookie = await login();
  const liveWorkflow = await fetchLiveWorkflow(cookie);
  const tempWorkflow = buildTempWorkflow(liveWorkflow, opts);

  if (opts.dryRun) {
    console.log(JSON.stringify(tempWorkflow, null, 2));
    return;
  }

  const created = await createWorkflow(cookie, tempWorkflow);
  let executionSummary = null;
  try {
    const started = await runWorkflow(cookie, created);
    const executionId = started.executionId || started.data?.executionId;
    if (!executionId) {
      throw new Error(`Manual run did not return an executionId: ${JSON.stringify(started)}`);
    }
    const execution = await waitForExecution(cookie, executionId);
    executionSummary = summarizeExecution(execution);
  } finally {
    if (!opts.keepWorkflow) {
      await deleteWorkflow(cookie, created.id);
    }
  }

  console.log(JSON.stringify({
    workflowId: created.id,
    workflowName: created.name,
    keptWorkflow: opts.keepWorkflow,
    days: opts.days,
    limit: opts.limit,
    notify: opts.notify,
    summary: executionSummary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
