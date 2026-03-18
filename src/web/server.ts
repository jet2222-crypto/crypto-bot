import { createServer } from "node:http";
import { URL } from "node:url";
import { getCachedMissedOpportunitySummary } from "../analysis/missedOpportunityCache";
import { config } from "../config/env";
import { readJournal } from "../storage/journal";
import { readOpenPositions } from "../storage/openPositions";
import { buildDashboardPayload, buildSafeConfigSnapshot, buildTradesPayload } from "./api";
import { getRuntimeSnapshot } from "./state";
import { error, info } from "../utils/logger";

const HOST = process.env.WEB_HOST?.trim() || "0.0.0.0";
const PORT = Number(process.env.WEB_PORT ?? "8787");

function sendJson(res: import("node:http").ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendHtml(res: import("node:http").ServerResponse, html: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(html);
}

function parseLimit(value: string | null, fallback: number, max: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Crypto Bot Local Dashboard (Read-Only)</title>
  <style>
    :root { --bg:#f4f6f8; --card:#ffffff; --text:#0f1720; --muted:#5a6b7d; --accent:#0e7490; --border:#d8e0e7; }
    body { margin:0; background:var(--bg); color:var(--text); font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .wrap { max-width: 1200px; margin: 20px auto 32px; padding: 0 16px; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    .note { color: #8b0000; margin-bottom: 14px; font-weight: 600; }
    .meta { color: var(--muted); margin-bottom: 16px; }
    .grid { display:grid; grid-template-columns: repeat(auto-fit,minmax(280px,1fr)); gap:12px; margin-bottom:12px; }
    .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:12px 14px; }
    .card h2 { font-size: 16px; margin: 0 0 10px; color: var(--accent); }
    .kv { display:grid; grid-template-columns: 1fr auto; gap:6px 10px; font-size:14px; }
    .kv div:nth-child(odd){ color:var(--muted); }
    table { width:100%; border-collapse: collapse; font-size:13px; background:var(--card); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
    th, td { padding:8px 10px; border-bottom:1px solid var(--border); text-align:left; }
    th { background:#edf3f8; font-size:12px; text-transform:uppercase; letter-spacing:0.02em; color:#334155; }
    .section { margin-top: 14px; }
    .badge { padding:2px 7px; border-radius:999px; font-size:12px; border:1px solid var(--border); background:#f8fafc; }
    .ok { color:#0a7f42; }
    .warn { color:#b45309; }
    .small { font-size:12px; color:var(--muted); }
    .notes { white-space:pre-wrap; line-height:1.3; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Crypto Bot Local Dashboard</h1>
    <div class="note">PAPER TRADING ONLY (read-only UI, local server)</div>
    <div class="meta" id="meta">Loading...</div>

    <div class="grid">
      <div class="card"><h2>Bot Status</h2><div class="kv" id="status"></div></div>
      <div class="card"><h2>Crypto.com Diagnostics</h2><div class="kv" id="authDiag"></div></div>
      <div class="card"><h2>Market Opportunity</h2><div class="kv" id="opportunity"></div></div>
      <div class="card"><h2>Performance</h2><div class="kv" id="metrics"></div></div>
      <div class="card"><h2>Missed Opportunity</h2><div class="kv" id="missed"></div></div>
      <div class="card"><h2>Warnings / Notes</h2><div class="notes small" id="notes">-</div></div>
    </div>

    <div class="section">
      <h2>Open Positions</h2>
      <table id="positions"><thead><tr><th>Instrument</th><th>Entry</th><th>Current</th><th>Qty</th><th>Size USD</th><th>Mode</th><th>uPnL</th><th>Source</th><th>Conf</th><th>XSrc</th><th>Unpriced</th><th>Status</th></tr></thead><tbody></tbody></table>
    </div>

    <div class="section">
      <h2>Scanner + Instrument Snapshot</h2>
      <div class="small" id="scannerSummary"></div>
      <table id="scanner"><thead><tr><th>Instrument</th><th>Price</th><th>Signal</th><th>Open</th><th>Selected</th><th>Vol</th><th>Hold Reason</th><th>Source</th><th>Candle</th></tr></thead><tbody></tbody></table>
    </div>

    <div class="section">
      <h2>Recent Closed Trades</h2>
      <table id="trades"><thead><tr><th>Instrument</th><th>Entry</th><th>Exit</th><th>Qty</th><th>PnL</th><th>Reason</th><th>Closed At</th><th>Flag</th></tr></thead><tbody></tbody></table>
    </div>
  </div>

  <script>
    const asMoney = (n) => (typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : "N/A");
    const asPct = (n) => (typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) + "%" : "N/A");
    const asPrice = (n) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "N/A");
    const yesNo = (v) => (v ? "YES" : "NO");
    const formatVisibleBalances = (balances, allZero) => {
      if (!balances || balances.length === 0) {
        return "no balances visible";
      }
      if (allZero) {
        return "all visible balances are zero (" + balances.length + ")";
      }
      return balances.slice(0, 4).map((b) => {
        const reserved = b.reserved ? " r=" + b.reserved : "";
        return b.asset + ": a=" + b.available + " t=" + b.total + reserved;
      }).join(" | ");
    };

    function setKv(id, pairs) {
      const el = document.getElementById(id);
      el.innerHTML = "";
      for (const [k, v] of pairs) {
        const left = document.createElement("div");
        left.textContent = k;
        const right = document.createElement("div");
        right.textContent = String(v);
        el.appendChild(left);
        el.appendChild(right);
      }
    }

    function fillTable(id, rows, mapper) {
      const body = document.querySelector("#" + id + " tbody");
      body.innerHTML = "";
      if (!rows || rows.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 12;
        td.textContent = "No data";
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      for (const row of rows) {
        const tr = document.createElement("tr");
        for (const cell of mapper(row)) {
          const td = document.createElement("td");
          td.textContent = cell;
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
    }

    async function refresh() {
      const [health, dash, positions, scanner, trades] = await Promise.all([
        fetch("/api/health").then(r => r.json()),
        fetch("/api/dashboard").then(r => r.json()),
        fetch("/api/positions").then(r => r.json()),
        fetch("/api/scanner").then(r => r.json()),
        fetch("/api/trades?limit=20").then(r => r.json())
      ]);

      document.getElementById("meta").textContent = "Auto-refresh: 5s | Last update: " + new Date().toISOString();
      document.getElementById("notes").textContent = (health.notes && health.notes.length ? health.notes.join("\\n") : "-");
      document.getElementById("scannerSummary").textContent =
        "Scanner mode: " + (dash.scannerMode || "N/A") +
        " | Source: " + (dash.scannerSource || "N/A") +
        " | Shortlist count: " + scanner.shortlistCount +
        " | Last cycle: " + (health.lastCycleTimestamp || "N/A") +
        (dash.scannerFallbackReason ? " | Reason: " + dash.scannerFallbackReason : "");

      setKv("status", [
        ["Bot Running", yesNo(health.botRunning)],
        ["Execution Mode", health.executionMode || "paper"],
        ["Live Trading Enabled", yesNo(health.liveTradingEnabled)],
        ["Live Dry Run", yesNo(health.liveExecutionDryRun)],
        ["Paper Sizing", health.paperSizeUseDynamic ? "DYNAMIC" : "FIXED"],
        ["Scanner", yesNo(health.scannerEnabled)],
        ["Scanner Mode", dash.scannerMode || "N/A"],
        ["Scanner Source", dash.scannerSource || "N/A"],
        ["Scanner Fallback", dash.scannerFallbackReason || "-"],
        ["Trailing Stop", yesNo(health.trailingStopEnabled)],
        ["Signal Exit", yesNo(health.signalExitEnabled)],
        ["Market Regime", dash.marketRegime || "N/A"],
        ["Regime Conf", dash.marketRegimeConfidence || "N/A"],
        ["Degraded Mode", yesNo(health.degradedMode)],
        ["Entries Paused", yesNo(health.entriesPaused)],
        ["Degraded Reasons", health.degradedReasons && health.degradedReasons.length ? health.degradedReasons.join(",") : "-"],
        ["Recovery", health.degradedRecoveryActive ? (health.degradedRecoveryProgress.current + "/" + health.degradedRecoveryProgress.required) : "-"],
        ["Last Cycle", health.lastCycleTimestamp || "N/A"],
        ["Cycle Duration", health.lastCycleDurationMs != null ? health.lastCycleDurationMs + "ms" : "N/A"]
      ]);

      if (health.lastOrderSubmissionAttempt) {
        const attempt = health.lastOrderSubmissionAttempt;
        document.getElementById("notes").textContent = ((health.notes && health.notes.length ? health.notes.join("\\n") + "\\n" : "") +
          "Last submission: " +
          attempt.action +
          " " +
          (attempt.instrument || attempt.orderId || "-") +
          " | " +
          attempt.status +
          " | " +
          (attempt.summary || "-"));
      }

      setKv("metrics", [
        ["Capital Mode", (dash.capitalMode || "paper").toUpperCase()],
        ["Starting Capital", asMoney(dash.startingCapitalUsd)],
        ["Current Equity", asMoney(dash.currentEquityUsd)],
        ["Deployed Capital", asMoney(dash.deployedCapitalUsd)],
        ["Free Capital", asMoney(dash.freeCapitalUsd)],
        ["Net Return", asPct(dash.netReturnPct)],
        ["Realized Return", asPct(dash.realizedReturnPct)],
        ["Unrealized Return", asPct(dash.unrealizedReturnPct)],
        ["Max Drawdown", asPct(dash.maxDrawdownPct)],
        ["Open Positions", dash.openPositionCount],
        ["Closed Trades", dash.closedTradesCount],
        ["Excluded Corrupt", dash.excludedCorruptTradesCount],
        ["Wins / Losses", dash.winsCount + " / " + dash.lossesCount],
        ["Win Rate", asPct(dash.winRatePct)],
        ["Realized PnL", asMoney(dash.realizedPnlUsd)],
        ["Unrealized PnL", asMoney(dash.unrealizedPnlUsd)],
        ["Combined PnL", asMoney(dash.combinedPnlUsd)],
        ["Confidence Mix", "H=" + dash.highConfidenceCount + " M=" + dash.mediumConfidenceCount + " L=" + dash.lowConfidenceCount + " N=" + dash.unpricedInstrumentCount],
        ["Orphaned Open", dash.orphanedOpenPositionsCount],
        ["Integrity", "fallback=" + dash.fallbackSourceUsageCount + " xsrc=" + dash.largeDisagreementCount],
        ["Data Health", "mock=" + dash.dataHealth.consecutiveMockCycles + " fetch=" + dash.dataHealth.consecutiveFetchFailureCycles + " stale=" + dash.dataHealth.staleCandleCycles + " reject=" + dash.dataHealth.consecutivePriceRejectCycles]
      ]);

      setKv("opportunity", [
        ["Opportunity Score", dash.opportunityScore != null ? Number(dash.opportunityScore).toFixed(1) + " / 10" : "N/A"],
        ["Opportunity State", dash.opportunityState || "N/A"],
        ["Opportunity Reasons", dash.opportunityReasons && dash.opportunityReasons.length ? dash.opportunityReasons.join(", ") : "-"]
      ]);

      setKv("missed", [
        ["Window", "last " + (dash.missedOpportunitySummary.windowHours || 12) + "h"],
        ["Reviewed", dash.missedOpportunitySummary.shortlistedReviewed],
        ["Not Traded", dash.missedOpportunitySummary.notTraded],
        ["Breakouts", dash.missedOpportunitySummary.breakoutLikeMoves],
        ["Profitable", dash.missedOpportunitySummary.profitable],
        ["Failed/Noisy", dash.missedOpportunitySummary.failedOrNoisy],
        ["Conclusion", dash.missedOpportunitySummary.conclusion || "Not enough data yet"]
      ]);

      setKv("authDiag", [
        ["Auth Configured", yesNo(health.cryptoComAuthConfigured)],
        ["Auth Healthy", yesNo(health.cryptoComAuthHealthy)],
        ["Balances Access", yesNo(health.cryptoComAccountSummaryAvailable)],
        ["Open Orders Access", yesNo(health.cryptoComOpenOrdersAvailable)],
        ["Trade History Access", yesNo(health.cryptoComTradeHistoryAvailable)],
        ["Endpoint Used", health.cryptoComEndpointUsed || "private/user-balance"],
        ["Capabilities", health.cryptoComCapabilities ? "bal=" + yesNo(health.cryptoComCapabilities.balances) + " oo=" + yesNo(health.cryptoComCapabilities.openOrders) + " trades=" + yesNo(health.cryptoComCapabilities.tradeHistory) : "-"],
        ["Connection", health.cryptoComConnectionMessage || "-"],
        ["Probe At", health.lastAuthenticatedProbeAt || "N/A"],
        ["Warnings", health.cryptoComCapabilityWarnings && health.cryptoComCapabilityWarnings.length ? health.cryptoComCapabilityWarnings.join(", ") : "-"],
        ["Visible Balances", formatVisibleBalances(health.cryptoComVisibleBalances || [], !!health.cryptoComAllBalancesZero)],
        ["Balance Count", health.cryptoComVisibleBalanceCount != null ? String(health.cryptoComVisibleBalanceCount) : "0"],
        ["All Zero", yesNo(health.cryptoComAllBalancesZero)],
        ["Quote Balance", health.cryptoComQuoteBalanceUsdOrUsdt || "-"]
      ]);

      fillTable("positions", positions.positions, (r) => [
        r.instrument,
        asPrice(r.entryPrice),
        r.currentPrice != null ? asPrice(r.currentPrice) : "N/A",
        r.quantity != null ? Number(r.quantity).toFixed(6) : "N/A",
        r.positionSizeUsd != null ? asMoney(r.positionSizeUsd) : "N/A",
        r.sizingMode || "N/A",
        r.unrealizedPnl != null ? asMoney(r.unrealizedPnl) : "N/A",
        r.priceSourceUsed || "N/A",
        r.confidence || "N/A",
        r.disagreementBps != null ? Number(r.disagreementBps).toFixed(1) + "bps" : "-",
        r.unpricedCycles != null ? String(r.unpricedCycles) : "0",
        r.orphanStatus || "OK"
      ]);

      fillTable("scanner", scanner.rows, (r) => [
        r.instrument,
        asPrice(r.latestPrice),
        r.signal,
        yesNo(r.hasOpenPosition),
        yesNo(r.scannerSelected),
        r.volatilityTag,
        r.holdReason || "-",
        r.priceSource || "-",
        r.candleTimestamp ? new Date(r.candleTimestamp).toISOString() : "N/A"
      ]);

      fillTable("trades", trades.trades, (r) => [
        r.instrument,
        asPrice(r.entryPrice),
        r.exitPrice != null ? asPrice(r.exitPrice) : "N/A",
        r.quantity != null ? Number(r.quantity).toFixed(6) : "N/A",
        r.pnl != null ? asMoney(r.pnl) : "N/A",
        r.reason,
        r.closedAt || "N/A",
        r.suspicious ? "SUSPICIOUS" : "-"
      ]);
    }

    refresh().catch((e) => {
      document.getElementById("meta").textContent = "Failed to load dashboard: " + (e?.message || "unknown");
    });
    setInterval(() => refresh().catch(() => {}), 5000);
  </script>
</body>
</html>`;
}

function mobileDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>Crypto Bot Mobile Monitor</title>
  <style>
    :root { --bg:#f3f6f8; --card:#ffffff; --text:#0f1720; --muted:#5b6675; --accent:#0f766e; --border:#d7dfe7; --warn:#9a3412; }
    * { box-sizing:border-box; }
    body { margin:0; background:linear-gradient(180deg, #eef4f7 0%, #f8fbfc 100%); color:var(--text); font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .wrap { max-width:560px; margin:0 auto; padding:18px 14px 28px; }
    .hero { margin-bottom:14px; }
    .eyebrow { font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:var(--accent); font-weight:700; }
    h1 { margin:4px 0 6px; font-size:28px; line-height:1.05; }
    .sub { color:var(--muted); font-size:13px; line-height:1.4; }
    .stack { display:grid; gap:12px; }
    .card { background:var(--card); border:1px solid var(--border); border-radius:16px; padding:14px; box-shadow:0 6px 20px rgba(15, 23, 32, 0.04); }
    .card h2 { margin:0 0 12px; font-size:14px; letter-spacing:0.04em; text-transform:uppercase; color:var(--muted); }
    .metric { display:flex; justify-content:space-between; align-items:flex-end; gap:10px; padding:6px 0; }
    .metric + .metric { border-top:1px solid #edf1f4; }
    .label { font-size:13px; color:var(--muted); }
    .value { font-size:16px; font-weight:700; text-align:right; }
    .heroValue { font-size:32px; font-weight:800; line-height:1; }
    .heroSub { font-size:12px; color:var(--muted); margin-top:4px; }
    .pillRow { display:flex; flex-wrap:wrap; gap:8px; }
    .pill { border:1px solid var(--border); border-radius:999px; padding:7px 10px; font-size:12px; font-weight:600; background:#f8fbfc; }
    .balances { display:grid; gap:8px; }
    .balance { border:1px solid #edf1f4; border-radius:12px; padding:10px; background:#fbfdfe; }
    .balanceTop { display:flex; justify-content:space-between; gap:8px; font-size:13px; font-weight:700; }
    .balanceMeta { margin-top:4px; font-size:12px; color:var(--muted); }
    .muted { color:var(--muted); }
    .warn { color:var(--warn); }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="eyebrow">Crypto Bot</div>
      <h1>Mobile Monitor</h1>
      <div class="sub">PAPER TRADING ONLY. Read-only status view optimized for phone browsers.</div>
    </div>

    <div class="stack">
      <div class="card">
        <h2>Topline</h2>
        <div class="metric">
          <div>
            <div class="label">Realized PnL</div>
            <div class="heroSub" id="lastCycle">Last cycle: -</div>
          </div>
          <div class="heroValue" id="realizedPnl">-</div>
        </div>
        <div class="metric">
          <div class="label">Unrealized PnL</div>
          <div class="value" id="unrealizedPnl">-</div>
        </div>
        <div class="metric">
          <div class="label">Win Rate</div>
          <div class="value" id="winRate">-</div>
        </div>
      </div>

      <div class="card">
        <h2>Status</h2>
        <div class="pillRow" id="statusPills"></div>
      </div>

      <div class="card">
        <h2>Trading Stats</h2>
        <div class="metric"><div class="label">Closed Trades</div><div class="value" id="closedTrades">-</div></div>
        <div class="metric"><div class="label">Open Positions</div><div class="value" id="openPositions">-</div></div>
        <div class="metric"><div class="label">Market Regime</div><div class="value" id="marketRegime">-</div></div>
        <div class="metric"><div class="label">Scanner Mode</div><div class="value" id="scannerMode">-</div></div>
        <div class="metric"><div class="label">Scanner Source</div><div class="value" id="scannerSource">-</div></div>
      </div>

      <div class="card">
        <h2>Missed</h2>
        <div class="metric"><div class="label">Reviewed</div><div class="value" id="missedReviewed">-</div></div>
        <div class="metric"><div class="label">Breakouts</div><div class="value" id="missedBreakouts">-</div></div>
        <div class="metric"><div class="label">Profitable</div><div class="value" id="missedProfitable">-</div></div>
      </div>

      <div class="card">
        <h2>Crypto.com Auth</h2>
        <div class="metric"><div class="label">Auth Status</div><div class="value" id="authStatus">-</div></div>
        <div class="metric"><div class="label">Visible Balance Count</div><div class="value" id="balanceCount">-</div></div>
        <div class="metric"><div class="label">Quote Balance</div><div class="value" id="quoteBalance">-</div></div>
      </div>

      <div class="card">
        <h2>Visible Balances</h2>
        <div class="balances" id="balances"></div>
      </div>

      <div class="card">
        <h2>Recent Trades</h2>
        <div class="balances" id="recentTrades"></div>
      </div>
    </div>
  </div>

  <script>
    const asMoney = (n) => typeof n === "number" && Number.isFinite(n) ? "$" + n.toFixed(2) : "N/A";
    const asPct = (n) => typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) + "%" : "N/A";
    const setText = (id, value) => { document.getElementById(id).textContent = value; };

    function renderPills(dash) {
      const el = document.getElementById("statusPills");
      el.innerHTML = "";
      [
        "Exec: " + (dash.adapterMode || "paper"),
        "Auth: " + (dash.cryptoComAuthHealthy ? "OK" : "NO"),
        "Regime: " + (dash.marketRegime || "N/A"),
        "Open: " + String(dash.openPositionCount ?? 0),
        "Scanner: " + (dash.scannerMode || "N/A")
      ].forEach((text) => {
        const pill = document.createElement("div");
        pill.className = "pill";
        pill.textContent = text;
        el.appendChild(pill);
      });
    }

    function renderBalances(dash) {
      const el = document.getElementById("balances");
      el.innerHTML = "";
      const balances = Array.isArray(dash.visibleBalances) ? dash.visibleBalances : [];
      if (balances.length === 0) {
        const item = document.createElement("div");
        item.className = "muted";
        item.textContent = "No visible balances returned.";
        el.appendChild(item);
        return;
      }
      if (dash.allBalancesZero) {
        const item = document.createElement("div");
        item.className = "warn";
        item.textContent = "Authenticated successfully. All visible balances are zero.";
        el.appendChild(item);
      }
      balances.forEach((balance) => {
        const card = document.createElement("div");
        card.className = "balance";
        const reserved = balance.reserved ? " | Reserved " + balance.reserved : "";
        card.innerHTML = '<div class="balanceTop"><span>' + balance.asset + '</span><span>Total ' + balance.total + '</span></div>' +
          '<div class="balanceMeta">Available ' + balance.available + reserved + '</div>';
        el.appendChild(card);
      });
    }

    function renderRecentTrades(tradesPayload) {
      const el = document.getElementById("recentTrades");
      el.innerHTML = "";
      const trades = Array.isArray(tradesPayload && tradesPayload.trades) ? tradesPayload.trades : [];
      if (trades.length === 0) {
        const item = document.createElement("div");
        item.className = "muted";
        item.textContent = "No recent closed trades.";
        el.appendChild(item);
        return;
      }
      trades.forEach((trade) => {
        const card = document.createElement("div");
        card.className = "balance";
        const pnl = typeof trade.pnl === "number" && Number.isFinite(trade.pnl) ? trade.pnl : null;
        const pnlUsd = pnl === null ? "N/A" : (pnl >= 0 ? "+" : "") + "$" + pnl.toFixed(2);
        const pnlPct = pnl === null || typeof trade.entryPrice !== "number" || typeof trade.quantity !== "number" || trade.entryPrice <= 0 || trade.quantity <= 0
          ? "N/A"
          : (((pnl / (trade.entryPrice * trade.quantity)) * 100) >= 0 ? "+" : "") + ((pnl / (trade.entryPrice * trade.quantity)) * 100).toFixed(2) + "%";
        const regime = trade.entryRegime ? " | " + trade.entryRegime : "";
        card.innerHTML =
          '<div class="balanceTop"><span>' + trade.instrument + ' · ' + trade.side + '</span><span>' + pnlUsd + '</span></div>' +
          '<div class="balanceMeta">' + pnlPct + ' | ' + (trade.exitReason || trade.reason || '-') + regime + '</div>' +
          '<div class="balanceMeta">' + (trade.closedAt || "N/A") + '</div>';
        el.appendChild(card);
      });
    }

    async function refresh() {
      const [dash, trades] = await Promise.all([
        fetch("/api/dashboard").then((r) => r.json()),
        fetch("/api/trades?limit=4").then((r) => r.json())
      ]);
      setText("realizedPnl", asMoney(dash.realizedPnlUsd));
      setText("unrealizedPnl", asMoney(dash.unrealizedPnlUsd));
      setText("winRate", asPct(dash.winRatePct));
      setText("closedTrades", String(dash.closedTradesCount ?? 0));
      setText("openPositions", String(dash.openPositionCount ?? 0));
      setText("marketRegime", dash.marketRegime || "N/A");
      setText("scannerMode", dash.scannerMode || "N/A");
      setText("scannerSource", dash.scannerSource || "N/A");
      const missed = dash.missedOpportunitySummary || {};
      setText("missedReviewed", (missed.shortlistedReviewed ?? 0) === 0 ? "Not enough data yet" : String(missed.shortlistedReviewed));
      setText("missedBreakouts", String(missed.breakoutLikeMoves ?? 0));
      setText("missedProfitable", String(missed.profitable ?? 0));
      setText("authStatus", dash.cryptoComAuthHealthy ? "HEALTHY" : (dash.cryptoComAuthConfigured ? "FAILED" : "NOT CONFIGURED"));
      setText("balanceCount", String(dash.visibleBalanceCount ?? 0));
      setText("quoteBalance", dash.quoteBalanceUsdOrUsdt || "N/A");
      setText(
        "lastCycle",
        "Last cycle: " +
          (dash.lastCycleTimestamp || "N/A") +
          (dash.scannerFallbackReason ? " | Scanner fallback: " + dash.scannerFallbackReason : "")
      );
      renderPills(dash);
      renderBalances(dash);
      renderRecentTrades(trades);
    }

    refresh().catch(() => {
      setText("lastCycle", "Last cycle: load failed");
    });
    setInterval(() => refresh().catch(() => {}), 5000);
  </script>
</body>
</html>`;
}

export function startWebServer(): void {
  const server = createServer((req, res) => {
    const method = req.method ?? "GET";
    if (method !== "GET") {
      sendJson(res, 405, { error: "Method Not Allowed" });
      return;
    }

    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    const runtime = getRuntimeSnapshot();

    if (url.pathname === "/") {
      sendHtml(res, dashboardHtml());
      return;
    }

    if (url.pathname === "/mobile") {
      sendHtml(res, mobileDashboardHtml());
      return;
    }

    if (url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        botRunning: runtime.botRunning,
        startedAt: runtime.startedAt,
        heartbeatAt: runtime.heartbeatAt,
        lastCycleTimestamp: runtime.lastCycleTimestamp,
        lastCycleDurationMs: runtime.lastCycleDurationMs,
        executionMode: config.executionMode,
        liveTradingEnabled: config.liveTradingEnabled,
        liveExecutionDryRun: config.liveExecutionDryRun,
        paperSizeUseDynamic: config.paperSizeUseDynamic,
        executionAdapterMode: runtime.executionDiagnostics.adapterMode,
        lastOrderSubmissionAttempt: runtime.executionDiagnostics.lastSubmissionAttempt,
        scannerEnabled: runtime.scannerEnabled,
        trailingStopEnabled: runtime.trailingStopEnabled,
        signalExitEnabled: runtime.signalExitEnabled,
        cryptoComAuthConfigured: runtime.cryptoComDiagnostics.cryptoComAuthConfigured,
        cryptoComAuthHealthy: runtime.cryptoComDiagnostics.cryptoComAuthHealthy,
        cryptoComEndpointUsed: runtime.cryptoComDiagnostics.cryptoComEndpointUsed,
        cryptoComAuthErrorCode: runtime.cryptoComDiagnostics.cryptoComAuthErrorCode,
        cryptoComAuthErrorMessage: runtime.cryptoComDiagnostics.cryptoComAuthErrorMessage,
        cryptoComCapabilities: runtime.cryptoComDiagnostics.cryptoComCapabilities,
        cryptoComAccountSummaryAvailable: runtime.cryptoComDiagnostics.cryptoComAccountSummaryAvailable,
        cryptoComOpenOrdersAvailable: runtime.cryptoComDiagnostics.cryptoComOpenOrdersAvailable,
        cryptoComTradeHistoryAvailable: runtime.cryptoComDiagnostics.cryptoComTradeHistoryAvailable,
        cryptoComConnectionMessage: runtime.cryptoComDiagnostics.cryptoComConnectionMessage,
        cryptoComCapabilityWarnings: runtime.cryptoComDiagnostics.warnings,
        cryptoComVisibleBalances: runtime.cryptoComDiagnostics.visibleBalances,
        cryptoComVisibleBalanceCount: runtime.cryptoComDiagnostics.visibleBalanceCount,
        cryptoComAllBalancesZero: runtime.cryptoComDiagnostics.allBalancesZero,
        cryptoComQuoteBalanceUsdOrUsdt: runtime.cryptoComDiagnostics.quoteBalanceUsdOrUsdt,
        lastAuthenticatedProbeAt: runtime.cryptoComDiagnostics.lastAuthenticatedProbeAt,
        degradedMode: runtime.dataDegradation.degraded,
        entriesPaused: runtime.dataDegradation.entriesPaused,
        degradedReasons: runtime.dataDegradation.reasons,
        degradedRecoveryActive: runtime.dataDegradation.inRecovery,
        degradedRecoveryProgress: runtime.dataDegradation.recoveryProgress,
        dataHealth: runtime.dataDegradation.counters,
        notes: runtime.notes
      });
      return;
    }

    if (url.pathname === "/api/dashboard") {
      void (async () => {
        const payload = buildDashboardPayload({
          runtime,
          journalEntries: readJournal(),
          expectedPaperTradeSizeUsd: config.paperTradeSizeUsd,
          missedOpportunitySummary: await getCachedMissedOpportunitySummary(12)
        });
        sendJson(res, 200, payload);
      })().catch((dashboardError) => {
        sendJson(res, 500, {
          error: dashboardError instanceof Error ? dashboardError.message : "dashboard build failed"
        });
      });
      return;
    }

    if (url.pathname === "/api/positions") {
      void (async () => {
        const payload = buildDashboardPayload({
          runtime,
          journalEntries: readJournal(),
          expectedPaperTradeSizeUsd: config.paperTradeSizeUsd,
          missedOpportunitySummary: await getCachedMissedOpportunitySummary(12)
        });
        sendJson(res, 200, {
          count: payload.openPositionDetails.length,
          positions: payload.openPositionDetails
        });
      })().catch((positionsError) => {
        sendJson(res, 500, {
          error: positionsError instanceof Error ? positionsError.message : "positions build failed"
        });
      });
      return;
    }

    if (url.pathname === "/api/scanner") {
      sendJson(res, 200, {
        shortlist: runtime.lastCycleScannerShortlist,
        shortlistCount: runtime.lastCycleScannerShortlist.length,
        rows: runtime.instrumentRows
      });
      return;
    }

    if (url.pathname === "/api/trades") {
      const includeSuspicious = url.searchParams.get("includeSuspicious") === "1";
      const limit = parseLimit(url.searchParams.get("limit"), 20, 200);
      const payload = buildTradesPayload({
        journalEntries: readJournal(),
        expectedPaperTradeSizeUsd: config.paperTradeSizeUsd,
        includeSuspicious,
        limit
      });
      sendJson(res, 200, payload);
      return;
    }

    if (url.pathname === "/api/config") {
      sendJson(res, 200, buildSafeConfigSnapshot(config));
      return;
    }

    sendJson(res, 404, { error: "Not Found" });
  });

  server.on("error", (serverError) => {
    error(`Web server failed: ${serverError instanceof Error ? serverError.message : "unknown error"}`);
  });
  server.listen(PORT, HOST, () => {
    info(`Web dashboard listening at http://${HOST}:${PORT}`);
  });
}

if (require.main === module) {
  startWebServer();
}
