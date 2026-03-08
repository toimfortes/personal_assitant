import puppeteer from 'puppeteer';

const N8N_URL = 'http://localhost:5678';
const EMAIL = 'cortexcerebral@gmail.com';
const PASSWORD = 'Hjkhjk.,23';
const N8N_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZTRkZTAyMy1mMGMzLTRlODAtOThlYi04ZmRkOGE1MTdjYjMiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiYWNiZjI5MDMtNTVkMy00MTQ0LWE2ZjQtZTgyN2E1ZDFmNzliIiwiaWF0IjoxNzcyNzI3MjY5LCJleHAiOjE3NzUyNjA4MDB9.XrePb6rP8yypF-roL4kRGjVQhj8Um6VEJ9SS8pINgqM';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  // Login
  await page.goto(N8N_URL, { waitUntil: 'networkidle2' });
  const allInputs = await page.$$('input');
  await allInputs[0].type(EMAIL, { delay: 20 });
  await allInputs[1].type(PASSWORD, { delay: 20 });
  const signInBtn = await page.$('button');
  await signInBtn.click();
  await new Promise(r => setTimeout(r, 3000));
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 500));

  // Get current latest execution ID before triggering
  const beforeResp = await fetch(`${N8N_URL}/api/v1/executions?workflowId=FgXJ0dTlOibbKHr0&limit=1`, {
    headers: { 'X-N8N-API-KEY': N8N_API_KEY },
  });
  const beforeList = await beforeResp.json();
  const lastExecId = beforeList.data?.[0]?.id || 0;
  console.log(`Last execution ID before trigger: ${lastExecId}`);

  // Go to workflow editor and execute
  await page.goto(`${N8N_URL}/workflow/FgXJ0dTlOibbKHr0`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  // Close drawers
  const closeButtons = await page.$$('.el-drawer__close-btn');
  for (const btn of closeButtons) { try { await btn.click(); } catch (e) {} }
  await new Promise(r => setTimeout(r, 500));

  console.log('=== EXECUTING ===');
  const execBtn = await page.$('[data-test-id="execute-workflow-button"]');
  await execBtn.click();

  // Wait for the new execution to appear
  let executionId = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const resp = await fetch(`${N8N_URL}/api/v1/executions?workflowId=FgXJ0dTlOibbKHr0&limit=1`, {
      headers: { 'X-N8N-API-KEY': N8N_API_KEY },
    });
    const list = await resp.json();
    const latest = list.data?.[0];
    if (latest && latest.id > lastExecId) {
      executionId = latest.id;
      console.log(`New execution: #${executionId}, status: ${latest.status}`);
      break;
    }
  }

  if (!executionId) {
    console.log('Could not find new execution');
    await browser.close();
    return;
  }

  // Poll for completion
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const statusResp = await fetch(`${N8N_URL}/api/v1/executions/${executionId}`, {
      headers: { 'X-N8N-API-KEY': N8N_API_KEY },
    });
    const exec = await statusResp.json();
    const status = exec.status;

    if (status !== 'running' && status !== 'new' && status !== 'waiting') {
      console.log(`\nExecution #${executionId} finished: status=${status}`);

      // Get detailed results
      const detailResp = await fetch(`${N8N_URL}/api/v1/executions/${executionId}?includeData=true`, {
        headers: { 'X-N8N-API-KEY': N8N_API_KEY },
      });
      const detail = await detailResp.json();
      const rd = detail.data?.resultData || {};

      if (rd.error) {
        console.log('\n=== EXECUTION ERROR ===');
        console.log(JSON.stringify(rd.error, null, 2).slice(0, 500));
      }

      if (rd.runData) {
        for (const [name, runs] of Object.entries(rd.runData)) {
          for (const run of runs) {
            let items = 0;
            const outputs = run.data?.main || [];
            for (const out of outputs) {
              if (out) items += out.length;
            }
            const err = run.error;
            console.log(`\n${err ? 'FAIL' : ' OK '} | ${name}: ${err ? err.message?.slice(0, 300) : items + ' items'}`);

            // Show sample data for key nodes
            if (!err && outputs[0]?.[0]?.json) {
              const first = outputs[0][0].json;
              if (name === 'Add to Notion') {
                if (first.object === 'page') {
                  console.log(`  SUCCESS: Created page ${first.url}`);
                } else if (first.status) {
                  console.log(`  Notion response: ${first.status} ${first.message || ''}`);
                } else {
                  console.log(`  Response keys: ${Object.keys(first).join(', ')}`);
                  console.log(`  Response: ${JSON.stringify(first).slice(0, 300)}`);
                }
              } else if (name === 'AI Triage (Local Ollama)') {
                const resp = first.response;
                if (resp) {
                  try {
                    const parsed = JSON.parse(resp);
                    console.log(`  AI result: important=${parsed.is_important}, cat=${parsed.category}`);
                  } catch(e) {
                    console.log(`  Raw response: ${resp.slice(0, 200)}`);
                  }
                }
              } else if (name === 'Gmail Get All') {
                console.log(`  First email: ${first.Subject || first.subject || 'no subject'}`);
                console.log(`  From: ${first.From || first.from || 'unknown'}`);
              }
            }
          }
        }
      }

      break;
    }

    if (i % 6 === 0) console.log(`  [${(i+1)*5}s] status: ${status}`);
  }

  await browser.close();
})();
