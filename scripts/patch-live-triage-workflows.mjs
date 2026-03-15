#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const MODEL_SETTINGS_PATH = join(PROJECT_ROOT, "config", "model_settings.json");
const ENV_PATH = join(PROJECT_ROOT, ".env");

const envFile = loadEnvFile();
const N8N_URL = process.env.N8N_URL || "http://localhost:5678";
const LOGIN_EMAIL = process.env.N8N_EMAIL || "cortexcerebral@gmail.com";
const LOGIN_PASSWORD = process.env.N8N_PASSWORD || envFile.N8N_PASSWORD;
const LLM_BRIDGE_URL = process.env.LLM_BRIDGE_URL || "http://llm-bridge:11435/api/generate";
const PRIMARY_MODEL = loadPrimaryModel();

function loadEnvFile() {
  const env = {};
  try {
    const raw = readFileSync(ENV_PATH, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
      const [key, ...rest] = line.split("=");
      env[key.trim()] = rest.join("=").trim();
    }
  } catch {}
  return env;
}

function loadPrimaryModel() {
  const raw = JSON.parse(readFileSync(MODEL_SETTINGS_PATH, "utf8"));
  return String(raw?.llm?.primary || "google-gemini-cli/gemini-3-flash-preview").trim();
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
  if (!LOGIN_PASSWORD) {
    throw new Error("Missing N8N_PASSWORD for workflow patch");
  }

  const { resp } = await jsonFetch(`${N8N_URL}/rest/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emailOrLdapLoginId: LOGIN_EMAIL,
      password: LOGIN_PASSWORD,
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

function patchType1Node(params) {
  let changed = false;
  if (params.url !== LLM_BRIDGE_URL) {
    params.url = LLM_BRIDGE_URL;
    changed = true;
  }

  const parameters = params?.bodyParameters?.parameters;
  if (!Array.isArray(parameters)) return changed;

  for (const entry of parameters) {
    if (entry?.name === "model" && entry.value !== PRIMARY_MODEL) {
      entry.value = PRIMARY_MODEL;
      changed = true;
    }
  }

  return changed;
}

function patchType4Node(params) {
  let changed = false;
  if (params.url !== LLM_BRIDGE_URL) {
    params.url = LLM_BRIDGE_URL;
    changed = true;
  }

  if (typeof params.jsonBody === "string") {
    const nextBody = params.jsonBody.replace(/\bmodel:\s*["'][^"']+["']/, `model: "${PRIMARY_MODEL}"`);
    if (nextBody !== params.jsonBody) {
      params.jsonBody = nextBody;
      changed = true;
    }
  }

  return changed;
}

function patchWorkflow(workflow) {
  let changed = false;
  for (const node of workflow.nodes || []) {
    if (node?.name !== "AI Triage (Local Ollama)") continue;
    const params = node.parameters || {};
    if (Array.isArray(params?.bodyParameters?.parameters)) {
      changed = patchType1Node(params) || changed;
      continue;
    }
    changed = patchType4Node(params) || changed;
  }
  return changed;
}

function activeVersionNeedsRefresh(workflow) {
  if (!workflow.active || !workflow.activeVersion?.nodes) return false;
  const draft = JSON.parse(JSON.stringify({ nodes: workflow.activeVersion.nodes }));
  return patchWorkflow(draft);
}

async function updateWorkflow(cookie, workflow) {
  const changed = patchWorkflow(workflow);
  const needsRepublish = changed || activeVersionNeedsRefresh(workflow);

  if (changed) {
    const payload = {
      nodes: workflow.nodes,
      connections: workflow.connections,
    };

    await jsonFetch(`${N8N_URL}/rest/workflows/${workflow.id}`, {
      method: "PATCH",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  let republished = false;
  if (workflow.active && needsRepublish) {
    await jsonFetch(`${N8N_URL}/rest/workflows/${workflow.id}/activate`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ versionId: workflow.versionId }),
    });
    republished = true;
  }

  return { id: workflow.id, name: workflow.name, changed, republished };
}

async function main() {
  const cookie = await login();
  const { data: listPayload } = await jsonFetch(`${N8N_URL}/rest/workflows?pageSize=100`, {
    headers: { Cookie: cookie },
  });

  const results = [];
  for (const summary of listPayload.data || []) {
    const { data: workflowPayload } = await jsonFetch(`${N8N_URL}/rest/workflows/${summary.id}`, {
      headers: { Cookie: cookie },
    });
    results.push(await updateWorkflow(cookie, workflowPayload.data));
  }

  const touched = results.filter((entry) => entry.changed || entry.republished);
  console.log(JSON.stringify({
    llmBridgeUrl: LLM_BRIDGE_URL,
    primaryModel: PRIMARY_MODEL,
    patched: results.filter((entry) => entry.changed).length,
    republished: results.filter((entry) => entry.republished).length,
    workflows: touched,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
