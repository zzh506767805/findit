import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHmac,generateKeyPairSync,sign} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const schema=fs.readFileSync('apps/api/migrations/0001_initial.sql','utf8')+fs.readFileSync('apps/api/migrations/0002_media_cleanup.sql','utf8');
const image=fs.readFileSync('tests/cloudflare/fixtures/model.jpg');
const secret='synthetic-test-secret';
function auth(id){const p=Buffer.from(JSON.stringify({sub:id,iat:Date.now()})).toString('base64url');return p+'.'+createHmac('sha256',secret).update(p).digest('base64url');}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
test('Worker preserves auth, private media, atomic entitlements and completed recognition history',async()=>{
 let calls=0,failAI=false;
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});const jwk={...publicKey.export({format:'jwk'}),kid:'qa-key',alg:'RS256',use:'sig'};
 const mf=new Miniflare(convertV4MiniflareOptions({name:'findit',modules:true,scriptPath:path.resolve('.wrangler/dry-run/cloudflare-worker.js'),compatibilityDate:'2026-11-08',compatibilityFlags:['nodejs_compat','enable_nodejs_http_server_modules'],d1Databases:['DB'],r2Buckets:['IMAGES'],bindings:{NODE_ENV:'production',FINDIT_RUNTIME:'cloudflare',PUBLIC_API_URL:'https://findit.test',JWT_SECRET:secret,APPLE_IAP_SHARED_SECRET:'synthetic-iap-secret',AZURE_OPENAI_API_KEY:'synthetic-ai-key',AZURE_OPENAI_DEPLOYMENT:'test-model',AZURE_OPENAI_RESPONSES_URL:'https://ai.test/openai/responses'},outboundService:async request=>{
  const url=new URL(request.url);const incoming=request.method==='POST'?await request.json():null;
  if(url.hostname==='appleid.apple.com')return json({keys:[jwk]});
  if(url.hostname==='buy.itunes.apple.com'){return json({status:0,latest_receipt_info:[{product_id:'fangnale_yearly',transaction_id:'qa-transaction-1',original_transaction_id:'qa-transaction-1',expires_date_ms:String(Date.now()+365*86400_000)}]});}
  if(url.hostname==='ai.test'){
   calls++;const body=incoming;if(failAI)return json({error:'simulated provider failure'},400);
   const payload=body.previous_response_id?{id:'response-final',output:[{type:'message',content:[{type:'output_text',text:'识别完成，请确认保存。'}]}]}:{id:'response-tools',output:[{type:'function_call',call_id:'save-call',name:'save_items',arguments:JSON.stringify({space:{name:'客厅'},position:{name:'书桌'},items:[{name:'测试钱包',description:'棕色钱包',status:'new'}]})}]};
   if(body.stream)return new Response('event: response.completed\ndata: '+JSON.stringify({type:'response.completed',response:payload})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});return json(payload);
  }
  throw new Error('Unexpected external request: '+url.hostname);
 }}));
 try{
  const db=await mf.getD1Database('DB');await db.batch(schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));const stamp=new Date().toISOString();
  await db.prepare("INSERT INTO users(id,email,name,free_credits,created_at) VALUES('alice','alice@example.invalid','Alice',3,?)").bind(stamp).run();
  await db.prepare("INSERT INTO users(id,email,name,free_credits,created_at) VALUES('bob','bob@example.invalid','Bob',3,?)").bind(stamp).run();
  const call=async(route,{id='alice',method='GET',body,headers={}}={})=>{ const response=await mf.dispatchFetch('https://findit.test'+route,{method,redirect:'manual',headers:{...(id?{Authorization:'Bearer '+auth(id)}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('content-type')?.includes('text/event-stream'))return response;const bytes=await response.arrayBuffer();return new Response(bytes,{status:response.status,headers:response.headers}); };
  assert.equal((await call('/health',{id:null})).status,200);
  assert.equal((await call('/user/credits',{id:null})).status,401);
  const welcome=await Promise.all(Array.from({length:5},()=>call('/user/benefits/welcome/claim',{method:'POST'})));
  for(const r of welcome)assert.equal(r.status,200,await r.clone().text());
  assert.equal((await db.prepare("SELECT paid_credits FROM users WHERE id='alice'").first()).paid_credits,30);
  assert.ok((await db.prepare("SELECT subscription_expires_at FROM users WHERE id='alice'").first()).subscription_expires_at>stamp);
  const reserves=await Promise.all(Array.from({length:4},()=>call('/agent/uploads',{method:'POST',body:{request_key:'recognition-one'}})));
  for(const r of reserves)assert.equal(r.status,200,await r.clone().text());const job=(await reserves[0].json()).id;
  assert.equal((await db.prepare("SELECT free_credits FROM users WHERE id='alice'").first()).free_credits,2);
  const upload=await mf.dispatchFetch('https://findit.test/staging/'+job+'/file_0',{method:'PUT',headers:{Authorization:'Bearer '+auth('alice'),'Content-Type':'image/jpeg'},body:image});assert.equal(upload.status,200,await upload.clone().text());const uploaded=await upload.json();
  const analysis=await call('/agent/analyze?source=spaces',{method:'POST',body:{job_id:job,uploads:[{key:uploaded.key}],request_key:'recognition-one'}});assert.equal(analysis.status,200);const stream=await analysis.text();assert.match(stream,/message_saved/);assert.match(stream,/识别完成/);assert.equal(calls,2);
  const saved=await db.prepare("SELECT * FROM messages WHERE user_id='alice' AND role='agent'").first();assert.ok(saved.suggestion);
  const confirm=()=>call('/agent/confirm',{method:'POST',body:{suggestion:JSON.parse(saved.suggestion),media_asset_id:saved.media_asset_id,message_id:saved.id}});
  const confirmations=await Promise.all([confirm(),confirm(),confirm()]);for(const r of confirmations)assert.equal(r.status,200,await r.clone().text());
  assert.equal((await db.prepare("SELECT count(*) n FROM item_records WHERE user_id='alice'").first()).n,1);
  assert.equal((await call('/media/'+saved.media_asset_id+'/original',{id:null})).status,401);
  assert.equal((await call('/media/'+saved.media_asset_id+'/original',{id:'bob'})).status,404);
  const media=await call('/media/'+saved.media_asset_id+'/original');assert.equal(media.status,302);const privateUrl=media.headers.get('location');const bytes=await mf.dispatchFetch(privateUrl);assert.equal(bytes.status,200);assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),image);
  const untrusted=new URL(privateUrl);untrusted.searchParams.set('signature','bad');assert.equal((await mf.dispatchFetch(untrusted)).status,403);
  const repeat=await call('/agent/analyze',{method:'POST',body:{job_id:job,uploads:[{key:uploaded.key}]}});await repeat.text();assert.equal(calls,2);
  failAI=true;const failedReserve=await call('/agent/uploads',{method:'POST',body:{request_key:'recognition-fail'}});const failed=(await failedReserve.json()).id;
  const up2=await mf.dispatchFetch('https://findit.test/staging/'+failed+'/file_0',{method:'PUT',headers:{Authorization:'Bearer '+auth('alice'),'Content-Type':'image/jpeg'},body:image});const input2=await up2.json();const broken=await call('/agent/analyze',{method:'POST',body:{job_id:failed,uploads:[{key:input2.key}]}});assert.match(await broken.text(),/simulated provider failure/);
  assert.equal((await db.prepare("SELECT free_credits FROM users WHERE id='alice'").first()).free_credits,2);
  assert.equal((await db.prepare('SELECT refunded FROM jobs WHERE id=?').bind(failed).first()).refunded,1);
  const receipts=await Promise.all([call('/user/add-credits',{method:'POST',body:{receiptData:'synthetic'}}),call('/user/add-credits',{method:'POST',body:{receiptData:'synthetic'}})]);for(const r of receipts)assert.equal(r.status,200,await r.clone().text());
  assert.equal((await db.prepare("SELECT paid_credits FROM users WHERE id='alice'").first()).paid_credits,1030);
  await db.prepare("INSERT INTO users(id,email,free_credits,paid_credits,subscription_expires_at) VALUES('charlie','charlie@example.invalid',1,0,?)").bind(new Date(Date.now()+86400_000).toISOString()).run();
  const race=await Promise.all(['last-a','last-b'].map(request_key=>call('/agent/uploads',{id:'charlie',method:'POST',body:{request_key}})));
  assert.deepEqual(race.map(r=>r.status).sort(),[200,403]);assert.equal((await db.prepare("SELECT free_credits FROM users WHERE id='charlie'").first()).free_credits,0);
  const cancelled=(await race.find(r=>r.status===200).json()).id;const cancel=()=>call('/agent/jobs/'+cancelled+'/cancel',{id:'charlie',method:'POST'});assert.equal((await cancel()).status,200);assert.equal((await cancel()).status,409);assert.equal((await db.prepare("SELECT free_credits FROM users WHERE id='charlie'").first()).free_credits,1);
  const deletion=await call('/user/account',{method:'DELETE'});assert.equal(deletion.status,200);assert.equal(await(await mf.getR2Bucket('IMAGES')).head(uploaded.key),null);
  const applePayload={iss:'https://appleid.apple.com',aud:'top.fangnale',sub:'qa-apple-id',exp:Math.floor(Date.now()/1000)+3600};const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'qa-key'})).toString('base64url'),pay=Buffer.from(JSON.stringify(applePayload)).toString('base64url');const identityToken=head+'.'+pay+'.'+sign('RSA-SHA256',Buffer.from(head+'.'+pay),privateKey).toString('base64url');
  const login=await call('/auth/apple',{id:null,method:'POST',body:{appleUserId:'qa-apple-id',email:'qa-apple@example.invalid',identityToken}});assert.equal(login.status,200,await login.clone().text());
  assert.equal((await call('/auth/apple',{id:null,method:'POST',body:{appleUserId:'qa-apple-id',identityToken:'invalid'}})).status,401);
 }finally{await mf.dispose();}
});
