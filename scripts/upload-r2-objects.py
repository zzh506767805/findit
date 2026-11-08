#!/usr/bin/env python3
"""Transfer the private image snapshot through Wrangler's R2 object API and verify every byte."""
import argparse,concurrent.futures,hashlib,json,re,threading,time,urllib.request,urllib.error
from pathlib import Path
from urllib.parse import quote

p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--account-id',required=True);p.add_argument('--bucket',required=True);args=p.parse_args()
source=Path(args.source).resolve();manifest=json.loads((source/'objects.json').read_text())
config=Path.home()/'Library/Preferences/.wrangler/config/default.toml'
match=re.search(r'^oauth_token\s*=\s*"([^"]+)"',config.read_text(),re.M)
if not match:raise SystemExit('Wrangler login is required')
auth='Bearer '+match.group(1)
base='https://api.cloudflare.com/client/v4/accounts/'+quote(args.account_id,safe='')+'/r2/buckets/'+quote(args.bucket,safe='')+'/objects/'
checkpoint=source/('r2-verified-'+args.account_id+'-'+args.bucket+'.json')
verified=json.loads(checkpoint.read_text()) if checkpoint.exists() else {}
lock=threading.Lock()

def request(url,method='GET',data=None,content_type=None):
    headers={'Authorization':auth}
    if content_type:headers['Content-Type']=content_type
    req=urllib.request.Request(url,method=method,data=data,headers=headers)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req,timeout=180) as response:return response.read()
        except urllib.error.HTTPError as error:
            if error.code==404 and method=='GET':return None
            if error.code not in [408,429,500,502,503,504] or attempt==2:raise RuntimeError('R2 request failed with HTTP '+str(error.code)) from None
        except urllib.error.URLError:
            if attempt==2:raise RuntimeError('R2 connection failed') from None
        time.sleep(2**attempt)

def transfer(entry):
    file=(source/entry['file']).resolve()
    if source not in file.parents:raise RuntimeError('Unsafe snapshot file path')
    body=file.read_bytes();digest=hashlib.sha256(body).hexdigest()
    if digest!=entry['sha256'] or len(body)!=entry['bytes']:raise RuntimeError('Local snapshot checksum mismatch')
    url=base+quote(entry['key'],safe='')
    # A fresh read is authoritative even after resume; never trust only a local marker.
    remote=request(url)
    if remote is not None and hashlib.sha256(remote).hexdigest()!=digest:raise RuntimeError('Conflicting remote object; refusing overwrite')
    if remote is None:
        request(url,'PUT',body,entry.get('contentType','image/jpeg'))
        remote=request(url)
    if remote is None or len(remote)!=len(body) or hashlib.sha256(remote).hexdigest()!=digest:raise RuntimeError('Remote image verification failed')
    with lock:
        verified[entry['key']]=digest
        checkpoint.write_text(json.dumps(verified,indent=2));checkpoint.chmod(0o600)
        if len(verified)%50==0 or len(verified)==len(manifest):print(json.dumps({'verified':len(verified),'total':len(manifest)}),flush=True)

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for _ in pool.map(transfer,manifest):pass
print(json.dumps({'verified_images':len(manifest),'bytes':sum(entry['bytes'] for entry in manifest),'bucket':args.bucket,'status':'all_checksums_match'}))
