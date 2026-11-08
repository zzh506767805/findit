import os
import json,time,secrets,urllib.request,urllib.error
from pathlib import Path
base=os.getenv('QA_BASE_URL','https://findit-preview.dressmeai-zzh.workers.dev');root=Path('.migration');out=root/os.getenv('QA_DIR','qa');session=json.loads((root/os.getenv('QA_SESSION_FILE','qa-preview-session.json')).read_text());opener=urllib.request.build_opener(urllib.request.ProxyHandler({'https':'http://127.0.0.1:7897'}));results=[]
def call(route,method='GET',data=None,headers=None,auth=True):
 h={'User-Agent':os.getenv('QA_USER_AGENT','Mozilla/5.0'),'Accept-Language':'zh-CN',**(headers or {})}
 if auth:h['Authorization']='Bearer '+session['token']
 if isinstance(data,dict):data=json.dumps(data).encode();h['Content-Type']='application/json'
 req=urllib.request.Request(base+route,method=method,data=data,headers=h)
 try:
  with opener.open(req,timeout=180) as r:status=r.status;body=r.read();rh=dict(r.headers)
 except urllib.error.HTTPError as e:status=e.code;body=e.read();rh=dict(e.headers)
 results.append({'route':route,'status':status});(out/'http.json').write_text(json.dumps(results));print(json.dumps(results[-1]),flush=True);return status,body,rh
def parse_events(body):
 events=[]
 for block in body.decode().split('\n\n'):
  lines=block.splitlines();kind=next((x[7:] for x in lines if x.startswith('event: ')),None);data=next((x[6:] for x in lines if x.startswith('data: ')),None)
  if kind and data:events.append({'type':kind,'data':json.loads(data)})
 return events
assert call('/health',auth=False)[0]==200
assert call('/user/credits',auth=False)[0]==401
assert call('/user/benefits/welcome/claim','POST')[0]==200
key='qa-photo-'+secrets.token_hex(8);s,b,_=call('/agent/uploads','POST',{'request_key':key});assert s==200,b;job=json.loads(b)['id'];photo=(out/'room.jpg').read_bytes()
s,b,_=call('/staging/'+job+'/file_0','PUT',photo,{'Content-Type':'image/jpeg'});assert s==200,b;upload=json.loads(b)
s,b,_=call('/staging/'+job+'/ai_0','PUT',photo,{'Content-Type':'image/jpeg'});assert s==200,b;ai=json.loads(b)
s,b,_=call('/agent/analyze?source=spaces','POST',{'job_id':job,'uploads':[{'key':upload['key'],'ai_image':ai['key']}],'query':'记录这张照片里的家具和物品，房间是客厅'});assert s==200,b;events=parse_events(b);(out/'events.json').write_text(json.dumps(events));assert not any(x['type']=='error' for x in events),events
suggestion=next(x['data']['suggestion'] for x in events if x['type']=='done');media=next(x['data']['media_asset_id'] for x in events if x['type']=='media');message=next(x['data']['message_id'] for x in events if x['type']=='message_saved');assert suggestion and suggestion.get('items')
s,b,_=call('/agent/confirm','POST',{'suggestion':suggestion,'media_asset_id':media,'message_id':message});assert s==200,b;(out/'confirmed.json').write_bytes(b)
assert call('/media/'+media+'/original',auth=False)[0]==401
s,b,_=call('/agent/query','POST',{'query':'帮我找'+suggestion['items'][0]['name']});assert s==200,b;query_events=parse_events(b);assert not any(x['type']=='error' for x in query_events),query_events;(out/'query-events.json').write_text(json.dumps(query_events));print(json.dumps({'real_recognition':'passed','saved_items':json.loads((out/'confirmed.json').read_text())['saved_count'],'query':'passed'}),flush=True)
