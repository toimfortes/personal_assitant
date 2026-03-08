const puppeteer = require('puppeteer');

const N8N_URL = 'http://localhost:5678';
const EMAIL = 'cortexcerebral@gmail.com';
const PASSWORD = 'Hjkhjk.,23';
const WORKFLOW_PATH = process.argv[2] || '/workflow/FgXJ0dTlOibbKHr0';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Go to sign-in page
  await page.goto(`${N8N_URL}/signin`, { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));

  // Fill login form
  const emailInput = await page.$('input[autocomplete="email"], input[type="email"], input[name="email"]');
  const passInput = await page.$('input[type="password"]');

  if (emailInput && passInput) {
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(EMAIL);
    await passInput.click({ clickCount: 3 });
    await passInput.type(PASSWORD);
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.toLowerCase().includes('sign in') || text.toLowerCase().includes('login')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  // Navigate to workflow
  await page.goto(`${N8N_URL}${WORKFLOW_PATH}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 3000));

  // Click "Execute workflow" button
  const execBtn = await page.$('button');
  const allButtons = await page.$$('button');
  let clicked = false;
  for (const btn of allButtons) {
    const text = await page.evaluate(el => el.textContent.trim(), btn);
    if (text.includes('Execute workflow')) {
      console.log('Clicking "Execute workflow"...');
      await btn.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    console.log('Could not find Execute workflow button');
  }

  // Wait for execution to progress
  await new Promise(r => setTimeout(r, 15000));
  await page.screenshot({ path: '/tmp/n8n-executing.png', fullPage: false });
  console.log('Screenshot saved: /tmp/n8n-executing.png');

  await browser.close();
})();
