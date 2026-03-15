#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const ENV_PATH = join(PROJECT_ROOT, ".env");

const envFile = loadEnvFile();
const N8N_URL = process.env.N8N_URL || envFile.N8N_EDITOR_BASE_URL || "http://localhost:5678";
const EMAIL = process.env.N8N_EMAIL || envFile.N8N_EMAIL || "cortexcerebral@gmail.com";
const PASSWORD = process.env.N8N_PASSWORD || envFile.N8N_PASSWORD || "Hjkhjk.,23";
const WORKFLOW_ID = process.env.N8N_WORKFLOW_ID || "";
const WORKFLOW_NAME = process.env.N8N_WORKFLOW_NAME || "Gmail to Notion (Investor Triage) - cortexcerebral@gmail.com";
const EXECUTION_LIMIT = Number(process.env.N8N_EXECUTION_LIMIT || 20);

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

async function jsonFetch(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${url}: ${JSON.stringify(data)}`);
  }
  return { resp, data };
}

async function login() {
  const { resp } = await jsonFetch(`${N8N_URL}/rest/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emailOrLdapLoginId: EMAIL,
      password: PASSWORD,
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

async function listWorkflows(cookie) {
  const { data } = await jsonFetch(`${N8N_URL}/rest/workflows?pageSize=100`, {
    headers: { Cookie: cookie },
  });
  return data.data || [];
}

function pickWorkflow(workflows) {
  const exactId = WORKFLOW_ID ? workflows.find((workflow) => workflow.id === WORKFLOW_ID) : null;
  if (exactId) return exactId;

  const exactName = workflows.find((workflow) => workflow.name === WORKFLOW_NAME);
  if (exactName) return exactName;

  return workflows.find((workflow) => workflow.active && workflow.name?.startsWith("Gmail to Notion (Investor Triage) - ")) || null;
}

async function getWorkflow(cookie, workflowId) {
  const { data } = await jsonFetch(`${N8N_URL}/rest/workflows/${workflowId}`, {
    headers: { Cookie: cookie },
  });
  return data.data;
}

async function listExecutions(cookie) {
  const { data } = await jsonFetch(`${N8N_URL}/rest/executions?limit=${EXECUTION_LIMIT}`, {
    headers: { Cookie: cookie },
  });
  return data.data?.results || [];
}

async function getExecution(cookie, executionId) {
  const { data } = await jsonFetch(`${N8N_URL}/rest/executions/${executionId}?includeData=true`, {
    headers: { Cookie: cookie },
  });
  return data.data || data;
}

function summarizeRunData(runData = {}) {
  for (const [name, runs] of Object.entries(runData)) {
    for (const run of runs) {
      let items = 0;
      const outputs = run.data?.main || [];
      for (const out of outputs) {
        if (out) items += out.length;
      }
      const err = run.error;
      console.log(`\n${err ? "FAIL" : " OK "} | ${name}: ${err ? err.message?.slice(0, 300) : `${items} items`}`);

      if (err || !outputs[0]?.[0]?.json) continue;

      const first = outputs[0][0].json;
      if (name === "Add to Notion") {
        if (first.object === "page") {
          console.log(`  SUCCESS: Created page ${first.url}`);
        } else if (first.status) {
          console.log(`  Notion response: ${first.status} ${first.message || ""}`);
        } else {
          console.log(`  Response keys: ${Object.keys(first).join(", ")}`);
          console.log(`  Response: ${JSON.stringify(first).slice(0, 300)}`);
        }
      } else if (name === "AI Triage (Local Ollama)") {
        const resp = first.response || first.thinking;
        if (resp) {
          try {
            const parsed = JSON.parse(resp);
            console.log(`  AI result: important=${parsed.is_important}, cat=${parsed.category}`);
          } catch {
            console.log(`  Raw response: ${String(resp).slice(0, 200)}`);
          }
        }
        if (first.model) {
          console.log(`  Model: ${first.model}`);
        }
        if (first.provider) {
          console.log(`  Provider: ${first.provider}`);
        }
        if (first.fallback_used !== undefined) {
          console.log(`  Fallback used: ${first.fallback_used}`);
        }
      } else if (name === "Gmail Get All" || name === "Gmail Trigger") {
        console.log(`  First email: ${first.Subject || first.subject || "no subject"}`);
        console.log(`  From: ${first.From || first.from || "unknown"}`);
      }
    }
  }
}

function inflateExecutionData(flat) {
  const cache = new Map();

  const decodeIndex = (idx) => {
    if (cache.has(idx)) return cache.get(idx);
    const raw = flat[idx];
    let decoded;
    if (Array.isArray(raw)) {
      decoded = raw.map(decodeValue);
    } else if (raw && typeof raw === "object") {
      decoded = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, decodeValue(value)]));
    } else {
      decoded = raw;
    }
    cache.set(idx, decoded);
    return decoded;
  };

  const decodeValue = (value) => {
    if (typeof value === "string" && /^\d+$/.test(value)) {
      const idx = Number(value);
      if (idx >= 0 && idx < flat.length) return decodeIndex(idx);
    }
    if (Array.isArray(value)) return value.map(decodeValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, decodeValue(inner)]));
    }
    return value;
  };

  return decodeIndex(0);
}

(async () => {
  const cookie = await login();
  const workflowSummary = pickWorkflow(await listWorkflows(cookie));
  if (!workflowSummary) {
    throw new Error(`Could not find a runnable workflow for id='${WORKFLOW_ID}' name='${WORKFLOW_NAME}'`);
  }

  const workflowData = await getWorkflow(cookie, workflowSummary.id);
  console.log(`Using workflow: ${workflowData.name} (${workflowData.id})`);
  console.log("=== VERIFYING LATEST EXECUTION ===");

  const latest = (await listExecutions(cookie)).find((execution) => execution.workflowId === workflowData.id);
  if (!latest) {
    throw new Error(`No recent executions found for workflow ${workflowData.id}`);
  }

  console.log(`Latest execution: #${latest.id} status=${latest.status} startedAt=${latest.startedAt}`);
  const detail = await getExecution(cookie, latest.id);
  let rd = detail.resultData || {};
  if (!rd.runData && typeof detail.data === "string") {
    const inflated = inflateExecutionData(JSON.parse(detail.data));
    rd = inflated?.resultData || rd;
  }

  if (rd.error) {
    console.log("\n=== EXECUTION ERROR ===");
    console.log(JSON.stringify(rd.error, null, 2).slice(0, 500));
  }

  summarizeRunData(rd.runData);
})().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
