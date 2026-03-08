const puppeteer = require('puppeteer');

const N8N_URL = 'http://localhost:5678';
const N8N_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZTRkZTAyMy1mMGMzLTRlODAtOThlYi04ZmRkOGE1MTdjYjMiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiYWNiZjI5MDMtNTVkMy00MTQ0LWE2ZjQtZTgyN2E1ZDFmNzliIiwiaWF0IjoxNzcyNzI3MjY5LCJleHAiOjE3NzUyNjA4MDB9.XrePb6rP8yypF-roL4kRGjVQhj8Um6VEJ9SS8pINgqM';
const AUTH_COOKIE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZlNGRlMDIzLWYwYzMtNGU4MC05OGViLThmZGQ4YTUxN2NiMyIsImhhc2giOiIwZngxR0JhV0liIiwidXNlZE1mYSI6ZmFsc2UsImlhdCI6MTc3Mjc1NjQzNywiZXhwIjoxNzczMzYxMjM3fQ.9bw_wGwJl-rJinSMC7jb7t5O8LXEfWx-t14FAOMrenA';
const WF_ID = 'FgXJ0dTlOibbKHr0';

const ACCOUNTS = [
  { id: 'MrF40yK3dky3O7Cz', name: 'Gmail account 2', email: 'antonio.maya.official@gmail.com' },
  { id: 'JaJpq3hIJWFJXv4S', name: 'Gmail account 3', email: 'toimusa@gmail.com' },
  { id: 'TEZwdWAZWeaN7IL1', name: 'Gmail account 4', email: 'antonioforteslegal@gmail.com' },
  { id: 'Xhbgajo1Ghik9Uf8', name: 'Gmail account 5', email: 'antonioandmayaadventures@gmail.com' },
  { id: 'PkoNf6XXZsGr9QVk', name: 'Gmail account 6', email: 'larissasrhsbparents@gmail.com' },
];

async function restCall(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Cookie': `n8n-auth=${AUTH_COOKIE}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${N8N_URL}${path}`, opts);
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return { _error: text.slice(0, 200) }; }
}

async function apiCall(path) {
  const resp = await fetch(`${N8N_URL}${path}`, {
    headers: { 'X-N8N-API-KEY': N8N_API_KEY },
  });
  return resp.json();
}

