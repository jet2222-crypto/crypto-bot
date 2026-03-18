# Crypto.com Exchange API Reference for Codex

Last reviewed: 2026-03-18  
Scope: Publicly available Crypto.com Exchange API documentation relevant to a separate trading-bot codebase.  
Audience: Codex / engineering implementation context.  
Status: Implementation-oriented summary, not legal/compliance advice.

---

## 1. What this file is for

This document is a compact engineering reference for building against the **Crypto.com Exchange API v1**.

It is designed for a repo where Crypto.com remains **separate from Alpaca**, while still following similar engineering discipline:
- fail-closed behaviour
- explicit configuration
- traceable request logging
- defensive validation before order submission
- reconciliation against broker/exchange truth

This file should be treated as a **repo-local build reference**, not as the final source of truth. The official docs remain authoritative.

---

## 2. Platform scope and product boundaries

Crypto.com has multiple products. For this bot, the relevant one is the **Crypto.com Exchange**, not the retail app.

Important boundary:
- **Exchange API** is the trading API you want for this project
- Do not assume app flows, app wallets, or app UX documentation map cleanly onto Exchange API behaviour

The docs explicitly state that **Exchange v1 API is the latest API that can trade Spot / Derivatives / Margin**, and that the older Derivatives API was upgraded into Exchange v1. This matters because many examples online still refer to “derivatives” paths or older discussions. Build against **Exchange v1** docs, not random forum fragments.

---

## 3. Official endpoints

### REST root
Production:
- `https://api.crypto.com/exchange/v1/{method}`

UAT sandbox:
- `https://uat-api.3ona.co/exchange/v1/{method}`

### WebSocket roots
Production user/authenticated:
- `wss://stream.crypto.com/exchange/v1/user`

Production market data:
- `wss://stream.crypto.com/exchange/v1/market`

UAT user/authenticated:
- `wss://uat-stream.3ona.co/exchange/v1/user`

UAT market data:
- `wss://uat-stream.3ona.co/exchange/v1/market`

Important note from Crypto.com help docs:
- UAT access is **invitation only for institutional accounts**

Practical implication for this repo:
- do **not** assume sandbox is available for a normal retail Exchange account
- your first realistic implementation path may be:
  1. public market-data integration
  2. private read-only integration on production with minimal permissions
  3. very small live trading only after validation layers are in place

---

## 4. API key setup and permissions

Official help guidance says API keys are created on the Exchange website under:
- Profile
- Manage Account
- API Management

Key points:
- the **secret key is shown once only**
- new keys default to **Can Read**
- trading can be enabled afterward
- enabling trading or withdrawal requires **IP whitelisting**
- if the secret is lost, you must create a **new key**

Recommended configuration for this repo:
- create a dedicated API key for the bot
- start with **read-only** while wiring balance/order/history reads
- enable trading only when the order path has validation, logging, and kill-switches
- do **not** enable withdrawal permissions for the bot
- use IP restrictions if your deployment setup is stable enough

Suggested environment variables:
- `CRYPTO_COM_API_KEY`
- `CRYPTO_COM_API_SECRET`
- `CRYPTO_COM_REST_BASE_URL`
- `CRYPTO_COM_WS_USER_URL`
- `CRYPTO_COM_WS_MARKET_URL`
- `CRYPTO_COM_ENABLED`
- `CRYPTO_COM_TRADING_ENABLED`

---

## 5. Request and authentication model

Crypto.com uses a JSON request envelope with fields like:
- `id`
- `method`
- `params`
- `nonce`
- `api_key`
- `sig`

### Private authentication
For REST:
- only **private** methods require `api_key` and `sig`

For WebSocket user API:
- you must call `public/auth` **once per session** with valid `api_key`, `sig`, and `nonce`
- after successful auth, subsequent user-specific commands do not need repeated auth fields for that session

### Signature algorithm
The docs describe the HMAC signing algorithm as:
1. If `params` exist, sort param keys in ascending order
2. Concatenate ordered param keys as `key + value` with no delimiters
3. Concatenate:
   - `method`
   - `id`
   - `api_key`
   - `parameter string`
   - `nonce`
4. HMAC-SHA256 the result using the API secret
5. Encode as lowercase hex string

### Extremely important implementation detail
The docs state:
- **all numbers must be strings** in requests, wrapped in double quotes

