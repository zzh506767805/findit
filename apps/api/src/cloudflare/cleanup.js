import {cloudflareEnv} from './runtime.js';
import {d1Query} from './database.js';
export async function cleanupDeletedMedia(id) {
 const env=cloudflareEnv();const rows=await d1Query('SELECT * FROM media_deletions'+(id?' WHERE id=$1':'')+' LIMIT 10',id?[id]:[]);
 for(const row of rows){try{const keys=JSON.parse(row.keys_json);for(let i=0;i<keys.length;i+=100)await env.IMAGES.delete(keys.slice(i,i+100));let cursor;do{const list=await env.IMAGES.list({prefix:`users/${row.user_id}/`,cursor});if(list.objects.length)await env.IMAGES.delete(list.objects.map(x=>x.key));cursor=list.truncated?list.cursor:undefined;}while(cursor);await d1Query('DELETE FROM media_deletions WHERE id=$1',[row.id]);}catch(error){console.error('Media cleanup will retry',error.message);}}
}
