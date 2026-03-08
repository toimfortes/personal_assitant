#!/usr/bin/env node
/**
 * Email Cleanup Scanner
 * Scans Gmail accounts via n8n credentials, groups by sender,
 * outputs top senders with volume stats and unsubscribe availability.
 *
 * Usage:
 *   node scripts/email-cleanup-scan.mjs [--account email] [--days 30] [--top 20] [--category promotions]
 *
 * Output: JSON array of sender objects sorted by email count descending.
 */

const N8N_URL = process.env.N8N_URL || "http://localhost:5678";
const N8N_API_KEY = process.env.N8N_API_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZTRkZTAyMy1mMGMzLTRlODAtOThlYi04ZmRkOGE1MTdjYjMiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiYWNiZjI5MDMtNTVkMy00MTQ0LWE2ZjQtZTgyN2E1ZDFmNzliIiwiaWF0IjoxNzcyNzI3MjY5LCJleHAiOjE3NzUyNjA4MDB9.XrePb6rP8yypF-roL4kRGjVQhj8Um6VEJ9SS8pINgqM";

const ACCOUNTS = [
  { id: "jACGwijQXj0rEYqR", name: "Gmail account 1", email: "cortexcerebral@gmail.com" },
  { id: "MrF40yK3dky3O7Cz", name: "Gmail account 2", email: "antonio.maya.official@gmail.com" },
  { id: "JaJpq3hIJWFJXv4S", name: "Gmail account 3", email: "antonioandmayaadventures@gmail.com" },
  { id: "TEZwdWAZWeaN7IL1", name: "Gmail account 4", email: "larissasrhsbparents@gmail.com" },
  { id: "Xhbgajo1Ghik9Uf8", name: "Gmail account 5", email: "antonioforteslegal@gmail.com" },
  { id: "aTfnlMCcGAbuzmBn", name: "Gmail account 6", email: "toimusa@gmail.com" },
];

const SCAN_WF_ID = "scan-cleanup"; // Will be set after workflow creation

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { days: 30, top: 25, account: null, category: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--account" && args[i + 1]) opts.account = args[++i];
    if (args[i] === "--days" && args[i + 1]) opts.days = parseInt(args[++i]);
    if (args[i] === "--top" && args[i + 1]) opts.top = parseInt(args[++i]);
    if (args[i] === "--category" && args[i + 1]) opts.category = args[++i];
  }
  return opts;
}

