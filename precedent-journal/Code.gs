/**
 * PRECEDENT KNOWLEDGE BANK  —  auto-file engine
 * =============================================================================
 * Drop any legal file (judgment, circular, GO, report, workshop material, notes,
 * dictionary source) into the DROP folder and press RUN. For each file:
 *
 *  JUDGMENT  -> Gemini extracts exam notes (points, ingredients, precedents,
 *               directions, Repeal/Varied flags). Notes are appended to the
 *               current PRECEDENTS Doc under the statute(s) it concerns, the case
 *               title bookmarked and linked to the source PDF. If essay-worthy,
 *               an English essay + Telugu translation goes to the current ESSAY
 *               Doc. New important English legal terms + Telugu are appended to
 *               the single DICTIONARY Doc (deduplicated). Search keys go to the
 *               SEARCH tab (category = which Precedents volume it landed in).
 *  NON-JUDGMENT -> renamed from its own title, URL + category recorded in the
 *               SEARCH tab. No notes.
 *
 *  Processed files are renamed and moved to the FILED folder.
 *  Unknown statute -> a new statute row + Doc is auto-created and flagged yellow.
 *  Every statute row in INDEX also collects direct links to every Precedents
 *  volume that actually contains a note for it (Doc 1..Doc 8 columns).
 *
 * TABS:  INDEX (statute registry) | SEARCH (search cards + non-judgment files) |
 *        Dictionary (dedup tracker) | Errors
 * DOCS:  Precedents-N, Essay-N, Dictionary Eng-Telugu  (in the Textbook folder)
 *
 * SETUP: 1) Script property GEMINI_API_KEY  2) Time zone Asia/Kolkata
 *        3) run tbSetup()  4) run tbInstallTriggers()  5) Deploy > Web app
 */

/* ================================ CONFIG ================================ */
var TB_SHEET_ID    = '1Ac9EHfNTdebDfQqW8fOxSOsONtAVAk9x-FveOsEJqFM';
var TB_DROP_FOLDER = '1er4Uqds6os_RZDdPf59FHT7HHKuolYPA';
var TB_FILED_FOLDER= '1_Ba_3exkTbWTYkl2VVkCPIfBVCNSZC5w';

var S_INDEX = 'subjects';
var S_SEARCH= 'search_index';
var S_DICT  = 'eng_tel_dictionary';
var S_ERR   = 'Errors';

var TB_MODEL      = 'gemini-2.5-flash';
var TB_MAX_TOKENS = 32000;
var TB_MAX_BYTES  = 19000000;
var TB_BUDGET_MS  = 260000;      // ~4.3 min per run
var TB_DOC_MAX    = 700000;      // roll a volume past this many characters
var TB_CELL_MAX   = 45000;
var TB_PAUSE_MS   = 14000;       // between files: stay under per-minute token limit
var TB_RETRY_MAX_WAIT = 95000;

var TB_PREC_PREFIX = 'Precedents';
var TB_ESSAY_PREFIX= 'Essay';
var TB_DICT_NAME   = 'Dictionary Eng-Telugu';

/* Full set of category tags used anywhere in the sheet (for humans skimming INDEX/SEARCH). */
var TB_CATEGORIES = ['Judgment','SCAR','Prosecution replenish','SC_HC_Circulars',
  'workshop_materials','SC_HC_judgments_circulated','GO Ms','Gazette','Academy material',
  'Precedents-1','Precedents-2','Precedents-3','ENGLISH-TELUGU-DICTIONARY',
  'ESSAYS_TRANSLATION','Miscellaneous'];

/* The subset Gemini is actually allowed to choose for a non-judgment file. Kept as its own
   list (rather than re-deriving from TB_CATEGORIES) so the prompt and the normaliser below
   can never silently drift apart. */
var TB_NONJUDG_CATEGORIES = ['SCAR','Prosecution replenish','SC_HC_Circulars','workshop_materials',
  'SC_HC_judgments_circulated','GO Ms','Gazette','Academy material','Miscellaneous'];

/* ================================ SETUP ================================ */
function tbSetup(){
  var ss = SpreadsheetApp.openById(TB_SHEET_ID);

  // INDEX: keep whatever is already there (statutes in column A, Doc URLs across).
  var idx = ss.getSheetByName(S_INDEX) || ss.insertSheet(S_INDEX);
  if (idx.getLastRow() === 0 || !tbTrim_(idx.getRange(1,1).getValue())){
    idx.getRange(1,1,1,9).setValues([['Statute','Doc 1','Doc 2','Doc 3','Doc 4','Doc 5','Doc 6','Doc 7','Doc 8']]);
    idx.getRange(1,1,1,9).setFontWeight('bold').setFontColor('#fff').setBackground('#26405f');
    idx.setFrozenRows(1);
  }

  // SEARCH: Category | Title | File URL | Search keys | Bookmark.
  // A = Category (Precedents-N doc URL for judgments, else category label)
  // B = Title (case title or file title - human readable)
  // C = File URL (source document url)
  // D = Search keys (judgments only)   E = Bookmark link (judgments only)
  //
  // Migrate in place if an older 4-column sheet (no Title column) is found, so existing
  // rows keep their data - it just shifts one column right and gets a blank Title, which
  // the app already falls back to guessing from the URL for.
  var se = ss.getSheetByName(S_SEARCH) || ss.insertSheet(S_SEARCH);
  var seHead = se.getLastColumn() ? se.getRange(1,1,1,se.getLastColumn()).getValues()[0] : [];
  if (tbTrim_(seHead[1]) !== 'Title'){
    if (se.getLastColumn() >= 2 && tbTrim_(seHead[0])) se.insertColumnBefore(2);
    se.getRange(1,1,1,5).setValues([['Category','Title','File URL','Search keys','Bookmark']]);
    se.getRange(1,1,1,5).setFontWeight('bold').setFontColor('#fff').setBackground('#2f6b4f');
    se.setFrozenRows(1);
    se.setColumnWidth(1,260); se.setColumnWidth(2,300); se.setColumnWidth(3,300);
    se.setColumnWidth(4,480); se.setColumnWidth(5,200);
  }

  tbTab_(ss, S_DICT, ['English term','Telugu','First seen in','Added'], [240,240,300,130]);
  tbTab_(ss, S_ERR,  ['What','Detail','Reason','Time'], [220,240,460,130]);

  tbTextbookFolder_();
  return 'Knowledge Bank ready. Statutes are read from INDEX column A.';
}

function tbTab_(ss,name,headers,widths){
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0){
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,headers.length).setFontWeight('bold').setFontColor('#fff').setBackground('#2f6b4f');
    var i; for(i=0;i<widths.length;i++) sh.setColumnWidth(i+1,widths[i]);
  }
  return sh;
}
function tbSh_(n){ return SpreadsheetApp.openById(TB_SHEET_ID).getSheetByName(n); }
function tbEnsure_(){ if(!tbSh_(S_SEARCH)) tbSetup(); }

function tbNamedFolder_(key,name){
  var p = PropertiesService.getScriptProperties(), id = p.getProperty(key);
  if (id){ try { return DriveApp.getFolderById(id); } catch(e){} }
  var f = DriveApp.createFolder(name);
  p.setProperty(key,f.getId());
  return f;
}
function tbTextbookFolder_(){ return tbNamedFolder_('TEXTBOOK_FOLDER_ID','Precedent Knowledge Bank'); }

function tbErr_(what,detail,reason){
  var sh = tbSh_(S_ERR);
  if(!sh){ tbSetup(); sh = tbSh_(S_ERR); }
  sh.appendRow([what,detail,String(reason).substring(0,480),new Date()]);
}

