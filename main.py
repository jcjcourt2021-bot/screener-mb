import os, json, sqlite3, re
from datetime import datetime, timezone
import requests
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
DB=os.getenv('DB_PATH','equity_engine.db')
CHARTINK_URL=os.getenv('CHARTINK_URL','https://chartink.com/screener/1-sp1-plain-daily')
SCAN_CLAUSE=os.getenv('CHARTINK_SCAN_CLAUSE','').strip()
app=FastAPI(title='Moonshot Equity Intelligence Engine')
HTML="""<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Equity Intelligence</title><style>body{margin:0;background:#0b1020;color:#e9f0fa;font:14px system-ui}header,main{padding:18px;max-width:1400px;margin:auto}.panel{background:#121a2d;border:1px solid #25334b;border-radius:12px;padding:15px;margin:12px 0}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.muted{color:#9aa8bd}button{padding:9px 12px;background:#20304a;color:white;border:1px solid #25334b;border-radius:8px}table{border-collapse:collapse;width:100%;overflow:auto}td,th{text-align:left;padding:10px;border-bottom:1px solid #25334b}.empty{padding:20px;color:#9aa8bd;text-align:center}@media(max-width:700px){.grid{grid-template-columns:repeat(2,1fr)}}a{color:#8bc4ff}</style></head><body><header><h2>🌙 Moonshot Equity Intelligence</h2><small>Chartink SP1 · Capital Rotation · Catalysts · Fundamental Research</small> <button onclick="scan()">Run Chartink scan</button> <span id="status" class="muted">Loading</span></header><main><div class="grid"><div class="panel">Stocks in last scan<div id="scanned">—</div></div><div class="panel">New entries<div id="flips">—</div></div><div class="panel">Early watch<div id="early">—</div></div><div class="panel">Updated<div id="updated">—</div></div></div><div class="panel"><h3>SP1 Scan Candidates</h3><p><a href="https://chartink.com/screener/1-sp1-plain-daily" target="_blank">Open Chartink scanner ↗</a></p><table><thead><tr><th>Symbol</th><th>Name</th><th>Price</th><th>% Change</th><th>Volume</th><th>First detected</th><th>Research status</th></tr></thead><tbody id="candidates"></tbody></table><div id="candidateEmpty" class="empty">No live scan imported yet. Use Run Chartink scan.</div></div><div class="panel"><h3>Sector Rotation Radar</h3><div class="empty">Sector data source not connected.</div></div><div class="panel"><h3>Research Queue / Top-up</h3><div id="queue" class="empty">Research queue awaits scan candidates.</div></div><p class="muted">Prototype. Signals will only display when data is received from the scanner. Not investment advice.</p></main><script>async function load(){try{let d=await(await fetch('/api/state')).json();document.getElementById('scanned').textContent=d.scanned??0;document.getElementById('flips').textContent=d.new_flips??0;document.getElementById('early').textContent=d.early_watch??0;document.getElementById('updated').textContent=d.updated??'Never';document.getElementById('status').textContent=d.provider_status||'';let tb=document.getElementById('candidates');tb.innerHTML='';for(let x of d.candidates||[]){let tr=document.createElement('tr');for(let v of [x.symbol,x.name,x.close,x.per_chg,x.volume,x.first_seen,x.research_status]){let td=document.createElement('td');td.textContent=v??'';tr.appendChild(td)}tb.appendChild(tr)}document.getElementById('candidateEmpty').style.display=(d.candidates||[]).length?'none':'block'}catch(e){document.getElementById('status').textContent='API unavailable'}}async function scan(){document.getElementById('status').textContent='Running scanner…';try{let r=await fetch('/api/chartink/run',{method:'POST'});let d=await r.json();document.getElementById('status').textContent=d.message;load()}catch(e){document.getElementById('status').textContent='Scan failed'}}load();setInterval(load,60000)</script></body></html>"""
def init_db():
 with sqlite3.connect(DB) as c:
  c.execute('CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
  c.execute('CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,symbol TEXT,event_type TEXT,payload TEXT,created_at TEXT)')
  c.execute('CREATE TABLE IF NOT EXISTS research(symbol TEXT PRIMARY KEY,first_sp1 TEXT,last_sp1 TEXT,status TEXT,dossier TEXT)')
  c.execute('CREATE TABLE IF NOT EXISTS candidates(symbol TEXT PRIMARY KEY,name TEXT,close REAL,per_chg REAL,volume REAL,first_seen TEXT,last_seen TEXT,research_status TEXT)')
  initial={'scanned':0,'new_flips':0,'early_watch':0,'updated':'Never','provider_status':'Chartink scanner not run yet','candidates':[]}
  c.execute('INSERT OR IGNORE INTO state(key,value) VALUES(?,?)',('dashboard',json.dumps(initial)))
init_db()
def chartink_scan():
 if not SCAN_CLAUSE:
  raise RuntimeError('CHARTINK_SCAN_CLAUSE is not configured. Configure the scan clause for the saved Chartink scanner.')
 with requests.Session() as s:
  page=s.get(CHARTINK_URL,timeout=25);page.raise_for_status()
  m=re.search(r'<meta[^>]+name=["\\']csrf-token["\\'][^>]+content=["\\']([^"\\']+)',page.text,re.I)
  if not m: raise RuntimeError('Chartink CSRF token not found in scanner page.')
  resp=s.post('https://chartink.com/screener/process',headers={'X-CSRF-TOKEN':m.group(1),'X-Requested-With':'XMLHttpRequest'},data={'scan_clause':SCAN_CLAUSE},timeout=35)
  resp.raise_for_status();data=resp.json()
  return data.get('data',[])
