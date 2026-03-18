# PROJECT_SUMMARY

## 1. High-level architecture

### What the bot does end to end
- Runs a recurring paper-trading loop for Crypto.com public market data.
- Selects instruments from either:
  - static `INSTRUMENTS` env list, or
  - scanner shortlist (if scanner mode is enabled).
- For each instrument, fetches candles, computes strategy signal, updates/opens/closes paper positions, writes trade journal entries, emits optional alerts, and prints a console summary.

### Paper-trading flow
- No real orders are placed.
- No private/authenticated Crypto.com endpoints are used.
- Position state is in-memory (`PaperPositionManager`).
- Trade history is persisted in `src/storage/trades.json`.

### Data flow
1. Market fetch:
   - `src/exchange/cryptocomRest.ts` fetches public candles (and scanner market metadata/tickers).
   - If candle fetch fails per instrument, app falls back to generated mock candles.
2. Signal:
   - `src/strategy/breakout.ts` computes `BUY` / `SELL` / `HOLD` from breakout/breakdown + volume confirmation.
3. Position management:
   - `src/risk/limits.ts` enforces max-open and duplicate-position rules.
   - Tracks trailing-stop state (`highestSeenPrice`) and closes with exit reason.
4. Persistence + observability:
   - `src/storage/journal.ts` appends journal entries to JSON.
   - `src/alerts/*` optionally emits startup/trade/error/fallback alerts.
   - `src/utils/logger.ts` writes timestamped logs.

## 2. File-by-file summary

### `src/app.ts`
- Purpose:
  - Main orchestrator and runtime loop.
- Key logic:
  - Startup banner and config log.
  - Scanner-based instrument selection (`getLoopInstruments`) with fallback to static instruments.
  - Per-instrument processing:
    - fetch candles (fallback to mock)
    - compute signal
    - manage open position exits (SL/TP/trailing/signal)
    - open new paper position on BUY
    - journal + alert events
  - Overlap guard (`cycleRunning`) to avoid concurrent cycles.
- Dependencies:
  - config (`src/config/env.ts`)
  - exchange client (`src/exchange/cryptocomRest.ts`)
  - types (`src/exchange/types.ts`)
  - risk manager (`src/risk/limits.ts`)
  - strategy (`src/strategy/breakout.ts`, `src/strategy/scanner.ts`)
  - storage (`src/storage/journal.ts`)
  - alerts (`src/alerts/index.ts`)
  - utils (`src/utils/logger.ts`, `src/utils/time.ts`)

### `src/config/env.ts`
- Purpose:
  - Loads and validates env config via `dotenv`.
- Key exports:
  - `config: BotConfig`
- Important logic:
  - Typed parsing helpers for number/integer/boolean/bounded values.
  - Safe defaults for all settings.
- Dependencies:
  - `dotenv`
  - `BotConfig` type from `src/exchange/types.ts`

### `src/exchange/types.ts`
- Purpose:
  - Shared domain types.
- Key exports:
  - `Signal`, `ExitReason`, `Candle`, `Position`, `JournalEntry`, `BotConfig`.
- Important logic:
  - Type-only module; central schema for strategy/risk/storage/app/config.

### `src/exchange/cryptocomRest.ts`
- Purpose:
  - Public Crypto.com REST adapter.
- Key exports:
  - `getCandles(instrument, timeframe)`
  - `getInstruments()`
  - `getTickers()`
  - `getMockCandles(size?)`
  - `PublicInstrument`, `PublicTicker` types
- Important logic:
  - Uses native `fetch` or `undici` fallback.
  - 8s timeout with `AbortController`.
  - Defensive JSON parsing and field normalization.
  - Candle normalization to internal `Candle[]` sorted ascending.
- Dependencies:
  - `src/exchange/types.ts`
  - dynamic import of `undici` when needed

### `src/strategy/breakout.ts`
- Purpose:
  - Signal generation and level calculation.
- Key exports:
  - `breakoutSignal(candles, lookback, volumeMultiplier)`
  - `calculateTradeLevels(entryPrice, stopLossPct, takeProfitPct)`
- Important logic:
  - BUY: latest close > highest high of prior lookback AND volume elevated.
  - SELL: latest close < lowest low of prior lookback AND volume elevated.
  - Otherwise HOLD.
- Dependencies:
  - `Candle`, `Signal` types.

### `src/strategy/scanner.ts`
- Purpose:
  - Scanner filtering/ranking helpers for dynamic instrument selection.
