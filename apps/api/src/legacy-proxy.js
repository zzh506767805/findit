import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
const target=process.env.FINDIT_PROXY_TARGET;
if(!target)throw new Error('FINDIT_PROXY_TARGET required');
process.env.FINDIT_MODULE_ONLY='1';
const {parseMultipart,normalizeImageForStorage,createImageThumbnailBuffer,extractVideoFrames}=await import('./server.js');
function forwardHeaders(req){const h={...req.headers};delete h.host;delete h.connection;delete h['content-length'];h['x-legacy-proxy-secret']=process.env.LEGACY_PROXY_SECRET||'';return h;}
async function call(path,options={}){const headers=new Headers(options.headers||{});headers.set('User-Agent','FindItCompatibility/1.0.3');return fetch(target+path,{...options,headers});}
async function put(token,job,label,bytes,mime){const response=await call(`/staging/${job}/${label}`,{method:'PUT',headers:{Authorization:token,'Content-Type':mime,'X-Upload-Size':String(bytes.length)},body:bytes});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Upload failed'),{status:response.status});return data.key;}
async function relay(response,res){res.writeHead(response.status,Object.fromEntries(response.headers));if(!response.body){res.end();return;}const reader=response.body.getReader();for(;;){const {done,value}=await reader.read();if(done)break;res.write(Buffer.from(value));}res.end();}
const server=createServer(async(req,res)=>{
 const headers=forwardHeaders(req);let job;
 try{
  if(req.method==='POST'&&new URL(req.url,'http://local').pathname==='/agent/analyze'){
   const requestKey=req.headers['idempotency-key']||randomUUID();const reserved=await call('/agent/uploads',{method:'POST',headers:{Authorization:headers.authorization,'Content-Type':'application/json'},body:JSON.stringify({request_key:requestKey})});const state=await reserved.json();if(!reserved.ok){res.writeHead(reserved.status,{'Content-Type':'application/json'});res.end(JSON.stringify(state));return;}job=state.id;
   if(state.status==='COMPLETED')return relay(await call(req.url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({job_id:job})}),res);
   let files=[],query='';
   if((req.headers['content-type']||'').includes('multipart/form-data')){const parts=await parseMultipart(req);files=Array.isArray(parts.file)?parts.file:parts.file?[parts.file]:[];query=String(parts.query||parts.text||'');}
   else{const chunks=[];for await(const c of req)chunks.push(c);const data=JSON.parse(Buffer.concat(chunks).toString());files=[{buffer:Buffer.from(data.imageBase64,'base64'),contentType:data.mimeType||'image/jpeg'}];query=data.query||'';}
   if(!files.length||files.length>6)throw Object.assign(new Error('Select up to 6 media files'),{status:400});
   const uploads=[];
   for(let i=0;i<files.length;i++){
    const file=files[i];const video=file.contentType?.startsWith('video/');const normalized=video?{buffer:file.buffer,contentType:file.contentType}:await normalizeImageForStorage(file.buffer,file.contentType);const key=await put(headers.authorization,job,`file_${i}`,normalized.buffer,normalized.contentType);const frames=[],aiImage=video?null:await createImageThumbnailBuffer(normalized.buffer,normalized.contentType,1600);let thumbnail;
    if(video){const decoded=await extractVideoFrames(file.buffer);for(let j=0;j<decoded.length;j++){const bytes=Buffer.from(decoded[j],'base64');frames.push(await put(headers.authorization,job,`frame_${i}_${j}`,bytes,'image/jpeg'));if(j===0)thumbnail=await createImageThumbnailBuffer(bytes,'image/jpeg',640);}}
    else thumbnail=await createImageThumbnailBuffer(normalized.buffer,normalized.contentType,640);
    if(!thumbnail||(!video&&!aiImage))throw new Error('Could not prepare media');
    const thumb=await put(headers.authorization,job,`thumb_${i}`,thumbnail,'image/jpeg');const ai=aiImage?await put(headers.authorization,job,`ai_${i}`,aiImage,'image/jpeg'):null;uploads.push({key,thumbnail:thumb,ai_image:ai,frames});
   }
   return relay(await call(req.url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({job_id:job,uploads,query,request_key:requestKey})}),res);
  }
  const options={method:req.method,headers};if(!['GET','HEAD'].includes(req.method)){options.body=req;options.duplex='half';}
  return relay(await call(req.url,options),res);
 }catch(error){if(job)await call('/agent/jobs/'+job+'/cancel',{method:'POST',headers:{Authorization:headers.authorization}}).catch(()=>{});if(!res.headersSent){res.writeHead(error.status||502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message,code:'LEGACY_PROXY_ERROR'}));}else res.end();}
});
server.listen(Number(process.env.PORT||4000),'0.0.0.0');
