const puppeteer = require('puppeteer');

const N8N_URL = 'http://localhost:5678';
const N8N_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZTRkZTAyMy1mMGMzLTRlODAtOThlYi04ZmRkOGE1MTdjYjMiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiYWNiZjI5MDMtNTVkMy00MTQ0LWE2ZjQtZTgyN2E1ZDFmNzliIiwiaWF0IjoxNzcyNzI3MjY5LCJleHAiOjE3NzUyNjA4MDB9.XrePb6rP8yypF-roL4kRGjVQhj8Um6VEJ9SS8pINgqM';
const WF_ID = 'FgXJ0dTlOibbKHr0';

(async () => {
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
    await emailInput.type('cortexcerebral@gmail.com');
    await passInput.click({ clickCount: 3 });
    await passInput.type('Hjkhjk.,23');
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.toLowerCase().includes('sign in')) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  // Get last exec ID
  const beforeResp = await fetch(`${N8N_URL}/api/v1/executions?workflowId=${WF_ID}&limit=1`, {
    headers: { 'X-N8N-API-KEY': N8N_API_KEY },
  });
  const beforeData = await beforeResp.json();
  const lastId = parseInt(beforeData.data?.[0]?.id || '0');
  console.log(`Last exec before: ${lastId}`);

  // Go to workflow and execute
  await page.goto(`${N8N_URL}/workflow/${WF_ID}`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));

  await page.screenshot({ path: '/tmp/n8n-probe-before.png' });

  const execBtn = await page.$('[data-test-id="execute-workflow-button"]');
  if (execBtn) {
    await execBtn.click();
    console.log('Triggered via data-test-id');
  } else {
    // Fallback: find button by text
    const allButtons = await page.$$('button');
    let clicked = false;
    for (const btn of allButtons) {
      const text = await page.evaluate(el => el.textContent.trim(), btn);
      if (text.includes('Execute') || text.includes('Test workflow')) {
        await btn.click();
        console.log(`Triggered via text: "${text}"`);
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      // List all buttons for debugging
      for (const btn of allButtons) {
        const text = await page.evaluate(el => el.textContent.trim(), btn);
        const testId = await page.evaluate(el => el.getAttribute('data-test-id') || '', btn);
        console.log(`  Button: "${text}" [${testId}]`);
      }
      console.log('No execute button found');
      await page.screenshot({ path: '/tmp/n8n-probe-debug.png' });
      await browser.close();
      return;
    }
  }

  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: '/tmp/n8n-probe-after.png' });

  // Poll with numeric comparison and longer timeout
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const resp = await fetch(`${N8N_URL}/api/v1/executions?workflowId=${WF_ID}&limit=1`, {
      headers: { 'X-N8N-API-KEY': N8N_API_KEY },
    });
    const list = await resp.json();
    const latest = list.data?.[0];
    if (latest && parseInt(latest.id) > lastId && !['running','new','waiting'].includes(latest.status)) {
      const detResp = await fetch(`${N8N_URL}/api/v1/executions/${latest.id}?includeData=true`, {
        headers: { 'X-N8N-API-KEY': N8N_API_KEY },
      });
      const det = await detResp.json();
      const rd = det.data?.resultData?.runData || {};
      const gmail = rd['Gmail Get All'] || [];
      for (const run of gmail) {
        if (run.error) { console.log(`ERROR: ${run.error.message}`); continue; }
        for (const outList of (run.data?.main || [])) {
          for (const item of (outList || [])) {
            const j = item.json || {};
            console.log(`To: ${j.to || j.To || j.deliveredTo || j['Delivered-To'] || 'unknown'}`);
            console.log(`From: ${j.From || j.from || 'unknown'}`);
            console.log(`Subject: ${j.subject || j.Subject || 'no subject'}`);
          }
        }
      }
      if (!gmail.length) console.log(`Status: ${latest.status}, no Gmail data`);
      break;
    }
    if (i === 59) console.log('Timed out');
  }

  await browser.close();
})();
