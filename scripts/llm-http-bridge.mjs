#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT || 11435);
const HOST = process.env.HOST || "0.0.0.0";
const MODEL_SETTINGS_PATH = process.env.MODEL_SETTINGS_PATH || "/app/config/model_settings.json";
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || "/workspace";
const DEFAULT_PRIMARY_MODEL = "google-gemini-cli/gemini-3-flash-preview";
const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

let cachedSettings = {
  primary: DEFAULT_PRIMARY_MODEL,
  fallbacks: [],
  timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
};

function normalizeModelIdentifier(model) {
  const value = String(model || "").trim();
  if (!value) return "";
  if (value.includes("/")) return value;
  return `ollama/${value}`;
}

function uniqueModels(models) {
  const seen = new Set();
  const ordered = [];
  for (const raw of models) {
    const model = normalizeModelIdentifier(raw);
    if (!model || seen.has(model)) continue;
    seen.add(model);
    ordered.push(model);
  }
  return ordered;
}

function cleanJsonText(raw) {
  const text = String(raw || "").trim().replace(/```json/g, "").replace(/```/g, "").trim();
  if (text.startsWith("{") && text.endsWith("}")) {
    return text;
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }
  throw new Error(`No JSON object found in provider output: ${text.slice(0, 200)}`);
}

async function loadSettings() {
  try {
    const raw = await readFile(MODEL_SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const llm = parsed?.llm ?? {};
    cachedSettings = {
      primary: normalizeModelIdentifier(llm.primary || DEFAULT_PRIMARY_MODEL) || DEFAULT_PRIMARY_MODEL,
      fallbacks: uniqueModels(Array.isArray(llm.fallbacks) ? llm.fallbacks : []),
      timeoutSeconds: Number(llm.timeout_seconds || DEFAULT_TIMEOUT_SECONDS) || DEFAULT_TIMEOUT_SECONDS,
    };
  } catch (error) {
    console.warn(`[llm-bridge] Failed to load model settings from ${MODEL_SETTINGS_PATH}: ${String(error)}`);
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function runCommand(args, prompt, timeoutSeconds) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: WORKSPACE_PATH,
      env: {
        ...process.env,
        HOME: process.env.HOME || "/home/node",
        NO_COLOR: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${args[0]} timed out after ${timeoutSeconds}s`));
    }, timeoutSeconds * 1000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });

    child.stdin.end(prompt);
  });
}

async function callGemini(providerModel, prompt, timeoutSeconds) {
  const model = providerModel.split("/", 2)[1];
  const result = await runCommand(["gemini", "-m", model, "-p", "", "--output-format", "json"], prompt, timeoutSeconds);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${providerModel} exited ${result.code}`);
  }
  const outer = JSON.parse(result.stdout);
  return {
    provider: "google-gemini-cli",
    model: providerModel,
    response: cleanJsonText(outer.response || ""),
  };
}

async function callClaude(providerModel, prompt, timeoutSeconds) {
  const model = providerModel.split("/", 2)[1];
  const result = await runCommand(
    ["claude", "-p", "--model", model, "--output-format", "json", "--permission-mode", "bypassPermissions", "--tools", ""],
    prompt,
    timeoutSeconds,
  );
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${providerModel} exited ${result.code}`);
  }
  const outer = JSON.parse(result.stdout);
  return {
    provider: "anthropic",
    model: providerModel,
    response: cleanJsonText(outer.result || ""),
  };
}

async function callCodex(providerModel, prompt, timeoutSeconds) {
  const model = providerModel.split("/", 2)[1];
  const tempDir = await mkdtemp(join(tmpdir(), "llm-bridge-"));
  const outputPath = join(tempDir, "codex-output.json");
  try {
    const result = await runCommand(
      ["codex", "exec", "-C", WORKSPACE_PATH, "--sandbox", "danger-full-access", "--skip-git-repo-check", "-m", model, "-o", outputPath, "-"],
      prompt,
      timeoutSeconds,
    );
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `${providerModel} exited ${result.code}`);
    }
    const rawOutput = await readFile(outputPath, "utf8");
    return {
      provider: "openai-codex",
      model: providerModel,
      response: cleanJsonText(rawOutput),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function callOllama(providerModel, prompt, timeoutSeconds) {
  const model = providerModel.split("/", 2)[1];
  const response = await fetch("http://ollama:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      prompt,
    }),
    signal: AbortSignal.timeout(timeoutSeconds * 1000),
  });
  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }
  const outer = await response.json();
  return {
    provider: "ollama",
    model: providerModel,
    response: cleanJsonText(outer.response || outer.thinking || ""),
  };
}

async function callProvider(providerModel, prompt, timeoutSeconds) {
  const provider = providerModel.split("/", 1)[0];
  if (provider === "google-gemini-cli") return callGemini(providerModel, prompt, timeoutSeconds);
  if (provider === "anthropic") return callClaude(providerModel, prompt, timeoutSeconds);
  if (provider === "openai-codex") return callCodex(providerModel, prompt, timeoutSeconds);
  if (provider === "ollama") return callOllama(providerModel, prompt, timeoutSeconds);
  throw new Error(`Unsupported provider ${provider}`);
}

function candidateModels(requestedModel, allowFallbacks = true) {
  const primary = normalizeModelIdentifier(requestedModel || cachedSettings.primary) || cachedSettings.primary;
  if (!allowFallbacks) {
    return [primary];
  }
  return uniqueModels([primary, ...cachedSettings.fallbacks]);
}

await loadSettings();
setInterval(() => {
  loadSettings().catch(() => {});
}, 60_000).unref();

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    sendJson(res, 200, {
      ok: true,
      status: "live",
      primary: cachedSettings.primary,
      fallbacks: cachedSettings.fallbacks,
    });
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/generate") {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const prompt = String(body?.prompt || "").trim();
    if (!prompt) {
      sendJson(res, 400, { ok: false, error: "Missing prompt" });
      return;
    }

    const timeoutSeconds = Number(body?.timeout_seconds || cachedSettings.timeoutSeconds) || cachedSettings.timeoutSeconds;
    const models = candidateModels(body?.model, body?.allow_fallbacks !== false);
    const failures = [];

    for (const providerModel of models) {
      try {
        const result = await callProvider(providerModel, prompt, timeoutSeconds);
        sendJson(res, 200, {
          provider: result.provider,
          model: result.model,
          response: result.response,
          attempted_models: models,
          fallback_used: providerModel !== models[0],
        });
        return;
      } catch (error) {
        failures.push({
          model: providerModel,
          error: String(error),
        });
      }
    }

    sendJson(res, 502, {
      ok: false,
      error: "All provider attempts failed",
      attempted_models: models,
      failures,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[llm-bridge] Listening on ${HOST}:${PORT}`);
});
