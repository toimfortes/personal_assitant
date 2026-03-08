const puppeteer = require('puppeteer');

const N8N_URL = 'http://localhost:5678';
const EMAIL = 'cortexcerebral@gmail.com';
const PASSWORD = 'Hjkhjk.,23';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  await page.goto(`${N8N_URL}/signin`, { waitUntil: 'networkidle2', timeout: 15000 });
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

  await page.goto(`${N8N_URL}/workflow/mokeOVIdeUcbHYPU`, { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 3000));

  // Execute
  const allButtons = await page.$$('button');
  for (const btn of allButtons) {
    const text = await page.evaluate(el => el.textContent.trim(), btn);
    if (text.includes('Execute workflow')) {
      console.log('Executing...');
      await btn.click();
      break;
    }
  }

  // Poll every 30s for up to 10 minutes
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 30000));
    await page.screenshot({ path: '/tmp/n8n-progress.png' });

    // Check if there's an error or completion
    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.includes('Problem in node')) {
      console.log(`Error detected at check ${i+1}`);
      break;
    }
    // Check if execution finished (Execute workflow button reappears without running indicator)
    const hasRunning = pageText.includes('Executing') || pageText.includes('running');
    console.log(`Check ${i+1}: ${hasRunning ? 'still running' : 'may be done'}`);

    if (!hasRunning && i > 0) {
      console.log('Execution appears complete');
      break;
    }
  }

  await page.screenshot({ path: '/tmp/n8n-final.png' });
  console.log('Final screenshot saved');
  await browser.close();
})();
