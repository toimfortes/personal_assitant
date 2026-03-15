const puppeteer = require('puppeteer');
const { N8N_URL, N8N_EMAIL: EMAIL, N8N_PASSWORD: PASSWORD } = require('./n8n-script-config.cjs');

const TARGET = process.argv[2] || '/';

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

    // Find and click submit button
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.toLowerCase().includes('sign in') || text.toLowerCase().includes('login')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 3000));
  } else {
    console.log('Login form not found, may already be logged in');
  }

  // Navigate to target
  const targetUrl = TARGET.startsWith('http') ? TARGET : `${N8N_URL}${TARGET}`;
  console.log('Navigating to:', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 3000));

  const outPath = '/tmp/n8n-screenshot.png';
  await page.screenshot({ path: outPath, fullPage: false });
  console.log('Screenshot saved:', outPath);

  await browser.close();
})();
