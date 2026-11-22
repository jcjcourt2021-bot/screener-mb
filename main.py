import os, json, sqlite3, re, csv, io, html, asyncio, logging
from datetime import datetime, timezone
from contextlib import contextmanager
import requests
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import HTMLResponse
DB=os.getenv('DB_PATH','equity_engine.db')
CHARTINK_URL=os.getenv('CHARTINK_URL','https://chartink.com/screener/1-sp1-plain-daily')
SCAN_CLAUSE=os.getenv('CHARTINK_SCAN_CLAUSE','').strip()
SCAN_INTERVAL=int(os.getenv('SCAN_INTERVAL_MINUTES','30'))
app=FastAPI(title='Moonshot Equity Intelligence Engine',version='0.2.0')
logging.basicConfig(level=logging.INFO)
PAGE=r'''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Equity Intelligence</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#090d16;color:#e6edf7;font:14px Inter,system-ui,Arial}header,main{padding:16px;max-width:1500px;margin:auto}header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.muted{color:#8b9bb2}.panel{background:#111a29;border:1px solid #253348;border-radius:14px;padding:15px;margin:12px 0}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.metric{font-size:24px;font-weight:700;margin-top:6px}.button{padding:10px 13px;background:#233650;color:#fff;border:1px solid #354c6c;border-radius:9px;cursor:pointer}.pill{padding:4px 8px;border:1px solid #33465e;border-radius:30px;font-size:12px}table{border-collapse:collapse;width:100%;min-width:720px}td,th{text-align:left;padding:10px;border-bottom:1px solid #263449}th{color:#94a8c1;font-weight:500}a{color:#9ccaff}.scroll{overflow:auto}.empty{padding:20px;text-align:center;color:#899bb2}.section-title{display:flex;align-items:center;justify-content:space-between;gap:8px}.input{background:#0b1220;color:#eee;border:1px solid #34455c;border-radius:8px;padding:9px;width:100%}@media(max-width:720px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.metric{font-size:20px}header h2{font-size:19px}}
</style></head><body><header><div><h2>🌙 Moonshot Equity Intelligence</h2><div class="muted">SP1 discovery · capital rotation · catalyst research · outcomes</div></div><div><button class="button" onclick="scan()">⟳ Run scan</button> <span id="status" class="pill">Loading…</span></div></header><main>
<div class="grid"><div class="panel">Latest scan count<div class="metric" id="scanCount">—</div></div><div class="panel">New symbols<div class="metric" id="newCount">—</div></div><div class="panel">Research queue<div class="metric" id="queueCount">—</div></div><div class="panel">Last update<div id="lastUpdate" class="muted" style="margin-top:8px">—</div></div></div>
<div class="panel"><div class="section-title"><h3>SP1 Discovery</h3><a href="https://chartink.com/screener/1-sp1-plain-daily" target="_blank">Chartink scanner ↗</a></div><div class="scroll"><table><thead><tr><th>Symbol</th><th>Company</th><th>Price</th><th>Change %</th><th>Volume</th><th>First detected</th><th>Research</th></tr></thead><tbody id="candidateRows"></tbody></table></div><div id="noCandidates" class="empty">No scanner results loaded yet.</div></div>
<div class="panel"><div class="section-title"><h3>Intelligence Queue</h3><span class="muted">First appearance → full dossier · repeat → top-up</span></div><div id="researchQueue" class="empty">No research records yet.</div></div>
<div class="panel"><h3>Sector / Theme Rotation</h3><div id="sectorRows" class="empty">Sector-level analysis becomes available when sector/industry data is imported. No sector rotation is fabricated.</div></div>
<div class="panel"><h3>Import fundamentals / market data</h3><p class="muted">CSV columns: symbol, company, sector, industry, market_cap, pe, sales_growth, profit_growth, debt, order_book, catalyst, rs_1m, rs_3m, rs_6m. Values are stored as supplied; missing data is not guessed.</p><input class="input" type="file" id="csvFile" accept=".csv"><button class="button" onclick="uploadCsv()" style="margin-top:8px">Import CSV</button><div id="importMsg" class="muted"></div></div>
<div class="panel"><h3>System log</h3><div id="events" class="muted">—</div></div><p class="muted">Research tool, not an automated buy/sell recommendation. Signal quality and backtests are not yet validated.</p></main>
<script>
async function load(){try{let d=await(await fetch('/api/state')).json();scanCount.textContent=d.scanned??0;newCount.textContent=d.new_flips??0;queueCount.textContent=d.research_queue??0;lastUpdate.textContent=d.updated||'Never';status.textContent=d.provider_status||'Ready';candidateRows.innerHTML='';for(const x of d.candidates||[]){let tr=document.createElement('tr');for(const v of [x.symbol,x.name,x.close,x.per_chg,x.volume,x.first_seen,x.research_status]){let td=document.createElement('td');td.textContent=v??'';tr.appendChild(td)}candidateRows.appendChild(tr)}noCandidates.style.display=(d.candidates||[]).length?'none':'block';researchQueue.innerHTML=(d.queue||[]).length?d.queue.map(x=>'<div style="padding:8px;border-bottom:1px solid #263449"><b>'+safe(x.symbol)+'</b> · '+safe(x.status)+' · first SP1 '+safe(x.first_sp1||'—')+' · last '+safe(x.last_sp1||'—')+'</div>').join(''):'No research records yet';sectorRows.innerHTML=(d.sectors||[]).length?d.sectors.map(x=>'<div style="padding:7px">'+safe(x.sector)+' · '+x.count+' candidates · score '+(x.score??'—')+'</div>').join(''):'Sector-level analysis becomes available when sector/industry data is imported. No sector rotation is fabricated.';events.innerHTML=(d.events||[]).map(x=>safe(x.created_at)+' · '+safe(x.event_type)+' · '+safe(x.symbol||'system')+'<br>').join('')}catch(e){status.textContent='API unavailable'}}function safe(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function scan(){status.textContent='Scanner running…';try{let r=await fetch('/api/scan',{method:'POST'});let d=await r.json();status.textContent=d.message||'Scan finished';await load()}catch(e){status.textContent='Scan failed'}}async function uploadCsv(){let f=csvFile.files[0];if(!f){importMsg.textContent='Choose a CSV file first';return}let fd=new FormData();fd.append('file',f);let r=await fetch('/api/import/csv',{method:'POST',body:fd});let d=await r.json();importMsg.textContent=d.message||d.error||'Import complete';load()}load();setInterval(load,60000);
</script></body></html>'''
@contextmanager
def db():
    c=sqlite3.connect(DB,timeout=20);c.row_factory=sqlite3.Row
    try:yield c;c.commit()
    finally:c.close()
