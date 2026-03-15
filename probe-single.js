const puppeteer = require('puppeteer');
const { N8N_URL, loginPage, findExecuteButton, getCookie, listExecutions, fetchExecution } = require('./scripts/n8n-script-config.cjs');

const WF_ID = 'FgXJ0dTlOibbKHr0';

(async () => {
  const cookie = await getCookie();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  await loginPage(page);

  // Get last exec ID
  const lastId = parseInt((await listExecutions(cookie, WF_ID, 20))[0]?.id || '0');
  console.log(`Last exec before: ${lastId}`);

  // Go to workflow and execute
  await page.goto(`${N8N_URL}/workflow/${WF_ID}`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));

  await page.screenshot({ path: '/tmp/n8n-probe-before.png' });

  const execBtn = await findExecuteButton(page);
  if (execBtn) {
    await execBtn.click();
    console.log('Triggered workflow');
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
      const latest = (await listExecutions(cookie, WF_ID, 20))[0];
      if (latest && parseInt(latest.id) > lastId && !['running','new','waiting'].includes(latest.status)) {
      const det = await fetchExecution(cookie, latest.id, true);
      const rd = det.resultData?.runData || {};
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