That means your TypeScript client should aggressively normalize request payloads for numeric-looking exchange values such as:
- quantity
- price
- notional
- leverage
- order ids when used in requests where signature correctness matters

The docs also specifically recommend using **string format** for `order_id` in JavaScript when calling `private/get-order-detail`, to avoid signature problems.

### Repo recommendation
Create one canonical function such as:
- `buildCryptoComSignedRequest(method, params)`

And make it responsible for:
- stable key sorting
- nested param string generation if needed
- string coercion of numeric values
- nonce generation
- signature creation
- final request envelope assembly

Do not let multiple code paths generate signatures differently. That is how this kind of exchange integration turns into swamp-jazz.

---

## 6. Rate limits and operational constraints

The Exchange v1 docs list rate limits by method. Key examples:
- `private/create-order`, `private/cancel-order`, `private/cancel-all-orders`: **15 requests per 100ms each**
- `private/get-order-detail`: **30 requests per 100ms**
- `private/get-trades`: **1 request per second**
- `private/get-order-history`: **1 request per second**
- all other authenticated methods: **3 requests per 100ms each**
- public market data methods such as book/ticker/trades/candlestick: **100 requests per second each**
- WebSocket limits: **150 req/s** for user API, **100 req/s** for market data

The help center also mentions a simpler hard limit framing of **10 calls per URL per second** and says 429s are returned when exceeded.

Practical interpretation:
- trust the Exchange API doc for method-specific implementation behaviour
- still design for 429 handling globally
- do not poll order history or trade history unnecessarily
- prefer WebSocket for state updates and fills

The docs also recommend adding a **1-second sleep after opening a WebSocket connection** before sending requests, to avoid `TOO_MANY_REQUESTS` due to calendar-second prorating.

For the bot:
- build a per-method rate limiter
- build exponential backoff with jitter for retriable failures
- separate read-path limits from trade-path limits
- avoid startup stampedes where the bot immediately opens sockets, authenticates, subscribes, fetches balances, fetches orders, and posts commands in one burst

---

## 7. Core public methods relevant to the repo

### `public/get-instruments`
Use this as your authoritative source for:
- tradable instruments
- symbol naming
- tick sizes
- quantity precision / step sizes
- leverage metadata where relevant

Example fields shown in docs include:
- `symbol`
- `inst_type`
- `base_ccy`
- `quote_ccy`
- `quote_decimals`
- `quantity_decimals`
- `price_tick_size`
- `qty_tick_size`
- `max_leverage`

Engineering use:
- cache instrument metadata locally
- use it for pre-submit validation
- reject orders that violate step size / precision before touching private endpoints

### `public/get-book`
Use for order-book snapshots when needed. Do not use this as your main real-time engine if WebSocket book streams are available.

### `public/get-tickers` / market subscriptions
Use for price snapshots, but prefer subscriptions for live decision-making.

### `public/get-candlestick`
Useful for historical bars if you want exchange-native candles. Still consider your own market-data abstraction so the strategy layer is not hard-coupled to one venue.

---

## 8. Core private methods relevant to the repo

### `private/user-balance`
This is the balance endpoint you likely want first, not an Alpaca-style “account summary” mental model.

Docs show fields such as:
- `total_available_balance`
- `total_margin_balance`
- `total_initial_margin`
- `total_position_im`
- `total_haircut`
- `total_maintenance_margin`
- `total_position_cost`
- `total_cash_balance`
- `total_collateral_value`
- `is_liquidating`
- `total_effective_leverage`
- `used_position_limit`
- balance arrays / collateral details

Bot use:
- startup validation
- available-cash checks
- position-risk diagnostics
- dashboard summaries

### `private/get-positions`
Use this to reconcile actual positions held at the exchange.

### `private/create-order`
Core order submission method.

Docs show:
- `side`: `BUY` / `SELL`
- `type`: `LIMIT` / `MARKET`
- `price`
- `quantity`
- `notional` for market buy spend-based cases
- `client_oid`
- `exec_inst`: includes `POST_ONLY`, `SMART_POST_ONLY`, `ISOLATED_MARGIN`
- `time_in_force`: `GOOD_TILL_CANCEL`, `IMMEDIATE_OR_CANCEL`, `FILL_OR_KILL`
- optional fee token selection
- isolated position fields