/* ================================ HELPERS ================================ */
function tbTrim_(s){ return String(s==null?'':s).replace(/^\s+|\s+$/g,''); }
function tbCap_(s,n){ var t=String(s==null?'':s); return t.length>(n||500)?t.substring(0,n||500):t; }
function tbPad_(n){ var s=String(n); while(s.length<4)s='0'+s; return s; }
function tbClean_(s){ return String(s||'').replace(/[\/\\:\*\?"<>\|]/g,' ').replace(/\s+/g,' ').replace(/^ +| +$/g,''); }
function tbExt_(n){ var s=String(n||''),d=s.lastIndexOf('.'); return (d===-1||d<s.length-6)?'':s.substring(d); }
function tbNorm_(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function tbDocId_(u){ var m=String(u||'').match(/[-\w]{25,}/); return m?m[0]:''; }
function tbKey_(){ return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'); }

/** Best-fit an arbitrary category string onto TB_NONJUDG_CATEGORIES so near-duplicate
 * spellings ("GO ms" vs "GO Ms") don't fork the SEARCH tiles. Unknown categories are kept
 * verbatim rather than forced into Miscellaneous, so nothing genuinely new is lost. */
function tbNormalizeCategory_(cat){
  var c = tbTrim_(cat);
  if (!c) return 'Miscellaneous';
  var n = tbNorm_(c), i;
  for (i=0;i<TB_NONJUDG_CATEGORIES.length;i++)
    if (tbNorm_(TB_NONJUDG_CATEGORIES[i]) === n) return TB_NONJUDG_CATEGORIES[i];
  return c;
}

/* ============================ STATUTE REGISTRY ============================ */
function tbIndexRows_(){
  var sh = tbSh_(S_INDEX), out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  var w = Math.max(sh.getLastColumn(),2);
  var v = sh.getRange(2,1,sh.getLastRow()-1,w).getValues(), i, c;
  for (i=0;i<v.length;i++){
    var s = tbTrim_(v[i][0]); if (!s) continue;
    var urls = [];
    for (c=1;c<w;c++){ var cell=tbTrim_(v[i][c]); if (cell && tbDocId_(cell)) urls.push(cell); }
    out.push({ row:i+2, statute:s, urls:urls });
  }
  return out;
}
function tbStatuteNames_(){ var r=tbIndexRows_(),o=[],i; for(i=0;i<r.length;i++)o.push(r[i].statute); return o; }

function tbResolveStatute_(name){
  var rows=tbIndexRows_(), n=tbNorm_(name), i;
  for (i=0;i<rows.length;i++) if (tbNorm_(rows[i].statute)===n) return rows[i].statute;
  for (i=0;i<rows.length;i++){
    var a=tbNorm_(rows[i].statute);
    if (a && n && (a.indexOf(n)!==-1 || n.indexOf(a)!==-1)) return rows[i].statute;
  }
  return '';
}

/** Resolve or CREATE a statute row. Returns {statute, created}. */
function tbEnsureStatute_(name){
  var clean = tbCap_(tbTrim_(name),150);
  if (!clean) return { statute:'', created:false };
  var hit = tbResolveStatute_(clean);
  if (hit) return { statute:hit, created:false };
  var sh = tbSh_(S_INDEX);
  var row = Math.max(sh.getLastRow(),1)+1;
  sh.getRange(row,1).setValue(clean).setBackground('#fff3c4')
    .setNote('Auto-created '+new Date().toLocaleDateString()+'. Rename or merge if needed.');
  return { statute:clean, created:true };
}

/** Record that a Precedents volume Doc now holds a note for this statute, in the next free
 * Doc N column of its INDEX row (deduplicated by URL). This is what powers the SUBJECTS tile
 * in the app - without it every statute would show zero linked documents. */
function tbLinkStatuteDoc_(statute, docUrl){
  if (!statute || !docUrl) return;
  var sh = tbSh_(S_INDEX);
  if (!sh) return;
  var rows = tbIndexRows_(), target = null, i;
  for (i=0;i<rows.length;i++) if (rows[i].statute === statute){ target = rows[i]; break; }
  if (!target) return;
  if (target.urls.indexOf(docUrl) !== -1) return;
  var w = Math.max(sh.getLastColumn(), 9);
  if (sh.getLastColumn() < w) sh.insertColumnsAfter(sh.getLastColumn(), w - sh.getLastColumn());
  var rowVals = sh.getRange(target.row, 2, 1, w-1).getValues()[0];
  for (i=0;i<rowVals.length;i++){
    if (!tbTrim_(rowVals[i])){
      sh.getRange(target.row, 2+i).setValue(docUrl);
      return;
    }
  }
  // all Doc-N slots already used - don't fail the run, just leave a breadcrumb.
  var cell = sh.getRange(target.row,1);
  cell.setNote((cell.getNote()||'') + '\nMore volumes not shown (all Doc slots full): ' + docUrl);
}

/* ============================ VOLUMED DOCS ============================ */
/**
 * Return an open Doc for a family (Precedents / Essay) with room to spare,
 * creating the next volume when the latest is full. Volume URLs are tracked in
 * Script Properties as a JSON list per family, and (for Precedents) mirrored
 * so tbCurrentPrecedentTag_ can name the category.
 */
function tbVolumeDoc_(prefix){
  var p = PropertiesService.getScriptProperties();
  var key = 'VOLS_' + prefix;
  var list = [];
  try { list = JSON.parse(p.getProperty(key) || '[]'); } catch(e){ list = []; }

  if (list.length){
    var lastUrl = list[list.length-1];
    var id = tbDocId_(lastUrl);
    if (id){
      try {
        var doc = DocumentApp.openById(id);
        if (doc.getBody().getText().length < TB_DOC_MAX)
          return { doc:doc, url:lastUrl, volume:list.length, name:prefix+'-'+list.length };
        doc.saveAndClose();
      } catch(e){ tbErr_('open vol', prefix, e); }
    }
  }
  var vol = list.length + 1;
  var name = prefix + '-' + vol;
  var nd = DocumentApp.create(name);
  var file = DriveApp.getFileById(nd.getId());
  tbTextbookFolder_().addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  var b = nd.getBody(); b.clear();
  b.appendParagraph(name).setHeading(DocumentApp.ParagraphHeading.TITLE);
  nd.saveAndClose();
  nd = DocumentApp.openById(nd.getId());
  list.push(nd.getUrl());
  p.setProperty(key, JSON.stringify(list));
  return { doc:nd, url:nd.getUrl(), volume:vol, name:name };
}

/** The single dictionary Doc. */
function tbDictDoc_(){
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('DICT_DOC_ID');
  if (id){ try { return DocumentApp.openById(id); } catch(e){} }
  var doc = DocumentApp.create(TB_DICT_NAME);
  var file = DriveApp.getFileById(doc.getId());
  tbTextbookFolder_().addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  var b = doc.getBody(); b.clear();
  b.appendParagraph(TB_DICT_NAME).setHeading(DocumentApp.ParagraphHeading.TITLE);
  var t = b.appendTable([['English term','Telugu']]);
  t.getRow(0).editAsText().setBold(true);
  doc.saveAndClose();
  doc = DocumentApp.openById(doc.getId());
  p.setProperty('DICT_DOC_ID', doc.getId());
  return doc;
}

/* ================================ GEMINI ================================ */
function tbClassifyAndExtractPrompt_(){
  var statutes = tbStatuteNames_();
  return [
    'You are building an Indian legal KNOWLEDGE BANK for a magistrate preparing the District Judge and',
    'Junior Civil Judge exams (including a 100-mark English<->Telugu translation paper).',
    '',
    'STEP 1 - CLASSIFY the file. Set "kind" to exactly one of:',
    '  "judgment"     - a court judgment or order.',
    '  "non_judgment" - a circular, GO, gazette, report, workshop/academy material, notes,',
    '                   digest, Prosecution Replenish, SCAR, dictionary source, or anything',
    '                   that is not a judgment.',
    '',
    'If kind = "non_judgment": return "title" (a short descriptive title read from its first pages),',
    '"category" (best fit among: ' + TB_NONJUDG_CATEGORIES.join(', ') + '), a few "search_keys",',
    'and leave "notes" empty. Do not summarise it.',
    '',
    'If kind = "judgment": set "case_title", "citation", "date_of_judgment", "court", and build "notes".',
    'A file may be a COMPILATION of many judgments (Prosecution Replenish, SCAR digest). Then produce one',
    'note per judgment inside it, each with its own case_title and citation.',
    '',
    'For each judgment note:',
    '  - Identify which statute(s) it turns on and produce a SEPARATE note per statute, so a judgment on',
    '    CrPC, Evidence and IPC yields three notes. Choose "statute" EXACTLY from this list where it fits:',
    statutes.join(' | '),
    '    If it concerns a statute absent from the list, name that statute in its standard form.',
    '    The three paired codes are ONE statute each: "IPC / BNS", "CrPC / BNSS", "Evidence / BSA".',
    '  - "body": the exam-worthy content in the court\'s own words where wording matters - issues decided,',
    '    legal points, ingredients, offences, discussion, precedents relied on, directions. EXCLUDE case',
    '    facts, background, and arguments of counsel. If this judgment repeals, overrules or varies an',
    '    earlier precedent, add a line beginning "Repeal/Varied: " naming it and what changed.',
    '  - "keywords": a headnote-style list of search terms for this judgment.',
    '',
    'ESSAY: if the judgment is significant enough to become a future legal-essay question, set',
    '"essay_worthy" true and provide "essay_en" (its important facts written as an essay) and "essay_te"',
    '(a faithful Telugu translation). Otherwise essay_worthy false and leave them empty.',
    '',
    'TERMS: in "terms", list important technical legal English words/phrases from the judgment, each with',
    'an ACCURATE Telugu rendering fit for a translation paper - NOT a loose word-for-word gloss.',
    '  - For an English legal phrase, give the settled Telugu legal rendering a Telugu judgment would use',
    '    (e.g. "expeditiously" -> "\u0c38\u0c24\u0c4d\u0c35\u0c30\u0c2e\u0c47", not merely "\u0c24\u0c4d\u0c35\u0c30\u0c17\u0c3e").',
    '  - For a LATIN maxim (per incuriam, pari materia, prima facie, mala fides, sub judice, res judicata,',
    '    etc.) keep the Latin maxim itself and give the Telugu sense beside it, in this exact shape placed',
    '    in "te":  "per incuriam (\u0c05\u0c1c\u0c3e\u0c17\u0c4d\u0c30\u0c24\u0c4d\u0c24\u0c17\u0c3e \u0c07\u0c1a\u0c4d\u0c1a\u0c3f\u0c28 \u0c24\u0c40\u0c30\u0c4d\u0c2a\u0c41)"',
    '  Keep to genuinely useful exam vocabulary. Every term MUST have a non-empty, accurate "te".',
    '',
    'Output ONLY the JSON object. Never invent; use empty string/array where genuinely absent.'
  ].join('\n');
}

function tbSchema_(){
  return {
    type:'OBJECT',
    properties:{
      kind:{type:'STRING'},
      title:{type:'STRING'}, category:{type:'STRING'},
      case_title:{type:'STRING'}, citation:{type:'STRING'},
      date_of_judgment:{type:'STRING'}, court:{type:'STRING'},
      search_keys:{type:'ARRAY', items:{type:'STRING'}},
      notes:{ type:'ARRAY', items:{ type:'OBJECT',
        properties:{
          statute:{type:'STRING'}, case_title:{type:'STRING'}, citation:{type:'STRING'},
          body:{type:'STRING'}, keywords:{type:'ARRAY', items:{type:'STRING'}}
        }, required:['statute','body'] } },
      essay_worthy:{type:'BOOLEAN'}, essay_en:{type:'STRING'}, essay_te:{type:'STRING'},
      terms:{ type:'ARRAY', items:{ type:'OBJECT',
        properties:{ en:{type:'STRING'}, te:{type:'STRING'} }, required:['en'] } }
    },
    required:['kind']
  };
}

function tbExtract_(parts){
  var key = tbKey_();
  if (!key) throw new Error('No GEMINI_API_KEY set.');
  var content = parts.slice();
  content.push({ text:'Classify and extract per the contract. Output ONLY the JSON object.' });
  var body = {
    systemInstruction:{ parts:[{ text: tbClassifyAndExtractPrompt_() }] },
    contents:[{ role:'user', parts:content }],
    generationConfig:{ responseMimeType:'application/json', responseSchema: tbSchema_(),
      temperature:0, maxOutputTokens:TB_MAX_TOKENS, thinkingConfig:{ thinkingBudget:0 } }
  };
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/'+TB_MODEL+':generateContent?key='+key;
  var resp = UrlFetchApp.fetch(url,{ method:'post', contentType:'application/json',
                                     muteHttpExceptions:true, payload:JSON.stringify(body) });
  var rc = resp.getResponseCode(), rt = resp.getContentText();
  if (rc === 429){
    var wait = tbRetryDelayMs_(rt);
    if (wait > 0 && wait <= TB_RETRY_MAX_WAIT){
      Utilities.sleep(wait + 2000);
      resp = UrlFetchApp.fetch(url,{ method:'post', contentType:'application/json',
                                     muteHttpExceptions:true, payload:JSON.stringify(body) });
      rc = resp.getResponseCode(); rt = resp.getContentText();
    }
  }
  if (rc !== 200){
    if (tbIsTransient_(rc,rt)){
      var isQuota = (rc === 429) || /quota|resource_exhausted|rate limit|ratelimit|billing/i.test(rt);
      throw new Error((isQuota ? 'TRANSIENT_QUOTA: ' : 'TRANSIENT_SERVER: ') + 'Gemini '+rc+' - '+rt.substring(0,200));
    }
    throw new Error('Gemini '+rc+': '+rt.substring(0,300));
  }
  var p = JSON.parse(rt);
  if (!p.candidates || !p.candidates[0]) throw new Error('No candidates.');
  var cand = p.candidates[0], out = '', i;
  if (cand.content && cand.content.parts)
    for (i=0;i<cand.content.parts.length;i++)
      if (cand.content.parts[i].text) out += cand.content.parts[i].text;
  var data = tbParse_(out);
  if (!data) throw new Error('Parse failed (finishReason='+(cand.finishReason||'?')+'). '+out.substring(0,160));
  return data;
}

/* ============================ THE ENGINE ============================ */
function tbProcessFolder(){
  if (!tbKey_()) return { noKey:true };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return { busy:true };
  var start = Date.now();
  var s = { judgments:0, nonJudg:0, notes:0, essays:0, terms:0, errors:0,
            stoppedEarly:false, quota:false, serverBusy:false, busy:false, noKey:false, fatal:'',
            newStatutes:[], log:[] };
  try {
    tbEnsure_();
    var folder = DriveApp.getFolderById(TB_DROP_FOLDER);
    var files = folder.getFiles();
    while (files.hasNext()){
      if (Date.now()-start > TB_BUDGET_MS){ s.stoppedEarly = true; break; }
      var f = files.next(), nm = f.getName();
      if (nm.indexOf('[done]')!==-1 || nm.indexOf('[error]')!==-1) continue;
      if (s.judgments || s.nonJudg || s.errors) Utilities.sleep(TB_PAUSE_MS);
      try {
        var data = tbExtract_(tbParts_(f));
        tbHandleFile_(data, f, s);
      } catch(e){
        var msg = String(e);
        if (msg.indexOf('TRANSIENT_QUOTA')!==-1){
          s.quota = true; tbErr_(nm,f.getId(),'Gemini quota - will retry. '+msg); break;
        }
        if (msg.indexOf('TRANSIENT_SERVER')!==-1){
          s.serverBusy = true; tbErr_(nm,f.getId(),'Gemini temporarily unavailable - will retry. '+msg); break;
        }
        tbErr_(nm,f.getId(),msg);
        // Leave the file untouched in the drop folder so it retries next run.
        s.errors++; s.log.push('ERROR (left in folder): '+nm+' - '+msg.substring(0,120));
      }
    }
  } catch(e){ s.fatal=String(e); tbErr_('(run)','',String(e)); }
  finally { lock.releaseLock(); }
  return s;
}

function tbHandleFile_(data, file, s){
  var kind = tbTrim_(data.kind).toLowerCase();
  if (kind === 'non_judgment' || !data.notes || !data.notes.length){
    tbFileNonJudgment_(data, file, s);
    return;
  }
  tbFileJudgment_(data, file, s);
}

/* ---------- non-judgment: rename, record in SEARCH, move ---------- */
function tbFileNonJudgment_(data, file, s){
  var title = tbClean_(tbTrim_(data.title) || tbTrim_(data.case_title) || file.getName().replace(tbExt_(file.getName()),''));
  var category = tbNormalizeCategory_(data.category);
  var keys = (data.search_keys && data.search_keys.join) ? data.search_keys.join(', ') : '';

  var newName = title.substring(0,90) + ' [done]' + tbExt_(file.getName());
  var url = '';
  try {
    file.setName(newName);
    DriveApp.getFolderById(TB_FILED_FOLDER).addFile(file);
    try { DriveApp.getFolderById(TB_DROP_FOLDER).removeFile(file); } catch(e){}
    url = file.getUrl();
  } catch(e){ tbErr_('move nonjudg', file.getId(), e); }

  tbSh_(S_SEARCH).appendRow([category, tbCap_(title,300), url, tbCap_(keys,TB_CELL_MAX), '']);
  s.nonJudg++; s.log.push('FILED ('+category+'): '+title);
}

/* ---------- judgment: notes -> Precedents, essay -> Essay, terms -> Dictionary ---------- */
function tbFileJudgment_(data, file, s){
  var docTitle = tbCap_(data.case_title,300), docCit = tbCap_(data.citation,150);

  // 1. rename + move the PDF first, so its URL is available to every stream
  var serial = tbSh_(S_SEARCH).getLastRow();
  var nm = tbPad_(serial)+'. '+(tbClean_(docTitle).substring(0,70) || 'judgment');
  if (tbClean_(docCit)) nm += ' - '+tbClean_(docCit).substring(0,40);
  var pdfUrl = '';
  try {
    file.setName(tbTrim_(nm)+' [done]'+tbExt_(file.getName()));
    DriveApp.getFolderById(TB_FILED_FOLDER).addFile(file);
    try { DriveApp.getFolderById(TB_DROP_FOLDER).removeFile(file); } catch(e){}
    pdfUrl = file.getUrl();
  } catch(e){ tbErr_('rename pdf', file.getId(), e); }

  // 2. notes -> current Precedents volume (grouped by statute heading)
  var precTag = '', firstDocUrl = '', firstBm = '', allKeys = [], filedNothing = true, i;
  for (i=0;i<data.notes.length;i++){
    var n = data.notes[i];
    if (!tbTrim_(n.body)){ tbErr_('empty note', docTitle, 'statute='+n.statute+' had no body'); continue; }
    var es = tbEnsureStatute_(n.statute);
    if (es.created && s.newStatutes.indexOf(es.statute)===-1) s.newStatutes.push(es.statute);
    var caseT = tbCap_(tbTrim_(n.case_title)||docTitle,300);
    var caseC = tbCap_(tbTrim_(n.citation)||docCit,150);
    var r = tbAppendPrecedent_(es.statute, caseT, caseC, String(n.body||''), pdfUrl);
    precTag = r.volumeName;
    if (!firstDocUrl){ firstDocUrl = r.docUrl; firstBm = r.bookmark; }
    if (r.lines > 0) filedNothing = false;
    s.notes++;
    if (n.keywords && n.keywords.join) allKeys.push(n.keywords.join(', '));
  }
  if (filedNothing) tbErr_('nothing filed', docTitle, 'All notes had empty bodies - check the model output.');

  // 3. essay -> current Essay volume
  if (data.essay_worthy && (tbTrim_(data.essay_en) || tbTrim_(data.essay_te))){
    tbAppendEssay_(docTitle, docCit, String(data.essay_en||''), String(data.essay_te||''), pdfUrl);
    s.essays++;
  }

  // 4. terms -> Dictionary (dedup)
  if (data.terms && data.terms.length){
    var added = tbAppendTerms_(data.terms, docTitle);
    s.terms += added;
  }

  // 5. search card -> SEARCH tab (category = the Precedents volume it landed in)
  var keys = tbTrim_(allKeys.join('  |  ')) || tbTrim_((data.search_keys||[]).join(', '));
  // A = Precedents doc URL, B = case title, C = source pdf url, D = keys, E = bookmark deep-link.
  var bookmarkLink = firstDocUrl + (firstBm ? ('#bookmark='+firstBm) : '');
  tbSh_(S_SEARCH).appendRow([firstDocUrl || (precTag||'Precedents-1'), docTitle,
                             pdfUrl, tbCap_(keys,TB_CELL_MAX), bookmarkLink]);
  s.judgments++; s.log.push('JUDGMENT -> '+(precTag||'Precedents')+': '+docTitle);
}

/** Append one judgment's notes into the current Precedents Doc, under a statute heading. */
function tbAppendPrecedent_(statute, caseTitle, citation, bodyText, pdfUrl){
  var d = tbVolumeDoc_(TB_PREC_PREFIX);
  var doc = d.doc, body = doc.getBody();

  // Find the statute HEADING2. If present, find the paragraph that STARTS the next
  // section (next H2/Title) so we can insert right before it; else append at the end.
  var paras = body.getParagraphs(), hPara = null, i;
  for (i=0;i<paras.length;i++)
    if (paras[i].getHeading()===DocumentApp.ParagraphHeading.HEADING2 &&
        tbTrim_(paras[i].getText())===statute){ hPara = paras[i]; break; }

  if (!hPara){
    hPara = body.appendParagraph(statute);
    hPara.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  }

  // Determine the insertion index: just before the next section, or end of doc.
  var startIdx = body.getChildIndex(hPara);
  var at = body.getNumChildren();
  for (i=startIdx+1;i<body.getNumChildren();i++){
    var ch = body.getChild(i);
    if (ch.getType()!==DocumentApp.ElementType.PARAGRAPH) continue;
    var h = ch.asParagraph().getHeading();
    if (h===DocumentApp.ParagraphHeading.HEADING2 || h===DocumentApp.ParagraphHeading.TITLE){ at = i; break; }
  }

  // Insert the case heading, then the body lines, each time re-anchoring on the
  // paragraph we just inserted so indices can never drift.
  var label = caseTitle + (citation ? '   ['+citation+']' : '');
  var casePara = body.insertParagraph(at, label);
  casePara.setHeading(DocumentApp.ParagraphHeading.HEADING3);
  if (pdfUrl){ try { casePara.editAsText().setLinkUrl(0, Math.max(0,label.length-1), pdfUrl); } catch(e){} }

  var anchorIdx = body.getChildIndex(casePara);   // stable anchor
  var lines = String(bodyText).split('\n'), k, placed = 0;
  for (k=0;k<lines.length;k++){
    if (!tbTrim_(lines[k])) continue;
    placed++;
    var pp = body.insertParagraph(anchorIdx + placed, lines[k]);
    pp.setHeading(DocumentApp.ParagraphHeading.NORMAL);
    if (tbTrim_(lines[k]).indexOf('Repeal/Varied:')===0) pp.editAsText().setBold(true);
  }

  var bm = doc.addBookmark(doc.newPosition(casePara, 0));
  var bmId = bm.getId();
  doc.saveAndClose();
  tbLinkStatuteDoc_(statute, d.url);
  return { volumeName: d.name, docUrl: d.url, bookmark: bmId, lines: placed };
}

/** Append an essay (English + Telugu) into the current Essay Doc. */
function tbAppendEssay_(caseTitle, citation, en, te, pdfUrl){
  var d = tbVolumeDoc_(TB_ESSAY_PREFIX);
  var doc = d.doc, body = doc.getBody();
  var label = caseTitle + (citation ? '   ['+citation+']' : '');
  var hp = body.appendParagraph(label);
  hp.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (pdfUrl){ try { hp.editAsText().setLinkUrl(0, label.length-1, pdfUrl); } catch(e){} }
  if (tbTrim_(en)){
    body.appendParagraph('English').setHeading(DocumentApp.ParagraphHeading.HEADING3);
    var le = en.split('\n'), i;
    for (i=0;i<le.length;i++) if (tbTrim_(le[i])) body.appendParagraph(le[i]).setHeading(DocumentApp.ParagraphHeading.NORMAL);
  }
  if (tbTrim_(te)){
    body.appendParagraph('\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41').setHeading(DocumentApp.ParagraphHeading.HEADING3);
    var lt = te.split('\n'), j;
    for (j=0;j<lt.length;j++) if (tbTrim_(lt[j])) body.appendParagraph(lt[j]).setHeading(DocumentApp.ParagraphHeading.NORMAL);
  }
  doc.saveAndClose();
}

/** Append only NEW English terms to the Dictionary; dedup via the Dictionary tab. */
function tbAppendTerms_(terms, source){
  var sh = tbSh_(S_DICT);
  var have = {}, i;
  if (sh.getLastRow() > 1){
    var v = sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
    for (i=0;i<v.length;i++) have[tbNorm_(v[i][0])] = true;
  }
  var fresh = [];
  for (i=0;i<terms.length;i++){
    var en = tbTrim_(terms[i].en); if (!en) continue;
    var te = tbTrim_(terms[i].te||'');
    if (!te) continue;                       // skip untranslated; a later run fills it properly
    var k = tbNorm_(en); if (have[k]) continue;
    have[k] = true;
    fresh.push([en, te, source, new Date()]);
  }
  if (!fresh.length) return 0;
  sh.getRange(sh.getLastRow()+1,1,fresh.length,4).setValues(fresh);

  // mirror into the dictionary Doc table
  try {
    var doc = tbDictDoc_(), tables = doc.getBody().getTables();
    if (tables.length){
      var t = tables[0], j;
      for (j=0;j<fresh.length;j++) t.appendTableRow().appendTableCell(fresh[j][0]).getParent().appendTableCell(fresh[j][1]);
      doc.saveAndClose();
    }
  } catch(e){ tbErr_('dict doc','',e); }
  return fresh.length;
}

/* ============================ RUN WRAPPER ============================ */
function tbRunNow(){
  var s = tbProcessFolder();
  if (s.noKey) return { ok:false, message:'No GEMINI_API_KEY set in Script properties.' };
  if (s.busy)  return { ok:false, message:'A run is already in progress.' };
  if (s.fatal) return { ok:false, message:'Run error: '+s.fatal };
  if (!s.judgments && !s.nonJudg && !s.errors && !s.quota && !s.serverBusy)
    return { ok:true, message:'Nothing new in the drop folder.', log:[] };
  var m = 'Processed '+s.judgments+' judgment(s) ('+s.notes+' notes, '+s.essays+' essays, '
        + s.terms+' new terms) and '+s.nonJudg+' other file(s). '+s.errors+' error(s).';
  if (s.quota) m += '  Gemini\'s free allowance is used up for now - remaining files are untouched and '
                 +  'retry automatically. Daily quota resets ~12:30 PM IST.';
  else if (s.serverBusy) m += '  Gemini is temporarily overloaded/unavailable - remaining files are '
                 +  'untouched and retry automatically on the next run.';
  else if (s.stoppedEarly) m += ' More remain - they continue automatically.';
  if (s.newStatutes.length) m += '  New statutes created: '+s.newStatutes.join(', ')+' (yellow in INDEX - rename/merge).';
  return { ok:true, message:m, log:s.log, newStatutes:s.newStatutes };
}

/* ============================ TRIGGERS ============================ */
function tbInstallTriggers(){
  tbRemoveTriggers();
  ScriptApp.newTrigger('tbProcessFolder').timeBased().everyHours(3).create();
  return 'Auto-processing installed: every 3 hours.';
}
function tbRemoveTriggers(){
  var t = ScriptApp.getProjectTriggers(), i;
  for (i=0;i<t.length;i++){
    var h = t[i].getHandlerFunction();
    if (h.indexOf('tb')===0 || h.indexOf('kb')===0 || h.indexOf('pj_')===0) ScriptApp.deleteTrigger(t[i]);
  }
  return 'Triggers removed.';
}

/* ============================ SPREADSHEET MENU ============================ */
function onOpen(){
  SpreadsheetApp.getUi().createMenu('Knowledge Bank')
    .addItem('Open Knowledge Bank app', 'kbOpenApp_')
    .addItem('Run now', 'kbRunNowUi_')
    .addSeparator()
    .addItem('Setup / repair tabs', 'tbSetup')
    .addItem('Install 3-hourly trigger', 'tbInstallTriggers')
    .addItem('Repair dictionary', 'tbRepairDictionary')
    .addItem('Diagnose next file', 'kbDiagnoseUi_')
    .addToUi();
}
function kbRunNowUi_(){
  var ui = SpreadsheetApp.getUi();
  var r = tbRunNow();
  ui.alert(r.ok ? 'Run complete' : 'Run failed', r.message, ui.ButtonSet.OK);
}
function kbDiagnoseUi_(){
  SpreadsheetApp.getUi().alert('Diagnose next file', tbDiagnoseOne(), SpreadsheetApp.getUi().ButtonSet.OK);
}
function kbOpenApp_(){
  var ui = SpreadsheetApp.getUi();
  var url = ScriptApp.getService().getUrl();
  if (!url){ ui.alert('Deploy this project as a Web app first (Deploy > New deployment > Web app).'); return; }
  var html = HtmlService.createHtmlOutput('<script>window.open('+JSON.stringify(url)+',"_blank");google.script.host.close();</script>');
  ui.showModalDialog(html, 'Opening\u2026');
}

/* ============================ PENDING COUNT ============================ */
function tbGetPending(){
  var out = [];
  try {
    var it = DriveApp.getFolderById(TB_DROP_FOLDER).getFiles();
    while (it.hasNext() && out.length < 500){
      var f = it.next(), nm = f.getName();
      if (nm.indexOf('[done]')!==-1 || nm.indexOf('[error]')!==-1) continue;
      out.push(nm);
    }
  } catch(e){ tbErr_('pending','',e); }
  return { count: out.length, names: out.slice(0,50) };
}

/* ============================ REUSED FROM v5 (proven) ============================ */
function tbParts_(f){
  var mime = String(f.getMimeType()||'');
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mime === 'application/vnd.google-apps.document' || mime === 'application/msword') {
    var pdf = f.getAs('application/pdf');
    if (pdf.getBytes().length > TB_MAX_BYTES) throw new Error('Document too large.');
    return [{ inline_data:{ mime_type:'application/pdf', data:Utilities.base64Encode(pdf.getBytes()) } }];
  }
  var ok = (mime==='application/pdf'||mime==='image/jpeg'||mime==='image/png'||
            mime==='image/webp'||mime==='image/heic'||mime==='image/heif'||mime==='image/gif');
  if (ok) {
    if (f.getSize() > TB_MAX_BYTES) throw new Error('File over 19 MB.');
    return [{ inline_data:{ mime_type:mime, data:Utilities.base64Encode(f.getBlob().getBytes()) } }];
  }
  var th = f.getThumbnail();
  if (th) return [{ inline_data:{ mime_type:'image/png', data:Utilities.base64Encode(th.getBytes()) } }];
  throw new Error('Unsupported file type: ' + mime);
}

function tbParse_(s){
  if(!s) return null;
  var t = String(s).replace(/```json/g,'').replace(/```/g,'');
  var a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a===-1||b===-1||b<a) return null;
  var slice = t.substring(a,b+1);
  try { return JSON.parse(slice); }
  catch(e1){ try { return JSON.parse(tbFixCtl_(slice)); } catch(e2){ return null; } }
}

function tbFixCtl_(s){
  var out=[],inStr=false,esc=false,i,ch;
  for(i=0;i<s.length;i++){
    ch=s.charAt(i);
    if(esc){out.push(ch);esc=false;continue;}
    if(ch==='\\'){out.push(ch);esc=true;continue;}
    if(ch==='"'){inStr=!inStr;out.push(ch);continue;}
    if(inStr && s.charCodeAt(i)<0x20){
      out.push(ch==='\n'?'\\n':ch==='\r'?'\\r':ch==='\t'?'\\t':' ');continue;}
    out.push(ch);
  }
  return out.join('');
}

function tbIsTransient_(code, text){
  if (code === 429 || code === 500 || code === 503) return true;
  var t = String(text||'').toLowerCase();
  return t.indexOf('resource_exhausted') !== -1 || t.indexOf('quota') !== -1 ||
         t.indexOf('rate limit') !== -1 || t.indexOf('ratelimit') !== -1 ||
         t.indexOf('exceeded') !== -1 || t.indexOf('overloaded') !== -1 ||
         t.indexOf('unavailable') !== -1 || t.indexOf('upgrade') !== -1 ||
         t.indexOf('billing') !== -1 || t.indexOf('too many requests') !== -1;
}

function tbRetryDelayMs_(text){
  var m = String(text||'').match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (!m) return 0;
  var secs = parseFloat(m[1]);
  return (secs > 0 && secs < 3600) ? Math.round(secs * 1000) : 0;
}

function tbTok_(s){
  var c=String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(' ');
  var seen={},out=[],i;
  for(i=0;i<c.length;i++) if(c[i].length>=2&&!seen[c[i]]){seen[c[i]]=true;out.push(c[i]);}
  return out;
}

function tbCounts_(s){
  var c=String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(' ');
  var m={_len:0},i;
  for(i=0;i<c.length;i++){ if(c[i].length<2)continue; m._len++; m[c[i]]=(m[c[i]]||0)+1; }
  return m;
}

function tbFuzzy_(q,counts){
  if (counts[q]) return counts[q];
  var tot=0,key;
  for(key in counts){
    if(key==='_len'||!counts.hasOwnProperty(key))continue;
    var w=0;
    if(key.indexOf(q)!==-1||q.indexOf(key)!==-1){
      var a=q.length<key.length?q.length:key.length,b=q.length>key.length?q.length:key.length;
      w=0.5+0.3*(a/b);
    } else if (Math.abs(q.length-key.length)<=2){
      var dd=tbLev_(q,key),ml=q.length>key.length?q.length:key.length,sim=1-(dd/ml);
      if(sim>=0.7)w=sim*0.6;
    }
    if(w>0)tot+=counts[key]*w;
  }
  return tot;
}

function tbLev_(a,b){
  var m=a.length,n=b.length; if(!m)return n; if(!n)return m;
  var prev=[],j,i; for(j=0;j<=n;j++)prev[j]=j;
  for(i=1;i<=m;i++){ var cur=[i],ca=a.charAt(i-1);
    for(j=1;j<=n;j++){ var cost=(ca===b.charAt(j-1))?0:1;
      var del=prev[j]+1,ins=cur[j-1]+1,sub=prev[j-1]+cost,mn=del<ins?del:ins;
      cur[j]=sub<mn?sub:mn; }
    prev=cur; }
  return prev[n];
}

function tbSnip_(text,qs){
  if(!text)return '';
  var low=text.toLowerCase(),pos=-1,i;
  for(i=0;i<qs.length;i++){var p=low.indexOf(qs[i]);if(p!==-1){pos=p;break;}}
  var W=340;
  if(pos===-1)return text.substring(0,W)+(text.length>W?'\u2026':'');
  var st=pos-90; if(st<0)st=0;
  var s=text.substring(st,st+W);
  if(st>0)s='\u2026'+s;
  if(st+W<text.length)s+='\u2026';
  return s;
}


/* ============================ DICTIONARY REPAIR ============================ */
/**
 * Fill in / correct Telugu for dictionary rows. Targets rows with EMPTY Telugu,
 * plus a short built-in list of known weak glosses. Batches through Gemini and
 * respects the time budget - run again if it reports rows remaining.
 */
var TB_WEAK_TE = ['\u0c24\u0c4d\u0c35\u0c30\u0c17\u0c3e'];   // "quickly" - too loose for "expeditiously" etc.

function tbRepairDictionary(){
  if (!tbKey_()) return 'No GEMINI_API_KEY set.';
  tbEnsure_();
  var sh = tbSh_(S_DICT);
  if (!sh || sh.getLastRow() < 2) return 'Dictionary is empty.';
  var v = sh.getRange(2,1,sh.getLastRow()-1,2).getValues();

  var todo = [], i;
  for (i=0;i<v.length;i++){
    var en = tbTrim_(v[i][0]); if (!en) continue;
    var te = tbTrim_(v[i][1]);
    var weak = (!te) || (TB_WEAK_TE.indexOf(te) !== -1);
    if (weak) todo.push({ row:i+2, en:en });
  }
  if (!todo.length) return 'Nothing to repair - every term has a Telugu rendering.';

  var start = Date.now(), fixed = 0, b = 0;
  while (b < todo.length){
    if (Date.now()-start > TB_BUDGET_MS) break;
    var batch = todo.slice(b, b+25);
    b += 25;
    var map = tbTranslateTerms_(batch);
    var j;
    for (j=0;j<batch.length;j++){
      var te = map[tbNorm_(batch[j].en)];
      if (te){ sh.getRange(batch[j].row, 2).setValue(te); fixed++; }
    }
    if (b < todo.length) Utilities.sleep(TB_PAUSE_MS);
  }
  var left = todo.length - fixed;
  return 'Repaired ' + fixed + ' term(s).' + (left>0 ? ' ~'+left+' remain - run tbRepairDictionary() again.' : '');
}

function tbTranslateTerms_(batch){
  var lines = [], i;
  for (i=0;i<batch.length;i++) lines.push((i+1)+'. '+batch[i].en);
  var sys = [
    'Give accurate Telugu renderings of these Indian legal English terms for a magistrate\'s translation',
    'paper. For a Latin maxim, keep the maxim and add the Telugu sense in brackets, e.g.',
    '"per incuriam (\u0c05\u0c1c\u0c3e\u0c17\u0c4d\u0c30\u0c24\u0c4d\u0c24\u0c17\u0c3e \u0c07\u0c1a\u0c4d\u0c1a\u0c3f\u0c28 \u0c24\u0c40\u0c30\u0c4d\u0c2a\u0c41)". For an English phrase give the settled',
    'Telugu legal rendering, not a loose word-for-word gloss. Return ONLY JSON: {"t":[{"en":"...","te":"..."}]}'
  ].join('\n');
  var body = {
    systemInstruction:{ parts:[{ text:sys }] },
    contents:[{ role:'user', parts:[{ text:lines.join('\n') }] }],
    generationConfig:{ responseMimeType:'application/json',
      responseSchema:{ type:'OBJECT', properties:{ t:{ type:'ARRAY', items:{ type:'OBJECT',
        properties:{ en:{type:'STRING'}, te:{type:'STRING'} }, required:['en','te'] } } }, required:['t'] },
      temperature:0, maxOutputTokens:8000, thinkingConfig:{ thinkingBudget:0 } }
  };
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/'+TB_MODEL+':generateContent?key='+tbKey_();
  var resp = UrlFetchApp.fetch(url,{ method:'post', contentType:'application/json',
                                     muteHttpExceptions:true, payload:JSON.stringify(body) });
  if (resp.getResponseCode() !== 200){ tbErr_('dict repair','','Gemini '+resp.getResponseCode()); return {}; }
  var p = JSON.parse(resp.getContentText()), out = '';
  if (p.candidates && p.candidates[0] && p.candidates[0].content && p.candidates[0].content.parts){
    var k; for (k=0;k<p.candidates[0].content.parts.length;k++)
      if (p.candidates[0].content.parts[k].text) out += p.candidates[0].content.parts[k].text;
  }
  var data = tbParse_(out), map = {};
  if (data && data.t){ var m; for (m=0;m<data.t.length;m++) map[tbNorm_(data.t[m].en)] = tbTrim_(data.t[m].te); }
  return map;
}

/* ============================ WEB APP (stage 1 stub) ============================ */
function doGet(e){
  return HtmlService.createHtmlOutputFromFile('Search')
    .setTitle('Precedent Knowledge Bank')
    .addMetaTag('viewport','width=device-width, initial-scale=1');
}

/* ============================ READ FOR THE APP ============================ */
/** Legacy-row fallback ONLY: rows filed before the Title column existed have no title, so
 * derive a short placeholder from the source URL. Every row filed by the current code always
 * has a real title in its own column and never needs this. */
function tbTitleFrom_(urlOrText){
  var s = tbTrim_(urlOrText);
  if (!s) return '(untitled)';
  if (s.indexOf('http') === 0){
    var id = tbDocId_(s);
    return id ? ('Document ' + id.substring(0,6)) : 'Document';
  }
  return s;
}
/** Prefer the row's own Title cell; fall back to guessing from the URL for old rows. */
function tbRowTitle_(title, urlOrText){
  var t = tbTrim_(title);
  return t ? t : tbTitleFrom_(urlOrText);
}

/** Master tiles for the top bar. Only shows what has data. */
function tbGetMasterTiles(){
  tbEnsure_();
  var tiles = [];

  // SUBJECTS (statutes from the subjects tab) - future manual store, display only
  var subs = tbIndexRows_();
  if (subs.length) tiles.push({ id:'__subjects__', label:'SUBJECTS', kind:'subjects', count:subs.length });

  // Scan search_index once
  var se = tbSh_(S_SEARCH);
  var precUrls = tbPrecedentUrls_();      // set of known Precedents doc urls
  var precRows = 0, catMap = {}, cats = [], i;
  if (se && se.getLastRow() > 1){
    var v = se.getRange(2,1,se.getLastRow()-1,5).getValues();
    for (i=0;i<v.length;i++){
      var a = tbTrim_(v[i][0]);
      if (!a) continue;
      if (tbDocId_(a) && precUrls[tbDocId_(a)]) { precRows++; continue; }   // a Precedents judgment row
      if (!catMap[a]){ catMap[a] = 0; cats.push(a); }
      catMap[a]++;
    }
  }

  if (precRows > 0) tiles.push({ id:'__precedents__', label:'PRECEDENTS', kind:'precedents', count:precRows });

  cats.sort();
  for (i=0;i<cats.length;i++)
    tiles.push({ id:cats[i], label:cats[i], kind:'category', count:catMap[cats[i]] });

  return { tiles:tiles, pending: tbGetPending().count, folder: tbTextbookFolder_().getUrl() };
}

/** Map of {docId: volumeLabel} for every Precedents volume we have created. */
function tbPrecedentUrls_(){
  var p = PropertiesService.getScriptProperties();
  var list = [];
  try { list = JSON.parse(p.getProperty('VOLS_'+TB_PREC_PREFIX) || '[]'); } catch(e){ list = []; }
  var map = {}, i;
  for (i=0;i<list.length;i++){ var id = tbDocId_(list[i]); if (id) map[id] = TB_PREC_PREFIX+'-'+(i+1); }
  return map;
}

/** Left-panel contents for a master tile. */
function tbGetPanel(tileId){
  tbEnsure_();
  if (tileId === '__subjects__'){
    var precMap = tbPrecedentUrls_();
    var rows = tbIndexRows_(), out = [], i, j;
    for (i=0;i<rows.length;i++){
      var kids = [];
      for (j=0;j<rows[i].urls.length;j++){
        var u = rows[i].urls[j], id = tbDocId_(u);
        kids.push({ url:u, label: (id && precMap[id]) ? precMap[id] : ('Doc '+(j+1)) });
      }
      out.push({ label:rows[i].statute, children:kids, kind:'statute' });
    }
    return { kind:'subjects', items:out };
  }
  if (tileId === '__precedents__'){
    var p = PropertiesService.getScriptProperties(), list = [];
    try { list = JSON.parse(p.getProperty('VOLS_'+TB_PREC_PREFIX) || '[]'); } catch(e){ list = []; }
    var vols = [], k;
    for (k=0;k<list.length;k++)
      vols.push({ label:TB_PREC_PREFIX+'-'+(k+1), url:list[k], kind:'precvol' });
    return { kind:'precedents', items:vols };
  }
  // a report/non-judgment category: list its files alphabetically
  var se = tbSh_(S_SEARCH), items = [];
  if (se && se.getLastRow() > 1){
    var v = se.getRange(2,1,se.getLastRow()-1,5).getValues(), i;
    for (i=0;i<v.length;i++){
      if (tbTrim_(v[i][0]) !== tbTrim_(tileId)) continue;
      items.push({ title: tbRowTitle_(v[i][1], v[i][2]), url:String(v[i][2]||''),
                   keys:String(v[i][3]||''), kind:'file' });
    }
  }
  items.sort(function(a,b){ return (a.title||'').toLowerCase() < (b.title||'').toLowerCase() ? -1 : 1; });
  return { kind:'category', category:tileId, items:items };
}

/** Judgments inside one Precedents volume (secondary bar), alphabetical. */
function tbGetVolumeJudgments(volUrl){
  tbEnsure_();
  var id = tbDocId_(volUrl);
  var se = tbSh_(S_SEARCH), out = [];
  if (se && se.getLastRow() > 1){
    var v = se.getRange(2,1,se.getLastRow()-1,5).getValues(), i;
    for (i=0;i<v.length;i++){
      if (tbDocId_(tbTrim_(v[i][0])) !== id) continue;
      out.push({ title: tbRowTitle_(v[i][1], v[i][2]),
                 noteLink:String(v[i][4]||v[i][0]||''),
                 pdf:String(v[i][2]||'') });
    }
  }
  out.sort(function(a,b){ return (a.title||'').toLowerCase() < (b.title||'').toLowerCase() ? -1 : 1; });
  return { items:out, volUrl:volUrl };
}

/**
 * Universal search. Fast path: score the SEARCH tab (title + keys + category).
 * Fallback: if fast path is thin, also scan the Precedents Docs' text live.
 */
function tbSearch(query){
  var q = tbTrim_(query);
  if (!q) return { results:[], message:'Type something to search.' };
  var qs = tbTok_(q);
  if (!qs.length) return { results:[], message:'No searchable words.' };

  var se = tbSh_(S_SEARCH);
  var rows = [];
  if (se && se.getLastRow() > 1) rows = se.getRange(2,1,se.getLastRow()-1,5).getValues();
  var precUrls = tbPrecedentUrls_();

  var scored = [], i, t;
  for (i=0;i<rows.length;i++){
    var a = tbTrim_(rows[i][0]);
    var titleCell = String(rows[i][1]||'');
    var b = String(rows[i][2]||'');
    var keys = String(rows[i][3]||'');
    var bm = String(rows[i][4]||'');
    var isPrec = (tbDocId_(a) && precUrls[tbDocId_(a)]);
    var catLabel = isPrec ? precUrls[tbDocId_(a)] : a;
    var title = tbRowTitle_(titleCell, b);
    var blob = title + ' ' + keys + ' ' + catLabel;
    var c = tbCounts_(blob), sc = 0;
    for (t=0;t<qs.length;t++) sc += tbFuzzy_(qs[t], c);
    if (sc > 0){
      var noteLink = isPrec ? (bm || a) : '';        // go-to-notes only for judgments
      scored.push({ s:sc, title:title, category:catLabel, pdf:b, noteLink:noteLink,
                    keys:keys, kind:(isPrec?'judgment':'file'), src:'card' });
    }
  }

  if (scored.length < 3){
    var deep = tbSearchDocs_(qs), seen = {}, k;
    for (k=0;k<scored.length;k++) seen[tbNorm_(scored[k].title)] = true;
    for (k=0;k<deep.length;k++) if (!seen[tbNorm_(deep[k].title)]) scored.push(deep[k]);
  }

  scored.sort(function(a,b){ return b.s - a.s; });
  var max = scored.length ? scored[0].s : 1, out = [];
  for (i=0;i<scored.length && i<30;i++){
    out.push({ title:scored[i].title, category:scored[i].category,
               pdf:scored[i].pdf||'', noteLink:scored[i].noteLink||'',
               snippet: tbSnip_(scored[i].keys||'', qs), kind:scored[i].kind,
               via: scored[i].src, score: Math.round((scored[i].s/max)*100) });
  }
  return { results: out, message: out.length ? '' : 'No matches in cards or documents.' };
}

/** Live fallback: read Precedents Docs and score each case section. */
function tbSearchDocs_(qs){
  var p = PropertiesService.getScriptProperties(), out = [];
  var list = [];
  try { list = JSON.parse(p.getProperty('VOLS_'+TB_PREC_PREFIX) || '[]'); } catch(e){ list = []; }
  var v;
  for (v=0; v<list.length; v++){
    var id = tbDocId_(list[v]);
    if (!id) continue;
    var doc;
    try { doc = DocumentApp.openById(id); } catch(e){ continue; }
    var paras = doc.getBody().getParagraphs();
    var statute='', caseT='', buf=[], i;
    function flush(){
      if (!caseT) return;
      var c = tbCounts_(caseT+' '+statute+' '+buf.join(' ')), sc = 0, t;
      for (t=0;t<qs.length;t++) sc += tbFuzzy_(qs[t], c);
      if (sc > 0) out.push({ s:sc*0.9, title:caseT, category:statute, pdf:'', noteLink:list[v],
                             keys:buf.join(' ').substring(0,600), kind:'judgment', src:'document' });
    }
    for (i=0;i<paras.length;i++){
      var pr = paras[i], h = pr.getHeading(), txt = pr.getText();
      if (h===DocumentApp.ParagraphHeading.HEADING2){ flush(); statute=tbTrim_(txt); caseT=''; buf=[]; }
      else if (h===DocumentApp.ParagraphHeading.HEADING3){ flush(); caseT=tbTrim_(txt.split('   [')[0]); buf=[]; }
      else if (caseT && tbTrim_(txt)) buf.push(txt);
    }
    flush();
    doc.saveAndClose();
  }
  return out;
}

/* ============================ SELF-CHECK ============================ */
/**
 * Process exactly ONE pending file and report precisely what happened at each
 * stage - so you can confirm notes land, the bookmark is made, and it reaches
 * the SEARCH tab. Run from the editor; read the return value in the log.
 */
function tbDiagnoseOne(){
  if (!tbKey_()) return 'No GEMINI_API_KEY set.';
  tbEnsure_();
  var it = DriveApp.getFolderById(TB_DROP_FOLDER).getFiles();
  var f = null;
  while (it.hasNext()){
    var c = it.next(), nm = c.getName();
    if (nm.indexOf('[done]')===-1 && nm.indexOf('[error]')===-1){ f = c; break; }
  }
  if (!f) return 'No unprocessed file in the drop folder to diagnose.';

  var report = ['FILE: ' + f.getName()];
  try {
    var data = tbExtract_(tbParts_(f));
    report.push('kind = ' + data.kind);
    report.push('case_title = ' + (data.case_title||'(none)'));
    report.push('notes returned = ' + (data.notes ? data.notes.length : 0));
    if (data.notes) {
      for (var i=0;i<data.notes.length;i++){
        var n = data.notes[i];
        report.push('  note '+(i+1)+': statute="'+n.statute+'" bodyLen='+String(n.body||'').length
                  + ' keywords='+((n.keywords||[]).length));
      }
    }
    report.push('essay_worthy = ' + !!data.essay_worthy + ', terms = ' + ((data.terms||[]).length));
    report.push('--- NOTE: this only INSPECTS; it does not file. Press RUN to file for real. ---');
  } catch(e){
    report.push('EXTRACT FAILED: ' + e);
  }
  return report.join('\n');
}

/* ============================ WORKBENCH (manual route) ============================ */
var TB_MARK = '###';
var TB_WSEP = '>>';

function tbWorkbenchDoc_(){
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('WORKBENCH_ID');
  if (id){ try { return DocumentApp.openById(id); } catch(e){} }
  var doc = DocumentApp.create('WORKBENCH - prepare notes here');
  var file = DriveApp.getFileById(doc.getId());
  tbTextbookFolder_().addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  tbResetWorkbench_(doc);
  p.setProperty('WORKBENCH_ID', doc.getId());
  return DocumentApp.openById(doc.getId());
}
function tbResetWorkbench_(doc){
  var b = doc.getBody(); b.clear();
  b.appendParagraph('WORKBENCH').setHeading(DocumentApp.ParagraphHeading.TITLE);
  var ex = b.appendParagraph(TB_MARK+' CrPC / BNSS '+TB_WSEP+' Judgment '+TB_WSEP
        +' Naresh Kumar v. State of Delhi '+TB_WSEP+' 2024 INSC 464 '+TB_WSEP+' judgment.pdf');
  ex.editAsText().setForegroundColor('#999999');
  var p = b.appendParagraph('Marker: ### Statute >> Nomenclature >> Case title >> Citation >> PDF file name. '
        + 'Write your formatted note below each marker, then press PUSH ALL.');
  p.editAsText().setForegroundColor('#999999');
  b.appendParagraph('');
  doc.saveAndClose();
}
function tbWorkbenchUrl(){ return { url: tbWorkbenchDoc_().getUrl() }; }

/** Push every marked block from the Workbench into its statute's Precedents doc. */
function tbPushWorkbench(){
  tbEnsure_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok:false, message:'Busy - try again.' };
  try {
    var wb = tbWorkbenchDoc_(), body = wb.getBody();
    var n = body.getNumChildren(), blocks = [], cur = null, i;
    for (i=0;i<n;i++){
      var el = body.getChild(i);
      var isP = (el.getType() === DocumentApp.ElementType.PARAGRAPH);
      var txt = isP ? el.asParagraph().getText() : '';
      if (isP && tbTrim_(txt).indexOf(TB_MARK) === 0){ cur = { marker:tbTrim_(txt), els:[] }; blocks.push(cur); }
      else if (cur) cur.els.push(el);
    }
    if (!blocks.length){ wb.saveAndClose(); return { ok:false, message:'No marker lines found in the Workbench.' }; }

    var pushed = 0, failed = 0, details = [], anyFail = false;
    for (i=0;i<blocks.length;i++){
      var parts = tbTrim_(blocks[i].marker).substring(TB_MARK.length).split(TB_WSEP);
      var m = { statute:tbTrim_(parts[0]||''), nomen:tbTrim_(parts[1]||'Judgment'),
                title:tbTrim_(parts[2]||''), citation:tbTrim_(parts[3]||''), pdfName:tbTrim_(parts[4]||'') };
      if (!m.statute){ failed++; anyFail=true; details.push('SKIP (no statute): '+tbCap_(blocks[i].marker,60)); continue; }
      try {
        tbPushBlock_(m, blocks[i].els);
        pushed++; details.push('Pushed: '+m.statute+' - '+(m.title||'(untitled)'));
      } catch(e){
        failed++; anyFail = true;
        tbErr_('workbench push', m.statute, String(e));
        details.push('FAILED: '+m.statute+' - '+String(e).substring(0,100));
      }
    }
    wb.saveAndClose();

    // Only clear the Workbench if EVERYTHING pushed cleanly.
    if (pushed && !anyFail) tbResetWorkbench_(DocumentApp.openById(wb.getId()));

    return { ok:true, cleared: (pushed && !anyFail),
             message:'Pushed '+pushed+' block(s).'
                   + (anyFail ? ' '+failed+' failed - Workbench NOT cleared so you can retry.' : ' Workbench cleared.'),
             details: details };
  } catch(e){
    tbErr_('push all','',String(e));
    return { ok:false, message:'Error: '+e };
  } finally { lock.releaseLock(); }
}

/** Push one manual block: copy formatted content into the Precedents doc + index it. */
function tbPushBlock_(m, els){
  // resolve source PDF (optional) - rename+move only on success at the end
  var pdfFile = null, pdfUrl = '';
  if (m.pdfName){
    try {
      var it = DriveApp.getFolderById(TB_DROP_FOLDER).getFilesByName(m.pdfName);
      if (it.hasNext()) pdfFile = it.next();
    } catch(e){}
  }

  var es = tbEnsureStatute_(m.statute);
  var caseT = tbCap_(m.title||'(untitled)',300), caseC = tbCap_(m.citation,150);

  // Build a plain-text body from the block, but preserve formatting by copying elements.
  var d = tbVolumeDoc_(TB_PREC_PREFIX);
  var doc = d.doc, docBody = doc.getBody();

  // statute heading
  var paras = docBody.getParagraphs(), hPara = null, i;
  for (i=0;i<paras.length;i++)
    if (paras[i].getHeading()===DocumentApp.ParagraphHeading.HEADING2 &&
        tbTrim_(paras[i].getText())===es.statute){ hPara = paras[i]; break; }
  if (!hPara){ hPara = docBody.appendParagraph(es.statute); hPara.setHeading(DocumentApp.ParagraphHeading.HEADING2); }

  var startIdx = docBody.getChildIndex(hPara), at = docBody.getNumChildren();
  for (i=startIdx+1;i<docBody.getNumChildren();i++){
    var ch = docBody.getChild(i);
    if (ch.getType()!==DocumentApp.ElementType.PARAGRAPH) continue;
    var h = ch.asParagraph().getHeading();
    if (h===DocumentApp.ParagraphHeading.HEADING2||h===DocumentApp.ParagraphHeading.TITLE){ at=i; break; }
  }

  var label = caseT + (caseC ? '   ['+caseC+']' : '');
  var casePara = docBody.insertParagraph(at, label);
  casePara.setHeading(DocumentApp.ParagraphHeading.HEADING3);
  var anchor = docBody.getChildIndex(casePara), placed = 0, j, plain = [];
  for (j=0;j<els.length;j++){
    var e = els[j], t = e.getType();
    try {
      if (t===DocumentApp.ElementType.PARAGRAPH){
        var pp = e.asParagraph();
        if (!tbTrim_(pp.getText()) && pp.getNumChildren()===0) continue;
        placed++; docBody.insertParagraph(anchor+placed, pp.copy()); plain.push(pp.getText());
      } else if (t===DocumentApp.ElementType.LIST_ITEM){
        placed++; docBody.insertListItem(anchor+placed, e.asListItem().copy()); plain.push(e.asListItem().getText());
      } else if (t===DocumentApp.ElementType.TABLE){
        placed++; docBody.insertTable(anchor+placed, e.asTable().copy()); plain.push(e.asTable().getText());
      }
    } catch(err){ tbErr_('copy element', es.statute, String(err)); }
  }

  // now that content is safely in, handle the PDF
  if (pdfFile){
    try {
      var serial = tbSh_(S_SEARCH).getLastRow();
      var nm = tbPad_(serial)+'. '+(tbClean_(caseT).substring(0,70)||'judgment');
      if (tbClean_(caseC)) nm += ' - '+tbClean_(caseC).substring(0,40);
      pdfFile.setName(tbTrim_(nm)+' [done]'+tbExt_(pdfFile.getName()));
      DriveApp.getFolderById(TB_FILED_FOLDER).addFile(pdfFile);
      try { DriveApp.getFolderById(TB_DROP_FOLDER).removeFile(pdfFile); } catch(e2){}
      pdfUrl = pdfFile.getUrl();
    } catch(e){ tbErr_('workbench pdf', m.pdfName, String(e)); }
    if (pdfUrl){ try { casePara.editAsText().setLinkUrl(0, Math.max(0,label.length-1), pdfUrl); } catch(e){} }
  }

  var bm = doc.addBookmark(doc.newPosition(casePara,0));
  var bmId = bm.getId();
  doc.saveAndClose();
  tbLinkStatuteDoc_(es.statute, d.url);

  // index row (5 cols): A=Precedents doc url, B=case title, C=source pdf, D=keys, E=bookmark deep-link
  var noteLink = d.url + '#bookmark=' + bmId;
  tbSh_(S_SEARCH).appendRow([d.url, caseT, pdfUrl,
                             tbCap_(plain.join(' ').substring(0,4000),TB_CELL_MAX), noteLink]);
}

function tbAddSlot(statute, nomen, title, citation, pdfName){
  tbEnsure_();
  statute = tbTrim_(statute);
  if (!statute) return { ok:false, message:'Statute is required.' };
  var doc = tbWorkbenchDoc_(), b = doc.getBody();
  var line = TB_MARK+' '+statute+' '+TB_WSEP+' '+(tbTrim_(nomen)||'Judgment');
  if (tbTrim_(title))    line += ' '+TB_WSEP+' '+tbTrim_(title);
  if (tbTrim_(citation)) line += ' '+TB_WSEP+' '+tbTrim_(citation);
  if (tbTrim_(pdfName))  line += ' '+TB_WSEP+' '+tbTrim_(pdfName);
  b.appendParagraph('');
  var p = b.appendParagraph(line);
  p.editAsText().setForegroundColor('#2f6b4f').setBold(true);
  b.appendParagraph('');
  doc.saveAndClose();
  return { ok:true, message:'Slot added.', url: tbWorkbenchDoc_().getUrl() };
}

/** Statute names for the Workbench dropdown. */
function tbGetStatuteNames(){ return { statutes: tbStatuteNames_() }; }
