import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createCompanion, destination } from './companion.mjs';

const token='test-only-companion-token-000000000000000';
const origin='http://127.0.0.1:3000';
const headers={Origin:origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'};

test('local companion enforces auth, origin, host and explicit localhost authorization', async t=>{
  const local=createCompanion({token,port:0});const address=await local.start();const base=`http://127.0.0.1:${address.port}`;
  t.after(()=>{local.server.closeAllConnections();local.server.close();});
  assert.equal((await fetch(`${base}/status`)).status,403);
  assert.equal((await fetch(`${base}/status`,{headers:{Origin:origin}})).status,401);
  assert.equal((await fetch(`${base}/status`,{headers:{...headers,Origin:'https://evil.test'}})).status,403);
  const poisonedHost = await new Promise(resolve=>{http.get(`${base}/status`,{headers:{...headers,Host:'attacker.test'}},res=>{res.resume();resolve(res.statusCode);});});
  assert.equal(poisonedHost,403);
  assert.equal((await fetch(`${base}/status`,{headers})).status,200);
  assert.equal((await fetch(`${base}/run`,{method:'POST',headers,body:JSON.stringify({execution_id:randomUUID(),method:'GET',url:'http://127.0.0.1:9000',headers:{},timeout_ms:1000})})).status,403);
  assert.throws(()=>createCompanion({origins:['https://cloud.example']}),/explicit/);
  assert.doesNotThrow(()=>createCompanion({origins:['https://cloud.example'],allowCloudOrigin:true}));
});

test('DNS pinning rejects mixed/private/mapped addresses and public HTTP',async()=>{
  for(const address of ['10.0.0.1','169.254.169.254','100.64.0.1','192.168.1.1','::ffff:127.0.0.1','fe80::1','2001:db8::1']) {
    await assert.rejects(destination('https://example.com',false,async()=>[{address,family:address.includes(':')?6:4}]),/private or reserved/);
  }
  await assert.rejects(destination('https://example.com',false,async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),/private or reserved/);
  await assert.rejects(destination('http://example.com',false),/HTTPS/);
  await assert.rejects(destination('https://user:pass@example.com',false),/credentials/);
  const pinned=await destination('https://example.com',false,async()=>[{address:'8.8.8.8',family:4}]);
  assert.equal(pinned.pinned.address,'8.8.8.8');
});

test('real local requests support methods, bytes, headers, timeout, cancel and limits',async t=>{
  let slowRequest;
  const fixture=http.createServer(async(req,res)=>{
    if(req.url==='/slow'){slowRequest=req;return;}
    if(req.url==='/large'){res.writeHead(200);res.end('x'.repeat(1048580));return;}
    if(req.url==='/redirect'){res.writeHead(302,{Location:'http://169.254.169.254/latest'});res.end();return;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    res.writeHead(req.method==='DELETE'?204:200,{'Content-Type':'application/json','X-Test':'fixture'});
    res.end(req.method==='DELETE'?undefined:JSON.stringify({method:req.method,body:Buffer.concat(chunks).toString(),authorization:req.headers.authorization}));
  });fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
  t.after(()=>{fixture.closeAllConnections();fixture.close();});
  const companion=createCompanion({token,port:0,allowLocalhost:true});const address=await companion.start();const base=`http://127.0.0.1:${address.port}`,target=`http://127.0.0.1:${fixture.address().port}`;
  t.after(()=>{companion.server.closeAllConnections();companion.server.close();});
  const run=async(extra={})=>{const response=await fetch(`${base}/run`,{method:'POST',headers,body:JSON.stringify({execution_id:randomUUID(),method:'GET',url:target,headers:{},timeout_ms:2000,...extra})});return {status:response.status,...await response.json()};};
  for(const method of ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']){
    const result=await run({method,body:'payload',headers:{Authorization:'Bearer ephemeral'}});
    assert.equal(result.status,200);assert.equal(result.data.error_code,null);assert.ok(result.data.duration_ms>=0);assert.equal(result.data.headers['x-test'],'fixture',`${method}: ${JSON.stringify(result.data)}`);
    if(!['HEAD','DELETE'].includes(method)){const body=JSON.parse(result.data.body);assert.equal(body.method,method);assert.equal(body.authorization,'Bearer ephemeral');assert.equal(body.body,method==='GET'?'':'payload');}
  }
  const encoded=await run({method:'POST',body_base64:Buffer.from('key=value&two=2').toString('base64')});assert.equal(JSON.parse(encoded.data.body).body,'key=value&two=2');
  assert.equal((await run({url:`${target}/redirect`})).data.status,302);
  assert.equal((await run({url:`${target}/large`})).data.error_code,'RESPONSE_TOO_LARGE');
  assert.equal((await run({url:`${target}/slow`,timeout_ms:100})).data.error_code,'TIMEOUT');
  assert.ok(slowRequest);
  assert.equal((await run({headers:{Host:'private'}})).status,422);
  assert.equal((await run({headers:{Authorization:'x\r\ny'}})).status,422);
  assert.equal((await run({body:'x'.repeat(1048577)})).status,413);
  const id=randomUUID();const pending=run({execution_id:id,url:`${target}/slow`});
  await new Promise(resolve=>fixture.once('request',resolve));
  const cancelled=await fetch(`${base}/executions/${id}`,{method:'DELETE',headers});assert.equal(cancelled.status,200);
  assert.equal((await pending).data.error_code,'CANCELLED');
});
