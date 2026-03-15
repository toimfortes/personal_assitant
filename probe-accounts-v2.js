const puppeteer = require('puppeteer');
const { N8N_URL, N8N_EMAIL, N8N_PASSWORD, getCookie, loginPage, findExecuteButton, listExecutions, fetchExecution } = require('./scripts/n8n-script-config.cjs');

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
  const cookie = await getCookie();
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${N8N_URL}${path}`, opts);
  const text = await resp.text();
  try { return JSON.parse(text); } catch(e) { return { _error: text.slice(0, 200) }; }
}

async function apiCall(method, path) {
  const cookie = await getCookie();
  if (path.startsWith(`/api/v1/executions?workflowId=${BACKFILL_WF_ID}`)) {
    return { data: await listExecutions(cookie, BACKFILL_WF_ID, 20) };
  }
  const match = path.match(/^\/api\/v1\/executions\/(\d+)(\?includeData=true)?$/);
  if (match) {
    return await fetchExecution(cookie, match[1], Boolean(match[2]));
  }
  throw new Error(`Unsupported helper API path: ${path}`);
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

  await loginPage(page);
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

    const execBtn = await findExecuteButton(page);
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
        const rd = detail.resultData?.runData || {};
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
