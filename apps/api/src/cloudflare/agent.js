import { randomUUID } from 'node:crypto';
import { cloudflareEnv, requestRuntime } from './runtime.js';
import { objectUrl, mediaBytes } from './media.js';
import { d1Query } from './database.js';
import { reserveJob, startJob, completeJob, failJob, findJob } from './jobs.js';
import { createMediaAsset, getOrCreateConversation, createMessage } from '../store.js';
import { runAgent } from '../agent.js';
const prefix=(userId,jobId)=>`users/${userId}/jobs/${jobId}/`;
export async function uploadBinary(request,env,userId,jobId,label) {
 const slot=label.match(/^(file|thumb|frame|ai)_(\d+)(?:_(\d+))?$/);
 if(!slot||Number(slot[2])>5||(slot[1]==='frame'?(slot[3]===undefined||Number(slot[3])>9):slot[3]!==undefined))return new Response('Invalid upload slot',{status:400});
 const job=await findJob(userId,jobId);if(!job||job.status!=='CREATED')return new Response('Upload job unavailable',{status:409});
 const mime=(request.headers.get('content-type')||'').split(';')[0];if(!['image/jpeg','image/png','image/heic','image/heif','image/webp','image/gif','image/avif','video/mp4','video/quicktime'].includes(mime))return new Response('Unsupported media',{status:415});
 const announced=Number(request.headers.get('content-length')||request.headers.get('x-upload-size')||0);if(announced>50*1024*1024)return new Response('Media is too large',{status:413});
 const key=prefix(userId,jobId)+label;const object=await env.IMAGES.put(key,request.body,{httpMetadata:{contentType:mime}});
 const max=label.startsWith('file_')?50*1024*1024:2*1024*1024;
 if(object.size>max){await env.IMAGES.delete(key);return new Response('Media is too large',{status:413});}
 await d1Query('UPDATE jobs SET updated_at=$1 WHERE id=$2 AND status=$3',[new Date().toISOString(),jobId,'CREATED']);
 return Response.json({key,url:objectUrl(key),contentType:mime});
}
async function readUpload(userId,jobId,key) {
 if(typeof key!=='string'||!key.startsWith(prefix(userId,jobId)))throw Object.assign(new Error('Upload does not belong to this task'),{status:403});
 const object=await cloudflareEnv().IMAGES.get(key);if(!object)throw Object.assign(new Error('Upload missing'),{status:400});return object;
}
export async function handleCloudAgent(req,res,url,user,h) {
 const {readJson,sendJson,sendSse,parseLanguage,clientDayFromRequest}=h;
 if(req.method==='GET'&&url.pathname.startsWith('/agent/jobs/')) {
  const job=await findJob(user.id,decodeURIComponent(url.pathname.slice(12)));if(!job)return sendJson(res,404,{error:'Not found'});
  return sendJson(res,200,{id:job.id,status:job.status,result:job.result?JSON.parse(job.result):null});
 }
 if(req.method==='POST'&&url.pathname.startsWith('/agent/jobs/')&&url.pathname.endsWith('/cancel')) {
  const job=await findJob(user.id,decodeURIComponent(url.pathname.slice(12,-7)));if(!job)return sendJson(res,404,{error:'Not found'});if(job.status!=='CREATED')return sendJson(res,409,{error:'Task already started'});await failJob(job,'Upload cancelled',true);return sendJson(res,200,{cancelled:true});
 }
 if(req.method==='POST'&&url.pathname==='/agent/uploads') {
  const body=await readJson(req);const requestKey=req.headers['idempotency-key']||body.request_key;if(typeof requestKey!=='string'||requestKey.length>160)return sendJson(res,400,{error:'Request key required'});
  const reserved=await reserveJob(user.id,requestKey,'analyze');return sendJson(res,200,{id:reserved.job.id,status:reserved.job.status,replay:reserved.replay});
 }
 if(req.method!=='POST'||!['/agent/analyze','/agent/query'].includes(url.pathname))return false;
 const body=await readJson(req),kind=url.pathname.endsWith('analyze')?'analyze':'query';
 const requestKey=req.headers['idempotency-key']||body.request_key||randomUUID();
 let job;
 if(kind==='analyze') {
  job=await findJob(user.id,body.job_id);if(!job||job.kind!=='analyze')return sendJson(res,400,{error:'Prepared upload task required'});
 }else job=(await reserveJob(user.id,requestKey,'query')).job;
 if(job.status==='COMPLETED') {
  const result=JSON.parse(job.result);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});for(const m of result.media||[])sendSse(res,'media',m);sendSse(res,'answer',{text:result.answer});sendSse(res,'done',{suggestion:result.suggestion});sendSse(res,'message_saved',{message_id:result.message_id});res.end();return true;
 }
 if(job.status!=='CREATED')return sendJson(res,409,{error:job.status==='FAILED'?'任务已退回，请重新发送':'任务正在处理中',code:'TASK_IN_PROGRESS',job_id:job.id});
 const source=url.searchParams.get('source')||'assistant';const spaceHint=url.searchParams.get('space_hint')||'';const query=String(body.query||body.text||'').trim();const media=[],mediaInputs=[];
 let conversation,answer='',suggestion=null,responseId,steps=[];
 try {
  if(kind==='analyze') {
   if(!Array.isArray(body.uploads)||!body.uploads.length||body.uploads.length>6)throw Object.assign(new Error('Select up to 6 media files'),{status:400});
   for(let i=0;i<body.uploads.length;i++) {
    const upload=body.uploads[i],original=await readUpload(user.id,job.id,upload.key);const mime=original.httpMetadata?.contentType||'';const isVideo=mime.startsWith('video/');const mediaId=randomUUID();let thumbnailUrl=upload.thumbnail?objectUrl(upload.thumbnail):null;
    if(upload.thumbnail)await readUpload(user.id,job.id,upload.thumbnail);
    const item={mediaId,blobUrl:objectUrl(upload.key),contentType:mime,isVideo,thumbnailUrl};
    if(isVideo) {
     if(!Array.isArray(upload.frames)||!upload.frames.length||upload.frames.length>10)throw Object.assign(new Error('Video frames required'),{status:400});
     item.videoFrames=[];for(const key of upload.frames){const frame=await readUpload(user.id,job.id,key);if(!frame.httpMetadata?.contentType?.startsWith('image/')||frame.size>512*1024)throw new Error('Invalid video frame');item.videoFrames.push(Buffer.from(await frame.arrayBuffer()).toString('base64'));}
     item.thumbnailUrl=thumbnailUrl||objectUrl(upload.frames[0]);
    }else{
     const ai=upload.ai_image?await readUpload(user.id,job.id,upload.ai_image):original;
     const aiMime=ai.httpMetadata?.contentType;
     if(!['image/jpeg','image/png'].includes(aiMime)||ai.size>2*1024*1024)throw new Error('Prepare images on device before uploading');
     item.imageBase64=Buffer.from(await ai.arrayBuffer()).toString('base64');item.aiMime=aiMime;item.aiUrl=upload.ai_image?objectUrl(upload.ai_image):null;
    }
    media.push(item);mediaInputs.push({kind:isVideo?'video':'image',imageBase64:item.imageBase64,videoFrames:item.videoFrames,mimeType:isVideo?'image/jpeg':item.aiMime||mime,blobUrl:item.blobUrl});
   }
  }
  conversation=await getOrCreateConversation(user.id,{clientDay:clientDayFromRequest(url,body)});await startJob(job,conversation.id);requestRuntime.getStore().job=job;
  if(query)await createMessage(conversation.id,user.id,{role:'user',type:'text',content:query,source});
  for(const m of media){await createMediaAsset(m.mediaId,user.id,m.blobUrl,m.contentType,m.thumbnailUrl);if(m.aiUrl)await d1Query('UPDATE media_assets SET ai_media_url=$1 WHERE id=$2',[m.aiUrl,m.mediaId]);await createMessage(conversation.id,user.id,{role:'user',type:m.isVideo?'video':'photo',blobUrl:m.blobUrl,mediaAssetId:m.mediaId,source});}
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Access-Control-Allow-Origin':'*'});
  const mediaEvents=media.map((m,index)=>({index,total:media.length,media_asset_id:m.mediaId,blob_url:m.blobUrl,thumbnail_url:m.thumbnailUrl,preview_url:m.thumbnailUrl||(m.isVideo?null:m.blobUrl),content_type:m.contentType}));
  for(const m of mediaEvents)sendSse(res,'media',m);
  const result=await runAgent({mode:kind,query,mediaInputs,imageBase64:media[0]?.imageBase64,videoFrames:media[0]?.videoFrames,mimeType:media[0]?.contentType,userId:user.id,previousResponseId:conversation.last_response_id,spaceHint,userLanguage:parseLanguage(req),onEvent:event=>{if(['tool_call','tool_result','answer'].includes(event.type))steps.push(event);if(event.type==='answer_delta'||event.type==='answer')answer=event.text||answer;if(event.type==='done'&&event.suggestion)suggestion=event.suggestion;sendSse(res,event.type,event);}});
  responseId=result.responseId;const saved=await completeJob(job,{answer,suggestion,steps,mediaId:media[0]?.mediaId,source,responseId,media:mediaEvents});sendSse(res,'message_saved',{message_id:saved.message_id});res.end();
 }catch(error){await failJob(job,error.message).catch(e=>console.error('Task refund failed',e.message));if(!res.headersSent)return sendJson(res,error.status||500,{error:error.message,code:error.code||'TASK_FAILED'});sendSse(res,'error',{error:error.message});res.end();}
 return true;
}
