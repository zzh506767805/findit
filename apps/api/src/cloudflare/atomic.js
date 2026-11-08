import { objectKey } from './media.js';
import { cleanupDeletedMedia } from './cleanup.js';
import { randomUUID } from 'node:crypto';
import { batch, d1Query, dateNow } from './database.js';
const day = () => new Date(Date.now()+8*3600_000).toISOString().slice(0,10);
const missing = () => Object.assign(new Error('User not found'), {status:401,code:'AUTH_FAILED'});
const addDays = (start, n) => new Date(Math.max(Date.now(), Date.parse(start)||0)+n*86400_000).toISOString();
export async function deleteAccount(userId) {
 const rows=await d1Query('SELECT blob_url,thumbnail_url,ai_media_url FROM media_assets WHERE user_id=$1',[userId]);
 const keys=[...new Set(rows.flatMap(row=>Object.values(row).map(objectKey).filter(Boolean)))];
 const cleanupId=randomUUID();
 const result=await batch([
  ['INSERT INTO media_deletions(id,user_id,keys_json,created_at) VALUES($1,$2,$3,$4)',[cleanupId,userId,JSON.stringify(keys),dateNow()]],
  ['UPDATE users SET referred_by_user_id=NULL WHERE referred_by_user_id=$1',[userId]],
  ['DELETE FROM reward_events WHERE user_id=$1 OR related_user_id=$1',[userId]],
  ...['jobs','confirmations','membership_grants','iap_transactions','usage_daily','messages','conversations','item_records','items','media_assets','positions','spaces'].map(t=>[`DELETE FROM ${t} WHERE user_id=$1`,[userId]]),
  ['DELETE FROM users WHERE id=$1',[userId]],
 ]);await cleanupDeletedMedia(cleanupId);return {success:Boolean(result.at(-1).meta.changes)};
}
export async function welcome(userId) {
 const stamp=dateNow(),token=randomUUID();
 const result=await batch([
  ["INSERT INTO reward_events(id,user_id,source,credits,created_at) SELECT $1,id,'welcome',30,$2 FROM users WHERE id=$3 AND welcome_claimed_at IS NULL ON CONFLICT DO NOTHING",[token,stamp,userId]],
  ["UPDATE users SET welcome_claimed_at=$1,paid_credits=paid_credits+30,subscription_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ',MAX(COALESCE(julianday(subscription_expires_at),0),julianday($1)),'+15 days'),subscription_product_id=CASE WHEN subscription_expires_at>$1 AND subscription_product_id IS NOT NULL THEN subscription_product_id ELSE 'welcome_trial' END WHERE id=$2 AND EXISTS(SELECT 1 FROM reward_events WHERE id=$3)",[stamp,userId,token]],
 ]);
 if(!(await d1Query('SELECT id FROM users WHERE id=$1',[userId])).length)throw missing();
 return Boolean(result[0].meta.changes);
}
export async function invite(userId, code) {
 const users=await d1Query('SELECT id,invite_code,invite_redeemed_at FROM users WHERE id=$1 OR invite_code=$2',[userId,code]);const u=users.find(u=>u.id===userId),inviter=users.find(u=>u.invite_code===code);
 if(!u)throw missing();
 if(u.invite_redeemed_at)throw Object.assign(new Error('你已经兑换过邀请码'),{status:409,code:'INVITE_ALREADY_REDEEMED'});
 if(u.invite_code===code)throw Object.assign(new Error('不能填写自己的邀请码'),{status:400,code:'INVITE_OWN_CODE'});
 if(!inviter)throw Object.assign(new Error('邀请码不存在'),{status:404,code:'INVITE_CODE_NOT_FOUND'});
 const token=randomUUID(),stamp=dateNow();
 const result=await batch([
  ["INSERT INTO reward_events(id,user_id,source,credits,related_user_id,created_at) SELECT $1,id,'invite_redeemee',15,$2,$3 FROM users WHERE id=$4 AND invite_redeemed_at IS NULL ON CONFLICT DO NOTHING",[token,inviter.id,stamp,userId]],
  ['UPDATE users SET invite_redeemed_at=$1,referred_by_user_id=$2,free_credits=free_credits+15 WHERE id=$3 AND EXISTS(SELECT 1 FROM reward_events WHERE id=$4)',[stamp,inviter.id,userId,token]],
  ['UPDATE users SET free_credits=free_credits+15 WHERE id=$1 AND EXISTS(SELECT 1 FROM reward_events WHERE id=$2)',[inviter.id,token]],
  ["INSERT INTO reward_events(id,user_id,source,credits,related_user_id,created_at) SELECT $1,$2,'invite_referrer',15,$3,$4 WHERE EXISTS(SELECT 1 FROM reward_events WHERE id=$5)",[randomUUID(),inviter.id,userId,stamp,token]],
 ]);
 if(!result[0].meta.changes)throw Object.assign(new Error('你已经兑换过邀请码'),{status:409,code:'INVITE_ALREADY_REDEEMED'});
}
export async function annual(userId,purchase,record=true) {
 const amount=Number(purchase.credits||0);if(!Number.isInteger(amount)||amount<=0)throw Object.assign(new Error('Invalid credits amount'),{status:400});
 if(!(await d1Query('SELECT id FROM users WHERE id=$1',[userId])).length)throw missing();
 const token=record?String(purchase.transactionId):randomUUID(),stamp=dateNow();
 if(!token||token==='undefined')throw Object.assign(new Error('Transaction id required'),{status:400});
 const expiry=Number.isFinite(Date.parse(purchase.expiresAt))&&Date.parse(purchase.expiresAt)>Date.now()?new Date(purchase.expiresAt).toISOString():null;
 const queries=[record ?
  ["INSERT INTO iap_transactions(transaction_id,original_transaction_id,user_id,product_id,credits,subscription_expires_at,created_at,grant_token) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(transaction_id) DO NOTHING",[token,purchase.originalTransactionId||null,userId,purchase.productId,amount,expiry,stamp,randomUUID()]]
  :['INSERT INTO membership_grants(id,user_id,created_at) VALUES($1,$2,$3)',[token,userId,stamp]]];
 const grantToken=record?queries[0][1].at(-1):token;
 const gate=record?'EXISTS(SELECT 1 FROM iap_transactions WHERE transaction_id=$5 AND grant_token=$6)':'EXISTS(SELECT 1 FROM membership_grants WHERE id=$5)';
 queries.push([`UPDATE users SET paid_credits=CASE WHEN subscription_expires_at>$1 THEN paid_credits+$2 ELSE $2 END,subscription_expires_at=CASE WHEN $3 IS NOT NULL THEN MAX(COALESCE(subscription_expires_at,$3),$3) ELSE strftime('%Y-%m-%dT%H:%M:%fZ',MAX(COALESCE(julianday(subscription_expires_at),0),julianday($1)),'+365 days') END,subscription_product_id=$4 WHERE id=$7 AND ${gate}`,[stamp,amount,expiry,purchase.productId||null,token,grantToken,userId]]);
 const result=await batch(queries);return {alreadyProcessed:!result[0].meta.changes};
}
export async function confirm(userId,suggestion,mediaId,requestKey) {
 if(mediaId&&!(await d1Query('SELECT id FROM media_assets WHERE id=$1 AND user_id=$2',[mediaId,userId])).length)throw Object.assign(new Error('Media not found'),{status:404});
 const spaceName=String(suggestion.space?.name||'').trim(),positionName=String(suggestion.position?.name||'').trim();
 if(!spaceName||!positionName)throw Object.assign(new Error('Space and position are required'),{status:400});
 const key=requestKey||randomUUID();const prior=await d1Query('SELECT result FROM confirmations WHERE user_id=$1 AND request_key=$2',[userId,key]);if(prior.length)return JSON.parse(prior[0].result);
 const space=(await d1Query('SELECT * FROM spaces WHERE user_id=$1 AND name=$2',[userId,spaceName]))[0]||{id:randomUUID(),user_id:userId,name:spaceName};
 const position=(await d1Query('SELECT * FROM positions WHERE space_id=$1 AND name=$2',[space.id,positionName]))[0]||{id:randomUUID(),space_id:space.id,user_id:userId,name:positionName,description:suggestion.position.description||''};
 const token=randomUUID(),gate='EXISTS(SELECT 1 FROM confirmations WHERE user_id=$1 AND request_key=$2 AND token=$3)';const values=[userId,key,token];
 const inputs=(suggestion.items||[]).filter(i=>i.status!=='missing'&&String(i.name||'').trim());
 const response={space,position,saved_count:inputs.length};
 const queries=[['INSERT INTO confirmations(user_id,request_key,token,result) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,request_key) DO NOTHING',[...values,JSON.stringify(response)]],
 [`INSERT INTO spaces(id,user_id,name) SELECT $4,$1,$5 WHERE ${gate} ON CONFLICT(id) DO NOTHING`,[...values,space.id,spaceName]],
 [`INSERT INTO positions(id,space_id,user_id,name,description) SELECT $4,$5,$1,$6,$7 WHERE ${gate} ON CONFLICT(id) DO NOTHING`,[...values,position.id,space.id,positionName,position.description]],
 ];
 if(mediaId)queries.push([`UPDATE media_assets SET position_id=$4 WHERE id=$5 AND user_id=$1 AND ${gate}`,[...values,position.id,mediaId]]);
 const allocated=new Map();
 for(const item of inputs){
  const existing=allocated.get(String(item.name).trim())||(await d1Query('SELECT id,description FROM items WHERE user_id=$1 AND name=$2',[userId,String(item.name).trim()]))[0];const id=existing?.id||randomUUID();allocated.set(String(item.name).trim(),{id,description:item.description});
  queries.push([`INSERT INTO items(id,user_id,name,description) SELECT $4,$1,$5,$6 WHERE ${gate} ON CONFLICT(id) DO NOTHING`,[...values,id,String(item.name).trim(),item.description||'']]);
  if(item.description)queries.push([`UPDATE items SET description=$4 WHERE id=$5 AND COALESCE(description,'')='' AND ${gate}`,[...values,item.description,id]]);
  queries.push([`INSERT INTO item_records(id,user_id,item_id,position_id,media_asset_id,note) SELECT $4,$1,$5,$6,$7,$8 WHERE ${gate}`,[...values,randomUUID(),id,position.id,mediaId||null,item.note||'']]);
 }
 await batch(queries);const saved=await d1Query('SELECT result FROM confirmations WHERE user_id=$1 AND request_key=$2',[userId,key]);return JSON.parse(saved[0].result);
}
