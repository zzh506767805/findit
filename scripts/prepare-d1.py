import json,re,sqlite3,datetime,urllib.parse
from pathlib import Path
src=Path('.migration/source-20261108');snapshot=json.loads((src/'database.json').read_text());schema=snapshot['schema'];tables=snapshot['tables'];variants=json.loads((src/'legacy-variants.json').read_text()) if (src/'legacy-variants.json').exists() else {};base='https://findit-api.dressmeai.com'
q=lambda x:'"'+x.replace('"','""')+'"'
statements=[]
for table,s in schema.items():
 cols=[]
 for c in s['columns']:
  typ='INTEGER' if c['type'] in ['integer','bigint','smallint','boolean'] else 'REAL' if c['type'] in ['real','double precision'] else 'TEXT'
  default=c['default']
  if default and 'gen_random_uuid' in default:default=None
  elif default:
   default=re.sub(r'::[a-z ]+','',default)
   default=default.replace('now()',"(strftime('%Y-%m-%dT%H:%M:%fZ','now'))").replace('false','0').replace('true','1')
  cols.append(q(c['name'])+' '+typ+(' NOT NULL' if c['required'] else '')+(' DEFAULT '+default if default else ''))
 for c in s['constraints']:
  if c['type'] in ['p','u','f','c']:cols.append('CONSTRAINT '+q(c['name'])+' '+c['definition'])
 statements.append('CREATE TABLE '+q(table)+' ('+','.join(cols)+');')
 for idx in s['indexes']:
  if not any(c['name']==idx['name'] for c in s['constraints']):statements.append(re.sub(r'::[a-z ]+', '', idx['definition'].replace(' USING btree','').replace('ON public.','ON '))+';')
statements.extend([
 'CREATE UNIQUE INDEX IF NOT EXISTS cf_apple_id_unique ON users(apple_user_id);',
 'ALTER TABLE iap_transactions ADD COLUMN grant_token TEXT;',
 'ALTER TABLE media_assets ADD COLUMN ai_media_url TEXT;',
 "CREATE TABLE membership_grants(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);",
 "CREATE TABLE confirmations(user_id TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,token TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user_id,request_key));",
 "CREATE TABLE jobs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,credit_type TEXT,quota_day TEXT NOT NULL,input_key TEXT,result TEXT,settle_token TEXT,refunded INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,request_key));",
 'CREATE INDEX jobs_status_updated ON jobs(status,updated_at);',
])
Path('apps/api/migrations').mkdir(exist_ok=True);Path('apps/api/migrations/0001_initial.sql').write_text('\n'.join(statements)+'\n')
def normalize(v):
 if isinstance(v,dict):return {k:normalize(x) for k,x in v.items()}
 if isinstance(v,list):return [normalize(x) for x in v]
 if isinstance(v,str) and v.startswith('https://finditstore.blob.core.windows.net/'):
  p=urllib.parse.urlparse(v);name=urllib.parse.unquote(p.path.split('/',2)[2]);return base+'/objects/'+urllib.parse.quote('legacy/'+name,safe='')
 return v
literal=lambda v:'NULL' if v is None else str(int(v)) if isinstance(v,bool) else str(v) if isinstance(v,(int,float)) else "'"+(json.dumps(v,ensure_ascii=False,separators=(',',':')) if isinstance(v,(dict,list)) else str(v)).replace("'","''")+"'"
order=['users','spaces','positions','items','media_assets','conversations','messages','item_records','reward_events','iap_transactions','usage_daily','feedback'];inserts=[];deferred=[]
for t in order:
 for original in tables[t]:
  row=normalize(dict(original))
  if t=='media_assets' and row['id'] in variants:
   v=variants[row['id']]
   if v.get('ai'):row['ai_media_url']=base+'/objects/'+urllib.parse.quote(v['ai'],safe='')
   if v.get('thumb'):row['thumbnail_url']=base+'/objects/'+urllib.parse.quote(v['thumb'],safe='')
  for c in schema[t]['columns']:
   if c['type'].startswith('timestamp') and row.get(c['name']):row[c['name']]=datetime.datetime.fromisoformat(row[c['name']].replace('Z','+00:00')).astimezone(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
  if t=='users' and row.get('referred_by_user_id'):
   deferred.append('UPDATE users SET referred_by_user_id='+literal(row['referred_by_user_id'])+' WHERE id='+literal(row['id'])+';');row['referred_by_user_id']=None
  inserts.append('INSERT INTO '+q(t)+' ('+','.join(map(q,row))+') VALUES ('+','.join(map(literal,row.values()))+');')
 if t=='users':inserts.extend(deferred)
(src/'d1-import.sql').write_text('\n'.join(inserts)+'\n');(src/'d1-import.sql').chmod(0o600)
check=src/'d1-check.sqlite';check.unlink(missing_ok=True);db=sqlite3.connect(check);db.executescript('PRAGMA foreign_keys=ON;'+ '\n'.join(statements));db.executescript('\n'.join(inserts));assert not db.execute('PRAGMA foreign_key_check').fetchall()
counts={t:db.execute('SELECT count(*) FROM '+q(t)).fetchone()[0] for t in order};assert counts=={t:len(tables[t]) for t in order}
credits=db.execute('SELECT sum(free_credits),sum(paid_credits) FROM users').fetchone();assert credits==(sum(x['free_credits'] for x in tables['users']),sum(x['paid_credits'] for x in tables['users']))
print(json.dumps({'tables':counts,'credits':credits,'foreign_keys':'passed'}))
