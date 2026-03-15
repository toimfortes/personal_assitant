const WF_ID = "FgXJ0dTlOibbKHr0";
const puppeteer = require("puppeteer");
const { N8N_URL, getCookie, loginPage, findExecuteButton, listExecutions, fetchExecution } = require("./scripts/n8n-script-config.cjs");

const CREDS = [
  { id: "0YJAOX0ZGvKDcpAt", name: "Gmail account 1" },
  { id: "MrF40yK3dky3O7Cz", name: "Gmail account 2" },
  { id: "JaJpq3hIJWFJXv4S", name: "Gmail account 3" },
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
    // Patch workflow to use this credential, fetch 1 email
    const wfResp = await fetch(`${N8N_URL}/rest/workflows/${WF_ID}`, { headers: {"Cookie": cookie} });
    const wf = (await wfResp.json()).data;
    for (const node of wf.nodes) {
      if (node.name === "Gmail Get All") {
        node.credentials = { gmailOAuth2: { id: cred.id, name: cred.name } };
        node.parameters.limit = 1;
        node.parameters.filters = { q: "newer_than:1d" };
        node.parameters.options = {};
      }
    }
    await fetch(`${N8N_URL}/rest/workflows/${WF_ID}`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json", "Cookie": cookie},
      body: JSON.stringify({ nodes: wf.nodes, connections: wf.connections })
    });

    // Get last exec
    const lastId = parseInt((await listExecutions(cookie, WF_ID, 20))[0]?.id || "0");

    // Trigger
    await page.goto(`${N8N_URL}/workflow/${WF_ID}`, { waitUntil: "networkidle2" });
    await new Promise(r => setTimeout(r, 3000));
    const execBtn = await findExecuteButton(page);
    if (execBtn) await execBtn.click();
    
    // Poll
    let found = false;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const latest = (await listExecutions(cookie, WF_ID, 20))[0];
      if (latest && parseInt(latest.id) > lastId && !["running","new","waiting"].includes(latest.status)) {
        const det = await fetchExecution(cookie, latest.id, true);
        const rd = det.resultData?.runData || {};
        const gmailRuns = rd["Gmail Get All"] || [];
        for (const run of gmailRuns) {
          if (run.error) { console.log(`${cred.name} (${cred.id}): ERROR - ${run.error.message}`); found = true; break; }
          for (const ol of (run.data?.main || [])) {
            for (const item of (ol || [])) {
              const j = item.json || {};
              const to = j.to || j.To || j.deliveredTo || "unknown";
              console.log(`${cred.name} (${cred.id}): ${to}`);
              found = true;
            }
          }
        }
        if (!found) console.log(`${cred.name} (${cred.id}): no emails returned`);
        found = true;
        break;
      }
    }
    if (!found) console.log(`${cred.name} (${cred.id}): TIMED OUT`);
  }

  // Restore to account 1
  const wfResp = await fetch(`${N8N_URL}/rest/workflows/${WF_ID}`, { headers: {"Cookie": cookie} });
  const wf = (await wfResp.json()).data;
  for (const node of wf.nodes) {
    if (node.name === "Gmail Get All") {
      node.credentials = { gmailOAuth2: { id: "0YJAOX0ZGvKDcpAt", name: "Gmail account 1" } };
    }
  }
  await fetch(`${N8N_URL}/rest/workflows/${WF_ID}`, {
    method: "PATCH",
    headers: {"Content-Type": "application/json", "Cookie": cookie},
    body: JSON.stringify({ nodes: wf.nodes, connections: wf.connections })
  });

  await browser.close();
})();
