import fs from 'fs';

const store = JSON.parse(fs.readFileSync('/home/node/.openclaw/agents/main/agent/auth-profiles.json', 'utf8'));
const cred = store.profiles['google-gemini-cli:cortexcerebral@gmail.com'];

const ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse';
const HEADERS = {
  'Authorization': 'Bearer ' + cred.access,
  'Content-Type': 'application/json',
  'User-Agent': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
  'X-Goog-Api-Client': 'gl-node/22.17.0',
  'Client-Metadata': JSON.stringify({ideType:'IDE_UNSPECIFIED',platform:'PLATFORM_UNSPECIFIED',pluginType:'GEMINI'})
};

async function query(label, prompt, model) {
  const body = {
    project: cred.projectId,
    model,
    userAgent: 'pi-coding-agent',
    requestId: `bench-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    request: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
    }
  };
  const start = Date.now();
  const r = await fetch(ENDPOINT, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  const text = await r.text();
  const elapsed = Date.now() - start;

  let output = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('data:')) {
      try {
        const d = JSON.parse(line.slice(5));
        const err = d.response?.error || d.error;
        if (err) { output = `ERROR ${err.code}: ${err.message.substring(0, 120)}`; break; }
        const parts = d.response?.candidates?.[0]?.content?.parts || d.candidates?.[0]?.content?.parts || [];
        for (const p of parts) { if (p.text) output += p.text; }
      } catch {}
    }
  }
  if (output === '' && text.includes('error')) {
    try { const d = JSON.parse(text); output = `ERROR ${d.error?.code}: ${d.error?.message?.substring(0, 120)}`; } catch { output = text.substring(0, 200); }
  }
  console.log(`${label} | ${model} | ${elapsed}ms | ${output.trim().substring(0, 180)}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const prompts = [
  ['triage', 'Classify: From ricardo@btgpactual.com Subject: Q2 Update. Return JSON {important:bool, summary:string}'],
  ['plan', 'You have tools: read, exec, web_search. User says: check my email. Plan 3 steps.'],
  ['draft', 'Draft a short reply to: Hi Antonio, can we reschedule the call to Thursday? Best, Ricardo'],
];

console.log('=== Sequential queries with 5s gaps (gemini-3-flash-preview) ===');
for (const [label, prompt] of prompts) {
  await query(label, prompt, 'gemini-3-flash-preview');
  await sleep(5000);
}

console.log('');
await sleep(5000);
console.log('=== Sequential queries with 5s gaps (gemini-2.0-flash) ===');
for (const [label, prompt] of prompts) {
  await query(label, prompt, 'gemini-2.0-flash');
  await sleep(5000);
}
