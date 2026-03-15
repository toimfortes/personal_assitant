const puppeteer = require('puppeteer');
const { N8N_URL, N8N_EMAIL: EMAIL, N8N_PASSWORD: PASSWORD } = require('./n8n-script-config.cjs');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Login
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

  // Go to workflow
  await page.goto(`${N8N_URL}/workflow/mokeOVIdeUcbHYPU`, { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 3000));

  // Execute
  const allButtons = await page.$$('button');
  for (const btn of allButtons) {
    const text = await page.evaluate(el => el.textContent.trim(), btn);
    if (text.includes('Execute workflow')) {
      console.log('Executing workflow...');
      await btn.click();
      break;
    }
  }

  // Wait for execution to complete or error (up to 30s)
  console.log('Waiting for execution...');
  await new Promise(r => setTimeout(r, 20000));

  await page.screenshot({ path: '/tmp/n8n-step1.png' });
  console.log('Step 1 screenshot saved');

  // Now double-click on Gmail Get All to see its output
  // The Gmail node is roughly at position x=575, y=420 based on earlier screenshots
  await page.mouse.click(575, 420, { clickCount: 2 });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: '/tmp/n8n-gmail-detail.png' });
  console.log('Gmail detail screenshot saved');

  await browser.close();
})();