def now():return datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')
def init_db():
    with db() as c:
        c.executescript('''CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS candidates(symbol TEXT PRIMARY KEY,name TEXT,close REAL,per_chg REAL,volume REAL,first_seen TEXT,last_seen TEXT,scan_count INTEGER DEFAULT 0,research_status TEXT DEFAULT 'PENDING',daily_sp1 INTEGER DEFAULT 1,weekly_sp1 INTEGER DEFAULT 0,sector TEXT,industry TEXT,market_cap REAL,pe REAL,sales_growth REAL,profit_growth REAL,debt REAL,order_book TEXT,catalyst TEXT,rs_1m REAL,rs_3m REAL,rs_6m REAL,source_data TEXT);
        CREATE TABLE IF NOT EXISTS research(symbol TEXT PRIMARY KEY,first_sp1 TEXT,last_sp1 TEXT,status TEXT,dossier TEXT,updated_at TEXT);
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,symbol TEXT,event_type TEXT,payload TEXT,created_at TEXT);
        CREATE TABLE IF NOT EXISTS outcomes(symbol TEXT,signal_date TEXT,horizon_days INTEGER,signal_price REAL,forward_price REAL,return_pct REAL,PRIMARY KEY(symbol,signal_date,horizon_days));
        CREATE TABLE IF NOT EXISTS fundamentals(symbol TEXT PRIMARY KEY,updated_at TEXT,payload TEXT);
        ''')
        initial={'scanned':0,'new_flips':0,'research_queue':0,'updated':'Never','provider_status':'Scanner not run yet','candidates':[],'queue':[],'sectors':[],'events':[]}
        c.execute('INSERT OR IGNORE INTO state VALUES(?,?)',('dashboard',json.dumps(initial)))
init_db()
def get_scan_clause(page):
    if SCAN_CLAUSE:return SCAN_CLAUSE
    patterns=[r'"scan_clause"\s*:\s*"((?:\\.|[^"\\])*)"',r"scan_clause\s*[:=]\s*['\"]([^'\"]+)['\"]",r'"query"\s*:\s*"((?:\\.|[^"\\])*)"']
    for pat in patterns:
        m=re.search(pat,page,re.I|re.S)
        if m:
            try:clause=json.loads('"'+m.group(1)+'"')
            except Exception:clause=html.unescape(m.group(1))
            if clause:return clause
    return ''
