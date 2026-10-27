import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const methods = ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'];
const denied = new BlockList();
for (const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) denied.addSubnet(ip,bits,'ipv4');
for (const [ip,bits] of [['::',96],['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20],['fc00::',7],['fe80::',10],['ff00::',8]]) denied.addSubnet(ip,bits,'ipv6');
const reservedHeaders = new Set(['host','connection','content-length','transfer-encoding','expect','te','upgrade','proxy-authorization','proxy-connection','origin']);
const loopbackHost = host => ['localhost','127.0.0.1','::1','[::1]'].includes(host.toLowerCase());
const publicAddress = address => isIP(address) === 4 ? !denied.check(address,'ipv4') : isIP(address) === 6 && /^[23]/i.test(address) && !denied.check(address,'ipv6');
const fail = (message, status=422) => Object.assign(new Error(message),{status});

export async function destination(value, allowLocalhost, resolve=lookup) {
  let url;
  try { url = new URL(value); } catch { throw fail('Enter a valid HTTPS URL, or explicitly authorize a localhost API.'); }
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.hash || /[\x00-\x20\x7f\\]/.test(value)) throw fail('Use HTTP(S) without URL credentials, fragments or control characters.');
  const hostname = url.hostname.replace(/^\[|\]$/g,'');
  const local = loopbackHost(hostname);
  if (local && !allowLocalhost) throw fail('Restart the companion with --allow-localhost to authorize local APIs.',403);
  if (!local && url.protocol !== 'https:') throw fail('Public destinations require HTTPS. HTTP is available only for authorized localhost APIs.');
  let records;
  if (isIP(hostname)) {
    records=[{address:hostname,family:isIP(hostname)}];
  } else {
    let timer;
    try {
      records=await Promise.race([resolve(hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('DNS lookup exceeded the 3 second limit.',504)),3000);})]);
    } finally { clearTimeout(timer); }
  }
  if (!records.length || records.some(record => local ? !['127.0.0.1','::1'].includes(record.address) : !publicAddress(record.address))) throw fail('DNS includes a private or reserved address. Only explicitly authorized localhost is exempt.',403);
  return {url, pinned:records[0]};
}

export async function execute(input, {allowLocalhost=false, signal, resolve=lookup}={}) {
  if (!methods.includes(input.method) || typeof input.url !== 'string' || input.url.length>4096) throw fail('Invalid method or URL.');
  if (!Number.isInteger(input.timeout_ms) || input.timeout_ms<100 || input.timeout_ms>60000) throw fail('Timeout must be between 100 and 60000 ms.');
  if (!input.headers || Array.isArray(input.headers) || typeof input.headers!=='object' || Object.keys(input.headers).length>40) throw fail('Use at most 40 headers.');
  for (const [key,value] of Object.entries(input.headers)) {
    if (!/^[A-Za-z0-9-]+$/.test(key) || reservedHeaders.has(key.toLowerCase()) || typeof value!=='string' || value.length>8192 || /[\r\n\0]/.test(value)) throw fail('A header is invalid or reserved by the HTTP transport.');
  }
  if (typeof input.body_base64 !== 'undefined' && (typeof input.body_base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.body_base64))) throw fail('Invalid body encoding.');
  if (input.body!=null && typeof input.body!=='string') throw fail('Invalid body.');
  const body = input.body_base64 ? Buffer.from(input.body_base64,'base64') : Buffer.from(input.body || '');
  if (body.length>1048576) throw fail('Local request bodies are limited to 1 MiB.',413);
  const start=performance.now();
  const target=await destination(input.url,allowLocalhost,resolve);
  const dnsMs=performance.now()-start;
  if (signal?.aborted) throw new DOMException('Cancelled','AbortError');
  return new Promise(resolveResult => {
    let response, settled=false, truncated=false, timedOut=false, chunks=[],size=0,firstByte=0,connectMs=0,tlsMs=0;
    const finish = error => {
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
      const headers={};for(const [key,value]of Object.entries(response?.headers || {}))if(Object.keys(headers).length<100)headers[key]=String(value).slice(0,2048);
      resolveResult({execution_id:input.execution_id,status:response?.statusCode || null,headers,body:Buffer.concat(chunks).toString('utf8'),duration_ms:Math.round(performance.now()-start),size_bytes:size,truncated,error_code:truncated?'RESPONSE_TOO_LARGE':timedOut?'TIMEOUT':signal?.aborted?'CANCELLED':error?'NETWORK_ERROR':null,timings:{dns_ms:Math.round(dnsMs),connect_ms:Math.round(connectMs),tls_ms:Math.round(tlsMs),first_byte_ms:Math.round(firstByte)}});
    };
    const transport=target.url.protocol==='https:'?https:http;
    const request=transport.request(target.url,{method:input.method,headers:{'User-Agent':'APIForge-Local/2.0',Accept:'application/json',...input.headers,...(!['GET','HEAD'].includes(input.method)?{'Content-Length':String(body.length)}:{})},agent:false,lookup:(_host,options,callback)=>callback(null,options.all?[target.pinned]:target.pinned.address,target.pinned.family),rejectUnauthorized:true},incoming=>{
      response=incoming;firstByte=performance.now()-start;
      incoming.on('data',chunk=>{const room=1048576-size;if(chunk.length>room){chunks.push(chunk.subarray(0,Math.max(0,room)));size+=Math.max(0,room);truncated=true;finish();incoming.destroy();request.destroy();}else{chunks.push(chunk);size+=chunk.length;}});
      incoming.on('end',()=>finish()); incoming.on('error',error=>finish(error));
    });
    request.on('socket',socket=>{socket.once('connect',()=>{connectMs=performance.now()-start;});socket.once('secureConnect',()=>{tlsMs=performance.now()-start;});});
    const timer=setTimeout(()=>{timedOut=true;request.destroy();finish(new Error('Timeout'));},Math.max(1,input.timeout_ms-dnsMs));
    const cancel=()=>{request.destroy();finish(new Error('Cancelled'));};
    signal?.addEventListener('abort',cancel,{once:true});
    request.on('error',error=>finish(error));
    request.end(['GET','HEAD'].includes(input.method)?undefined:body);
  });
}

