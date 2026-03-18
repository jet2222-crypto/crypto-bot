import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getLiveStatusPath, getRuntimeSnapshot } from "../src/web/state";

const liveStatusPath = getLiveStatusPath();
const liveStatusDir = path.dirname(liveStatusPath);
const originalExists = existsSync(liveStatusPath);
const originalContents = originalExists ? readFileSync(liveStatusPath, "utf-8") : null;

function writeSnapshot(payload: object): void {
  mkdirSync(liveStatusDir, { recursive: true });
  writeFileSync(liveStatusPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

afterEach(() => {
  if (originalContents !== null) {
    writeFileSync(liveStatusPath, originalContents, "utf-8");
    return;
  }
  if (existsSync(liveStatusPath)) {
    rmSync(liveStatusPath);
  }
});

describe("shared live status snapshot", () => {
  it("returns safe offline state when file is missing", () => {
    if (existsSync(liveStatusPath)) {
      rmSync(liveStatusPath);
    }

    const snapshot = getRuntimeSnapshot();
    expect(snapshot.botRunning).toBe(false);
    expect(snapshot.lastCycleTimestamp).toBeNull();
  });

  it("treats a fresh heartbeat as running", () => {
    const now = new Date().toISOString();
    writeSnapshot({
      botRunning: true,
      startedAt: now,
      heartbeatAt: now,
      lastCycleTimestamp: now,
      lastCycleDurationMs: 250,
      scannerEnabled: true,
      trailingStopEnabled: true,
      signalExitEnabled: true,
      regimeContext: null,
      regimePolicy: null,
      dataDegradation: {
        degraded: false,
        entriesPaused: false,
        reasons: [],
        counters: {
          consecutiveMockCycles: 0,
          consecutiveFetchFailureCycles: 0,
          staleCandleCycles: 0,
          consecutivePriceRejectCycles: 0,
          healthyRecoveryCycles: 0
        },
        inRecovery: false,
        recoveryProgress: { current: 0, required: 0 }
      },
      openPositionHealthByInstrument: {},
      lastCycleScannerShortlist: ["BTC_USDT"],
      instrumentRows: [],
      trustedPriceByInstrument: {},
      notes: []
    });

    const snapshot = getRuntimeSnapshot();
    expect(snapshot.botRunning).toBe(true);
    expect(snapshot.lastCycleDurationMs).toBe(250);
  });

  it("treats a stale heartbeat as offline", () => {
    writeSnapshot({
      botRunning: true,
      startedAt: "2026-03-10T00:00:00.000Z",
      heartbeatAt: "2026-03-10T00:00:00.000Z",
      lastCycleTimestamp: "2026-03-10T00:05:00.000Z",
      lastCycleDurationMs: 400,
      scannerEnabled: true,
      trailingStopEnabled: true,
      signalExitEnabled: true,
      regimeContext: null,
      regimePolicy: null,
      dataDegradation: {
        degraded: false,
        entriesPaused: false,
        reasons: [],
        counters: {
          consecutiveMockCycles: 0,
          consecutiveFetchFailureCycles: 0,
          staleCandleCycles: 0,
          consecutivePriceRejectCycles: 0,
          healthyRecoveryCycles: 0
        },
        inRecovery: false,
        recoveryProgress: { current: 0, required: 0 }
      },
      openPositionHealthByInstrument: {},
      lastCycleScannerShortlist: [],
      instrumentRows: [],
      trustedPriceByInstrument: {},
      notes: []
    });

    const snapshot = getRuntimeSnapshot();
    expect(snapshot.botRunning).toBe(false);
    expect(snapshot.lastCycleTimestamp).toBe("2026-03-10T00:05:00.000Z");
  });
});
