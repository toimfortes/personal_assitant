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

  // Login via REST API (correct field name)
  console.log('Logging in via REST...');
  await page.goto(N8N_URL, { waitUntil: 'networkidle2', timeout: 15000 });

  const loginResult = await page.evaluate(async (email, password) => {
    try {
      const resp = await fetch('/rest/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrLdapLoginId: email, password }),
        credentials: 'include',
      });
      return { status: resp.status, ok: resp.ok };
    } catch (e) {
      return { error: e.message };
    }
  }, EMAIL, PASSWORD);

  console.log('Login:', JSON.stringify(loginResult));
  if (!loginResult.ok) {
    console.log('Login failed!');
    await browser.close();
    return;
  }

  // Navigate to workflow
  await page.goto(`${N8N_URL}/workflow/${WORKFLOW_ID}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 3000));

  const url = page.url();
  console.log('URL:', url);
  if (url.includes('signin')) {
    console.log('Redirected to signin despite REST login');
    await browser.close();
    return;
  }

  await page.screenshot({ path: '/tmp/n8n-debug-0.png' });

  // Execute workflow
  console.log('Looking for Execute button...');
  const btnText = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    const texts = [];
    for (const b of btns) texts.push(b.textContent.trim());
    return texts;
  });
  console.log('Buttons found:', btnText.filter(t => t.length > 0 && t.length < 50).join(' | '));

  const clicked = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      const t = b.textContent.trim();
      if (t.includes('Test workflow') || t.includes('Execute workflow')) {
        b.click();
        return t;
      }
    }
    return null;
  });

  if (clicked) {
    console.log(`Clicked: "${clicked}"`);
  } else {
    console.log('No execute button found!');
    await page.screenshot({ path: '/tmp/n8n-debug-noexec.png' });
    await browser.close();
    return;
  }

  // Wait for execution and take periodic screenshots
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 15000));
    await page.screenshot({ path: '/tmp/n8n-debug-progress.png' });

    const pageText = await page.evaluate(() => document.body.innerText);

    if (pageText.includes('Problem in node')) {
      console.log(`ERROR at check ${i + 1}`);
      // Click on the error node to see details
      await page.screenshot({ path: '/tmp/n8n-debug-error.png' });

      // Try to read error text
      const errorInfo = await page.evaluate(() => {
        const errorEls = document.querySelectorAll('[class*="error"], [class*="Error"], .el-notification');
        let texts = [];
        for (const e of errorEls) {
          const t = e.textContent.trim();
          if (t.length > 10 && t.length < 500) texts.push(t);
        }
        return texts;
      });
      if (errorInfo.length) {
        console.log('Error details:', errorInfo.join('\n'));
      }
      break;
    }

    if (pageText.includes('Workflow executed successfully')) {
      console.log(`SUCCESS at check ${i + 1}`);
      break;
    }

    // Check node counts from the canvas
    const nodeInfo = await page.evaluate(() => {
      // Look for item count badges on nodes
      const badges = document.querySelectorAll('[class*="count"], [class*="badge"], [class*="items"]');
      let info = [];
      for (const b of badges) {
        const t = b.textContent.trim();
        if (t && t.match(/\d/)) info.push(t);
      }
      return info;
    });

    const hasRunning = pageText.includes('Executing') || pageText.includes('running');
    console.log(`Check ${i + 1}: ${hasRunning ? 'running' : 'idle'} ${nodeInfo.length ? 'items: ' + nodeInfo.join(', ') : ''}`);

    if (!hasRunning && i > 2) {
      console.log('Execution appears complete');
      break;
    }
  }

  await page.screenshot({ path: '/tmp/n8n-debug-final.png' });
  console.log('Done. Screenshots at /tmp/n8n-debug-*.png');
  await browser.close();
})();
