import { describe, expect, it } from "vitest";
import { buildMarketDataSnapshot, calculateDisagreementBps } from "../src/marketData/selector";

const thresholds = {
  freshnessMs: 600000,
  highDisagreementBps: 30,
  mediumDisagreementBps: 100,
  orphanWarningCycles: 2,
  orphanStaleCycles: 4,
  orphanCycles: 8,
  quarantineCycles: 12,
  allowLastGoodPriceMarking: true,
  allowLowConfidenceEntries: false
} as const;

describe("market data selector", () => {
  it("prefers fresh primary source over reference and safety", () => {
    const snapshot = buildMarketDataSnapshot({
      instrument: "BTC_USDT",
      primary: {
        tier: "PRIMARY",
        kind: "REAL_CANDLE",
        price: 100,
        timestamp: 1,
        fresh: true
      },
      reference: {
        tier: "REFERENCE",
        kind: "LAST_GOOD",
        price: 99.95,
        timestamp: 1,
        fresh: true
      },
      safety: {
        tier: "SAFETY",
        kind: "MOCK_CANDLE",
        price: 100.1,
        timestamp: 1,
        fresh: true
      },
      thresholds
    });

    expect(snapshot.priceSourceUsed).toBe("PRIMARY:REAL_CANDLE");
    expect(snapshot.chosenPrice).toBe(100);
    expect(snapshot.priceConfidence).toBe("HIGH");
  });

  it("calculates disagreement in basis points", () => {
    expect(calculateDisagreementBps(100, 99.5)).toBeCloseTo(50.251256, 3);
  });

  it("downgrades confidence for safety-only pricing", () => {
    const snapshot = buildMarketDataSnapshot({
      instrument: "DOGE_USDT",
      safety: {
        tier: "SAFETY",
        kind: "MOCK_CANDLE",
        price: 0.1,
        timestamp: 1,
        fresh: true
      },
      thresholds
    });

    expect(snapshot.priceConfidence).toBe("LOW");
    expect(snapshot.isTradable).toBe(false);
  });

  it("escalates orphan status across repeated low-confidence cycles", () => {
    let previous = buildMarketDataSnapshot({
      instrument: "XRP_USDT",
      safety: {
        tier: "SAFETY",
        kind: "MOCK_CANDLE",
        price: 1,
        timestamp: 1,
        fresh: true
      },
      thresholds
    });

    for (let index = 0; index < 11; index += 1) {
      previous = buildMarketDataSnapshot({
        instrument: "XRP_USDT",
        previous,
        thresholds
      });
    }

    expect(previous.unpricedCycles).toBeGreaterThanOrEqual(12);
    expect(previous.orphanStatus).toBe("QUARANTINED");
    expect(previous.isTradable).toBe(false);
  });

  it("reuses last good price for temporary marking when enabled", () => {
    const first = buildMarketDataSnapshot({
      instrument: "ETH_USDT",
      primary: {
        tier: "PRIMARY",
        kind: "REAL_CANDLE",
        price: 2000,
        timestamp: 1000,
        fresh: true
      },
      thresholds
    });
    const second = buildMarketDataSnapshot({
      instrument: "ETH_USDT",
      previous: first,
      reference: {
        tier: "REFERENCE",
        kind: "LAST_GOOD",
        price: first.lastGoodPrice!,
        timestamp: first.lastGoodPriceTs!,
        fresh: true
      },
      thresholds
    });

    expect(second.priceSourceUsed).toBe("REFERENCE:LAST_GOOD");
    expect(second.priceConfidence).toBe("LOW");
    expect(second.chosenPrice).toBe(2000);
  });
});
