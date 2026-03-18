import { describe, expect, it } from "vitest";
import { BlockedEntryTelemetryDeduper } from "../src/telemetry/blockedEntryDeduper";

describe("blocked entry telemetry deduper", () => {
  it("suppresses duplicate blocked entries within cooldown when price is unchanged", () => {
    const deduper = new BlockedEntryTelemetryDeduper(600_000, 0.005);
    const base = {
      instrument: "DOGE_USDT",
      signal: "BUY",
      regime: "RANGE_CHOP",
      reasonBlocked: "REGIME_BLOCKED" as const,
      candidateScore: 3,
      price: 0.1
    };

    expect(deduper.shouldEmit(base, 0)).toBe(true);
    expect(deduper.shouldEmit(base, 60_000)).toBe(false);
  });

  it("re-emits when price changes materially", () => {
    const deduper = new BlockedEntryTelemetryDeduper(600_000, 0.005);
    const base = {
      instrument: "DOGE_USDT",
      signal: "BUY",
      regime: "RANGE_CHOP",
      reasonBlocked: "REGIME_BLOCKED" as const,
      candidateScore: 3,
      price: 0.1
    };

    expect(deduper.shouldEmit(base, 0)).toBe(true);
    expect(deduper.shouldEmit({ ...base, price: 0.1006 }, 60_000)).toBe(true);
  });

  it("re-emits after cooldown elapses", () => {
    const deduper = new BlockedEntryTelemetryDeduper(600_000, 0.005);
    const base = {
      instrument: "DOGE_USDT",
      signal: "BUY",
      regime: "RANGE_CHOP",
      reasonBlocked: "REGIME_BLOCKED" as const,
      candidateScore: 3,
      price: 0.1
    };

    expect(deduper.shouldEmit(base, 0)).toBe(true);
    expect(deduper.shouldEmit(base, 600_000)).toBe(true);
  });

  it("treats changed regime, reason, or candidate score as a new blocked situation", () => {
    const deduper = new BlockedEntryTelemetryDeduper(600_000, 0.005);
    const base = {
      instrument: "DOGE_USDT",
      signal: "BUY",
      regime: "RANGE_CHOP",
      reasonBlocked: "REGIME_BLOCKED" as const,
      candidateScore: 3,
      price: 0.1
    };

    expect(deduper.shouldEmit(base, 0)).toBe(true);
    expect(deduper.shouldEmit({ ...base, regime: "BEAR_TREND" }, 60_000)).toBe(true);
    expect(deduper.shouldEmit({ ...base, reasonBlocked: "EV_RR_TOO_LOW" }, 120_000)).toBe(true);
    expect(deduper.shouldEmit({ ...base, candidateScore: 4 }, 180_000)).toBe(true);
  });
});
