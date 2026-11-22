# Moonshot Equity Intelligence Engine

Cloud-first dashboard scaffold for an India equity discovery and research system.

## Current state
- Mobile-friendly dashboard and health endpoint.
- SQLite event/state storage scaffold.
- Does not fabricate signals or market data.
- Market-data, sector-flow, catalyst/news and SP1 computation providers are not connected yet.

## Run locally
```bash
pip install -r requirements.txt
uvicorn main:app --reload
`

## Planned data providers
1. Broker API (Kite or Fyers) for OHLCV and market data.
2. NSE/BSE filings and company announcements.
3. NSDL sector-wise FPI flows, AMFI mutual-fund flows, sector indices.
4. News provider with source link and timestamp.
5. Fundamentals provider.

## Signal protocol
- Weekly SP1 trigger; settings configurable and frozen for validation.
- Discovery pre-SP1 through sector relative strength and catalyst radar.
- First SP1 event creates a full dossier; repeats create delta/top-up research only.
- Store immutable signal history and source citations.
- No probability claims until walk-forward calibration.
