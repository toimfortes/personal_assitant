const puppeteer = require('puppeteer');

const N8N_URL = 'http://localhost:5678';
const EMAIL = 'cortexcerebral@gmail.com';
const PASSWORD = 'Hjkhjk.,23';
const WORKFLOW_ID = 'mokeOVIdeUcbHYPU';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Login via REST API first, then navigate
  console.log('Logging in via REST API...');
  await page.goto(N8N_URL, { waitUntil: 'networkidle2', timeout: 15000 });

  const loginResult = await page.evaluate(async (email, password) => {
    try {
      const resp = await fetch('/rest/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });
      const data = await resp.json();
      return { status: resp.status, ok: resp.ok, id: data?.data?.id };
    } catch (e) {
      return { error: e.message };
    }
  }, EMAIL, PASSWORD);

  console.log('Login result:', JSON.stringify(loginResult));

  if (!loginResult.ok) {
    // Try UI login as fallback
    console.log('REST login failed, trying UI...');
    await page.goto(`${N8N_URL}/signin`, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: '/tmp/n8n-bar-login.png' });

    // Try multiple input selectors
    const emailSel = await page.$('input[name="email"]') ||
                     await page.$('input[type="email"]') ||
                     await page.$('input[autocomplete="email"]') ||
                     await page.$('input:first-of-type');
    const passSel = await page.$('input[name="password"]') ||
                    await page.$('input[type="password"]');

    if (emailSel && passSel) {
      await emailSel.click({ clickCount: 3 });
      await emailSel.type(EMAIL, { delay: 50 });
      await passSel.click({ clickCount: 3 });
      await passSel.type(PASSWORD, { delay: 50 });
      await new Promise(r => setTimeout(r, 500));

      // Click sign in
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          if (b.textContent.toLowerCase().includes('sign in')) { b.click(); return; }
        }
      });
      await new Promise(r => setTimeout(r, 3000));
    }
    await page.screenshot({ path: '/tmp/n8n-bar-login2.png' });
  }

  // Check we're logged in
  await page.goto(`${N8N_URL}/workflow/${WORKFLOW_ID}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: '/tmp/n8n-bar-0.png' });

  const currentUrl = page.url();
  console.log('Current URL:', currentUrl);
  if (currentUrl.includes('signin')) {
    console.log('ERROR: Still on signin page. Login failed.');
    await browser.close();
    return;
  }

  // Check workflow via internal API
  console.log('Checking workflow nodes...');
  const wfData = await page.evaluate(async (wfId) => {
    try {
      const resp = await fetch(`/rest/workflows/${wfId}`, { credentials: 'include' });
      const data = await resp.json();
      const nodes = data.data ? data.data.nodes : data.nodes || [];
      return nodes.map(n => ({
        name: n.name,
        type: n.type,
        credentials: n.credentials || {},
      }));
    } catch (e) {
      return { error: e.message };
    }
  }, WORKFLOW_ID);

  console.log('Workflow nodes:');
  for (const node of (Array.isArray(wfData) ? wfData : [])) {
    const hasCreds = Object.keys(node.credentials).length > 0;
    console.log(`  ${node.name} [${node.type}]${hasCreds ? ' creds:' + JSON.stringify(node.credentials) : ''}`);
  }

  // Find the Notion node name
  const notionNode = (Array.isArray(wfData) ? wfData : []).find(n =>
    n.type.includes('notion') || n.type.includes('Notion') || n.name.includes('Notion')
  );

  if (notionNode) {
    console.log(`\nNotion node: "${notionNode.name}", credentials: ${JSON.stringify(notionNode.credentials)}`);
    const hasBoundCred = Object.keys(notionNode.credentials).length > 0;

    if (!hasBoundCred) {
      console.log('Notion credential NOT bound - fixing via UI...');

      // Double-click the Notion node
      const nodeLabel = notionNode.name;
      let clicked = false;

      const allEls = await page.$$('.node-default');
      for (const el of allEls) {
        const text = await page.evaluate(e => e.textContent, el);
        if (text.includes(nodeLabel) || text.includes('Notion')) {
          const box = await el.boundingBox();
          if (box) {
            console.log(`Clicking node at ${box.x},${box.y}`);
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 2 });
            clicked = true;
            break;
          }
        }
      }

      if (!clicked) {
        // Try searching all elements for the node name
        const found = await page.evaluate((label) => {
          const els = document.querySelectorAll('*');
          for (const el of els) {
            if (el.textContent === label && el.offsetWidth > 20 && el.offsetWidth < 300) {
              const rect = el.getBoundingClientRect();
              return { x: rect.x + rect.width / 2, y: rect.y - 30 };
            }
          }
          return null;
        }, nodeLabel);

        if (found) {
          console.log(`Found node text at ${found.x},${found.y}`);
          await page.mouse.click(found.x, found.y, { clickCount: 2 });
          clicked = true;
        }
      }

      await new Promise(r => setTimeout(r, 3000));
      await page.screenshot({ path: '/tmp/n8n-bar-1.png' });

      // Look for credential dropdown
      const credBtn = await page.evaluate(() => {
        const btns = document.querySelectorAll('button, [role="button"]');
        for (const b of btns) {
          const t = b.textContent.trim();
          if (t.includes('credential') || t.includes('Credential') || t.includes('Create new') || t.includes('Select')) {
            const rect = b.getBoundingClientRect();
            if (rect.width > 0) return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: t.substring(0, 60) };
          }
        }
        return null;
      });

      if (credBtn) {
        console.log(`Clicking credential button: "${credBtn.text}"`);
        await page.mouse.click(credBtn.x, credBtn.y);
        await new Promise(r => setTimeout(r, 2000));

        await page.screenshot({ path: '/tmp/n8n-bar-2.png' });

        // Select Notion account
        const optResult = await page.evaluate(() => {
          const opts = document.querySelectorAll('[role="option"], [role="menuitem"], li, [class*="option"]');
          for (const o of opts) {
            const t = o.textContent.trim();
            if (t.includes('Notion account') || t.includes('notionApiMain') || t.includes('Notion')) {
              o.click();
              return t;
            }
          }
          return null;
        });

        if (optResult) {
          console.log(`Selected credential: "${optResult}"`);
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      await page.screenshot({ path: '/tmp/n8n-bar-3.png' });

      // Close panel and save
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 1000));
    } else {
      console.log('Notion credential already bound!');
    }
  } else {
    console.log('WARNING: No Notion node found in workflow');
  }

  // Save workflow
  console.log('Saving workflow...');
  await page.keyboard.down('Control');
  await page.keyboard.press('s');
  await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 2000));

  // Execute workflow
  console.log('Executing workflow...');
  const execResult = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      const t = b.textContent.trim();
      if (t.includes('Execute workflow') || t.includes('Test workflow')) {
        b.click();
        return t;
      }
    }
    return null;
  });

  if (execResult) {
    console.log(`Clicked: "${execResult}"`);
  } else {
    console.log('Execute button not found by text, taking screenshot...');
    await page.screenshot({ path: '/tmp/n8n-bar-noexec.png' });
  }

  // Poll for completion
  console.log('Polling for completion (up to 15 min)...');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 30000));
    await page.screenshot({ path: '/tmp/n8n-bar-progress.png' });

    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.includes('Problem in node')) {
      console.log(`ERROR at check ${i + 1}`);
      await page.screenshot({ path: '/tmp/n8n-bar-error.png' });
      break;
    }
    if (pageText.includes('Workflow executed successfully')) {
      console.log(`SUCCESS at check ${i + 1}`);
      break;
    }

    const hasRunning = pageText.includes('Executing') || pageText.includes('running');
    console.log(`Check ${i + 1}: ${hasRunning ? 'still running' : 'may be done'}`);

    if (!hasRunning && i > 1) {
      console.log('Execution appears complete');
      break;
    }
  }

  await page.screenshot({ path: '/tmp/n8n-bar-final.png' });
  console.log('Done. Screenshots in /tmp/n8n-bar-*.png');
  await browser.close();
})();