export function createCompanion({token=randomBytes(32).toString('base64url'), origins=['http://127.0.0.1:3000'], allowLocalhost=false, allowCloudOrigin=false, port=8102, resolve=lookup}={}) {
  if (token.length<32) throw new Error('Use a session token with at least 32 characters.');
  for (const origin of origins) {
    const url=new URL(origin);
    if (url.origin!==origin || !['http:','https:'].includes(url.protocol) || url.username || (!loopbackHost(url.hostname) && !allowCloudOrigin)) throw new Error('Cloud origins require explicit --allow-cloud-origin authorization.');
  }
  const active=new Map();let count=0,windowStarted=Date.now();
  const server=http.createServer({maxHeaderSize:16384},async(request,response)=>{
    const origin=request.headers.origin;
    const json=(status,value)=>{if(!response.destroyed){response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));}};
    if (!request.headers.host?.match(/^127\.0\.0\.1:\d+$/) || !origins.includes(origin)) return json(403,{message:'This UI origin is not authorized by the local companion.'});
    response.setHeader('Access-Control-Allow-Origin',origin);response.setHeader('Vary','Origin');
    if(request.method==='OPTIONS'){
      response.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');response.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');response.setHeader('Access-Control-Allow-Private-Network','true');response.writeHead(204);response.end();return;
    }
    const supplied=Buffer.from(request.headers.authorization || '');const expected=Buffer.from(`Bearer ${token}`);
    if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected))return json(401,{message:'Pair the local companion with its current session token.'});
    if(Date.now()-windowStarted>60000){count=0;windowStarted=Date.now();}if(++count>120)return json(429,{message:'Local companion rate limit reached.'});
    if(request.method==='GET' && request.url==='/status')return json(200,{data:{service:'APIForge local companion',version:'2.0.0',allow_localhost:allowLocalhost,max_body_bytes:1048576}});
    if(request.method==='DELETE' && /^\/executions\/[0-9a-f-]{36}$/.test(request.url)) { active.get(request.url.split('/')[2])?.abort();return json(200,{data:{cancelled:true}}); }
    if(request.method!=='POST' || request.url!=='/run')return json(404,{message:'Not found.'});
    if(active.size>=4)return json(429,{message:'At most four local executions may run at once.'});
    let controller,id;
    try {
      let size=0;const chunks=[];
      for await(const chunk of request){size+=chunk.length;if(size>1600000)throw fail('Companion payload exceeds its limit.',413);chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8')); id=input.execution_id;
      if(typeof id!=='string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id))throw fail('A unique execution UUID is required.');
      if(active.has(id))throw fail('That execution is already running.',409);
      if(active.size>=4)throw fail('At most four local executions may run at once.',429);
      controller=new AbortController();active.set(id,controller);
      response.once('close',()=>{if(!response.writableEnded)controller.abort();});
      const data=await execute(input,{allowLocalhost,signal:controller.signal,resolve});json(200,{data});
    } catch(error){json(error.status || 422,{message:error.status?error.message:'The local request could not be processed. No credentials were logged.'});}
    finally{if(id && active.get(id)===controller)active.delete(id);}
  });
  server.headersTimeout=10000;server.requestTimeout=70000;server.on('close',()=>{for(const job of active.values())job.abort();});
  return {server,token,start:()=>new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>done(server.address()));})};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);const read=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
  const companion=createCompanion({origins:[read('--origin') || 'http://127.0.0.1:3000'],port:Number(read('--port') || 8102),allowLocalhost:args.includes('--allow-localhost'),allowCloudOrigin:args.includes('--allow-cloud-origin')});
  await companion.start();
  console.log(`APIForge local companion: http://127.0.0.1:${companion.server.address().port}\nAuthorized UI: ${read('--origin') || 'http://127.0.0.1:3000'}\nLocalhost APIs: ${args.includes('--allow-localhost')?'explicitly authorized':'disabled'}\nPairing token (this session only): ${companion.token}\nPaste it into Request Studio > Local > Connect. Keep this terminal private. Ctrl+C stops local execution.`);
  for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>{companion.server.close();companion.server.closeAllConnections();});
}
