const { readFileSync } = require("fs");
const { join } = require("path");

const PROJECT_ROOT = join(__dirname, "..");
const ENV_PATH = join(PROJECT_ROOT, ".env");

function loadEnvFile() {
  const values = {};
  try {
    const raw = readFileSync(ENV_PATH, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
      const [key, ...rest] = line.split("=");
      values[key.trim()] = rest.join("=").trim();
    }
  } catch {
    // Fall back to process.env and defaults.
  }
  return values;
}

const envFile = loadEnvFile();

const N8N_URL = process.env.N8N_URL || envFile.N8N_EDITOR_BASE_URL || "http://localhost:5678";
const N8N_EMAIL = process.env.N8N_EMAIL || envFile.N8N_EMAIL || "cortexcerebral@gmail.com";
const N8N_PASSWORD = process.env.N8N_PASSWORD || envFile.N8N_PASSWORD || "";

async function jsonFetch(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${url}: ${JSON.stringify(data)}`);
  }
  return { resp, data };
}

async function getCookie() {
  if (!N8N_PASSWORD) {
    throw new Error("Missing N8N_PASSWORD; set it in the environment or .env");
  }

  const { resp } = await jsonFetch(`${N8N_URL}/rest/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emailOrLdapLoginId: N8N_EMAIL,
      password: N8N_PASSWORD,
    }),
  });

  const cookie = (resp.headers.getSetCookie?.() || [])
    .map((value) => value.split(";", 1)[0])
    .find((value) => value.startsWith("n8n-auth="));

  if (!cookie) {
    throw new Error("n8n-auth cookie missing after login");
  }

  return cookie;
}

async function loginPage(page) {
  await page.goto(`${N8N_URL}/signin`, { waitUntil: "networkidle2" });
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const emailInput = await page.$('input[autocomplete="email"], input[type="email"]');
  const passInput = await page.$('input[type="password"]');
  if (!emailInput || !passInput) return false;

  await emailInput.click({ clickCount: 3 });
  await emailInput.type(N8N_EMAIL);
  await passInput.click({ clickCount: 3 });
  await passInput.type(N8N_PASSWORD);

  for (const button of await page.$$("button")) {
    const text = (await page.evaluate((el) => el.textContent || "", button)).toLowerCase();
    if (text.includes("sign in") || text.includes("login")) {
      await button.click();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return true;
    }
  }

  return false;
}

async function findExecuteButton(page) {
  const selectors = [
    '[data-test-id="execute-workflow-button"]',
    '[data-test-id="workflow-execute-button"]',
    '[data-test-id="run-workflow-button"]',
    'button[aria-label*="Execute"]',
    'button[aria-label*="Test workflow"]',
  ];

  for (const selector of selectors) {
    const button = await page.$(selector);
    if (button) return button;
  }

  for (const button of await page.$$("button")) {
    const text = (await page.evaluate((el) => (el.textContent || "").trim(), button)).toLowerCase();
    if (text.includes("execute") || text.includes("test workflow") || text.includes("run workflow")) {
      return button;
    }
  }

  return null;
}

async function listExecutions(cookie, workflowId, limit = 20) {
  const { data } = await jsonFetch(`${N8N_URL}/rest/executions?limit=${limit}`, {
    headers: { Cookie: cookie },
  });

  const results = data.data?.results || [];
  return workflowId ? results.filter((execution) => execution.workflowId === workflowId) : results;
}

async function fetchExecution(cookie, executionId, includeData = false) {
  const suffix = includeData ? "?includeData=true" : "";
  const { data } = await jsonFetch(`${N8N_URL}/rest/executions/${executionId}${suffix}`, {
    headers: { Cookie: cookie },
  });
  return data.data || data;
}

module.exports = {
  N8N_URL,
  N8N_EMAIL,
  N8N_PASSWORD,
  getCookie,
  loginPage,
  findExecuteButton,
  listExecutions,
  fetchExecution,
};
