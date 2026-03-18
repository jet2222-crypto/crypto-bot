# Crypto Bot MVP (Paper Trading Only)

A modular Node.js + TypeScript paper-trading bot MVP for Crypto.com Exchange public market data.

## Warning

This project is **PAPER TRADING ONLY**.

- No real orders are placed.
- No private/authenticated exchange trading endpoints are used.
- Position management and trade logging are simulated in-memory + local JSON journal.
- Open positions are also persisted locally for restart recovery.

## What It Currently Does

- Loads typed runtime config from environment variables.
- Fetches candlestick data from Crypto.com public REST endpoint.
- Falls back to generated mock candles if API data is unavailable.
- Runs a breakout + volume confirmation strategy.
- Applies an optional volatility/regime filter to block weak breakout entries.
- Emits compact HOLD reason codes to explain why entries are blocked.
- Supports optional SELL breakdown signal logic (for signal-based exits).
- Supports optional scanner mode that ranks public Crypto.com spot USDT markets.
- Applies paper risk rules:
  - max open positions
  - no duplicate open position per instrument
  - fixed USD notional per trade
  - stop loss / take profit exits
  - trailing stop exits with highest-seen-price tracking per open position
  - optional signal-based exits
- Persists trade journal entries to `src/storage/trades.json`.
- Persists open paper positions to `src/storage/open_positions.json` and restores them on startup.
- Prints per-cycle console summary with instrument, price, signal, and open-position status.
- Prevents overlapping loop cycles.
- Supports optional non-fatal alerting (console/webhook/Telegram).
- Includes a data-degradation circuit breaker that pauses new entries when public data quality degrades.
- Includes a market-data confidence layer with source selection, fallback marking, and orphan/quarantine escalation.
- Includes a BTC-based market regime layer that adjusts paper-entry risk policy by cycle.
- Emits append-only telemetry and review-pack exports for trades, regime events, blocked entries, and daily summaries.
- Applies a minimum expected-value gate to new entries only; existing positions are unchanged.

## Scanner Mode

Scanner mode is optional and still PAPER ONLY.

- Uses Crypto.com public endpoints for instruments and tickers.
- Filters for spot-style quote pairs (default `USDT`) and excludes leveraged/special symbols.
- Ranks candidates with simple momentum heuristics using 24h change and volume proxy.
- When enabled, adds candle-based volatility context (ATR% and range%) to reranking.
- Uses the scanner shortlist for that loop when enabled.
- Falls back to static `INSTRUMENTS` if scanner data is unavailable.
- Supports liquidity filtering and optional candle-confirmation reranking.

## Alerts (Optional)

Alerting is optional and still PAPER ONLY.

- If alert credentials are missing, the bot keeps running and logs alert warnings.
- Supported modes:
  - `console`
  - `webhook`
  - `telegram`
- Alerts are emitted for:
  - startup
  - paper position opened
  - paper position closed
  - API fallback to mock candles
  - major runtime cycle errors

## Terminal Dashboard

After each cycle, the bot prints a compact dashboard with:

- open positions and open instruments
- closed trades, wins/losses, and win rate
- realized/unrealized/combined PnL
- excluded suspicious historical closed-trade count
- scanner/trailing/signal-exit status
- last cycle timestamp and optional open-position detail lines
- degraded-mode status, reasons, and data-health counters
- degraded-mode recovery progress and orphaned open-position count
- price-confidence mix, fallback-source usage, disagreement count, and open-position integrity fields
- market regime, regime confidence, and active regime policy
- closed-trade performance grouped by entry regime

Unrealized PnL uses only trusted prices. Untrusted fallback/mock prices are excluded.
Realized headline metrics also exclude suspicious historical closed trades (journal is not modified).
When degraded mode is active, new entries are paused until healthy real data resumes.
Long-lived unpriceable open positions now escalate through `WARNING -> STALE -> ORPHAN -> QUARANTINED`.

## Telemetry And Review Pack

The bot now writes structured append-only telemetry under:

- `data/trades.jsonl`
- `data/regime_events.jsonl`
- `data/blocked_entries.jsonl`
- `data/daily_summary.jsonl`

You can generate human-readable review exports with:

```bash
npm run review-pack
```

This writes:

- `exports/trades_latest.csv`
- `exports/regime_latest.csv`
- `exports/blocked_latest.csv`
- `exports/summary_latest.json`

Telemetry writes are non-fatal. If disk export fails, the trading loop continues.

## Local Web Dashboard (Read-Only)

You can also run a local read-only web dashboard for easier monitoring.

- Local only (binds to `127.0.0.1`)
- PAPER mode visibility only
- No order buttons
- No strategy/config mutation from UI

Endpoints:

- `GET /api/health`: runtime health + last cycle state
- `GET /api/dashboard`: dashboard metrics (includes excluded suspicious trade count)
- `GET /api/positions`: open position details
- `GET /api/scanner`: latest scanner shortlist + last instrument snapshot table
- `GET /api/trades`: recent closed trades (`?includeSuspicious=1` to include flagged rows)
- `GET /api/config`: safe config snapshot (secrets excluded)

## Setup

```bash
npm install
cp .env.example .env
```

## Environment Example