async function getCookie() {
  const resp = await fetch(`${N8N_URL}/rest/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrLdapLoginId: "cortexcerebral@gmail.com", password: "Hjkhjk.,23" }),
  });
  return resp.headers.getSetCookie()?.find((c) => c.startsWith("n8n-auth="))?.split(";")[0] || "";
}

async function scanAccount(cookie, account, opts) {
  // Use n8n's internal credential proxy to call Gmail API
  // We patch the triage workflow temporarily to scan emails
  const afterDate = new Date(Date.now() - opts.days * 86400000).toISOString().split("T")[0].replace(/-/g, "/");
  let query = `after:${afterDate}`;
  if (opts.category) query += ` category:${opts.category}`;

  // Create a temporary workflow for scanning
  const scanWf = {
    name: `_temp_scan_${account.email}`,
    nodes: [
      {
        parameters: {},
        name: "Manual Trigger",
        type: "n8n-nodes-base.manualTrigger",
        typeVersion: 1,
        position: [100, 300],
      },
      {
        parameters: {
          operation: "getAll",
          returnAll: false,
          limit: 500,
          filters: { q: query },
          options: { dataPropertyAttachmentsPrefixName: "" },
        },
        name: "Gmail Scan",
        type: "n8n-nodes-base.gmail",
        typeVersion: 2,
        position: [300, 300],
        credentials: { gmailOAuth2: { id: account.id, name: account.name } },
      },
      {
        parameters: {
          jsCode: `const items = $input.all();
const senders = {};
for (const item of items) {
  const j = item.json || {};
  const from = j.from || '';
  const headers = j.payload?.headers || [];

  // Extract List-Unsubscribe header
  let listUnsub = '';
  let listUnsubPost = '';
  for (const h of headers) {
    if (h.name === 'List-Unsubscribe') listUnsub = h.value || '';
    if (h.name === 'List-Unsubscribe-Post') listUnsubPost = h.value || '';
  }

  // Parse sender
  const match = from.match(/<([^>]+)>/);
  const email = match ? match[1].toLowerCase() : from.toLowerCase().trim();
  const domain = email.split('@')[1] || '';
  const displayName = from.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || email;

  if (!email) continue;

  if (!senders[email]) {
    senders[email] = {
      email,
      domain,
      displayName,
      count: 0,
      unread: 0,
      hasUnsubscribe: false,
      unsubscribeUrl: '',
      unsubscribeMailto: '',
      hasOneClick: false,
      subjects: [],
      latestDate: '',
    };
  }
  senders[email].count++;

  const labels = j.labelIds || [];
  if (labels.includes('UNREAD')) senders[email].unread++;

  if (listUnsub && !senders[email].hasUnsubscribe) {
    senders[email].hasUnsubscribe = true;
    const urls = listUnsub.match(/<([^>]+)>/g) || [];
    for (const u of urls) {
      const url = u.slice(1, -1);
      if (url.startsWith('http')) senders[email].unsubscribeUrl = url;
      if (url.startsWith('mailto:')) senders[email].unsubscribeMailto = url;
    }
    senders[email].hasOneClick = listUnsubPost.includes('One-Click');
  }

  if (senders[email].subjects.length < 3) {
    senders[email].subjects.push((j.subject || '').substring(0, 80));
  }

  const date = j.internalDate ? new Date(parseInt(j.internalDate)).toISOString() : '';
  if (date > senders[email].latestDate) senders[email].latestDate = date;
}

const sorted = Object.values(senders).sort((a, b) => b.count - a.count);
return sorted.map(s => ({ json: s }));`,
          mode: "runOnceForAllItems",
        },
        name: "Aggregate Senders",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [500, 300],
      },
    ],
    connections: {
      "Manual Trigger": { main: [[{ node: "Gmail Scan", type: "main", index: 0 }]] },
      "Gmail Scan": { main: [[{ node: "Aggregate Senders", type: "main", index: 0 }]] },
    },
    settings: {},
  };

  // Create workflow
  const createResp = await fetch(`${N8N_URL}/rest/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(scanWf),
  });
  const created = (await createResp.json()).data;
  const wfId = created.id;

  try {
    // Execute via test run
    const execResp = await fetch(`${N8N_URL}/rest/workflows/${wfId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ runData: {} }),
    });
    const execResult = await execResp.json();
    const execData = execResult.data;

    // Extract results from the Aggregate Senders node
    const rd = execData?.resultData?.runData || {};
    const aggRuns = rd["Aggregate Senders"] || [];
    const results = [];
    for (const run of aggRuns) {
      for (const ol of run.data?.main || []) {
        for (const item of ol || []) {
          results.push(item.json);
        }
      }
    }
    return results;
  } finally {
    // Delete temp workflow
    await fetch(`${N8N_URL}/rest/workflows/${wfId}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
  }
}

(async () => {
  const opts = parseArgs();
  const cookie = await getCookie();

  const accountsToScan = opts.account
    ? ACCOUNTS.filter((a) => a.email.includes(opts.account))
    : ACCOUNTS;

  if (accountsToScan.length === 0) {
    console.error(`No account matching "${opts.account}"`);
    process.exit(1);
  }

  const allSenders = {};

  for (const acct of accountsToScan) {
    process.stderr.write(`Scanning ${acct.email}...\n`);
    try {
      const senders = await scanAccount(cookie, acct, opts);
      for (const s of senders) {
        const key = `${s.email}__${acct.email}`;
        allSenders[key] = { ...s, account: acct.email };
      }
      process.stderr.write(`  Found ${senders.length} unique senders\n`);
    } catch (e) {
      process.stderr.write(`  Error: ${e.message}\n`);
    }
  }

  // Merge and sort
  const sorted = Object.values(allSenders)
    .sort((a, b) => b.count - a.count)
    .slice(0, opts.top);

  // Output as JSON
  console.log(JSON.stringify(sorted, null, 2));
})();