@app.get('/',response_class=HTMLResponse)
def home():return HTML
@app.get('/api/state')
def state():
 with sqlite3.connect(DB) as c:r=c.execute('SELECT value FROM state WHERE key=?',('dashboard',)).fetchone()
 return json.loads(r[0]) if r else {}
@app.post('/api/chartink/run')
def run_chartink():
 now=datetime.now(timezone.utc).astimezone().strftime('%Y-%m-%d %H:%M:%S %Z')
 try:
  rows=chartink_scan()
  with sqlite3.connect(DB) as c:
   old={x[0] for x in c.execute('SELECT symbol FROM candidates')}
   symbols=set()
   for row in rows:
    sym=(row.get('nsecode') or row.get('symbol') or '').upper().strip()
    if not sym:continue
    symbols.add(sym);name=row.get('name',sym)
    close=float(row.get('close') or 0);change=float(row.get('per_chg') or 0);volume=float(row.get('volume') or 0)
    first=c.execute('SELECT first_seen FROM candidates WHERE symbol=?',(sym,)).fetchone()
    first_seen=first[0] if first else now
    c.execute('INSERT INTO candidates(symbol,name,close,per_chg,volume,first_seen,last_seen,research_status) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET name=excluded.name,close=excluded.close,per_chg=excluded.per_chg,volume=excluded.volume,last_seen=excluded.last_seen',(sym,name,close,change,volume,first_seen,now))
    c.execute('INSERT INTO events(symbol,event_type,payload,created_at) VALUES(?,?,?,?)',(sym,'CHARTINK_SCAN',json.dumps(row),now))
   candidate_rows=[dict(symbol=x[0],name=x[1],close=x[2],per_chg=x[3],volume=x[4],first_seen=x[5],research_status=('FULL RESEARCH PENDING' if x[0] not in old else 'TOP-UP REVIEW')) for x in c.execute('SELECT symbol,name,close,per_chg,volume,first_seen FROM candidates ORDER BY last_seen DESC')]
   new=len(symbols-old)
   d={'scanned':len(rows),'new_flips':new,'early_watch':0,'updated':now,'provider_status':f'Chartink scan successful · {len(rows)} results · {new} new candidates','candidates':candidate_rows}
   c.execute('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('dashboard',json.dumps(d)))
  return {'ok':True,'count':len(rows),'new':new,'message':f'Chartink scan completed: {len(rows)} results, {new} new symbols.'}
 except Exception as e:
  with sqlite3.connect(DB) as c:
   d=json.loads(c.execute('SELECT value FROM state WHERE key=?',('dashboard',)).fetchone()[0]);d['updated']=now;d['provider_status']=f'Scan error: {str(e)[:250]}';c.execute('UPDATE state SET value=? WHERE key=?',(json.dumps(d),'dashboard'))
  return {'ok':False,'message':str(e)}
@app.get('/health')
def health():return {'ok':True,'app':'moonshot-equity-engine'}