```env
NODE_ENV=development
LOG_LEVEL=info
INSTRUMENTS=BTC_USDT,ETH_USDT
TIMEFRAME=1m
LOOKBACK=20
BREAKOUT_VOLUME_MULTIPLIER=1.08
BREAKOUT_BUFFER_PCT=0.001
MIN_RANGE_PCT=0.0018
USE_RELAXED_ENTRY=true
ATR_PERIOD=14
MIN_ATR_PCT=0.0006
MIN_VOLATILITY_RANGE_PCT=0.0025
VOL_FILTER_ENABLED=true
STOP_LOSS_PCT=0.01
TAKE_PROFIT_PCT=0.02
PAPER_TRADE_SIZE_USD=100
MAX_OPEN_POSITIONS=3
POLL_INTERVAL_MS=10000
ENABLE_TRAILING_STOP=true
TRAILING_STOP_PCT=0.01
ENABLE_SIGNAL_EXIT=false
SCANNER_ENABLED=false
SCANNER_MAX_INSTRUMENTS=200
SCANNER_QUOTE_FILTER=USDT
SCANNER_TOP_N=20
SCANNER_MIN_24H_VOLUME=500000
SCANNER_USE_CANDLE_CONFIRMATION=true
ALERTS_ENABLED=false
ALERT_MODE=console
ALERT_WEBHOOK_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
DATA_CB_MAX_CONSECUTIVE_MOCK_CYCLES=3
DATA_CB_MAX_CONSECUTIVE_FETCH_FAILURE_CYCLES=3
DATA_CB_MAX_STALE_CANDLE_CYCLES=2
DATA_CB_MAX_CONSECUTIVE_PRICE_REJECT_CYCLES=3
DATA_CB_HEALTHY_CYCLES_TO_CLEAR=2
ORPHAN_POSITION_MAX_UNPRICED_CYCLES=8
MARKET_DATA_FRESHNESS_MS=600000
MARKET_DATA_HIGH_DISAGREEMENT_BPS=30
MARKET_DATA_MEDIUM_DISAGREEMENT_BPS=100
ORPHAN_WARNING_CYCLES=2
ORPHAN_STALE_CYCLES=4
ORPHAN_ORPHAN_CYCLES=8
ORPHAN_QUARANTINE_CYCLES=12
ALLOW_LAST_GOOD_PRICE_MARKING=true
ALLOW_LOW_CONFIDENCE_ENTRIES=false
MIN_REWARD_RISK_BULL=1.2
MIN_REWARD_RISK_NEUTRAL=1.4
MIN_TP_DISTANCE_PCT=0.0035
MAX_SL_DISTANCE_PCT=0.015
MIN_CANDIDATE_SCORE_NEUTRAL=3
```

## Commands

- `npm run dev` - run with `nodemon` + `ts-node`
- `npm run build` - compile TypeScript to `dist/`
- `npm run start` - run compiled build
- `npm run test` - run unit tests
- `npm run review:journal` - review suspicious historical closed journal entries (read-only)
- `npm run export-telemetry` - generate fresh CSV/JSON exports from append-only telemetry
- `npm run review-pack` - same as `export-telemetry`
- `npm run web` - start local read-only web dashboard only
- `npm run dev:web` - start bot + local web dashboard together

## Architecture

- `src/config/env.ts`: Typed env parsing + defaults.
- `src/exchange/types.ts`: Shared domain types.
- `src/exchange/cryptocomRest.ts`: Public candle client + mock candle generator.
- `src/strategy/breakout.ts`: Breakout signal + trade levels.
- `src/strategy/volatility.ts`: ATR/range-based volatility helpers.
- `src/strategy/scanner.ts`: Market scanner filter/ranking helpers.
- `src/lib/marketRegime.ts`: BTC-led regime classification using EMA, volatility, and breadth.
- `src/lib/regimeConfig.ts`: Per-regime policy definitions.
- `src/lib/riskProfile.ts`: Entry sizing and stop/take-profit adjustments from regime policy.
- `src/lib/entryQualityGate.ts`: Minimum EV / setup-quality checks for new entries only.
- `src/alerts/index.ts`: Alert dispatcher (console/webhook/Telegram, non-fatal).
- `src/alerts/consoleAlert.ts`: Console alert output.
- `src/risk/limits.ts`: In-memory paper position/risk manager with trailing-stop helpers.
- `src/marketData/types.ts`: Normalized market-data/confidence/orphan model.
- `src/marketData/selector.ts`: Source selection, disagreement calculation, confidence scoring, and orphan escalation.
- `src/storage/journal.ts`: JSON trade journal read/append with corruption recovery.
- `src/storage/openPositions.ts`: Open-position persistence and restore support.
- `src/reporting/dashboard.ts`: Dashboard metrics aggregation + terminal rendering.
- `src/reporting/journalSanity.ts`: Closed-trade sanity checks + suspicious-trade review helpers.
- `src/telemetry/store.ts`: Append-only JSONL telemetry + review-pack export helpers.
- `src/web/state.ts`: In-memory runtime snapshot shared by bot and web API.
- `src/web/api.ts`: Read-only API payload helpers (safe config/trade payload shaping).
- `src/web/server.ts`: Local read-only HTTP server + dashboard page.
- `src/web/dev.ts`: Combined local start for bot + web server.
- `src/utils/logger.ts`: Timestamped logs.
- `src/utils/time.ts`: Time helpers.
- `src/app.ts`: Main paper-trading loop orchestration.