- Key exports:
  - `filterScannerInstruments(...)`
  - `rankScannerCandidates(...)`
  - `buildScannerShortlist(...)`
  - `ScannerCandidate` type
- Important logic:
  - Filters to quote currency (default USDT), excludes leveraged/special symbols.
  - Scores by momentum + volume proxy.
  - Returns top-N shortlist.
- Dependencies:
  - `PublicInstrument`, `PublicTicker` from exchange module.

### `src/risk/limits.ts`
- Purpose:
  - In-memory paper position/risk engine.
- Key exports:
  - `PaperPositionManager` class
- Important logic:
  - Prevents duplicate open positions per instrument.
  - Enforces max open positions.
  - Opens positions by USD notional -> quantity.
  - Tracks `highestSeenPrice` for trailing stop.
  - Computes realized PnL on close and stores `exitReason`.
  - Static helpers for trailing-stop threshold/trigger.
- Dependencies:
  - `Position`, `ExitReason` types.

### `src/storage/journal.ts`
- Purpose:
  - JSON trade journal persistence.
- Key exports:
  - `readJournal()`
  - `appendJournalEntry(entry)`
- Important logic:
  - Auto-creates `src/storage/trades.json`.
  - Validates parsed entries.
  - Resets to `[]` with warning on empty/corrupt/invalid JSON.
- Dependencies:
  - Node `fs` + `path`
  - `JournalEntry` type
  - logger warn helper

### `src/alerts/index.ts`
- Purpose:
  - Optional, non-fatal alert dispatcher.
- Key exports:
  - `sendAlert(context, message)`
  - `formatAlertMessage(...)`
  - alert types (`AlertMode`, `AlertEvent`, `AlertContext`, `AlertMessage`)
- Important logic:
  - Modes: `console`, `webhook`, `telegram`.
  - Missing credentials/URLs produce warning alerts but do not throw.
  - HTTP alert failures are caught and downgraded to warning logs.
- Dependencies:
  - `src/alerts/consoleAlert.ts`
  - `src/utils/time.ts`
  - dynamic import of `undici` fallback for HTTP sends

### `src/alerts/consoleAlert.ts`
- Purpose:
  - Minimal console alert sink.
- Key exports:
  - `sendConsoleAlert(message)`

### `src/utils/logger.ts`
- Purpose:
  - Timestamped log helpers.
- Key exports:
  - `info`, `warn`, `error`
- Dependencies:
  - `nowIso()` from `src/utils/time.ts`

### `src/utils/time.ts`
- Purpose:
  - Time helper.
- Key exports:
  - `nowIso()`

### `tests/breakout.test.ts`
- Purpose:
  - Unit tests for breakout strategy and trade levels.
- Coverage:
  - BUY/HOLD/SELL/HOLD(volume-fail) signal cases.
  - stop-loss/take-profit level math.

### `tests/risk.test.ts`
- Purpose:
  - Unit tests for risk/position manager.
- Coverage:
  - Duplicate-block behavior.
  - PnL on close + exit reason.
  - highestSeenPrice update behavior.
  - trailing-stop threshold and trigger.

### `tests/scanner.test.ts`
- Purpose:
  - Unit tests for scanner filter/ranking.
- Coverage:
  - USDT filtering and leveraged/special exclusion.
  - momentum/volume ranking order.
  - top-N shortlist size behavior.

### `tests/alerts.test.ts`
- Purpose:
  - Unit tests for alert message formatting and non-fatal behavior.
- Coverage:
  - formatted text includes metadata.
  - missing Telegram credentials does not throw.
  - disabled alerts no-op.

## 3. Current config surface (env fields)

All fields are loaded in `src/config/env.ts`:

- `INSTRUMENTS`: comma-separated static instruments fallback/default universe.
- `TIMEFRAME`: candle timeframe passed to Crypto.com candlestick endpoint.
- `LOOKBACK`: comparison window for breakout/breakdown signal.
- `BREAKOUT_VOLUME_MULTIPLIER`: minimum volume multiplier for signal confirmation.
- `STOP_LOSS_PCT`: stop loss percentage from entry.
- `TAKE_PROFIT_PCT`: take profit percentage from entry.
- `PAPER_TRADE_SIZE_USD`: fixed USD notional per paper entry.
- `MAX_OPEN_POSITIONS`: cap on simultaneous open positions.
- `POLL_INTERVAL_MS`: loop interval.
- `ENABLE_TRAILING_STOP`: enables trailing stop exit check.
- `TRAILING_STOP_PCT`: trailing stop distance from `highestSeenPrice`.
- `ENABLE_SIGNAL_EXIT`: allows SELL signal to close open position.
- `SCANNER_ENABLED`: enable dynamic market scanning.
- `SCANNER_MAX_INSTRUMENTS`: max scanned eligible instruments before ranking.
- `SCANNER_QUOTE_FILTER`: quote filter (e.g., `USDT`).
- `SCANNER_TOP_N`: number of ranked instruments used each cycle.
- `ALERTS_ENABLED`: enables alert dispatch.
- `ALERT_MODE`: `console`, `webhook`, or `telegram`.
- `ALERT_WEBHOOK_URL`: target URL for webhook mode.
- `TELEGRAM_BOT_TOKEN`: bot token for telegram mode.
- `TELEGRAM_CHAT_ID`: chat id for telegram mode.

