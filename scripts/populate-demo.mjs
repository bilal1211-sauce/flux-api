import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const credentials = JSON.parse(readFileSync(resolve(root,'.runtime/demo-account.json'),'utf8'));
const origin = 'http://127.0.0.1:8100/api/v1';
let token;
async function call(path, method = 'GET', body) {
  const res = await fetch(`${origin}/${path}`, { method, headers: { Accept:'application/json','Content-Type':'application/json',...(token ? { Authorization:`Bearer ${token}` } : {}) }, body:body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json(); if (!res.ok) throw new Error(`${path}: ${json.message}`); return json.data;
}
token = (await call('auth/login','POST',credentials)).token;
const workspace = (await call('workspaces'))[0];
const base = `workspaces/${workspace.id}`;
const requests = await call(`${base}/requests`);
const environment = (await call(`${base}/environments`))[0];
for (const request of requests.slice(0,3)) {
  const result = await call(`${base}/execute`,'POST',{...request,environment_id:environment.id,saved_request_id:request.id});
  if (result.status !== 200) throw new Error(`The live demo target returned ${result.error_code || result.status}.`);
  console.log(`${request.name}: HTTP ${result.status}, ${result.duration_ms} ms, ${result.outcome}`);
}
const existing = await call(`${base}/monitors`);
const monitor = existing[0] || await call(`${base}/monitors`,'POST',{name:'JSONPlaceholder · service health',api_request_id:requests[1].id,environment_id:environment.id,interval_minutes:5,enabled:true,failure_threshold:2});
const result = await call(`${base}/monitors/${monitor.id}/check`,'POST');
console.log(`Live monitor check: ${result?.outcome || 'already running'}. Only genuine network samples have been recorded.`);
