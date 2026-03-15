const puppeteer = require('puppeteer');
const { N8N_URL, N8N_EMAIL: EMAIL, N8N_PASSWORD: PASSWORD } = require('./n8n-script-config.cjs');

const WORKFLOW_PATH = process.argv[2] || '/workflow/FgXJ0dTlOibbKHr0';
const NODE_NAME = process.argv[3] || 'Gmail Get All';

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

  await page.goto(`${N8N_URL}${WORKFLOW_PATH}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 3000));

  // Double-click on the target node to open its panel
  const allElements = await page.$$('*');
  let found = false;
  for (const el of allElements) {
    const text = await page.evaluate(el => el.textContent, el);
    const tag = await page.evaluate(el => el.tagName, el);
    const cls = await page.evaluate(el => el.className, el);
    if (text === NODE_NAME && (tag === 'SPAN' || tag === 'DIV') && !found) {
      const box = await el.boundingBox();
      if (box && box.width < 300 && box.width > 20) {
        console.log(`Found node "${NODE_NAME}" at ${box.x},${box.y} (${box.width}x${box.height})`);
        await page.mouse.click(box.x + box.width/2, box.y + box.height/2, { clickCount: 2 });
        found = true;
        break;
      }
    }
  }

  if (!found) {
    console.log(`Node "${NODE_NAME}" not found by text, trying coordinates`);
  }

  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: '/tmp/n8n-node-output.png', fullPage: false });
  console.log('Screenshot saved: /tmp/n8n-node-output.png');

  await browser.close();
})();
