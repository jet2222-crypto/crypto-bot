import { describe, expect, it } from "vitest";
import { Position } from "../src/exchange/types";
import { PaperCapitalReportSource } from "../src/reporting/capital";

describe("paper capital reporting", () => {
  it("computes equity, deployed capital, free capital, and returns", () => {
    const openPositions: Position[] = [
      {
        instrument: "BTC_USDT",
        entryPrice: 100,
        quantity: 2,
        openedAt: "2026-03-14T00:00:00.000Z",
        stopLoss: 95,
        takeProfit: 110,
        highestSeenPrice: 105,
        status: "OPEN"
      }
    ];

    const report = new PaperCapitalReportSource().buildReport({
      startingCapitalUsd: 5000,
      openPositions,
      realizedPnlUsd: 100,
      unrealizedPnlUsd: -20,
      closedTrades: [
        {
          entry: {
            instrument: "ETH_USDT",
            side: "SELL",
            entryPrice: 100,
            exitPrice: 110,
            quantity: 1,
            openedAt: "2026-03-14T00:00:00.000Z",
            closedAt: "2026-03-14T01:00:00.000Z",
            pnl: 10,
            reason: "TAKE_PROFIT",
            exitReason: "TAKE_PROFIT"
          },
          pnl: 10,
          entryNotional: 100,
          returnPct: 0.1
        },
        {
          entry: {
            instrument: "SOL_USDT",
            side: "SELL",
            entryPrice: 100,
            exitPrice: 95,
            quantity: 1,
            openedAt: "2026-03-14T00:00:00.000Z",
            closedAt: "2026-03-14T02:00:00.000Z",
            pnl: -5,
            reason: "STOP_LOSS",
            exitReason: "STOP_LOSS"
          },
          pnl: -5,
          entryNotional: 100,
          returnPct: -0.05
        }
      ]
    });

    expect(report.capitalMode).toBe("paper");
    expect(report.currentEquityUsd).toBe(5080);
    expect(report.realizedEquityUsd).toBe(5100);
    expect(report.deployedCapitalUsd).toBe(200);
    expect(report.freeCapitalUsd).toBe(4880);
    expect(report.realizedReturnPct).toBe(2);
    expect(report.unrealizedReturnPct).toBe(-0.4);
    expect(report.netReturnPct).toBe(1.6);
  });

  it("computes max drawdown from closed-trade equity curve", () => {
    const report = new PaperCapitalReportSource().buildReport({
      startingCapitalUsd: 5000,
      openPositions: [],
      realizedPnlUsd: 5,
      unrealizedPnlUsd: 0,
      closedTrades: [
        {
          entry: {
            instrument: "ETH_USDT",
            side: "SELL",
            entryPrice: 100,
            exitPrice: 120,
            quantity: 1,
            openedAt: "2026-03-14T00:00:00.000Z",
            closedAt: "2026-03-14T01:00:00.000Z",
            pnl: 20,
            reason: "TAKE_PROFIT",
            exitReason: "TAKE_PROFIT"
          },
          pnl: 20,
          entryNotional: 100,
          returnPct: 0.2
        },
        {
          entry: {
            instrument: "SOL_USDT",
            side: "SELL",
            entryPrice: 100,
            exitPrice: 85,
            quantity: 1,
            openedAt: "2026-03-14T00:00:00.000Z",
            closedAt: "2026-03-14T02:00:00.000Z",
            pnl: -15,
            reason: "STOP_LOSS",
            exitReason: "STOP_LOSS"
          },
          pnl: -15,
          entryNotional: 100,
          returnPct: -0.15
        }
      ]
    });

    expect(report.maxDrawdownUsd).toBe(15);
    expect(report.maxDrawdownPct).toBeCloseTo((15 / 5020) * 100, 6);
  });
});
