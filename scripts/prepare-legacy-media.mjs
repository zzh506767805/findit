import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const run=promisify(execFile),source=path.resolve('.migration/source-20261108'),out=path.resolve('.migration/legacy-variants');
await fs.mkdir(out,{recursive:true,mode:0o700});
const snapshot=JSON.parse(await fs.readFile(path.join(source,'database.json'),'utf8'));const manifest=JSON.parse(await fs.readFile(path.join(source,'objects.json'),'utf8'));const byUrl=new Map(manifest.map(x=>[x.sourceUrl,x]));const mapping={};const objects=[];
for(const asset of snapshot.tables.media_assets){
 const entry=byUrl.get(asset.blob_url.split('?')[0]);if(!entry)throw new Error('Asset not in backup');
 const input=path.join(source,entry.file);const isVideo=asset.content_type.startsWith('video/');
 const variants=[...(isVideo?[]:[['ai',1600]]),...(!asset.thumbnail_url?[['thumb',640]]:[])];
 for(const[kind,size]of variants){
  const name=asset.id+'-'+kind+'.jpg',file=path.join(out,name);let decoded=input;
  if(/image\/hei[cf]/.test(asset.content_type)){decoded=path.join(out,asset.id+'-decoded.jpg');await run('heif-convert',['-q','95',input,decoded]);}
  await run('ffmpeg',['-y','-i',decoded,'-vf',`scale='min(${size},iw)':'min(${size},ih)':force_original_aspect_ratio=decrease`,'-frames:v','1','-q:v','3',file]);
  const bytes=await fs.readFile(file),key='legacy-prepared/'+name;objects.push({key,file:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:'image/jpeg'});mapping[asset.id]??={};mapping[asset.id][kind]=key;
 }
}
await fs.writeFile(path.join(out,'objects.json'),JSON.stringify(objects),{mode:0o600});await fs.writeFile(path.join(source,'legacy-variants.json'),JSON.stringify(mapping),{mode:0o600});console.log(JSON.stringify({prepared_objects:objects.length,bytes:objects.reduce((s,x)=>s+x.bytes,0)}));
