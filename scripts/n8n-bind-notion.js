const puppeteer = require('puppeteer');
const { N8N_URL, N8N_EMAIL: EMAIL, N8N_PASSWORD: PASSWORD } = require('./n8n-script-config.cjs');

const WORKFLOW_ID = 'mokeOVIdeUcbHYPU';

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
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
  await page.goto(`${N8N_URL}/workflow/${WORKFLOW_ID}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: '/tmp/n8n-bind-1.png' });

  // Find and double-click "Add to Notion" node
  // From screenshots, this node is on the far right side
  // Let's find it by searching for text
  const allEls = await page.$$('*');
  let clicked = false;
  for (const el of allEls) {
    const text = await page.evaluate(e => e.textContent, el);
    const tag = await page.evaluate(e => e.tagName, el);
    if (text === 'Add to Notion' && (tag === 'SPAN' || tag === 'DIV' || tag === 'P')) {
      const box = await el.boundingBox();
      if (box && box.width < 300 && box.width > 20) {
        console.log(`Found "Add to Notion" at ${box.x},${box.y} (${box.width}x${box.height})`);
        await page.mouse.click(box.x + box.width / 2, box.y - 30, { clickCount: 2 });
        clicked = true;
        break;
      }
    }
  }

  if (!clicked) {
    console.log('Trying coordinate click on Add to Notion area...');
    // Based on screenshots, Add to Notion is roughly at x=1100, y=420
    await page.mouse.click(1100, 420, { clickCount: 2 });
  }

  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: '/tmp/n8n-bind-2.png' });
  console.log('Node panel screenshot saved');

  // Look for credential dropdown or "Select Credential" button
  // Try clicking any dropdown that mentions credential
  const allButtons2 = await page.$$('button, [role="button"], .clickable, [class*="credential"]');
  for (const btn of allButtons2) {
    const text = await page.evaluate(e => e.textContent.trim(), btn);
    if (text.includes('credential') || text.includes('Credential') || text.includes('Select') || text.includes('Create new')) {
      console.log(`Found credential button: "${text.substring(0, 50)}"`);
      const box = await btn.boundingBox();
      if (box) {
        await btn.click();
        await new Promise(r => setTimeout(r, 2000));
        break;
      }
    }
  }

  await page.screenshot({ path: '/tmp/n8n-bind-3.png' });

  // Look for "Notion account" in dropdown
  const options = await page.$$('[role="option"], [role="menuitem"], li, [class*="option"], [class*="item"]');
  for (const opt of options) {
    const text = await page.evaluate(e => e.textContent.trim(), opt);
    if (text.includes('Notion account') || text.includes('notionApiMain')) {
      console.log(`Found Notion option: "${text.substring(0, 50)}"`);
      await opt.click();
      await new Promise(r => setTimeout(r, 2000));
      break;
    }
  }

  await page.screenshot({ path: '/tmp/n8n-bind-4.png' });

  // Close the panel and save (press Escape or click away, then Ctrl+S)
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 1000));

  // Save workflow with Ctrl+S
  await page.keyboard.down('Control');
  await page.keyboard.press('s');
  await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 2000));

  await page.screenshot({ path: '/tmp/n8n-bind-5.png' });
  console.log('Done. Screenshots saved as /tmp/n8n-bind-[1-5].png');

  await browser.close();
})();
