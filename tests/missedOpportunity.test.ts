import { describe, expect, it } from "vitest";
import {
  analyzeMissedOpportunity,
  selectMissedCandidates,
  summarizeMissedOpportunityResults
} from "../src/analysis/missedOpportunity";
import { Candle } from "../src/exchange/types";
import { ScannerDecisionTelemetryEntry } from "../src/telemetry/store";

function candle(timestamp: number, open: number, high: number, low: number, close: number, volume = 100): Candle {
  return { timestamp, open, high, low, close, volume };
}

describe("missed opportunity analysis", () => {
  it("handles an empty window", () => {
    const selected = selectMissedCandidates([], "2026-03-17T00:00:00.000Z", "2026-03-17T12:00:00.000Z");
    expect(selected).toEqual([]);
  });

  it("ignores non-shortlisted or already-open rows", () => {
    const rows: ScannerDecisionTelemetryEntry[] = [
      {
        observedAt: "2026-03-17T01:00:00.000Z",
        instrument: "DOGE_USDT",
        timeframe: "5m",
        scannerSelected: false,
        hasOpenPosition: false,
        signal: "HOLD",
        holdReason: "NO_BREAKOUT",
        latestPrice: 0.1,
        candleTimestamp: 1000
      },
      {
        observedAt: "2026-03-17T01:05:00.000Z",
        instrument: "XRP_USDT",
        timeframe: "5m",
        scannerSelected: true,
        hasOpenPosition: true,
        signal: "HOLD",
        holdReason: "NO_BREAKOUT",
        latestPrice: 0.5,
        candleTimestamp: 2000
      }
    ];

    const selected = selectMissedCandidates(rows, "2026-03-17T00:00:00.000Z", "2026-03-17T12:00:00.000Z");
    expect(selected).toHaveLength(0);
  });

  it("classifies a basic breakout-like move after a no-breakout decision", () => {
    const decision = {
      observedAt: "2026-03-17T01:00:00.000Z",
      instrument: "DOGE_USDT",
      timeframe: "5m",
      scannerSelected: true as const,
      hasOpenPosition: false as const,
      signal: "HOLD" as const,
      holdReason: "NO_BREAKOUT" as const,
      latestPrice: 1,
      candleTimestamp: 4000
    };

    const candles = [
      candle(1000, 0.94, 0.95, 0.93, 0.94),
      candle(2000, 0.95, 0.96, 0.94, 0.95),
      candle(3000, 0.96, 0.97, 0.95, 0.96),
      candle(4000, 0.99, 1.0, 0.98, 1.0),
      candle(5000, 1.0, 1.03, 0.99, 1.02),
      candle(6000, 1.02, 1.05, 1.01, 1.04),
      candle(7000, 1.04, 1.06, 1.02, 1.05)
    ];

    const result = analyzeMissedOpportunity({
      decision,
      candles,
      lookback: 3,
      breakoutBufferPct: 0.001,
      futureCandlesToCheck: 3,
      minWorthwhileMovePct: 0.35
    });

    expect(result.breakoutThresholdExceeded).toBe(true);
    expect(result.profitableAfterWindow).toBe(true);
    expect(result.outcome).toBe("MISSED_BREAKOUT");
  });

  it("summarizes empty analysis windows as not enough data yet", () => {
    const summary = summarizeMissedOpportunityResults({
      windowHours: 12,
      candidatesReviewed: 0,
      analyses: []
    });

    expect(summary.shortlistedReviewed).toBe(0);
    expect(summary.conclusion).toBe("Not enough data yet");
  });
});