## 4. Current strategy and risk logic

### Breakout entry logic
- Strategy returns `BUY` when:
  - latest close is above highest high of prior lookback candles, and
  - latest volume > average lookback volume * multiplier.
- App opens a position only when signal is BUY and risk rules allow.

### Sell logic
- Strategy returns `SELL` when:
  - latest close is below lowest low of prior lookback candles, and
  - latest volume is elevated.
- In app, SELL only causes an exit if `ENABLE_SIGNAL_EXIT=true` and position is open.

### Stop loss / take profit
- On entry, stop/take levels are precomputed from entry price.
- Exit checks in app prioritize:
  1. `STOP_LOSS`
  2. `TAKE_PROFIT`
  3. `TRAILING_STOP`
  4. `SIGNAL_EXIT`

### Trailing stop
- Each cycle, for open positions, `highestSeenPrice` is updated when latest close makes a new high.
- Trailing threshold = `highestSeenPrice * (1 - TRAILING_STOP_PCT)`.
- Exit when latest close <= trailing threshold (if enabled).

### Scanner behavior
- If scanner disabled: uses static `INSTRUMENTS`.
- If scanner enabled:
  - fetch instruments + tickers
  - filter candidate symbols
  - rank and take top-N
  - if scanner fails or empty shortlist -> fallback to static instruments.

### Alert behavior
- Alerts are optional and fire-and-forget (`void sendAlert(...)`).
- Events sent:
  - startup
  - position opened
  - position closed
  - API fallback to mock candles
  - runtime cycle error
- Sending failures are swallowed and converted to warning-style console alert output.

## 5. Runtime behavior (one loop cycle)

1. Check overlap guard (`cycleRunning`). Skip if prior cycle still running.
2. Resolve instrument list (scanner or static).
3. For each instrument:
   - fetch candles or fallback to mock candles
   - validate latest price
   - compute strategy signal
   - if position exists, evaluate exits and close if needed
   - if signal BUY and risk allows, open paper position
   - append journal entry for open/close
   - emit relevant alerts
4. Print summary table of instrument, latest price, signal, open-position flag.
5. Catch and log any cycle-level exception, emit runtime error alert, release guard.

## 6. Known weaknesses or risks

- Signal/exit ordering is hard-coded: STOP_LOSS and TAKE_PROFIT take precedence over trailing and signal exits; this may not match all intended policies.
- Journal persistence is synchronous file I/O on every append (`read + write` each event), which can become a bottleneck and risks race issues if the process model changes.
- Scanner ranking uses only ticker-level heuristics (24h change/volume proxy), not candle-based “price above recent range”, so market quality filtering is shallow.
- Alert dispatch is fire-and-forget; no backoff/retry queue and no delivery status tracking.
- Risk state is in-memory only; restart loses open positions while journal remains on disk (state reconstruction is not implemented).
- `JournalEntry.reason` is an unconstrained `string`, while exit reasons are separately typed; this leaves room for inconsistent reason labeling.
- App is a script entrypoint with internal functions not exported; integration testing of full loop logic is limited.

## 7. Exact current commands

From `package.json`:

- build: `npm run build`
- test: `npm run test`
- dev: `npm run dev`
- start: `npm run start`

## 8. What to improve next

1. Persistent position state + restart recovery:
   - Persist open positions and rebuild manager state on startup from storage.
2. Split `app.ts` orchestration into testable services:
   - instrument selection service, cycle executor, execution/reporting adapters.
3. Improve scanner quality:
   - add candle-derived momentum/range filters and liquidity thresholds.
4. Harden storage and concurrency:
   - move to append-only event log or lightweight DB; avoid full-file read/write per event.
5. Add integration tests for full loop behavior:
   - mock exchange + time to validate end-to-end open/close/journal/alert sequences.
