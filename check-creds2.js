const WF_ID = "FgXJ0dTlOibbKHr0";
const puppeteer = require("puppeteer");
const { N8N_URL, getCookie, loginPage, findExecuteButton, listExecutions, fetchExecution } = require("./scripts/n8n-script-config.cjs");

// Only check the accounts that returned no results
const CREDS = [
  { id: "MrF40yK3dky3O7Cz", name: "Gmail account 2" },
  { id: "TEZwdWAZWeaN7IL1", name: "Gmail account 4" },
  { id: "Xhbgajo1Ghik9Uf8", name: "Gmail account 5" },
  { id: "PkoNf6XXZsGr9QVk", name: "Gmail account 6" },
];

(async () => {
  const cookie = await getCookie();
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  await loginPage(page);

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

    const lastId = parseInt((await listExecutions(cookie, WF_ID, 20))[0]?.id || "0");

    await page.goto(`${N8N_URL}/workflow/${WF_ID}`, { waitUntil: "networkidle2" });
    await new Promise(r => setTimeout(r, 3000));
    const execBtn = await findExecuteButton(page);
    if (execBtn) await execBtn.click();
    
    let found = false;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const latest = (await listExecutions(cookie, WF_ID, 20))[0];
      if (latest && parseInt(latest.id) > lastId && !["running","new","waiting"].includes(latest.status)) {
        const det = await fetchExecution(cookie, latest.id, true);
        const rd = det.resultData?.runData || {};
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
      node.credentials = { gmailOAuth2: { id: "0YJAOX0ZGvKDcpAt", name: "Gmail account 1" } };
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
