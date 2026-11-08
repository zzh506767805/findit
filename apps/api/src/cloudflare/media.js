import { createHmac, timingSafeEqual } from 'node:crypto';
import { cloudflareEnv } from './runtime.js';
export function objectUrl(key) { return `${cloudflareEnv().PUBLIC_API_URL}/objects/${encodeURIComponent(key)}`; }
export function objectKey(url) {
 try { const parsed=new URL(url);const base=new URL(cloudflareEnv().PUBLIC_API_URL);return parsed.origin===base.origin&&parsed.pathname.startsWith('/objects/')?decodeURIComponent(parsed.pathname.slice(9)):null; } catch { return null; }
}
export async function putMedia(bytes,name,contentType) {
 const context=cloudflareEnv();const key='uploads/'+name;
 await context.IMAGES.put(key,bytes,{httpMetadata:{contentType}});return objectUrl(key);
}
export function signedMedia(url) {
 const key=objectKey(url);if(!key)return url;
 const expires=String(Math.floor(Date.now()/1000)+3600);const sig=createHmac('sha256',cloudflareEnv().JWT_SECRET).update(key+'\n'+expires).digest('hex');
 return objectUrl(key)+'?expires='+expires+'&signature='+sig;
}
export async function mediaBytes(url) {
 const key=objectKey(url);if(!key)throw new Error('Media is not in private R2');
 const object=await cloudflareEnv().IMAGES.get(key);if(!object)throw new Error('Media not found');return Buffer.from(await object.arrayBuffer());
}
export async function serveObject(request,env) {
 const url=new URL(request.url),key=decodeURIComponent(url.pathname.slice(9));const expires=Number(url.searchParams.get('expires'));const signature=url.searchParams.get('signature')||'';
 if(!Number.isInteger(expires)||expires<Math.floor(Date.now()/1000)||expires>Math.floor(Date.now()/1000)+3700)return new Response('Expired',{status:403});
 const expected=createHmac('sha256',env.JWT_SECRET).update(key+'\n'+expires).digest('hex');const supplied=Buffer.from(signature);
 if(supplied.length!==expected.length||!timingSafeEqual(supplied,Buffer.from(expected)))return new Response('Invalid signature',{status:403});
 const object=await env.IMAGES.get(key);if(!object)return new Response('Not found',{status:404});
 const headers=new Headers();object.writeHttpMetadata(headers);headers.set('ETag',object.httpEtag);headers.set('Cache-Control','private, max-age=300');headers.set('Content-Length',String(object.size));
 return new Response(request.method==='HEAD'?null:object.body,{headers});
}
