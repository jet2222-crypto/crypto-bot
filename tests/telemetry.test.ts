import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendBlockedEntryTelemetry,
  appendTradeTelemetry,
  buildDailySummariesForExport,
  buildDailySummaryTelemetry,
  buildTradeTelemetryFromJournalEntry,
  getTelemetryPaths,
  readBlockedEntryTelemetry,
  readTradeTelemetry,
  writeReviewPack
} from "../src/telemetry/store";

const tempRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "crypto-bot-telemetry-"));
  tempRoots.push(root);
  return root;
}

describe("telemetry store", () => {
  afterEach(() => {
    tempRoots.length = 0;
  });

  it("appends telemetry safely and reads it back", () => {
    const root = makeRoot();

    expect(() =>
      appendTradeTelemetry(
        {
          openedAt: "2026-03-10T00:00:00.000Z",
          closedAt: "2026-03-10T00:10:00.000Z",
          instrument: "ETH_USDT",
          side: "LONG",
          entry: 100,
          exit: 102,
          qty: 1,
          pnlUsd: 2,
          pnlPct: 2,
          entryRegime: "BULL_TREND",
          entryRegimeConfidence: "HIGH",
          entryBreadthScore: 0.4,
          entryVolatilityPct: 0.01,
          entryEmaSpreadPct: 0.005,
          exitReason: "TAKE_PROFIT",
          holdingMinutes: 10,
          mfeUsd: 2.5,
          maeUsd: -0.3
        },
        root
      )
    ).not.toThrow();

    const rows = readTradeTelemetry(root);
    expect(rows).toHaveLength(1);
    expect(rows[0].entryRegime).toBe("BULL_TREND");
  });

  it("builds closed trade telemetry from journal with regime fields", () => {
    const row = buildTradeTelemetryFromJournalEntry({
      closedEntry: {
        instrument: "SOL_USDT",
        side: "SELL",
        entryPrice: 100,
        exitPrice: 103,
        quantity: 1,
        openedAt: "2026-03-10T00:00:00.000Z",
        closedAt: "2026-03-10T00:05:00.000Z",
        pnl: 3,
        reason: "TAKE_PROFIT",
        exitReason: "TAKE_PROFIT",
        entryRegime: "BULL_TREND",
        entryRegimeConfidence: "HIGH",
        entryBreadthScore: 0.5,
        entryVolatilityPct: 0.02,
        entryEmaSpreadPct: 0.006
      },
      mfeUsd: 4,
      maeUsd: -1
    });

    expect(row).not.toBeNull();
    expect(row?.entryRegime).toBe("BULL_TREND");
    expect(row?.mfeUsd).toBe(4);
  });

  it("captures blocked entry telemetry for EV gate reasons", () => {
    const root = makeRoot();

    appendBlockedEntryTelemetry(
      {
        at: "2026-03-10T00:00:00.000Z",
        instrument: "DOGE_USDT",
        signal: "BUY",
        regime: "BEAR_TREND",
        reasonBlocked: "EV_RR_TOO_LOW",
        price: 0.12,
        rewardRiskRatio: 1.1,
        tpDistancePct: 0.01,
        slDistancePct: 0.009
      },
      root
    );

    const rows = readBlockedEntryTelemetry(root);
    expect(rows).toHaveLength(1);
    expect(rows[0].reasonBlocked).toBe("EV_RR_TOO_LOW");
  });

  it("writes a review pack with exports", () => {
    const root = makeRoot();
    appendTradeTelemetry(
      {
        openedAt: "2026-03-10T00:00:00.000Z",
        closedAt: "2026-03-10T00:10:00.000Z",
        instrument: "ETH_USDT",
        side: "LONG",
        entry: 100,
        exit: 102,
        qty: 1,
        pnlUsd: 2,
        pnlPct: 2,
        entryRegime: "BULL_TREND",
        entryRegimeConfidence: "HIGH",
        entryBreadthScore: 0.4,
        entryVolatilityPct: 0.01,
        entryEmaSpreadPct: 0.005,
        exitReason: "TAKE_PROFIT",
        holdingMinutes: 10,
        mfeUsd: 2.5,
        maeUsd: -0.3
      },
      root
    );
    appendBlockedEntryTelemetry(
      {
        at: "2026-03-10T00:00:00.000Z",
        instrument: "DOGE_USDT",
        signal: "BUY",
        regime: "BEAR_TREND",
        reasonBlocked: "EV_RR_TOO_LOW",
        price: 0.12
      },
      root
    );

    const paths = getTelemetryPaths(root);
    expect(() =>
      writeReviewPack(root)
    ).not.toThrow();
    expect(existsSync(paths.tradesExportPath)).toBe(true);
    expect(existsSync(paths.blockedExportPath)).toBe(true);
    const tradesCsv = readFileSync(paths.tradesExportPath, "utf-8");
    expect(tradesCsv).toContain("entryRegime");
    expect(tradesCsv).toContain("BULL_TREND");
    const blockedCsv = readFileSync(paths.blockedExportPath, "utf-8");
    expect(blockedCsv).toContain("EV_RR_TOO_LOW");
  });

  it("review-pack summary export ignores stale appended day snapshots and recomputes from source data", () => {
    const root = makeRoot();
    const paths = getTelemetryPaths(root);
    appendBlockedEntryTelemetry(
      {
        at: "2026-03-10T00:01:00.000Z",
        instrument: "DOGE_USDT",
        signal: "BUY",
        regime: "RANGE_CHOP",
        reasonBlocked: "REGIME_BLOCKED",
        price: 0.1
      },
      root
    );

    expect(() =>
      writeReviewPack(root, {
        journalEntries: [
          {
            instrument: "ETH_USDT",
            side: "SELL",
            entryPrice: 100,
            exitPrice: 104,
            quantity: 1,
            openedAt: "2026-03-10T00:05:00.000Z",
            closedAt: "2026-03-10T12:00:00.000Z",
            pnl: 4,
            reason: "TAKE_PROFIT",
            exitReason: "TAKE_PROFIT"
          }
        ],
        currentUtcDay: "2026-03-10"
      })
    ).not.toThrow();

    const summary = JSON.parse(readFileSync(paths.summaryExportPath, "utf-8")) as {
      latestSummary: { closedTrades: number; realizedPnlUsd: number; blockedEntriesByReason: Record<string, number> };
    };
    expect(summary.latestSummary.closedTrades).toBe(1);
    expect(summary.latestSummary.realizedPnlUsd).toBe(4);
    expect(summary.latestSummary.blockedEntriesByReason.REGIME_BLOCKED).toBe(1);
  });

  it("builds daily summary metrics from telemetry rows", () => {
    const summary = buildDailySummaryTelemetry({
      day: "2026-03-10",
      unrealizedPnlUsd: 0.5,
      tradeRows: [
        {
          openedAt: "2026-03-10T00:00:00.000Z",
          closedAt: "2026-03-10T00:10:00.000Z",
          instrument: "ETH_USDT",
          side: "LONG",
          entry: 100,
          exit: 102,
          qty: 1,
          pnlUsd: 2,
          pnlPct: 2,
          entryRegime: "BULL_TREND",
          entryRegimeConfidence: "HIGH",
          entryBreadthScore: 0.4,
          entryVolatilityPct: 0.01,
          entryEmaSpreadPct: 0.005,
          exitReason: "TAKE_PROFIT",
          holdingMinutes: 10,
          mfeUsd: 2.5,
          maeUsd: -0.3
        },
        {
          openedAt: "2026-03-10T01:00:00.000Z",
          closedAt: "2026-03-10T01:10:00.000Z",
          instrument: "SOL_USDT",
          side: "LONG",
          entry: 100,
          exit: 99,
          qty: 1,
          pnlUsd: -1,
          pnlPct: -1,
          entryRegime: "BEAR_TREND",
          entryRegimeConfidence: "MEDIUM",
          entryBreadthScore: 0.1,
          entryVolatilityPct: 0.02,
          entryEmaSpreadPct: -0.003,
          exitReason: "STOP_LOSS",
          holdingMinutes: 10,
          mfeUsd: 0.3,
          maeUsd: -1.2
        }
      ],
      blockedEntries: [
        {
          at: "2026-03-10T02:00:00.000Z",
          instrument: "DOGE_USDT",
          signal: "BUY",
          regime: "BEAR_TREND",
          reasonBlocked: "EV_RR_TOO_LOW",
          price: 0.12
        }
      ]
    });

    expect(summary.closedTrades).toBe(2);
    expect(summary.blockedEntriesByReason.EV_RR_TOO_LOW).toBe(1);
    expect(summary.closedTradesByRegime.BULL_TREND).toBe(1);
  });

  it("recomputes a day after trades close later in that UTC day", () => {
    const summaries = buildDailySummariesForExport({
      journalEntries: [
        {
          instrument: "ETH_USDT",
          side: "SELL",
          entryPrice: 100,
          exitPrice: 103,
          quantity: 1,
          openedAt: "2026-03-10T00:05:00.000Z",
          closedAt: "2026-03-10T12:00:00.000Z",
          pnl: 3,
          reason: "TAKE_PROFIT",
          exitReason: "TAKE_PROFIT"
        }
      ],
      blockedEntries: [
        {
          at: "2026-03-10T00:01:00.000Z",
          instrument: "DOGE_USDT",
          signal: "BUY",
          regime: "RANGE_CHOP",
          reasonBlocked: "REGIME_BLOCKED",
          price: 0.1
        }
      ],
      expectedPaperTradeSizeUsd: 100,
      currentUtcDay: "2026-03-10"
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0].day).toBe("2026-03-10");
    expect(summaries[0].closedTrades).toBe(1);
    expect(summaries[0].realizedPnlUsd).toBe(3);
    expect(summaries[0].blockedEntriesByReason.REGIME_BLOCKED).toBe(1);
  });

  it("recomputes multiple UTC days correctly", () => {
    const summaries = buildDailySummariesForExport({
      journalEntries: [
        {
          instrument: "ETH_USDT",
          side: "SELL",
          entryPrice: 100,
          exitPrice: 102,
          quantity: 1,
          openedAt: "2026-03-10T00:05:00.000Z",
          closedAt: "2026-03-10T12:00:00.000Z",
          pnl: 2,
          reason: "TAKE_PROFIT",
          exitReason: "TAKE_PROFIT"
        },
        {
          instrument: "SOL_USDT",
          side: "SELL",
          entryPrice: 100,
          exitPrice: 98,
          quantity: 1,
          openedAt: "2026-03-11T01:00:00.000Z",
          closedAt: "2026-03-11T02:00:00.000Z",
          pnl: -2,
          reason: "STOP_LOSS",
          exitReason: "STOP_LOSS"
        }
      ],
      blockedEntries: [],
      expectedPaperTradeSizeUsd: 100,
      currentUtcDay: "2026-03-11"
    });

    expect(summaries.map((summary) => summary.day)).toEqual(["2026-03-10", "2026-03-11"]);
    expect(summaries[0].closedTrades).toBe(1);
    expect(summaries[0].realizedPnlUsd).toBe(2);
    expect(summaries[1].closedTrades).toBe(1);
    expect(summaries[1].realizedPnlUsd).toBe(-2);
  });

  it("includes a zero-trade UTC day when no trades have closed yet", () => {
    const summaries = buildDailySummariesForExport({
      journalEntries: [],
      blockedEntries: [],
      expectedPaperTradeSizeUsd: 100,
      currentUtcDay: "2026-03-12"
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0].day).toBe("2026-03-12");
    expect(summaries[0].closedTrades).toBe(0);
    expect(summaries[0].realizedPnlUsd).toBe(0);
  });
});
