const puppeteer = require('puppeteer');

const N8N_URL = 'http://localhost:5678';
const EMAIL = 'cortexcerebral@gmail.com';
const PASSWORD = 'Hjkhjk.,23';
const AUTH_COOKIE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZlNGRlMDIzLWYwYzMtNGU4MC05OGViLThmZGQ4YTUxN2NiMyIsImhhc2giOiIwZngxR0JhV0liIiwidXNlZE1mYSI6ZmFsc2UsImlhdCI6MTc3Mjc1NjQzNywiZXhwIjoxNzczMzYxMjM3fQ.9bw_wGwJl-rJinSMC7jb7t5O8LXEfWx-t14FAOMrenA';
const N8N_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZTRkZTAyMy1mMGMzLTRlODAtOThlYi04ZmRkOGE1MTdjYjMiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiYWNiZjI5MDMtNTVkMy00MTQ0LWE2ZjQtZTgyN2E1ZDFmNzliIiwiaWF0IjoxNzcyNzI3MjY5LCJleHAiOjE3NzUyNjA4MDB9.XrePb6rP8yypF-roL4kRGjVQhj8Um6VEJ9SS8pINgqM';
const BACKFILL_WF_ID = 'FgXJ0dTlOibbKHr0';

const CREDS = [
  { id: '0YJAOX0ZGvKDcpAt', name: 'Gmail account 1' },
  { id: 'MrF40yK3dky3O7Cz', name: 'Gmail account 2' },
  { id: 'JaJpq3hIJWFJXv4S', name: 'Gmail account 3' },
  { id: 'TEZwdWAZWeaN7IL1', name: 'Gmail account 4' },
  { id: 'Xhbgajo1Ghik9Uf8', name: 'Gmail account 5' },
  { id: 'PkoNf6XXZsGr9QVk', name: 'Gmail account 6' },
];

async function restCall(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `n8n-auth=${AUTH_COOKIE}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${N8N_URL}${path}`, opts);
  const text = await resp.text();
  try { return JSON.parse(text); } catch(e) { return { _error: text.slice(0, 200) }; }
}

async function apiCall(method, path) {
  const resp = await fetch(`${N8N_URL}${path}`, {
    method,
    headers: { 'X-N8N-API-KEY': N8N_API_KEY },
  });
  return resp.json();
}

(async () => {
  // Get current workflow
  const wfResp = await restCall('GET', `/rest/workflows/${BACKFILL_WF_ID}`);
  const originalWf = wfResp.data || wfResp;

  // Save original credential for restore
  let originalCredId, originalCredName;
  for (const node of originalWf.nodes) {
    if (node.name === 'Gmail Get All') {
      originalCredId = node.credentials?.gmailOAuth2?.id;
      originalCredName = node.credentials?.gmailOAuth2?.name;
      // Also temporarily set limit to 1 for probing
      node.parameters.limit = 1;
      break;
    }
  }

  console.log(`Original credential: ${originalCredName} (${originalCredId})\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // Login
  await page.goto(`${N8N_URL}/signin`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));
  const emailInput = await page.$('input[autocomplete="email"], input[type="email"]');
  const passInput = await page.$('input[type="password"]');
  if (emailInput && passInput) {
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(EMAIL);
    await passInput.click({ clickCount: 3 });
    await passInput.type(PASSWORD);
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.toLowerCase().includes('sign in')) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log('Logged in\n');

  for (const cred of CREDS) {
    console.log(`=== ${cred.name} (${cred.id}) ===`);

    // Update workflow credential via REST API
    const currentResp = await restCall('GET', `/rest/workflows/${BACKFILL_WF_ID}`);
    const wf = currentResp.data || currentResp;
    for (const node of wf.nodes) {
      if (node.name === 'Gmail Get All') {
        node.credentials = { gmailOAuth2: { id: cred.id, name: cred.name } };
        node.parameters.limit = 1;
        node.parameters.filters = { q: 'after:2026/02/03 before:2026/03/06' };
        node.parameters.options = { labelIds: ['INBOX'] };
      }
    }
    await restCall('PATCH', `/rest/workflows/${BACKFILL_WF_ID}`, { nodes: wf.nodes, connections: wf.connections });

    // Get last execution ID
    const beforeList = await apiCall('GET', `/api/v1/executions?workflowId=${BACKFILL_WF_ID}&limit=1`);
    const lastExecId = beforeList.data?.[0]?.id || '0';

    // Navigate to workflow and execute
    await page.goto(`${N8N_URL}/workflow/${BACKFILL_WF_ID}`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    // Close any drawers
    const closeButtons = await page.$$('.el-drawer__close-btn');
    for (const btn of closeButtons) { try { await btn.click(); } catch(e) {} }
    await new Promise(r => setTimeout(r, 500));

    const execBtn = await page.$('[data-test-id="execute-workflow-button"]');
    if (execBtn) {
      await execBtn.click();
      console.log('  Triggered execution...');
    } else {
      console.log('  Could not find execute button');
      continue;
    }

    // Wait for execution to appear and complete
    let found = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const list = await apiCall('GET', `/api/v1/executions?workflowId=${BACKFILL_WF_ID}&limit=1`);
      const latest = list.data?.[0];
      if (latest && latest.id > lastExecId && latest.status !== 'running' && latest.status !== 'new') {
        // Get detailed data
        const detail = await apiCall('GET', `/api/v1/executions/${latest.id}?includeData=true`);
        const rd = detail.data?.resultData?.runData || {};
        const gmailRuns = rd['Gmail Get All'] || [];

        for (const run of gmailRuns) {
          if (run.error) {
            console.log(`  ERROR: ${run.error.message}`);
            continue;
          }
          const outputs = run.data?.main || [];
          for (const outList of outputs) {
            for (const item of (outList || [])) {
              const j = item.json || {};
              const to = j.to || j.To || j.deliveredTo || j['Delivered-To'] || 'unknown';
              const from = j.From || j.from || 'unknown';
              const subject = j.subject || j.Subject || 'no subject';
              console.log(`  To: ${to}`);
              console.log(`  From: ${from}`);
              console.log(`  Subject: ${subject}`);
            }
          }
        }

        if (!gmailRuns.length) {
          console.log(`  Status: ${latest.status}, no Gmail data`);
        }
        found = true;
        break;
      }
    }
    if (!found) console.log('  Timed out waiting for execution');
    console.log('');
  }

  // Restore original credential and limit
  const restoreResp = await restCall('GET', `/rest/workflows/${BACKFILL_WF_ID}`);
  const restoreWf = restoreResp.data || restoreResp;
  for (const node of restoreWf.nodes) {
    if (node.name === 'Gmail Get All') {
      node.credentials = { gmailOAuth2: { id: originalCredId, name: originalCredName } };
      node.parameters.limit = 50;
    }
  }
  await restCall('PATCH', `/rest/workflows/${BACKFILL_WF_ID}`, { nodes: restoreWf.nodes, connections: restoreWf.connections });
  console.log('Restored original workflow settings');

  await browser.close();
})();
