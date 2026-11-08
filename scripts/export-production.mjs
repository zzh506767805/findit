import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
const out=path.resolve(process.argv[2]||'.migration/source-20261108');
await fs.mkdir(out,{recursive:true,mode:0o700});
const settings=JSON.parse(await fs.readFile('.migration/azure-settings-private.json','utf8'));
if(!settings.DATABASE_URL.includes('findit-db.postgres.database.azure.com')||settings.AZURE_STORAGE_ACCOUNT!=='finditstore')throw new Error('Unexpected source resources');
const client=new pg.Client({connectionString:settings.DATABASE_URL,ssl:{rejectUnauthorized:true}});
await client.connect();
await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(x=>x.tablename);
const schema={};const data={};
for(const t of tables){
 const q='"'+t.replaceAll('"','""')+'"';
 schema[t]={columns:(await client.query(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_attribute a LEFT JOIN pg_attrdef d ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[t])).rows,constraints:(await client.query('SELECT conname AS name,contype AS type,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass',[t])).rows,indexes:(await client.query("SELECT indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname='public' AND tablename=$1",[t])).rows};
 data[t]=(await client.query('SELECT * FROM '+q)).rows;
}
const snapshot={utc:new Date().toISOString(),tables:data,schema};
await client.query('COMMIT');await client.end();
await fs.writeFile(path.join(out,'database.json'),JSON.stringify(snapshot),{mode:0o600});
const literal=x=>x===null?'NULL':typeof x==='boolean'?(x?'TRUE':'FALSE'):typeof x==='number'?String(x):"'"+(x instanceof Date?x.toISOString():typeof x==='object'?JSON.stringify(x):String(x)).replaceAll("'","''")+"'";
let restore='CREATE EXTENSION IF NOT EXISTS pgcrypto;\n';
for(const[t,s]of Object.entries(schema))restore+=`CREATE TABLE "${t}" (`+s.columns.map(c=>`"${c.name}" ${c.type}${c.required?' NOT NULL':''}${c.default?' DEFAULT '+c.default:''}`).join(',')+');\n';
for(const[t,rows]of Object.entries(data))for(const row of rows)restore+=`INSERT INTO "${t}" (`+Object.keys(row).map(k=>'"'+k+'"').join(',')+') VALUES ('+Object.values(row).map(literal).join(',')+');\n';
for(const kinds of [['p','u'],['f','c']])for(const[t,s]of Object.entries(schema))for(const c of s.constraints)if(kinds.includes(c.type))restore+=`ALTER TABLE "${t}" ADD CONSTRAINT "${c.name}" ${c.definition};\n`;
for(const s of Object.values(schema))for(const i of s.indexes)if(!Object.values(schema).some(s=>s.constraints.some(c=>c.name===i.name)))restore+=i.definition+';\n';
await fs.writeFile(path.join(out,'postgres-restore.sql'),restore,{mode:0o600});
if(process.argv.includes('--database-only')) { console.log(JSON.stringify({tables:Object.fromEntries(Object.entries(data).map(([t,r])=>[t,r.length])),backup:out}));process.exit(0); }
const service=new BlobServiceClient(`https://${settings.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`,new StorageSharedKeyCredential(settings.AZURE_STORAGE_ACCOUNT,settings.AZURE_STORAGE_KEY));
const container=service.getContainerClient(settings.AZURE_STORAGE_CONTAINER);const blobs=[];
for await(const b of container.listBlobsFlat())blobs.push(b);
let cursor=0;const manifest=[];const checkpoint=path.join(out,'objects-partial.json');let prior=[];try{prior=JSON.parse(await fs.readFile(checkpoint,'utf8'));}catch{}const previous=new Map(prior.map(e=>[e.name,e]));
await Promise.all(Array.from({length:6},async()=>{while(cursor<blobs.length){const b=blobs[cursor++];const file=path.resolve(out,'objects',b.name);if(!file.startsWith(out+path.sep))throw new Error('Unsafe object name');await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const bc=container.getBlobClient(b.name);let saved=previous.get(b.name);let buffer;if(saved){try{buffer=await fs.readFile(file);if(buffer.length!==saved.bytes||crypto.createHash('sha256').update(buffer).digest('hex')!==saved.sha256)buffer=null;}catch{}}if(!buffer){for(let retry=0;;retry++){try{await fs.rm(file,{force:true});await bc.downloadToFile(file,0,undefined,{concurrency:2,blockSize:4*1024*1024,maxRetryRequestsPerBlock:5});buffer=await fs.readFile(file);break;}catch(error){if(retry>=4)throw error;await new Promise(r=>setTimeout(r,1000*(retry+1)));}}}if(buffer.length!==b.properties.contentLength)throw new Error('Size mismatch');manifest.push({name:b.name,key:'legacy/'+b.name,file:path.relative(out,file),sourceUrl:bc.url,bytes:buffer.length,contentType:b.properties.contentType||'application/octet-stream',sha256:crypto.createHash('sha256').update(buffer).digest('hex')});await fs.writeFile(checkpoint,JSON.stringify(manifest),{mode:0o600});if(manifest.length%50===0)console.log(JSON.stringify({verified:manifest.length,total:blobs.length}));}}));
manifest.sort((a,b)=>a.name.localeCompare(b.name));await fs.writeFile(path.join(out,'objects.json'),JSON.stringify(manifest),{mode:0o600});
console.log(JSON.stringify({tables:Object.fromEntries(Object.entries(data).map(([t,r])=>[t,r.length])),objects:manifest.length,bytes:manifest.reduce((s,e)=>s+e.bytes,0),backup:out}));
