import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PaperPositionManager } from "../src/risk/limits";

describe("open position persistence", () => {
  const originalCwd = process.cwd();
  let tempDir = "";

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), "crypto-bot-open-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists positions after open/update/close", async () => {
    const storage = await import("../src/storage/openPositions");
    const manager = new PaperPositionManager(3);

    const opened = manager.openPaperPosition({
      instrument: "BTC_USDT",
      entryPrice: 100,
      usdNotional: 100,
      stopLoss: 95,
      takeProfit: 110,
      openedAt: "2026-01-01T00:00:00.000Z"
    });
    storage.writeOpenPositions(manager.listOpenPositions());
    expect(storage.readOpenPositions()[0].instrument).toBe("BTC_USDT");
    expect(storage.readOpenPositions()[0].highestSeenPrice).toBe(opened.entryPrice);

    manager.updateHighestSeenPrice("BTC_USDT", 108);
    storage.writeOpenPositions(manager.listOpenPositions());
    expect(storage.readOpenPositions()[0].highestSeenPrice).toBe(108);

    manager.closePosition({
      instrument: "BTC_USDT",
      exitPrice: 109,
      closedAt: "2026-01-01T01:00:00.000Z",
      exitReason: "TAKE_PROFIT"
    });
    storage.writeOpenPositions(manager.listOpenPositions());
    expect(storage.readOpenPositions()).toEqual([]);
  });

  it("restores open positions from disk preserving trailing fields", async () => {
    const storage = await import("../src/storage/openPositions");
    const manager = new PaperPositionManager(3);

    storage.writeOpenPositions([
      {
        instrument: "ETH_USDT",
        entryPrice: 200,
        quantity: 0.5,
        openedAt: "2026-01-01T00:00:00.000Z",
        stopLoss: 190,
        takeProfit: 220,
        highestSeenPrice: 212,
        status: "OPEN"
      }
    ]);

    const restored = storage.readOpenPositions();
    manager.restoreOpenPositions(restored);
    const position = manager.getOpenPosition("ETH_USDT");
    expect(position?.highestSeenPrice).toBe(212);
    expect(position?.stopLoss).toBe(190);
    expect(position?.takeProfit).toBe(220);
  });
});
