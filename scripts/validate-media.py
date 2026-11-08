import json,secrets,urllib.request,urllib.error
from pathlib import Path
root=Path('.migration');out=root/'qa';session=json.loads((root/'qa-preview-session.json').read_text());base='https://findit-preview.dressmeai-zzh.workers.dev';opener=urllib.request.build_opener(urllib.request.ProxyHandler({'https':'http://127.0.0.1:7897'}))
def call(path,method='GET',data=None,mime=None):
 h={'Authorization':'Bearer '+session['token'],'User-Agent':'Mozilla/5.0','Accept-Language':'en-US'}
 if isinstance(data,dict):data=json.dumps(data).encode();h['Content-Type']='application/json'
 elif mime:h['Content-Type']=mime
 req=urllib.request.Request(base+path,data=data,headers=h,method=method)
 try:
  with opener.open(req,timeout=180) as r:body=r.read();code=r.status
 except urllib.error.HTTPError as e:body=e.read();code=e.code
 print(json.dumps({'path':path,'status':code}),flush=True);assert code==200,body[:300];return body
results=[]
for kind in ['heic','video']:
 job=json.loads(call('/agent/uploads','POST',{'request_key':'qa-'+kind+'-'+secrets.token_hex(6)}))['id'];file=out/('room.heic' if kind=='heic' else 'video.mp4');mime='image/heic' if kind=='heic' else 'video/mp4'
 key=json.loads(call('/staging/'+job+'/file_0','PUT',file.read_bytes(),mime))['key'];entry={'key':key}
 if kind=='heic':entry['ai_image']=json.loads(call('/staging/'+job+'/ai_0','PUT',(out/'room.jpg').read_bytes(),'image/jpeg'))['key']
 else:
  entry['frames']=[]
  for i,f in enumerate(sorted(out.glob('frame_*.jpg'))):entry['frames'].append(json.loads(call('/staging/'+job+'/frame_0_'+str(i),'PUT',f.read_bytes(),'image/jpeg'))['key'])
  entry['thumbnail']=entry['frames'][0]
 body=call('/agent/analyze?source=spaces','POST',{'job_id':job,'uploads':[entry],'query':'Record visible household items. Reply in English.'});events=[]
 for block in body.decode().split('\n\n'):
  event=next((x[7:] for x in block.splitlines() if x.startswith('event: ')),None);data=next((x[6:] for x in block.splitlines() if x.startswith('data: ')),None)
  if event and data:events.append({'type':event,'data':json.loads(data)})
 assert not any(e['type']=='error' for e in events),events
 suggestion=next(e['data']['suggestion'] for e in events if e['type']=='done');message=next(e['data']['message_id'] for e in events if e['type']=='message_saved');media=next(e['data']['media_asset_id'] for e in events if e['type']=='media')
 result=json.loads(call('/agent/confirm','POST',{'suggestion':suggestion,'message_id':message,'media_asset_id':media}));(out/(kind+'-events.json')).write_text(json.dumps(events));results.append({'kind':kind,'saved_items':result['saved_count'],'passed':True})
(out/'media-validation.json').write_text(json.dumps(results));print(json.dumps(results),flush=True)
