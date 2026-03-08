#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

function loadEnv() {
  const envPath = join(PROJECT_ROOT, ".env");
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    env[key] = rest.join("=");
  }
  return env;
}

const ENV = loadEnv();

const NOTION_URL = "https://api.notion.com/v1";
const DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID || ENV.NOTION_DATA_SOURCE_ID || "2c91d51187a6805cab38000b18d92545";
const NOTION_VERSION = process.env.NOTION_API_VERSION || ENV.NOTION_API_VERSION || "2025-09-03";
const NOTION_TOKEN = process.env.NOTION_API_KEY || ENV.NOTION_API_KEY;

if (!NOTION_TOKEN) {
  console.error("NOTION_API_KEY is required");
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    pageId: "",
    dryRunProvider: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--page-id" && argv[i + 1]) {
      opts.pageId = argv[++i];
    } else if (arg === "--dry-run-provider") {
      opts.dryRunProvider = true;
    }
  }

  return opts;
}

const CLI = parseArgs(process.argv.slice(2));

function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function notionRequest(url, method = "GET", body = null) {
  const resp = await fetch(url, {
    method,
    headers: notionHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    throw new Error(`Notion ${method} ${url} failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.status === 204 ? {} : await resp.json();
}

function richTextToString(prop) {
  return (prop?.rich_text || []).map((part) => part.plain_text || "").join("").trim();
}

function titleToString(prop) {
  return (prop?.title || []).map((part) => part.plain_text || "").join("").trim();
}

function extractEmail(value) {
  const match = String(value || "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return match ? match[0].toLowerCase() : "";
}

function extractGmailId(originalLink) {
  const link = String(originalLink || "");
  const marker = "#inbox/";
  if (!link.includes(marker)) return "";
  return link.split(marker).pop() || "";
}

async function getPendingPages() {
  const pages = [];
  let cursor = null;
  do {
    const body = {
      page_size: 100,
      filter: {
        or: [
          { property: "Provider Action Status", select: { equals: "Pending" } },
          { property: "Provider Action Status", select: { equals: "Retry" } },
        ],
      },
      start_cursor: cursor || undefined,
    };
    const result = await notionRequest(`${NOTION_URL}/data_sources/${DATA_SOURCE_ID}/query`, "POST", body);
    pages.push(...(result.results || []));
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);
  return pages.filter((page) => {
    if (CLI.pageId && page.id !== CLI.pageId) return false;
    const action = (page.properties?.["Provider Action"]?.select || {}).name || "";
    return action && action !== "None";
  });
}

async function updatePage(pageId, { queue, providerActionStatus, status }) {
  return notionRequest(`${NOTION_URL}/pages/${pageId}`, "PATCH", {
    properties: {
      Queue: { select: { name: queue } },
      "Provider Action Status": { select: { name: providerActionStatus } },
      Status: { select: { name: status } },
    },
  });
}

async function runCleanupAction(args) {
  const finalArgs = ["scripts/email-cleanup-actions.mjs", ...args];
  if (CLI.dryRunProvider) {
    finalArgs.push("--dry-run");
  }
  const { stdout } = await execFileAsync("node", finalArgs, {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout.trim());
}

async function handleGmail(action, mailbox, senderEmail, senderDomain) {
  if (action === "Block Sender") {
    return runCleanupAction(["--action", "block", "--sender", senderEmail, "--account", mailbox]);
  }
  if (action === "Block Domain") {
    return runCleanupAction(["--action", "block", "--domain", senderDomain, "--account", mailbox]);
  }
  if (action === "Report Spam" || action === "Report Phishing") {
    return runCleanupAction(["--action", "block", "--sender", senderEmail || senderDomain, ...(senderEmail ? [] : ["--domain", senderDomain]), "--account", mailbox]);
  }
  if (action === "Unsubscribe") {
    return { success: false, skipped: true, message: "Unsubscribe automation not implemented yet; missing stored unsubscribe target" };
  }
  return { success: false, skipped: true, message: `Unsupported Gmail provider action: ${action}` };
}

async function handleOutlook(action, senderEmail, senderDomain) {
  if (action === "Block Sender" && senderEmail) {
    return runCleanupAction(["--action", "add-spam-rule", "--sender", senderEmail]);
  }
  if ((action === "Block Domain" || action === "Report Spam" || action === "Report Phishing") && senderDomain) {
    return runCleanupAction(["--action", "add-spam-rule", "--domain", senderDomain]);
  }
  if (action === "Unsubscribe") {
    return { success: false, skipped: true, message: "Outlook unsubscribe automation not implemented yet" };
  }
  return { success: false, skipped: true, message: `Unsupported Outlook provider action: ${action}` };
}

async function main() {
  const pages = await getPendingPages();
  const summary = {
    matched: pages.length,
    pageIdFilter: CLI.pageId || null,
    dryRunProvider: CLI.dryRunProvider,
    done: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const page of pages) {
    const props = page.properties || {};
    const pageId = page.id;
    const title = titleToString(props.Name);
    const action = (props["Provider Action"]?.select || {}).name || "";
    const mailbox = props.Mailbox?.email || "";
    const senderText = richTextToString(props.Sender);
    const senderEmail = extractEmail(senderText);
    const senderDomain = richTextToString(props["Sender Domain"]) || (senderEmail.split("@")[1] || "");
    const emailAccount = richTextToString(props["Email Account"]);
    const originalLink = props["Original Link"]?.url || "";
    const gmailId = extractGmailId(originalLink);

    try {
      let result;
      if (!mailbox && emailAccount.includes("Gmail")) {
        result = { success: false, skipped: true, message: "Missing Mailbox for Gmail row" };
      } else if (!senderEmail && !senderDomain) {
        result = { success: false, skipped: true, message: "Missing sender identity" };
      } else if (emailAccount.includes("Gmail")) {
        result = await handleGmail(action, mailbox, senderEmail, senderDomain, gmailId);
      } else if (emailAccount.includes("Outlook")) {
        result = await handleOutlook(action, senderEmail, senderDomain);
      } else {
        result = { success: false, skipped: true, message: `Unknown email account type: ${emailAccount}` };
      }

      if (result.success) {
        await updatePage(pageId, { queue: "Done", providerActionStatus: "Done", status: "Completed" });
        summary.done += 1;
      } else if (result.skipped) {
        await updatePage(pageId, { queue: "Done", providerActionStatus: "Skipped", status: "Completed" });
        summary.skipped += 1;
      } else {
        summary.failed += 1;
      }

      summary.details.push({
        pageId,
        title,
        action,
        mailbox,
        senderEmail,
        senderDomain,
        result,
      });
    } catch (error) {
      summary.failed += 1;
      summary.details.push({
        pageId,
        title,
        action,
        mailbox,
        senderEmail,
        senderDomain,
        error: error.message,
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