def chartink_scan():
    with requests.Session() as s:
        page=s.get(CHARTINK_URL,headers={'User-Agent':'Mozilla/5.0'},timeout=30);page.raise_for_status()
        clause=get_scan_clause(page.text)
        if not clause:raise RuntimeError('Scan clause could not be extracted. Add CHARTINK_SCAN_CLAUSE as a Railway variable.')
        token=re.search(r'<meta[^>]+name=["\']csrf-token["\'][^>]+content=["\']([^"\']+)',page.text,re.I)
        if not token:token=re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']csrf-token',page.text,re.I)
        if not token:raise RuntimeError('Chartink CSRF token missing; scanner page format changed.')
        r=s.post('https://chartink.com/screener/process',headers={'X-CSRF-TOKEN':token.group(1),'X-Requested-With':'XMLHttpRequest','Referer':CHARTINK_URL},data={'scan_clause':clause},timeout=40);r.raise_for_status()
        payload=r.json();return payload.get('data',[]) if isinstance(payload,dict) else payload
def update_state(status,scanned=None,new=0):
    with db() as c:
        cand=[dict(x) for x in c.execute('SELECT symbol,name,close,per_chg,volume,first_seen,research_status,sector,scan_count FROM candidates ORDER BY last_seen DESC LIMIT 500')]
        q=[dict(x) for x in c.execute('SELECT symbol,first_sp1,last_sp1,status FROM research ORDER BY last_sp1 DESC LIMIT 100')]
        sectors=[dict(x) for x in c.execute('SELECT sector,COUNT(*) count,AVG(COALESCE(rs_3m,0)) score FROM candidates WHERE sector IS NOT NULL GROUP BY sector ORDER BY count DESC LIMIT 30')]
        events=[dict(x) for x in c.execute('SELECT event_type,symbol,created_at FROM events ORDER BY id DESC LIMIT 20')]
        old=c.execute("SELECT value FROM state WHERE key='dashboard'").fetchone();d=json.loads(old[0]) if old else {}
        d.update({'scanned':scanned if scanned is not None else d.get('scanned',0),'new_flips':new,'research_queue':sum(1 for x in q if x['status']!='RESEARCHED'),'updated':now(),'provider_status':status,'candidates':cand,'queue':q,'sectors':sectors,'events':events})
        c.execute('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('dashboard',json.dumps(d)))
        return d
def run_scan():
    rows=chartink_scan();timestamp=now();new_symbols=set()
    with db() as c:
        existing={r[0] for r in c.execute('SELECT symbol FROM candidates')}
        for row in rows:
            sym=str(row.get('nsecode') or row.get('symbol') or row.get('ticker') or '').strip().upper()
            if not sym:continue
            name=row.get('name') or row.get('companyname') or sym
            try:close=float(row.get('close') or row.get('price') or 0)
            except:close=0
            try:chg=float(row.get('per_chg') or row.get('change') or 0)
            except:chg=0
            try:vol=float(row.get('volume') or 0)
            except:vol=0
            first=c.execute('SELECT first_seen,scan_count FROM candidates WHERE symbol=?',(sym,)).fetchone()
            first_seen=first['first_seen'] if first else timestamp;scan_count=(first['scan_count'] if first else 0)+1
            status='TOP-UP REVIEW' if first else 'FULL RESEARCH PENDING'
            c.execute('''INSERT INTO candidates(symbol,name,close,per_chg,volume,first_seen,last_seen,scan_count,research_status,daily_sp1,source_data) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET name=excluded.name,close=excluded.close,per_chg=excluded.per_chg,volume=excluded.volume,last_seen=excluded.last_seen,scan_count=excluded.scan_count,daily_sp1=1,source_data=excluded.source_data''',(sym,name,close,chg,vol,first_seen,timestamp,scan_count,status,1,json.dumps(row)))
            if sym not in existing:
                new_symbols.add(sym);c.execute('INSERT OR IGNORE INTO research(symbol,first_sp1,last_sp1,status,dossier,updated_at) VALUES(?,?,?,?,?,?)',(sym,timestamp,timestamp,'PENDING','',timestamp))
            else:c.execute('UPDATE research SET last_sp1=?,status=CASE WHEN status="RESEARCHED" THEN "TOP-UP REVIEW" ELSE status END,updated_at=? WHERE symbol=?',(timestamp,timestamp,sym))
            c.execute('INSERT INTO events(symbol,event_type,payload,created_at) VALUES(?,?,?,?)',(sym,'SP1_SCAN',json.dumps(row),timestamp))
    update_state(f'Chartink scan successful · {len(rows)} results · {len(new_symbols)} new symbols',len(rows),len(new_symbols))
    return {'ok':True,'count':len(rows),'new':len(new_symbols),'message':f'Scan completed: {len(rows)} rows, {len(new_symbols)} new candidates.'}
@app.get('/',response_class=HTMLResponse)
def home():return PAGE
@app.get('/health')
def health():return {'ok':True,'version':'0.2.0','time':now()}
@app.get('/api/state')
def state():
    with db() as c:r=c.execute("SELECT value FROM state WHERE key='dashboard'").fetchone()
    return json.loads(r[0]) if r else {}
@app.post('/api/scan')
def scan():
    try:return run_scan()
    except Exception as e:
        msg=f'Scan error: {type(e).__name__}: {e}';logging.exception(msg);update_state(msg);return {'ok':False,'message':msg}
@app.post('/api/import/csv')
async def import_csv(file:UploadFile=File(...)):
    if not file.filename.lower().endswith('.csv'):raise HTTPException(400,'Upload a CSV file')
    raw=(await file.read()).decode('utf-8-sig');reader=csv.DictReader(io.StringIO(raw));count=0;ts=now()
    with db() as c:
        for row in reader:
            sym=(row.get('symbol') or row.get('ticker') or row.get('nsecode') or '').strip().upper()
            if not sym:continue
            name=row.get('company') or row.get('name') or sym
            def num(k):
                try:return float(row[k]) if row.get(k) not in (None,'') else None
                except:return None
            sector=row.get('sector') or row.get('Sector') or None
            c.execute('''INSERT INTO candidates(symbol,name,sector,industry,market_cap,pe,sales_growth,profit_growth,debt,order_book,catalyst,rs_1m,rs_3m,rs_6m,last_seen,source_data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET name=excluded.name,sector=COALESCE(excluded.sector,candidates.sector),industry=COALESCE(excluded.industry,candidates.industry),market_cap=COALESCE(excluded.market_cap,candidates.market_cap),pe=COALESCE(excluded.pe,candidates.pe),sales_growth=COALESCE(excluded.sales_growth,candidates.sales_growth),profit_growth=COALESCE(excluded.profit_growth,candidates.profit_growth),debt=COALESCE(excluded.debt,candidates.debt),order_book=COALESCE(excluded.order_book,candidates.order_book),catalyst=COALESCE(excluded.catalyst,candidates.catalyst),rs_1m=COALESCE(excluded.rs_1m,candidates.rs_1m),rs_3m=COALESCE(excluded.rs_3m,candidates.rs_3m),rs_6m=COALESCE(excluded.rs_6m,candidates.rs_6m),source_data=excluded.source_data''',(sym,name,sector,row.get('industry'),num('market_cap'),num('pe'),num('sales_growth'),num('profit_growth'),num('debt'),row.get('order_book'),row.get('catalyst'),num('rs_1m'),num('rs_3m'),num('rs_6m'),ts,json.dumps(row)))
            c.execute('INSERT INTO fundamentals VALUES(?,?,?) ON CONFLICT(symbol) DO UPDATE SET updated_at=excluded.updated_at,payload=excluded.payload',(sym,ts,json.dumps(row)));count+=1
            c.execute('INSERT INTO events(symbol,event_type,payload,created_at) VALUES(?,?,?,?)',(sym,'CSV_FUNDAMENTALS_IMPORT',json.dumps(row),ts))
    update_state(f'CSV import complete · {count} symbols updated');return {'ok':True,'count':count,'message':f'Imported/updated {count} symbols.'}
@app.get('/api/candidates')
def candidates():
    with db() as c:return [dict(r) for r in c.execute('SELECT * FROM candidates ORDER BY last_seen DESC')]
@app.get('/api/research/{symbol}')
def research(symbol:str):
    with db() as c:
        r=c.execute('SELECT * FROM research WHERE symbol=?',(symbol.upper(),)).fetchone();f=c.execute('SELECT * FROM fundamentals WHERE symbol=?',(symbol.upper(),)).fetchone()
    if not r:raise HTTPException(404,'Symbol not found')
    return {'research':dict(r),'fundamentals':json.loads(f['payload']) if f else None}
@app.post('/api/research/{symbol}/mark-reviewed')
def mark_reviewed(symbol:str):
    ts=now()
    with db() as c:
        r=c.execute('SELECT symbol FROM research WHERE symbol=?',(symbol.upper(),)).fetchone()
        if not r:raise HTTPException(404,'Symbol not found')
        c.execute('UPDATE research SET status="RESEARCHED",updated_at=? WHERE symbol=?',(ts,symbol.upper()));c.execute('UPDATE candidates SET research_status="RESEARCHED" WHERE symbol=?',(symbol.upper(),));c.execute('INSERT INTO events(symbol,event_type,payload,created_at) VALUES(?,?,?,?)',(symbol.upper(),'RESEARCH_MARKED_REVIEWED','{}',ts))
    update_state('Research status updated');return {'ok':True,'symbol':symbol.upper(),'status':'RESEARCHED'}
@app.on_event('startup')
async def background_scanner():
    async def loop():
        while True:
            await asyncio.sleep(max(5,SCAN_INTERVAL)*60)
            try:run_scan()
            except Exception as e:logging.exception('Background scan failed');update_state(f'Background scan failed: {e}')
    asyncio.create_task(loop())
