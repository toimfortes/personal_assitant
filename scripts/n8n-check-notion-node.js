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
    console.log(`Found Add to Notion at ${nodePos.x},${nodePos.y}`);
    // Click slightly above (on the node body, not the label)
    await page.mouse.click(nodePos.x, nodePos.y - 40, { clickCount: 2 });
  } else {
    console.log('Node text not found, trying coordinates');
    await page.mouse.click(1100, 420, { clickCount: 2 });
  }

  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: '/tmp/n8n-notion-panel.png' });

  // Read panel content
  const panelText = await page.evaluate(() => {
    // Look for the side panel
    const panel = document.querySelector('[class*="ndv"], [class*="node-details"], [class*="panel"]');
    if (panel) return panel.textContent.substring(0, 2000);
    return document.body.innerText.substring(0, 3000);
  });
  console.log('Panel content (first 1500 chars):');
  console.log(panelText.substring(0, 1500));

  // Check if there's an error tab or output tab
  const tabs = await page.evaluate(() => {
    const allTabs = document.querySelectorAll('[role="tab"], [class*="tab"]');
    return Array.from(allTabs).map(t => t.textContent.trim()).filter(t => t.length > 0 && t.length < 50);
  });
  console.log('\nTabs found:', tabs.join(' | '));

  // Try clicking "Output" tab if it exists
  await page.evaluate(() => {
    const tabs = document.querySelectorAll('[role="tab"], [class*="tab"]');
    for (const t of tabs) {
      if (t.textContent.trim().includes('Output')) {
        t.click();
        return;
      }
    }
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: '/tmp/n8n-notion-output.png' });

  await browser.close();
})();
