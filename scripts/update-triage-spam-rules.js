/**
 * Updates the triage workflow's Normalize Sender & Rules node
 * to also check spam_domain/spam_sender rules from triage_rules.csv.
 * Blocked senders are auto-rejected (force_spam = true, is_important = false).
 */

const WF_ID = "FgXJ0dTlOibbKHr0";
const fs = require("fs");
const { N8N_URL, N8N_EMAIL, N8N_PASSWORD } = require("./n8n-script-config.cjs");

// Read current spam rules from CSV
const rulesContent = fs.readFileSync("config/triage_rules.csv", "utf8");
const spamDomains = [];
const spamSenders = [];
for (const line of rulesContent.split("\n")) {
  const parts = line.split(",");
  if (parts[0] === "spam_domain") spamDomains.push(parts[1].trim().toLowerCase());
  if (parts[0] === "spam_sender") spamSenders.push(parts[1].trim().toLowerCase());
}

console.log(`Spam rules: ${spamDomains.length} domains, ${spamSenders.length} senders`);

async function getCookie() {
  const resp = await fetch(`${N8N_URL}/rest/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrLdapLoginId: N8N_EMAIL, password: N8N_PASSWORD }),
  });
  return resp.headers.getSetCookie()?.find((c) => c.startsWith("n8n-auth="))?.split(";")[0] || "";
}

(async () => {
  const cookie = await getCookie();
  const wfResp = await fetch(`${N8N_URL}/rest/workflows/${WF_ID}`, { headers: { Cookie: cookie } });
  const wf = (await wfResp.json()).data;

  for (const node of wf.nodes) {
    if (node.name === "Normalize Sender & Rules") {
      // Build the updated code with spam rules baked in
      node.parameters.jsCode = `const importantDomains = new Set(['antharistheapeutics.com', 'taxadvisorypartnership.com', 'met.police.uk', 'police.uk', 'cityoflondon.police.uk', 'gov.uk', 'mintz.com', 'evidence.com']);
const importantEmails = new Set(['seffron@mintz.com', 'adwoa.antwi-boadu@met.police.uk', 'beth.clark@cityoflondon.police.uk', 'pinaudr@gmail.com']);

// Spam rules - senders/domains auto-blocked via cleanup
const spamDomains = new Set(${JSON.stringify(spamDomains)});
const spamSenders = new Set(${JSON.stringify(spamSenders)});

const results = [];
for (const item of $input.all()) {
  const senderRaw = (item.json.From || item.json.from || item.json.sender || item.json.email || '').toString();
  const emailMatch = senderRaw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/);
  const senderEmail = (emailMatch ? emailMatch[0] : senderRaw).toLowerCase();
  const senderDomain = senderEmail.includes('@') ? senderEmail.split('@').pop() : '';
  const subject = (item.json.subject || item.json.Subject || item.json.snippet || '').toString();
  const body = (item.json.textPlain || item.json.body || item.json.snippet || '').toString().substring(0, 2000);

  // Check spam rules first
  const isSpamSender = spamSenders.has(senderEmail);
  const isSpamDomain = senderDomain && Array.from(spamDomains).some(d => senderDomain === d || senderDomain.endsWith('.' + d));

  if (isSpamSender || isSpamDomain) {
    // Skip this email entirely - blocked sender
    continue;
  }

  const importantEmailMatch = senderEmail && importantEmails.has(senderEmail);
  const importantDomainMatch = senderDomain && Array.from(importantDomains).some((d) => senderDomain === d || senderDomain.endsWith('.' + d));

  results.push({
    json: {
      ...item.json,
      sender_email: senderEmail,
      sender_domain: senderDomain,
      subject_normalized: subject,
      body_normalized: body,
      _triage: {
        important_list_match: importantEmailMatch || importantDomainMatch,
        force_important: importantEmailMatch || importantDomainMatch,
        rule_reason: importantEmailMatch ? 'important_email' : (importantDomainMatch ? 'important_domain' : '')
      }
    }
  });
}
return results;`;
    }
  }

  const patchResp = await fetch(`${N8N_URL}/rest/workflows/${WF_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ nodes: wf.nodes, connections: wf.connections }),
  });
  console.log("Workflow updated:", patchResp.ok);
})();
