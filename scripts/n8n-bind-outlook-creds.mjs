#!/usr/bin/env node
/**
 * Bind Microsoft Outlook and Notion credentials to the Outlook triage workflow
 * via Puppeteer driving the n8n UI.
 */
import puppeteer from 'puppeteer';
import n8nConfig from './n8n-script-config.cjs';

const { N8N_URL, N8N_EMAIL, N8N_PASSWORD } = n8nConfig;
const WORKFLOW_ID = 'PGA0GAmNmnYEKWyR';

const delay = ms => new Promise(r => setTimeout(r, ms));

async function login(page) {
  console.log('Logging in to n8n...');
  await page.goto(`${N8N_URL}/signin`, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(1000);

  // Fill email
  await page.waitForSelector('input[type="email"], input[name="email"], input[autocomplete="email"]', { timeout: 10000 });
  await page.type('input[type="email"], input[name="email"], input[autocomplete="email"]', N8N_EMAIL, { delay: 30 });

  // Fill password
  await page.type('input[type="password"], input[name="password"]', N8N_PASSWORD, { delay: 30 });

  // Click sign in button
  await delay(300);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const signIn = btns.find(b => b.textContent.trim().toLowerCase().includes('sign in'));
    if (signIn) signIn.click();
  });

  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await delay(2000);
  console.log('Logged in. URL:', page.url());
}

async function openNode(page, nodeName) {
  console.log(`Opening node: "${nodeName}"...`);
  // n8n renders nodes on a canvas. Try to find and double-click the node.
  const found = await page.evaluate((name) => {
    // Search all elements for the node name text
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.textContent.trim() === name) {
        // Found the label - find clickable parent
        let el = node.parentElement;
        for (let i = 0; i < 10 && el; i++) {
          if (el.getAttribute('data-test-id')?.includes('node') ||
              el.classList?.contains('vue-flow__node') ||
              el.classList?.toString().includes('node')) {
            el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 100, clientY: 100 }));
            return { found: true, method: 'treewalker' };
          }
          el = el.parentElement;
        }
        // Just double-click the text element's parent
        node.parentElement.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        return { found: true, method: 'text-parent' };
      }
    }
    return { found: false };
  }, nodeName);

  console.log(`  Find result:`, JSON.stringify(found));
  await delay(2000);
  return found.found;
}

async function selectCredential(page, credName) {
  console.log(`  Selecting credential: "${credName}"...`);

  // Take screenshot to see the node panel
  await page.screenshot({ path: `/tmp/n8n-node-panel.png` });

  // Look for credential dropdown and click it
  const clicked = await page.evaluate(() => {
    // n8n credential dropdowns have data-test-id="node-credentials-select"
    // or are in a section with "Credential to connect with"
    const selects = document.querySelectorAll(
      '[data-test-id="node-credentials-select"], ' +
      '[class*="credentialPicker"], ' +
      '.credential-select'
    );
    if (selects.length > 0) {
      selects[0].click();
      return 'data-test-id';
    }

    // Try finding by label text
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.children.length === 0 && el.textContent.includes('Credential to connect with')) {
        // Find the closest dropdown/select nearby
        const parent = el.closest('.parameter, .n8n-input-wrapper, div');
        if (parent) {
          const dropdown = parent.querySelector('input, [role="combobox"], .n8n-select, .el-input');
          if (dropdown) {
            dropdown.click();
            return 'label-search';
          }
        }
      }
    }

    // Broad search: any dropdown in the node settings panel
    const panel = document.querySelector('[data-test-id="node-details-view"], .ndv-wrapper, [class*="ndv"]');
    if (panel) {
      const inputs = panel.querySelectorAll('[role="combobox"], .el-input__inner, .n8n-select input');
      if (inputs.length > 0) {
        inputs[0].click();
        return 'panel-first-input';
      }
    }
    return null;
  });

  console.log(`  Dropdown click method: ${clicked}`);
  await delay(1000);

  if (!clicked) {
    // Screenshot for debugging
    await page.screenshot({ path: '/tmp/n8n-no-dropdown.png' });
    console.log('  Screenshot saved: /tmp/n8n-no-dropdown.png');
    return false;
  }

  // Now select the credential from the opened dropdown
  await page.screenshot({ path: '/tmp/n8n-dropdown-open.png' });

  const selected = await page.evaluate((name) => {
    // Look for dropdown options
    const options = document.querySelectorAll(
      '[role="option"], ' +
      '.el-select-dropdown__item, ' +
      '[class*="listItem"], ' +
      'li[class*="option"], ' +
      '[data-test-id*="credential"] li'
    );
    for (const opt of options) {
      if (opt.textContent.includes(name)) {
        opt.click();
        return true;
      }
    }
    return false;
  }, credName);

  if (selected) {
    console.log(`  Selected "${credName}"`);
    await delay(500);
    return true;
  }

  console.log(`  Could not find "${credName}" in dropdown options`);
  await page.screenshot({ path: '/tmp/n8n-select-fail.png' });
  return false;
}

async function closePanel(page) {
  // Press Escape or click outside to close node panel
  await page.keyboard.press('Escape');
  await delay(500);
}

async function saveWorkflow(page) {
  console.log('\nSaving workflow...');
  // Ctrl+S to save
  await page.keyboard.down('Control');
  await page.keyboard.press('s');
  await page.keyboard.up('Control');
  await delay(2000);
  console.log('Save triggered');
}

(async () => {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewport({ width: 1400, height: 900 });

  try {
    // Step 1: Login
    await login(page);

    // Step 2: Open the Outlook workflow
    console.log(`\nNavigating to workflow ${WORKFLOW_ID}...`);
    await page.goto(`${N8N_URL}/workflow/${WORKFLOW_ID}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(3000);
    await page.screenshot({ path: '/tmp/n8n-outlook-workflow.png' });

    const pageInfo = await page.evaluate(() => ({
      url: window.location.href,
      bodySnippet: document.body.innerText.substring(0, 300),
    }));
    console.log('Workflow page URL:', pageInfo.url);

    // Step 3: Bind credential to Microsoft 365 Email trigger node
    if (await openNode(page, 'Microsoft 365 Email')) {
      await page.screenshot({ path: '/tmp/n8n-outlook-node-open.png' });
      await selectCredential(page, 'Microsoft Outlook account');
      await page.screenshot({ path: '/tmp/n8n-outlook-cred-bound.png' });
      await closePanel(page);
    }

    // Step 4: Bind credential to Add to Notion node
    if (await openNode(page, 'Add to Notion')) {
      await page.screenshot({ path: '/tmp/n8n-notion-node-open.png' });
      await selectCredential(page, 'Notion account');
      await page.screenshot({ path: '/tmp/n8n-notion-cred-bound.png' });
      await closePanel(page);
    }

    // Step 5: Save
    await saveWorkflow(page);
    await page.screenshot({ path: '/tmp/n8n-outlook-saved.png' });

    console.log('\nDone! Check screenshots in /tmp/n8n-*.png');

  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: '/tmp/n8n-error.png' });
  } finally {
    await browser.close();
  }
})();
