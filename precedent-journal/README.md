# Precedent Knowledge Bank

Apps Script engine that watches a Drive "drop" folder, sends each file to Gemini
to classify/extract, and auto-files it:

- **Judgments** → exam notes filed under the right statute(s) in a rolling
  `Precedents-N` Google Doc, essay-worthy ones also go to `Essay-N`, new legal
  terms go to the `Dictionary Eng-Telugu` Doc, and a search card is added to
  the `search_index` sheet tab.
- **Everything else** (circulars, GOs, gazettes, workshop material, etc.) is
  renamed from its own title and recorded in `search_index` under a category.

It's bound to the Google Sheet **"6. Precedents_journal"**
(`1Ac9EHfNTdebDfQqW8fOxSOsONtAVAk9x-FveOsEJqFM`), reads from the Drive folder
**"0.a. PRECEDENTS_collecting_BIN_individual"** and files into
**"filed-completed-processed"**. A small web app (`doGet` → `Search.html`)
gives a searchable UI over everything filed so far.

This repo folder is the version-controlled source; the live copy is the
container-bound Apps Script project attached to that Sheet
(**Extensions → Apps Script**).

## Files

| File | Purpose |
|---|---|
| `Code.gs` | The whole engine: extraction, filing, search backend, Workbench (manual filing route), dictionary repair. |
| `Search.html` | The web app UI served by `doGet`. |
| `appsscript.json` | Manifest — time zone `Asia/Kolkata`, web app access. |
| `.clasp.json` / `.claspignore` | `clasp` push/deploy config (see below). |

## One-time setup (in the Apps Script editor)

1. Open the Sheet → **Extensions → Apps Script**.
2. **Project Settings (⚙️) → Script properties** → add `GEMINI_API_KEY` with
   your Gemini API key.
3. Confirm the manifest's time zone is `Asia/Kolkata` (already set if you
   deploy `appsscript.json` from here).
4. Run `tbSetup()` once (creates/repairs the `subjects`, `search_index`,
   `eng_tel_dictionary`, `Errors` tabs and the "Precedent Knowledge Bank"
   Drive folder).
5. Run `tbInstallTriggers()` once (installs the 3-hourly auto-run trigger).
6. **Deploy → New deployment → Web app** to get the search UI's URL, or open
   it any time from the Sheet's new **Knowledge Bank** menu → *Open Knowledge
   Bank app* (added in this update).

Re-opening the Sheet now also shows a **Knowledge Bank** menu with Run now /
Setup / Install trigger / Repair dictionary / Diagnose next file, so most of
the above can be done without opening the script editor at all.

## Deploying from the CLI with `clasp`

This folder is `clasp`-ready but needs your Script ID and your own Google
login — nothing here can push code into your Apps Script project without
those, so this part is on you:

```bash
cd precedent-journal
npm install            # installs @google/clasp locally
npx clasp login         # opens a browser to authorize your Google account
```

Then get the **Script ID**: in the Apps Script editor, **Project Settings
(⚙️) → Script ID**, copy it, and paste it into `.clasp.json` in place of
`PASTE_YOUR_SCRIPT_ID_HERE`. (Don't run `clasp create` — the project already
exists, bound to the Sheet; you're attaching to it, not making a new one.)

```bash
npx clasp push          # push Code.gs / Search.html / appsscript.json
npx clasp open           # opens the project in the browser to deploy/redeploy
```

> **Careful:** `clasp push` overwrites `appsscript.json` on the server with
> the one in this repo. If the live project's web app deployment currently
> uses different access settings than `"access": "MYSELF"`, update this
> file to match before pushing, or you'll need to re-select access when you
> next create a deployment.

## What changed in this pass

The script was mid-development; these were the real bugs found and fixed:

1. **Titles were never actually stored.** `search_index` only ever saved a
   Drive URL, never the case/file title, so every card in the search UI and
   every volume/category listing showed a meaningless "Document ab12cd"
   instead of the real name. Added a dedicated **Title** column
   (`search_index` is now `Category | Title | File URL | Search keys |
   Bookmark`); `tbSetup()` migrates an existing 4-column sheet in place
   (inserts the column, shifts old data right, no data loss — old rows just
   show a generic placeholder title as before, new rows show real titles).
2. **The SUBJECTS panel was always empty.** `INDEX` has `Doc 1..Doc 8`
   columns per statute, but nothing ever wrote to them, so every statute
   showed zero linked volumes in the app. Added `tbLinkStatuteDoc_()`, called
   whenever a note is filed (both the auto engine and the manual Workbench
   path), which records/dedupes the Precedents volume link under its statute
   row — and the volume chips now show the real volume name (`Precedents-2`)
   instead of generic "Doc N".
3. **One transient Gemini 500/503 halted the whole run and reported it as
   "quota exhausted".** Split `TRANSIENT_QUOTA` from `TRANSIENT_SERVER` so
   the status message is accurate, and both still stop the batch safely so
   remaining files retry next run.
4. **`TB_CATEGORIES` was dead code** — the actual category list used in the
   Gemini prompt was a separate, hand-duplicated string that could silently
   drift from it. Split out `TB_NONJUDG_CATEGORIES` as the single source of
   truth, referenced directly by the prompt, and added `tbNormalizeCategory_`
   so near-duplicate spellings from the model ("GO ms" vs "GO Ms") collapse
   to one category instead of forking the tile list.
5. Fixed the `search_index` header typo ("Title cu File URL").
6. Added a **Knowledge Bank** spreadsheet menu (`onOpen`) with one-click Run
   now / Setup / Install trigger / Repair dictionary / Diagnose next file /
   Open app, so day-to-day use doesn't require the script editor.

Everything else (extraction prompt/schema, volume rollover, Workbench manual
filing, dictionary dedup/repair, fuzzy search + live-Doc fallback) was
already working and is unchanged.
