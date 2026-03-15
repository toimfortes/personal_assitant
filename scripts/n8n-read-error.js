const puppeteer = require('puppeteer');
const { N8N_URL, N8N_EMAIL: EMAIL, N8N_PASSWORD: PASSWORD } = require('./n8n-script-config.cjs');

const WORKFLOW_ID = 'mokeOVIdeUcbHYPU';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Login via REST
  await page.goto(N8N_URL, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.evaluate(async (email, password) => {
    await fetch('/rest/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrLdapLoginId: email, password }),
      credentials: 'include',
    });
  }, EMAIL, PASSWORD);

  // Go to workflow
  await page.goto(`${N8N_URL}/workflow/${WORKFLOW_ID}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 3000));

  // Double-click on "Add to Notion" node
  const nodePos = await page.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      if (el.textContent === 'Add to Notion' && el.offsetWidth > 20 && el.offsetWidth < 200) {
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  });

  if (nodePos) {
    await page.mouse.click(nodePos.x, nodePos.y - 40, { clickCount: 2 });
  } else {
    await page.mouse.click(1100, 420, { clickCount: 2 });
  }

  await new Promise(r => setTimeout(r, 3000));

  // Click on Output tab
  await page.evaluate(() => {
    const tabs = document.querySelectorAll('[role="tab"], [class*="tab"], span');
    for (const t of tabs) {
      const text = t.textContent.trim();
      if (text === 'Output' || text === 'ERROR') {
        t.click();
        return true;
      }
    }
    return false;
  });
  await new Promise(r => setTimeout(r, 1000));

  await page.screenshot({ path: '/tmp/n8n-error-detail.png' });

  // Read all text in the panel
  const panelText = await page.evaluate(() => {
    // Look for error messages
    const errorEls = document.querySelectorAll('[class*="error"], [class*="Error"], .el-notification, [class*="message"], [class*="output"]');
    let texts = [];
    for (const e of errorEls) {
      const t = e.textContent.trim();
      if (t.length > 5 && t.length < 2000) texts.push(t);
    }
    return texts;
  });

  console.log('Error info:');
  for (const t of panelText) {
    console.log(t.substring(0, 300));
    console.log('---');
  }

  // Also try to get the full page text in the output area
  const outputText = await page.evaluate(() => {
    const rightPanel = document.querySelector('[class*="output"], [class*="right"]');
    if (rightPanel) return rightPanel.textContent.substring(0, 2000);
    return '';
  });
  console.log('\nOutput panel text:');
  console.log(outputText.substring(0, 1000));

  await browser.close();
})();
