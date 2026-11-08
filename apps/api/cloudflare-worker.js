import { handleRequest } from './src/cloudflare/http.js';
import { route, verifyToken } from './src/server.js';
import { requestRuntime } from './src/cloudflare/runtime.js';
import { serveObject } from './src/cloudflare/media.js';
import { uploadBinary } from './src/cloudflare/agent.js';
import { cleanupDeletedMedia } from './src/cloudflare/cleanup.js';
import { expireJobs } from './src/cloudflare/jobs.js';
import { requireUser } from './src/store.js';
export default {
 fetch(request,env,ctx) {
  if(env.MAINTENANCE_MODE==='1'){if(new URL(request.url).pathname==='/health')return Response.json({ok:true,maintenance:true});return new Response('Service update in progress',{status:503,headers:{'Retry-After':'60'}});}
  return requestRuntime.run({env,ctx},async()=>{
   const url=new URL(request.url);
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,Idempotency-Key,X-Upload-Size'}});
   if(url.pathname.startsWith('/objects/'))return serveObject(request,env);
   const upload=url.pathname.match(/^\/staging\/([^/]+)\/([^/]+)$/);
   if(upload){if(request.method!=='PUT')return new Response('Method not allowed',{status:405});try{const token=request.headers.get('authorization')?.replace(/^Bearer /,'');const user=await requireUser(verifyToken(token));return uploadBinary(request,env,user.id,upload[1],upload[2]);}catch(error){return Response.json({error:error.message},{status:error.status||500});}}
   return handleRequest(request,ctx,route);
  });
 },
 scheduled(_event,env,ctx) { if(env.MAINTENANCE_MODE!=='1')ctx.waitUntil(requestRuntime.run({env},async()=>{await expireJobs();await cleanupDeletedMedia();})); }
};
