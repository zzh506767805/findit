import { randomUUID } from 'node:crypto';
import { batch, d1Query, dateNow } from './database.js';
export async function reserveJob(userId,requestKey,kind) {
 const existing=(await d1Query('SELECT * FROM jobs WHERE user_id=$1 AND request_key=$2',[userId,requestKey]))[0];if(existing)return {job:existing,replay:true};
 const id=randomUUID(),stamp=dateNow(),day=new Date(Date.now()+8*3600_000).toISOString().slice(0,10);const column=kind==='analyze'?'analyze_count':'query_count';
 const result=await batch([
  [`INSERT INTO jobs(id,user_id,request_key,kind,status,credit_type,quota_day,created_at,updated_at) SELECT $1,id,$2,$3,'CREATED',CASE WHEN $3='query' THEN NULL WHEN free_credits>0 THEN 'free' ELSE 'paid' END,$4,$5,$5 FROM users WHERE id=$6 AND ($3='query' OR free_credits>0 OR (paid_credits>0 AND subscription_expires_at>$5)) AND COALESCE((SELECT ${column} FROM usage_daily WHERE user_id=$6 AND day=$4),0)<CASE WHEN subscription_expires_at>$5 THEN 50 ELSE 1 END ON CONFLICT(user_id,request_key) DO NOTHING`,[id,requestKey,kind,day,stamp,userId]],
  ["UPDATE users SET free_credits=free_credits-CASE WHEN (SELECT credit_type FROM jobs WHERE id=$1)='free' THEN 1 ELSE 0 END,paid_credits=paid_credits-CASE WHEN (SELECT credit_type FROM jobs WHERE id=$1)='paid' THEN 1 ELSE 0 END WHERE id=$2 AND EXISTS(SELECT 1 FROM jobs WHERE id=$1)",[id,userId]],
  [`INSERT INTO usage_daily(user_id,day,${column}) SELECT $1,$2,1 WHERE EXISTS(SELECT 1 FROM jobs WHERE id=$3) ON CONFLICT(user_id,day) DO UPDATE SET ${column}=usage_daily.${column}+1`,[userId,day,id]],
 ]);
 const job=(await d1Query('SELECT * FROM jobs WHERE user_id=$1 AND request_key=$2',[userId,requestKey]))[0];
 if(!job){const u=(await d1Query('SELECT * FROM users WHERE id=$1',[userId]))[0];if(!u)throw Object.assign(new Error('User not found'),{status:401});const noCredits=kind==='analyze'&&!(u.free_credits>0||(u.paid_credits>0&&u.subscription_expires_at>stamp));throw Object.assign(new Error(noCredits?'免费体验已用完，请开通会员继续使用':'今日次数已达上限，请明天再试'),{status:noCredits?403:429,code:noCredits?'INSUFFICIENT_CREDITS':'DAILY_LIMIT_REACHED'});}
 return {job,replay:!result[0].meta.changes};
}
export async function startJob(job,conversationId) {
 const result=await batch([["UPDATE jobs SET status='PROCESSING',updated_at=$1 WHERE id=$2 AND status='CREATED'",[dateNow(),job.id]]]);if(!result[0].meta.changes)throw Object.assign(new Error('Task already started or cancelled'),{status:409});job.conversationId=conversationId;job.status='PROCESSING';
}
export async function completeJob(job,{answer,suggestion,steps,mediaId,source,responseId,media}) {
 const messageId=randomUUID(),stamp=dateNow();const result={answer,suggestion,media,mediaId,message_id:messageId};
 const changes=await batch([
  ["UPDATE jobs SET status='COMPLETED',result=$1,settle_token=$2,updated_at=$3 WHERE id=$4 AND status='PROCESSING' AND refunded=0",[JSON.stringify(result),messageId,stamp,job.id]],
  ["INSERT INTO messages(id,conversation_id,user_id,role,type,content,suggestion,media_asset_id,source,steps,created_at) SELECT $1,$2,$3,'agent','answer',$4,$5,$6,$7,$8,$9 WHERE EXISTS(SELECT 1 FROM jobs WHERE id=$10 AND settle_token=$1 AND status='COMPLETED')",[messageId,job.conversationId,job.user_id,answer,suggestion?JSON.stringify(suggestion):null,mediaId||null,source,JSON.stringify(steps),stamp,job.id]],
  ['UPDATE conversations SET last_response_id=$1,updated_at=$2 WHERE id=$3 AND EXISTS(SELECT 1 FROM jobs WHERE id=$4 AND settle_token=$5 AND status=$6)',[responseId||null,stamp,job.conversationId,job.id,messageId,'COMPLETED']],
 ]);
 if(!changes[0].meta.changes)throw new Error('Recognition task is no longer active');return result;
}
export async function failJob(job,error='识别中断，请重试',beforeStartOnly=false) {
 const token=randomUUID(),stamp=dateNow();const col=job.kind==='analyze'?'analyze_count':'query_count';
 const result=await batch([
  ["UPDATE jobs SET status='FAILED',refunded=1,settle_token=$1,result=$2,updated_at=$3 WHERE id=$4 AND status IN('CREATED','PROCESSING') AND refunded=0 AND ($5=0 OR status='CREATED')",[token,JSON.stringify({error}),stamp,job.id,Number(beforeStartOnly)]],
  ["UPDATE users SET free_credits=free_credits+CASE WHEN $1='free' THEN 1 ELSE 0 END,paid_credits=paid_credits+CASE WHEN $1='paid' THEN 1 ELSE 0 END WHERE id=$2 AND EXISTS(SELECT 1 FROM jobs WHERE id=$3 AND settle_token=$4)",[job.credit_type,job.user_id,job.id,token]],
  [`UPDATE usage_daily SET ${col}=MAX(${col}-1,0) WHERE user_id=$1 AND day=$2 AND EXISTS(SELECT 1 FROM jobs WHERE id=$3 AND settle_token=$4)`,[job.user_id,job.quota_day,job.id,token]],
 ]);
 if(result[0].meta.changes && job.status==='CREATED'){const {cloudflareEnv}=await import('./runtime.js');const env=cloudflareEnv();try{let cursor;do{const list=await env.IMAGES.list({prefix:`users/${job.user_id}/jobs/${job.id}/`,cursor});if(list.objects.length)await env.IMAGES.delete(list.objects.map(x=>x.key));cursor=list.truncated?list.cursor:undefined;}while(cursor);}catch(error){console.error('Staging cleanup failed',error.message);}}
}
export async function expireJobs() {
 const old=new Date(Date.now()-10*60_000).toISOString();const jobs=await d1Query("SELECT * FROM jobs WHERE status IN('CREATED','PROCESSING') AND updated_at<$1 LIMIT 20",[old]);
 for(const job of jobs)await failJob(job);return jobs.length;
}
export async function findJob(userId,key) {return (await d1Query('SELECT * FROM jobs WHERE user_id=$1 AND (id=$2 OR request_key=$2)',[userId,key]))[0];}
