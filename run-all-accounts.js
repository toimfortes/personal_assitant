const puppeteer = require("puppeteer");
const N8N_URL = "http://localhost:5678";
const N8N_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZTRkZTAyMy1mMGMzLTRlODAtOThlYi04ZmRkOGE1MTdjYjMiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiYWNiZjI5MDMtNTVkMy00MTQ0LWE2ZjQtZTgyN2E1ZDFmNzliIiwiaWF0IjoxNzcyNzI3MjY5LCJleHAiOjE3NzUyNjA4MDB9.XrePb6rP8yypF-roL4kRGjVQhj8Um6VEJ9SS8pINgqM";
const WF_ID = "FgXJ0dTlOibbKHr0";

const ACCOUNTS = [
  { id: "0YJAOX0ZGvKDcpAt", name: "Gmail account 1", email: "cortexcerebral@gmail.com" },
  { id: "MrF40yK3dky3O7Cz", name: "Gmail account 2", email: "antonio.maya.official@gmail.com" },
  { id: "JaJpq3hIJWFJXv4S", name: "Gmail account 3", email: "antonioandmayaadventures@gmail.com" },
  { id: "TEZwdWAZWeaN7IL1", name: "Gmail account 4", email: "larissasrhsbparents@gmail.com" },
  { id: "Xhbgajo1Ghik9Uf8", name: "Gmail account 5", email: "antonioforteslegal@gmail.com" },
  // Account 6 (toimusa) already done
];

async function getCookie() {
  const loginResp = await fetch(`${N8N_URL}/rest/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrLdapLoginId: "cortexcerebral@gmail.com", password: "Hjkhjk.,23" }),
  });
  return loginResp.headers.getSetCookie()?.find((c) => c.startsWith("n8n-auth="))?.split(";")[0] || "";
}

async function patchCredential(cookie, credId, credName) {
  const wfResp = await fetch(`${N8N_URL}/rest/workflows/${WF_ID}`, { headers: { Cookie: cookie } });
  const wf = (await wfResp.json()).data;
  for (const node of wf.nodes) {
    if (node.name === "Gmail Get All") {
      node.credentials = { gmailOAuth2: { id: credId, name: credName } };
      node.parameters.limit = 50;
      node.parameters.filters = { q: "after:2026/02/03 before:2026/03/07" };
      node.parameters.options = {};
    }
  }
  await fetch(`${N8N_URL}/rest/workflows/${WF_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ nodes: wf.nodes, connections: wf.connections }),
  });
}

(async () => {
  const cookie = await getCookie();
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // Login
  await page.goto(`${N8N_URL}/signin`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2000));
  const ei = await page.$('input[autocomplete="email"], input[type="email"]');
  const pi = await page.$('input[type="password"]');
  if (ei && pi) {
    await ei.click({ clickCount: 3 }); await ei.type("cortexcerebral@gmail.com");
    await pi.click({ clickCount: 3 }); await pi.type("Hjkhjk.,23");
    for (const btn of await page.$$("button")) {
      if ((await page.evaluate((el) => el.textContent, btn)).toLowerCase().includes("sign in")) {
        await btn.click(); break;
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("Logged in\n");

  const allResults = [];

  for (const acct of ACCOUNTS) {
    const startTime = Date.now();
    console.log(`${"=".repeat(60)}`);
    console.log(`ACCOUNT: ${acct.email}`);
    console.log(`${"=".repeat(60)}`);

    await patchCredential(cookie, acct.id, acct.name);

    const beforeResp = await fetch(`${N8N_URL}/api/v1/executions?workflowId=${WF_ID}&limit=1`, {
      headers: { "X-N8N-API-KEY": N8N_API_KEY },
    });
    const lastId = parseInt((await beforeResp.json()).data?.[0]?.id || "0");

    await page.goto(`${N8N_URL}/workflow/${WF_ID}`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 3000));
    const execBtn = await page.$('[data-test-id="execute-workflow-button"]');
    if (execBtn) {
      await execBtn.click();
      console.log(`  Triggered at ${new Date().toLocaleTimeString()}`);
    } else {
      console.log("  ERROR: No execute button");
      continue;
    }

    // Poll for completion
    let result = null;
    for (let i = 0; i < 300; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const resp = await fetch(`${N8N_URL}/api/v1/executions?workflowId=${WF_ID}&limit=1`, {
        headers: { "X-N8N-API-KEY": N8N_API_KEY },
      });
      const latest = (await resp.json()).data?.[0];
      if (latest && parseInt(latest.id) > lastId && !["running", "new", "waiting"].includes(latest.status)) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`  Completed in ${elapsed}s (status: ${latest.status})`);

        const detResp = await fetch(`${N8N_URL}/api/v1/executions/${latest.id}?includeData=true`, {
          headers: { "X-N8N-API-KEY": N8N_API_KEY },
        });
        const det = await detResp.json();
        const rd = det.data?.resultData?.runData || {};

        // Count emails
        const gmailRuns = rd["Gmail Get All"] || [];
        let emailCount = 0;
        for (const run of gmailRuns) {
          if (run.error) { console.log(`  Gmail ERROR: ${run.error.message}`); continue; }
          for (const ol of run.data?.main || []) emailCount += (ol || []).length;
        }

        // Parse AI results
        const parseRuns = rd["Parse AI Result"] || [];
        let parseItems = [];
        for (const run of parseRuns) {
          if (run.error) { console.log(`  Parse ERROR: ${run.error.message}`); continue; }
          for (const ol of run.data?.main || []) {
            for (const item of ol || []) parseItems.push(item.json || {});
          }
        }

        const importantItems = parseItems.filter((p) => p.is_important);

        // Notion results
        const notionRuns = rd["Add to Notion"] || [];
        let notionCount = 0;
        for (const run of notionRuns) {
          if (run.error) { console.log(`  Notion ERROR: ${run.error.message}`); continue; }
          for (const ol of run.data?.main || []) {
            for (const item of ol || []) {
              if ((item.json || {}).id) notionCount++;
            }
          }
        }

        console.log(`\n  Emails: ${emailCount} | Important: ${importantItems.length} | Written to Notion: ${notionCount}`);

        if (importantItems.length > 0) {
          console.log("\n  --- Important emails ---");
          for (const p of importantItems) {
            console.log(`  * ${(p.from_raw || "?").substring(0, 50)}`);
            console.log(`    ${p.subject}`);
            console.log(`    Category: ${p.category} | ${(p.reason || "").substring(0, 60)}`);
          }
        }

        // Log errors
        for (const [name, runs] of Object.entries(rd)) {
          for (const run of runs) {
            if (run.error) console.log(`  ERROR in ${name}: ${run.error.message}`);
          }
        }

        allResults.push({ account: acct.email, fetched: emailCount, important: importantItems.length, notion: notionCount });
        result = true;
        break;
      }
      if (i > 0 && i % 30 === 0) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`  ... ${elapsed}s elapsed`);
      }
    }
    if (!result) {
      console.log("  TIMED OUT");
      allResults.push({ account: acct.email, fetched: 0, important: 0, notion: 0, error: "timeout" });
    }
    console.log("");
  }

  // Restore to account 1
  await patchCredential(cookie, "jACGwijQXj0rEYqR", "Gmail account 1");

  console.log(`\n${"=".repeat(60)}`);
  console.log("SUMMARY");
  console.log(`${"=".repeat(60)}`);
  for (const r of allResults) {
    console.log(`${r.account}: ${r.fetched} emails, ${r.important} important, ${r.notion} written to Notion${r.error ? " ("+r.error+")" : ""}`);
  }

  await browser.close();
})();
