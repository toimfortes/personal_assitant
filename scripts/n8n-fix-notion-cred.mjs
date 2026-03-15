#!/usr/bin/env node
import puppeteer from 'puppeteer';
import n8nConfig from './n8n-script-config.cjs';

const { N8N_URL, N8N_EMAIL, N8N_PASSWORD } = n8nConfig;
const WORKFLOW_ID = 'PGA0GAmNmnYEKWyR';
const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewport({ width: 1400, height: 900 });

  try {
    // Login
    console.log('Logging in...');
    await page.goto(`${N8N_URL}/signin`, { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(1000);
    await page.type('input[type="email"]', N8N_EMAIL, { delay: 30 });
    await page.type('input[type="password"]', N8N_PASSWORD, { delay: 30 });
    await delay(300);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim().toLowerCase().includes('sign in'));
      if (btn) btn.click();
    });
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    await delay(2000);

    // Open workflow
    console.log('Opening workflow...');
    await page.goto(`${N8N_URL}/workflow/${WORKFLOW_ID}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(3000);

    // Double-click "Add to Notion" node
    console.log('Opening "Add to Notion" node...');
    await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.trim() === 'Add to Notion') {
          let el = walker.currentNode.parentElement;
          for (let i = 0; i < 10 && el; i++) {
            if (el.getAttribute('data-test-id')?.includes('node') || el.classList?.toString().includes('node')) {
              el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
              return;
            }
            el = el.parentElement;
          }
          walker.currentNode.parentElement.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          return;
        }
      }
    });
    await delay(2000);

    // Click the credential dropdown
    console.log('Clicking credential dropdown...');
    await page.evaluate(() => {
      const sel = document.querySelector('[data-test-id="node-credentials-select"]');
      if (sel) sel.click();
    });
    await delay(1000);

    // Screenshot to see the options
    await page.screenshot({ path: '/tmp/n8n-notion-dropdown.png' });

    // Select EXACTLY "Notion account" (not "Test Notion Import Format UPDATED")
    const selected = await page.evaluate(() => {
      const options = document.querySelectorAll('[role="option"], .el-select-dropdown__item, li[class*="option"]');
      for (const opt of options) {
        const text = opt.textContent.trim();
        // Exact match - must start with "Notion account" and NOT contain "Test"
        if (text.startsWith('Notion account') && !text.includes('Test')) {
          opt.click();
          return text;
        }
      }
      return null;
    });
    console.log('Selected:', selected);
    await delay(500);

    // Save with Ctrl+S
    console.log('Saving...');
    await page.keyboard.down('Control');
    await page.keyboard.press('s');
    await page.keyboard.up('Control');
    await delay(2000);

    await page.screenshot({ path: '/tmp/n8n-notion-fixed.png' });
    console.log('Done!');

  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: '/tmp/n8n-fix-error.png' });
  } finally {
    await browser.close();
  }
})();