async function patchCredential(credId, credName) {
  const resp = await restCall('GET', `/rest/workflows/${WF_ID}`);
  const wf = resp.data || resp;
  for (const node of wf.nodes) {
    if (node.name === 'Gmail Get All') {
      node.credentials = { gmailOAuth2: { id: credId, name: credName } };
      node.parameters.limit = 50;
      node.parameters.filters = { q: 'after:2026/02/03 before:2026/03/06' };
      node.parameters.options = { labelIds: ['INBOX'] };
    }
  }
  await restCall('PATCH', `/rest/workflows/${WF_ID}`, { nodes: wf.nodes, connections: wf.connections });
}

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // Login
  await page.goto(`${N8N_URL}/signin`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));
  const ei = await page.$('input[autocomplete="email"], input[type="email"]');
  const pi = await page.$('input[type="password"]');
  if (ei && pi) {
    await ei.click({ clickCount: 3 }); await ei.type('cortexcerebral@gmail.com');
    await pi.click({ clickCount: 3 }); await pi.type('Hjkhjk.,23');
    for (const btn of await page.$$('button')) {
      if ((await page.evaluate(el => el.textContent, btn)).toLowerCase().includes('sign in')) {
        await btn.click(); break;
      }
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log('Logged in\n');

  const allResults = [];

  for (const acct of ACCOUNTS) {
    const startTime = Date.now();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`ACCOUNT: ${acct.email} (${acct.name})`);
    console.log(`${'='.repeat(60)}`);

    // Patch credential
    await patchCredential(acct.id, acct.name);

    // Get last exec ID
    const before = await apiCall(`/api/v1/executions?workflowId=${WF_ID}&limit=1`);
    const lastId = parseInt(before.data?.[0]?.id || '0');

    // Navigate and execute
    await page.goto(`${N8N_URL}/workflow/${WF_ID}`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));
    const execBtn = await page.$('[data-test-id="execute-workflow-button"]');
    if (execBtn) {
      await execBtn.click();
      console.log(`  Triggered at ${new Date().toLocaleTimeString()}`);
    } else {
      console.log('  ERROR: No execute button');
      continue;
    }

    // Poll for completion — up to 120 min
    let result = null;
    for (let i = 0; i < 3600; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const list = await apiCall(`/api/v1/executions?workflowId=${WF_ID}&limit=1`);
      const latest = list.data?.[0];
      if (latest && parseInt(latest.id) > lastId && !['running', 'new', 'waiting'].includes(latest.status)) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`  Completed in ${elapsed}s (status: ${latest.status})`);

        const detail = await apiCall(`/api/v1/executions/${latest.id}?includeData=true`);
        const rd = detail.data?.resultData?.runData || {};

        // Count emails fetched
        const gmailRuns = rd['Gmail Get All'] || [];
        let emailCount = 0;
        for (const run of gmailRuns) {
          for (const ol of (run.data?.main || [])) {
            emailCount += (ol || []).length;
          }
        }

        // Count flagged as important (passed the Is Important? filter)
        const notionRuns = rd['Add to Notion'] || [];
        let flagged = [];
        for (const run of notionRuns) {
          if (run.error) { console.log(`  Notion ERROR: ${run.error.message}`); continue; }
          for (const ol of (run.data?.main || [])) {
            for (const item of (ol || [])) {
              const j = item.json || {};
              if (j.object === 'page' || j.id) {
                // Extract from the properties we sent
                const props = j.properties || {};
                const title = props?.Name?.title?.[0]?.text?.content || 'unknown';
                const sender = props?.Sender?.rich_text?.[0]?.text?.content || 'unknown';
                const category = props?.Category?.select?.name || 'unknown';
                const reason = props?.['Importance Reason']?.rich_text?.[0]?.text?.content || '';
                flagged.push({ title, sender, category, reason });
              }
            }
          }
        }

        // Also check AI triage results for all emails
        const aiRuns = rd['AI Triage (Local Ollama)'] || [];
        let aiResults = [];
        for (const run of aiRuns) {
          for (const ol of (run.data?.main || [])) {
            for (const item of (ol || [])) {
              const j = item.json || {};
              try {
                const parsed = JSON.parse(j.response || '{}');
                aiResults.push({
                  important: parsed.is_important,
                  category: parsed.category,
                  summary: (parsed.summary || '').slice(0, 80),
                  reason: (parsed.reason || '').slice(0, 80),
                });
              } catch {}
            }
          }
        }

        // Get subjects from Gmail node for correlation
        let subjects = [];
        for (const run of gmailRuns) {
          for (const ol of (run.data?.main || [])) {
            for (const item of (ol || [])) {
              const j = item.json || {};
              subjects.push({
                from: (j.From || j.from || '').slice(0, 50),
                subject: (j.subject || j.Subject || '').slice(0, 60),
              });
            }
          }
        }

        console.log(`\n  Emails fetched: ${emailCount}`);
        console.log(`  Flagged important: ${flagged.length}`);

        console.log(`\n  --- All ${emailCount} emails with AI verdict ---`);
        for (let i = 0; i < subjects.length; i++) {
          const ai = aiResults[i] || {};
          const flag = ai.important ? '*** IMPORTANT ***' : '    skip';
          console.log(`  ${flag} | ${subjects[i].from}`);
          console.log(`         ${subjects[i].subject}`);
          if (ai.important) {
            console.log(`         Category: ${ai.category} | ${ai.reason}`);
          }
        }

        if (flagged.length > 0) {
          console.log(`\n  --- Written to Notion ---`);
          for (const f of flagged) {
            console.log(`  * ${f.title}`);
            console.log(`    From: ${f.sender} | Category: ${f.category}`);
          }
        }

        allResults.push({
          account: acct.email,
          fetched: emailCount,
          flagged: flagged.length,
          aiResults,
        });

        result = true;
        break;
      }

      // Progress update every 60s
      if (i > 0 && i % 30 === 0) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`  ... ${elapsed}s elapsed, still running`);
      }
    }

    if (!result) console.log('  TIMED OUT');
  }

  // Restore to account 1
  await patchCredential('jACGwijQXj0rEYqR', 'Gmail account 1');

  console.log(`\n\n${'='.repeat(60)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(60)}`);
  for (const r of allResults) {
    const importantCount = r.aiResults.filter(a => a.important).length;
    console.log(`${r.account}: ${r.fetched} emails, ${importantCount} flagged important, ${r.flagged} written to Notion`);
  }

  await browser.close();
})();
