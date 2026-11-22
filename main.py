import os, json, sqlite3
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
DB=os.getenv('DB_PATH','equity_engine.db')
app=FastAPI(title='Moonshot Equity Intelligence Engine')
HTML="<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Equity Intelligence</title><style>body{margin:0;background:#0b1020;color:#e9f0fa;font:14px system-ui}header,main{padding:18px;max-width:1400px;margin:auto}.panel{background:#121a2d;border:1px solid #25334b;border-radius:12px;padding:15px;margin:12px 0}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.muted{color:#9aa8bd}button{padding:9px 12px;background:#20304a;color:white;border:1px solid #25334b;border-radius:8px}table{border-collapse:collapse;width:100%;overflow:auto}td,th{text-align:left;padding:10px;border-bottom:1px solid #25334b}.empty{padding:20px;color:#9aa8bd;text-align:center}@media(max-width:700px){.grid{grid-template-columns:repeat(2,1fr)}} </style></head><body><header><h2>🌙 Moonshot Equity Intelligence</h2><small>SP1 Weekly · Capital Rotation · Catalysts · Early Accumulation</small> <button onclick=\"scan()\">Refresh scan</button> <span id=\"status\" class=\"muted\">Loading</span></header><main><div class=\"grid\"><div class=\"panel\">Scanned<div id=\"scanned\">—</div></div><div class=\"panel\">New SP1 flips<div id=\"flips\">—</div></div><div class=\"panel\">Early watch<div id=\"early\">—</div></div><div class=\"panel\">Updated<div id=\"updated\">—</div></div></div><div class=\"panel\"><h3>Sector Rotation Radar</h3><table><thead><tr><th>Sector</th><th>Relative Strength</th><th>1M</th><th>3M</th><th>Breadth</th><th>Phase</th></tr></thead><tbody id=\"sectors\"></tbody></table><div id=\"sectorEmpty\" class=\"empty\">Sector data provider not connected.</div></div><div class=\"panel\"><h3>SP1 Weekly Candidates</h3><table><thead><tr><th>Symbol</th><th>Sector</th><th>Status</th><th>Weekly RS</th><th>Volume</th><th>Score</th><th>Trigger</th><th>Research</th></tr></thead><tbody id=\"candidates\"></tbody></table><div id=\"candidateEmpty\" class=\"empty\">No scan data loaded. Configure a data provider before scanning.</div></div><div class=\"panel\"><h3>Early Watch — pre-SP1</h3><div id=\"watch\" class=\"empty\">Awaiting data.</div></div><div class=\"panel\"><h3>Catalyst Feed</h3><div id=\"catalysts\" class=\"empty\">Exchange filings and news feeds are not connected.</div></div><div class=\"panel\"><h3>Research Queue / Top-up</h3><div id=\"queue\" class=\"empty\">Research queue awaits SP1 events.</div></div><p class=\"muted\">Prototype only. No fabricated signals or live data. Research tool, not investment advice.</p></main><script>async function load(){try{let d=await(await fetch('/api/state')).json();for(let k of ['scanned','flips','early','updated'])document.getElementById(k).textContent=d[k==='flips'?'new_flips':k==='early'?'early_watch':k]??'—';document.getElementById('status').textContent=d.provider_status||''}catch(e){document.getElementById('status').textContent='API unavailable'}}async function scan(){document.getElementById('status').textContent='Scan requested';let d=await(await fetch('/api/scan',{method:'POST'})).json();document.getElementById('status').textContent=d.message;load()}load();setInterval(load,60000)</script></body></html>";
def init_db():
 with sqlite3.connect(DB) as c:
  c.execute('CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
  c.execute('CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,symbol TEXT,event_type TEXT,payload TEXT,created_at TEXT)')
  c.execute('CREATE TABLE IF NOT EXISTS research(symbol TEXT PRIMARY KEY,first_sp1 TEXT,last_sp1 TEXT,status TEXT,dossier TEXT)')
  initial={'scanned':0,'new_flips':0,'early_watch':0,'updated':'Never','provider_status':'Prototype: market data provider not connected'}
  c.execute('INSERT OR IGNORE INTO state(key,value) VALUES(?,?)',('dashboard',json.dumps(initial)))
init_db()
@app.get('/',response_class=HTMLResponse)
def home():return HTML
@app.get('/api/state')
def state():
 with sqlite3.connect(DB) as c:r=c.execute('SELECT value FROM state WHERE key=?',('dashboard',)).fetchone()
 return json.loads(r[0]) if r else {}
@app.post('/api/scan')
def scan():
 with sqlite3.connect(DB) as c:
  d=json.loads(c.execute('SELECT value FROM state WHERE key=?',('dashboard',)).fetchone()[0]);d['updated']=datetime.now(timezone.utc).astimezone().strftime('%Y-%m-%d %H:%M:%S %Z');d['provider_status']='No live provider configured. Scan does not create fake signals.';c.execute('UPDATE state SET value=? WHERE key=?',(json.dumps(d),'dashboard'))
 return {'ok':True,'message':'Prototype scan recorded; connect provider to screen real stocks.'}
@app.get('/health')
def health():return {'ok':True,'app':'moonshot-equity-engine'}
