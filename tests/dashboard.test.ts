import { describe, expect, it } from "vitest";
import { JournalEntry, Position } from "../src/exchange/types";
import { computeDashboardMetrics, renderDashboard } from "../src/reporting/dashboard";

const healthyDegradation = {
  degraded: false,
  entriesPaused: false,
  reasons: [],
  inRecovery: false,
  recoveryProgress: {
    current: 0,
    required: 2
  },
  counters: {
    consecutiveMockCycles: 0,
    consecutiveFetchFailureCycles: 0,
    staleCandleCycles: 0,
    consecutivePriceRejectCycles: 0,
    healthyRecoveryCycles: 0
  }
} as const;

describe("dashboard metrics", () => {
  it("handles zero-trade and zero-position state", () => {
    const metrics = computeDashboardMetrics({
      openPositions: [],
      journalEntries: [],
      trustedPriceByInstrument: {},
      lastCycleScannerCount: 0,
      lastCycleTimestamp: "2026-03-09T00:00:00.000Z",
      scannerEnabled: true,
      trailingStopEnabled: true,
      signalExitEnabled: false,
      marketRegime: "RANGE_CHOP",
      marketRegimeConfidence: "LOW",
      marketRegimePolicy: {
        allowNewEntries: false,
        maxOpenPositions: 2,
        sizeMultiplier: 0,
        tpMultiplier: 0.8,
        stopMultiplier: 0.9,
        requireHighScore: true,
        tightenTrailing: true
      },
      dataDegradation: healthyDegradation
    });

    expect(metrics.closedTradesCount).toBe(0);
    expect(metrics.excludedCorruptTradesCount).toBe(0);
    expect(metrics.winRatePct).toBe(0);
    expect(metrics.unrealizedPnlUsd).toBe(0);
    expect(metrics.capitalMode).toBe("paper");
    expect(metrics.startingCapitalUsd).toBe(5000);
    expect(metrics.currentEquityUsd).toBe(5000);
    expect(metrics.freeCapitalUsd).toBe(5000);

    const rendered = renderDashboard(metrics);
    expect(rendered).toContain("Open Positions: 0");
    expect(rendered).toContain("Closed Trades: 0");
    expect(rendered).toContain("Excluded Corrupt Trades: 0");
    expect(rendered).toContain("Capital Mode: PAPER");
    expect(rendered).toContain("Degraded Mode: OFF");
  });

  it("aggregates realized pnl, wins/losses, and unrealized pnl", () => {
    const openPositions: Position[] = [
      {
        instrument: "BTC_USDT",
        entryPrice: 100,
        quantity: 1,
        openedAt: "2026-03-09T00:00:00.000Z",
        stopLoss: 95,
        takeProfit: 110,
        highestSeenPrice: 106,
        status: "OPEN"
      }
    ];
    const journalEntries: JournalEntry[] = [
      {
        instrument: "ETH_USDT",
        side: "SELL",
        entryPrice: 100,
        exitPrice: 110,
        quantity: 1,
        openedAt: "2026-03-08T00:00:00.000Z",
        closedAt: "2026-03-08T01:00:00.000Z",
        pnl: 10,
        reason: "TAKE_PROFIT",
        exitReason: "TAKE_PROFIT",
        entryRegime: "BULL_TREND"
      },
      {
        instrument: "SOL_USDT",
        side: "SELL",
        entryPrice: 100,
        exitPrice: 95,
        quantity: 1,
        openedAt: "2026-03-08T00:00:00.000Z",
        closedAt: "2026-03-08T01:00:00.000Z",
        pnl: -5,
        reason: "STOP_LOSS",
        exitReason: "STOP_LOSS",
        entryRegime: "BEAR_TREND"
      }
    ];

    const metrics = computeDashboardMetrics({
      openPositions,
      journalEntries,
      trustedPriceByInstrument: { BTC_USDT: 105 },
      lastCycleScannerCount: 3,
      lastCycleTimestamp: "2026-03-09T00:00:00.000Z",
      scannerEnabled: true,
      trailingStopEnabled: true,
      signalExitEnabled: true,
      marketRegime: "BULL_TREND",
      marketRegimeConfidence: "HIGH",
      marketRegimePolicy: {
        allowNewEntries: true,
        maxOpenPositions: 4,
        sizeMultiplier: 1,
        tpMultiplier: 1.15,
        stopMultiplier: 1,
        requireHighScore: false,
        tightenTrailing: false
      },
      dataDegradation: healthyDegradation,
      expectedPaperTradeSizeUsd: 100
    });

    expect(metrics.realizedPnlUsd).toBe(5);
    expect(metrics.winsCount).toBe(1);
    expect(metrics.lossesCount).toBe(1);
    expect(metrics.winRatePct).toBe(50);
    expect(metrics.unrealizedPnlUsd).toBe(5);
    expect(metrics.combinedPnlUsd).toBe(10);
    expect(metrics.excludedCorruptTradesCount).toBe(0);
    expect(metrics.currentEquityUsd).toBe(5010);
    expect(metrics.deployedCapitalUsd).toBe(100);
    expect(metrics.freeCapitalUsd).toBe(4910);
    expect(metrics.netReturnPct).toBe(0.2);
    expect(metrics.closedTradesByEntryRegime).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ regime: "BULL_TREND", trades: 1, wins: 1, realizedPnlUsd: 10 }),
        expect.objectContaining({ regime: "BEAR_TREND", trades: 1, losses: 1, realizedPnlUsd: -5 })
      ])
    );
  });

  it("ignores untrusted/missing prices for unrealized pnl", () => {
    const openPositions: Position[] = [
      {
        instrument: "NOT_USDT",
        entryPrice: 0.02,
        quantity: 1000,
        openedAt: "2026-03-09T00:00:00.000Z",
        stopLoss: 0.019,
        takeProfit: 0.024,
        highestSeenPrice: 0.021,
        status: "OPEN"
      }
    ];

    const metrics = computeDashboardMetrics({
      openPositions,
      journalEntries: [],
      trustedPriceByInstrument: {},
      lastCycleScannerCount: 2,
      lastCycleTimestamp: "2026-03-09T00:00:00.000Z",
      scannerEnabled: true,
      trailingStopEnabled: true,
      signalExitEnabled: true,
      marketRegime: "RANGE_CHOP",
      marketRegimeConfidence: "LOW",
      marketRegimePolicy: {
        allowNewEntries: false,
        maxOpenPositions: 2,
        sizeMultiplier: 0,
        tpMultiplier: 0.8,
        stopMultiplier: 0.9,
        requireHighScore: true,
        tightenTrailing: true
      },
      dataDegradation: healthyDegradation
    });

    expect(metrics.unrealizedPnlUsd).toBe(0);
    expect(metrics.unpricedOpenPositionsCount).toBe(1);
    const rendered = renderDashboard(metrics);
    expect(rendered).toContain("excluded from unrealized PnL");
    expect(rendered).toContain("uPnL=N/A");
  });

  it("excludes suspicious closed trades from realized metrics", () => {
    const journalEntries: JournalEntry[] = [
      {
        instrument: "NOT_USDT",
        side: "SELL",
        entryPrice: 0.0181,
        exitPrice: 50014.1,
        quantity: 5524.861878453039,
        openedAt: "2026-03-08T00:00:00.000Z",
        closedAt: "2026-03-08T00:30:00.000Z",
        pnl: 276_000_000,
        reason: "TAKE_PROFIT",
        exitReason: "TAKE_PROFIT"
      },
      {
        instrument: "ETH_USDT",
        side: "SELL",
        entryPrice: 100,
        exitPrice: 102,
        quantity: 1,
        openedAt: "2026-03-08T00:00:00.000Z",
        closedAt: "2026-03-08T00:30:00.000Z",
        pnl: 2,
        reason: "TAKE_PROFIT",
        exitReason: "TAKE_PROFIT"
      }
    ];

    const metrics = computeDashboardMetrics({
      openPositions: [],
      journalEntries,
      trustedPriceByInstrument: {},
      lastCycleScannerCount: 0,
      lastCycleTimestamp: "2026-03-09T00:00:00.000Z",
      scannerEnabled: true,
      trailingStopEnabled: true,
      signalExitEnabled: true,
      marketRegime: "BEAR_TREND",
      marketRegimeConfidence: "MEDIUM",
      marketRegimePolicy: {
        allowNewEntries: true,
        maxOpenPositions: 2,
        sizeMultiplier: 0.5,
        tpMultiplier: 0.8,
        stopMultiplier: 0.9,
        requireHighScore: true,
        tightenTrailing: true
      },
      dataDegradation: {
        degraded: true,
        entriesPaused: true,
        reasons: ["FETCH_FAILURES"],
        inRecovery: false,
        recoveryProgress: {
          current: 0,
          required: 2
        },
        counters: {
          consecutiveMockCycles: 0,
          consecutiveFetchFailureCycles: 3,
          staleCandleCycles: 0,
          consecutivePriceRejectCycles: 0,
          healthyRecoveryCycles: 0
        }
      },
      expectedPaperTradeSizeUsd: 100
    });

    expect(metrics.closedTradesCount).toBe(1);
    expect(metrics.excludedCorruptTradesCount).toBe(1);
    expect(metrics.realizedPnlUsd).toBe(2);
    const rendered = renderDashboard(metrics);
    expect(rendered).toContain("Excluded Corrupt Trades: 1");
    expect(rendered).toContain("Degraded Mode: ON (entries paused)");
    expect(rendered).toContain("Degraded Reasons: FETCH_FAILURES");
  });

  it("marks long-unpriced open positions as stale orphan in reporting", () => {
    const metrics = computeDashboardMetrics({
      openPositions: [
        {
          instrument: "DOGE_USDT",
          entryPrice: 0.1,
          quantity: 1000,
          openedAt: "2026-03-09T00:00:00.000Z",
          stopLoss: 0.09,
          takeProfit: 0.12,
          highestSeenPrice: 0.11,
          status: "OPEN"
        }
      ],
      journalEntries: [],
      trustedPriceByInstrument: {},
      lastCycleScannerCount: 0,
      lastCycleTimestamp: "2026-03-10T00:00:00.000Z",
      scannerEnabled: true,
      trailingStopEnabled: true,
      signalExitEnabled: true,
      marketRegime: "RANGE_CHOP",
      marketRegimeConfidence: "LOW",
      marketRegimePolicy: {
        allowNewEntries: false,
        maxOpenPositions: 2,
        sizeMultiplier: 0,
        tpMultiplier: 0.8,
        stopMultiplier: 0.9,
        requireHighScore: true,
        tightenTrailing: true
      },
      dataDegradation: healthyDegradation,
      openPositionHealthByInstrument: {
        DOGE_USDT: {
          unpricedCycles: 8,
          orphaned: true
        }
      }
    });

    expect(metrics.orphanedOpenPositionsCount).toBe(1);
    expect(renderDashboard(metrics)).toContain("status=ORPHAN");
  });
});
