import { describe, expect, it } from "vitest";
import { PaperPositionManager } from "../src/risk/limits";

describe("PaperPositionManager", () => {
  it("blocks duplicate open positions for the same instrument", () => {
    const manager = new PaperPositionManager(3);

    manager.openPaperPosition({
      instrument: "BTC_USDT",
      entryPrice: 100,
      usdNotional: 100,
      stopLoss: 99,
      takeProfit: 102,
      openedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(manager.canOpenPosition("BTC_USDT")).toBe(false);
  });

  it("computes pnl correctly when closing a position", () => {
    const manager = new PaperPositionManager(3);

    const opened = manager.openPaperPosition({
      instrument: "ETH_USDT",
      entryPrice: 200,
      usdNotional: 100,
      stopLoss: 190,
      takeProfit: 220,
      openedAt: "2026-01-01T00:00:00.000Z"
    });

    const result = manager.closePosition({
      instrument: "ETH_USDT",
      exitPrice: 210,
      closedAt: "2026-01-01T01:00:00.000Z",
      exitReason: "TAKE_PROFIT"
    });

    const expectedPnl = (210 - 200) * opened.quantity;
    expect(result.realizedPnl).toBe(expectedPnl);
    expect(result.closedPosition.status).toBe("CLOSED");
    expect(result.closedPosition.exitReason).toBe("TAKE_PROFIT");
    expect(manager.hasOpenPosition("ETH_USDT")).toBe(false);
  });

  it("updates highestSeenPrice only when price makes a new high", () => {
    const manager = new PaperPositionManager(3);

    manager.openPaperPosition({
      instrument: "SOL_USDT",
      entryPrice: 100,
      usdNotional: 100,
      stopLoss: 95,
      takeProfit: 110,
      openedAt: "2026-01-01T00:00:00.000Z"
    });

    const first = manager.updateHighestSeenPrice("SOL_USDT", 108);
    const second = manager.updateHighestSeenPrice("SOL_USDT", 103);

    expect(first.position?.highestSeenPrice).toBe(108);
    expect(first.updated).toBe(true);
    expect(second.position?.highestSeenPrice).toBe(108);
    expect(second.updated).toBe(false);
  });

  it("calculates trailing stop and triggers trailing exit condition", () => {
    const trailingStop = PaperPositionManager.trailingStopPrice(120, 0.1);
    expect(trailingStop).toBe(108);
    expect(PaperPositionManager.shouldExitByTrailingStop(107, 120, 0.1)).toBe(true);
    expect(PaperPositionManager.shouldExitByTrailingStop(109, 120, 0.1)).toBe(false);
  });

  it("restores only OPEN positions from snapshot", () => {
    const manager = new PaperPositionManager(5);
    manager.restoreOpenPositions([
      {
        instrument: "BTC_USDT",
        entryPrice: 100,
        quantity: 1,
        openedAt: "2026-01-01T00:00:00.000Z",
        stopLoss: 95,
        takeProfit: 110,
        highestSeenPrice: 102,
        status: "OPEN"
      },
      {
        instrument: "ETH_USDT",
        entryPrice: 200,
        quantity: 1,
        openedAt: "2026-01-01T00:00:00.000Z",
        stopLoss: 190,
        takeProfit: 220,
        highestSeenPrice: 210,
        status: "CLOSED",
        exitReason: "TAKE_PROFIT"
      }
    ]);

    expect(manager.hasOpenPosition("BTC_USDT")).toBe(true);
    expect(manager.hasOpenPosition("ETH_USDT")).toBe(false);
  });
});
