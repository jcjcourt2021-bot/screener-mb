# Moonshot Equity Intelligence Engine

A cloud-first research dashboard for Indian equities, designed around SP1 discovery, capital rotation, catalyst research, and outcome validation.

## Current build (v0.2)

- FastAPI dashboard, responsive for mobile
- Chartink SP1 scan connector with manual scan trigger
- Candidate history and first-detection timestamps
- First appearance creates a research queue item; repeat detections are labelled top-up review
- CSV import for fundamentals, sector/industry, relative-strength and catalyst fields
- SQLite event history
- `/health`, `/api/state`, `/api/scan`, `/api/candidates`, `/api/research/{symbol}`
- Background scanner interval configurable via `SCAN_INTERVAL_MINUTES` (default 30)
- Railway persistent volume expected at `/data`; set `DB_PATH=/data/equity_engine.db`

## Deploy

Railway service source: `jcjcourt2021-bot/screener-mb`, branch `main`.

Environment variables:
- `DB_PATH=/data/equity_engine.db`
- `SCAN_INTERVAL_MINUTES=30`
- `CHARTINK_URL=https://chartink.com/screener/1-sp1-plain-daily`
- `CHARTINK_SCAN_CLAUSE` (optional; if automatic clause extraction is unsuccessful, supply the scanner clause)

The service needs a persistent Railway volume mounted at `/data`. Health check: `/health`.

## Data limitations

- Chartink scan connection is not yet verified against live results.
- Weekly SP1 scan has not yet been supplied; the current scanner is daily.
- Sector/theme rotation is not yet a validated signal. CSV imports can seed sector and RS fields.
- Fundamentals, news/catalysts, order books, and earnings research are not yet automatically sourced.
- Backtesting and forward-validation are not yet implemented. No probability of a double/multibagger is claimed.
- No trading or order placement is enabled.

## CSV import columns

`symbol,company,sector,industry,market_cap,pe,sales_growth,profit_growth,debt,order_book,catalyst,rs_1m,rs_3m,rs_6m`

Import through the dashboard.

## Local run

```bash
pip install -r requirements.txt
DB_PATH=./equity_engine.db uvicorn main:app --host 0.0.0.0 --port 8000
```

## Test workflow

GitHub Actions smoke workflow runs `py_compile` and app import/health checks on pushes to main.