Important documented rules:
- `POST_ONLY` and `SMART_POST_ONLY` cannot coexist
- if `exec_inst` contains `POST_ONLY`, `time_in_force` can only be `GOOD_TILL_CANCEL`
- response is asynchronous: success response only confirms request acceptance, not fill or final order state

### `private/amend-order`
This exists and was added in 2025. If the bot later supports amendment rather than cancel-replace, wire it deliberately. For first-pass execution, cancel-replace is usually simpler and easier to audit.

### `private/cancel-order`
Asynchronous cancellation. Use `user.order` subscription to observe final cancellation state.

### `private/cancel-all-orders`
Useful for kill-switch and startup cleanup logic.

### `private/get-open-orders`
Critical for reconciliation at startup and after connectivity issues.

### `private/get-order-detail`
Useful for debugging and targeted reconciliation. Send `order_id` as a string.

### `private/get-order-history` and `private/get-trades`
Useful for audit, diagnostics, and backfilling, but note the tight documented rate limit of **1 request per second**.

---

## 9. WebSocket channels that matter most

The docs list both market and user channels. Most relevant to a trading bot:

### Market data
- `book.{instrument_name}.{depth}`
- `ticker.{instrument_name}`
- `trade.{instrument_name}`
- `candlestick.{time_frame}.{instrument_name}`

### User state
- `user.order.{instrument_name}`
- `user.trade.{instrument_name}`
- `user.balance`
- `user.positions`

### Authentication and connection safety
- `public/auth`
- `private/set-cancel-on-disconnect`
- `private/get-cancel-on-disconnect`

The docs explicitly say **Cancel on Disconnect** can cancel all open orders created by that WebSocket connection on connectivity loss, and that once enabled for the connection the scope cannot be changed or disabled.

Important gotcha from docs:
- unsubscribing from user channels is treated as loss of connectivity and can trigger order cancellation when cancel-on-disconnect is enabled

Repo implication:
- if you ever use user WebSocket order entry, treat cancel-on-disconnect as a deliberate safety feature, not a casual toggle
- document exactly which orders are created over REST vs WebSocket
- do not quietly mix transport modes without a clear policy

---

## 10. Breaking changes and version drift you should design around

The current docs include a breaking-change schedule and recent changelog entries. The ones most relevant to implementation are:

### Advanced orders migration
The docs say:
- current trigger order creation/cancellation migrated to Advanced Order Management API on **2025-12-17 08:00 UTC**
- take-profit / stop-loss order creation/cancellation migrated to `private/advanced/create-order` on **2026-01-28 08:00 UTC**

### February 2026 change
The changelog says on **2026-02-20**:
- `private/create-order` removed `STOP_LOSS`, `STOP_LIMIT`, `TAKE_PROFIT`, `TAKE_PROFIT_LIMIT` from `type`
- removed `ref_price` and `ref_price_type` from `private/create-order`
- added `private/advanced/create-order`
- added `private/advanced/create-oco`
- added `private/advanced/cancel-oco`

What this means for the repo:
- for plain vanilla spot-style execution, stick to `LIMIT` and `MARKET` first
- do not build new conditional-order logic on old examples floating around online
- create a separate advanced-orders module later if needed
- keep conditional/trigger logic behind a feature flag until you intentionally support the advanced API

### Book subscription changes
The docs note that:
- explicit `book.{instrument_name}.{depth}` should be used
- older default or removed modes should not be assumed

That means:
- always subscribe with explicit depth
- do not rely on deprecated wildcard or default subscriptions

---

## 11. Error handling and expected failure modes

Docs use response envelopes with:
- `code`
- `message`
- `result`
- sometimes `original` for error cases

A success is generally `code: 0`.

Operationally, your client should expect at least these failure categories:
- invalid signature
- invalid nonce / clock drift
- insufficient balance
- duplicate `client_oid`
- invalid instrument or precision violation
- rate limit / 429
- async acceptance followed by later rejection/cancel state

Recommended client behaviour:
- log raw request envelope excluding secret
- log response code and message
- log parsed exchange error classification
- preserve exchange `order_id` and your `client_oid`
- never treat “request accepted” as “trade complete”

---

## 12. Engineering recommendations for this separate Crypto.com repo

