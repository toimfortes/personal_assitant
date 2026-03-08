const N8N_URL = "http://localhost:5678";
const WF_ID = "FgXJ0dTlOibbKHr0";
const N8N_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZTRkZTAyMy1mMGMzLTRlODAtOThlYi04ZmRkOGE1MTdjYjMiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiYWNiZjI5MDMtNTVkMy00MTQ0LWE2ZjQtZTgyN2E1ZDFmNzliIiwiaWF0IjoxNzcyNzI3MjY5LCJleHAiOjE3NzUyNjA4MDB9.XrePb6rP8yypF-roL4kRGjVQhj8Um6VEJ9SS8pINgqM";
const puppeteer = require("puppeteer");

// Only check the accounts that returned no results
const CREDS = [
  { id: "MrF40yK3dky3O7Cz", name: "Gmail account 2" },
  { id: "TEZwdWAZWeaN7IL1", name: "Gmail account 4" },
  { id: "Xhbgajo1Ghik9Uf8", name: "Gmail account 5" },
  { id: "PkoNf6XXZsGr9QVk", name: "Gmail account 6" },
];

async function getCookie() {
  const loginResp = await fetch(`${N8N_URL}/rest/login`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({emailOrLdapLoginId:"cortexcerebral@gmail.com",password:"Hjkhjk.,23"})
  });
  return loginResp.headers.getSetCookie()?.find(c => c.startsWith("n8n-auth="))?.split(";")[0] || "";
}

(async () => {
  const cookie = await getCookie();
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  
  await page.goto(`${N8N_URL}/signin`, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2000));
  const ei = await page.$('input[autocomplete="email"], input[type="email"]');
  const pi = await page.$('input[type="password"]');
  if (ei && pi) {
    await ei.click({ clickCount: 3 }); await ei.type("cortexcerebral@gmail.com");
    await pi.click({ clickCount: 3 }); await pi.type("Hjkhjk.,23");
    for (const btn of await page.$$("button")) {
      if ((await page.evaluate(el => el.textContent, btn)).toLowerCase().includes("sign in")) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  for (const cred of CREDS) {
    const wfResp = await fetch(`${N8N_URL}/rest/workflows/${WF_ID}`, { headers: {"Cookie": cookie} });
    const wf = (await wfResp.json()).data;
    for (const node of wf.nodes) {
      if (node.name === "Gmail Get All") {
        node.credentials = { gmailOAuth2: { id: cred.id, name: cred.name } };
        node.parameters.limit = 1;
        // Use broader query - any email in inbox
        node.parameters.filters = {};
        node.parameters.options = {};
      }
    }
    await fetch(`${N8N_URL}/rest/workflows/${WF_ID}`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json", "Cookie": cookie},
      body: JSON.stringify({ nodes: wf.nodes, connections: wf.connections })
    });

    const beforeResp = await fetch(`${N8N_URL}/api/v1/executions?workflowId=${WF_ID}&limit=1`, {
      headers: { "X-N8N-API-KEY": N8N_API_KEY }
    });
    const lastId = parseInt((await beforeResp.json()).data?.[0]?.id || "0");

    await page.goto(`${N8N_URL}/workflow/${WF_ID}`, { waitUntil: "networkidle2" });
    await new Promise(r => setTimeout(r, 3000));
    const execBtn = await page.$('[data-test-id="execute-workflow-button"]');
    if (execBtn) await execBtn.click();
    
    let found = false;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const resp = await fetch(`${N8N_URL}/api/v1/executions?workflowId=${WF_ID}&limit=1`, {
        headers: { "X-N8N-API-KEY": N8N_API_KEY }
      });
      const latest = (await resp.json()).data?.[0];
      if (latest && parseInt(latest.id) > lastId && !["running","new","waiting"].includes(latest.status)) {
        const detResp = await fetch(`${N8N_URL}/api/v1/executions/${latest.id}?includeData=true`, {
          headers: { "X-N8N-API-KEY": N8N_API_KEY }
        });
        const det = await detResp.json();
        const rd = det.data?.resultData?.runData || {};
        const gmailRuns = rd["Gmail Get All"] || [];
        for (const run of gmailRuns) {
          if (run.error) { 
            console.log(`${cred.name} (${cred.id}): ERROR - ${run.error.message}`); 
            found = true; 
            break; 
          }
          for (const ol of (run.data?.main || [])) {
            for (const item of (ol || [])) {
              const j = item.json || {};
              const to = j.to || j.To || j.deliveredTo || "unknown";
              const from = (j.From || j.from || "unknown").substring(0, 40);
              console.log(`${cred.name} (${cred.id}): TO=${to} FROM=${from}`);
              found = true;
            }
          }
        }
        if (!found) console.log(`${cred.name} (${cred.id}): empty result, status=${latest.status}`);
        found = true;
        break;
      }
    }
    if (!found) console.log(`${cred.name} (${cred.id}): TIMED OUT`);
  }

  // Restore
  const wfResp2 = await fetch(`${N8N_URL}/rest/workflows/${WF_ID}`, { headers: {"Cookie": cookie} });
  const wf2 = (await wfResp2.json()).data;
  for (const node of wf2.nodes) {
    if (node.name === "Gmail Get All") {
      node.credentials = { gmailOAuth2: { id: "jACGwijQXj0rEYqR", name: "Gmail account 1" } };
      node.parameters.limit = 50;
      node.parameters.filters = { q: "in:inbox category:primary after:2026/02/03 before:2026/03/07" };
    }
  }
  await fetch(`${N8N_URL}/rest/workflows/${WF_ID}`, {
    method: "PATCH",
    headers: {"Content-Type": "application/json", "Cookie": cookie},
    body: JSON.stringify({ nodes: wf2.nodes, connections: wf2.connections })
  });

  await browser.close();
})();