Because you want Crypto.com and Alpaca to remain operationally separate, the right approach is:
- separate repos / runtime configs / env files / credentials
- similar engineering shape
- no forced shared execution core yet

A good repo structure would be:

```text
crypto-bot/
  docs/
    crypto_com_exchange_api_reference_for_codex.md
    architecture_notes.md
    safety_model.md
  src/
    config/
      env.ts
    exchange/
      cryptoComClient.ts
      cryptoComSigning.ts
      cryptoComTypes.ts
      cryptoComInstruments.ts
      cryptoComWebSocket.ts
      cryptoComErrors.ts
    execution/
      createOrder.ts
      cancelOrder.ts
      reconcileOrders.ts
      reconcilePositions.ts
      validateOrder.ts
    safety/
      tradingGuards.ts
      killSwitch.ts
    telemetry/
      logger.ts
      requestJournal.ts
```

### Similar shape to Alpaca, separate implementation
You said you want the two systems separate but aesthetically similar. That is the sweet spot.

So mirror the *discipline*, not necessarily the code:
- explicit mode/config file
- typed request/response wrappers
- pre-submit validation
- startup reconciliation
- request correlation IDs / structured logs
- dashboard terminology kept similar where possible

But do not prematurely create a fake “unified broker interface” if it will slow down correct implementation.

---

## 13. Minimum safe implementation path

### Phase 1: read-only wiring
1. implement env/config loading
2. implement signing helper
3. call `public/get-instruments`
4. call `private/user-balance`
5. call `private/get-open-orders`
6. connect market WebSocket and receive ticker/book updates

### Phase 2: safe trading skeleton
1. local instrument metadata cache
2. validate quantity/price against tick sizes
3. require explicit `client_oid`
4. add request/response journaling
5. add dry-run mode that builds but does not submit orders

### Phase 3: smallest live order path
1. submit tiny `LIMIT` order only
2. monitor via `user.order` and `user.trade`
3. test cancel flow
4. verify reconciliation after restart

### Phase 4: robustness
1. kill switch
2. cancel-all on critical fault
3. stale-socket detection
4. websocket reconnect logic
5. backoff and replay-safe recovery rules

---

## 14. Specific Codex build instructions

When using this file with Codex, point it to the implementation target plainly. Example prompt:

> Read `docs/crypto_com_exchange_api_reference_for_codex.md` and implement a typed Crypto.com Exchange client for this repo. Start with config loading, request signing, public/get-instruments, private/user-balance, private/get-open-orders, and private/create-order for LIMIT and MARKET only. Enforce that all numeric request values are sent as strings, generate signatures exactly as documented, require client_oid on every submitted order, and add structured logging with secrets redacted.

Second-step prompt:

> Extend the Crypto.com client with websocket support for market data and user order updates. Authenticate the user websocket with public/auth, wait 1 second after opening the socket before sending auth or subscriptions, and add reconnect-safe subscription management.

---

## 15. Recommended file location in your repo

Drop this file here:

- `docs/crypto_com_exchange_api_reference_for_codex.md`

Why this location:
- easy for Codex to find
- keeps vendor/integration docs separate from source
- matches the pattern you have already used in other build threads

If you want a slightly more structured docs tree, use:
- `docs/integrations/crypto_com_exchange_api_reference_for_codex.md`

My recommendation for now is the simpler path:
- `docs/crypto_com_exchange_api_reference_for_codex.md`

---

## 16. Bottom line

Crypto.com Exchange API is usable, but it is not a “throw in some fetch calls and vibes” integration.

The main implementation hazards are:
- signature correctness
- numeric-string normalization
- async order lifecycle handling
- rate-limit discipline
- evolving advanced-order behaviour

For this repo, the safest posture is:
- separate from Alpaca operationally
- similar in cleanliness and safety style
- narrow first milestone: instruments, balances, open orders, simple order placement, reconciliation

That gives you a bot that is small, intelligible, and much less likely to detonate itself for theatrical reasons.

---

## 17. Primary sources used

1. Crypto.com Exchange API v1 documentation  
   `https://exchange-docs.crypto.com/exchange/v1/rest-ws/index.html`

2. Crypto.com Help Center API article  
   `https://help.crypto.com/en/articles/3511424-api`

