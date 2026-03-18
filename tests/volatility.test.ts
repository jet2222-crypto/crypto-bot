import { describe, expect, it } from "vitest";
import { Candle } from "../src/exchange/types";
import {
  calculateAtr,
  calculateRangePct,
  calculateTrueRange,
  isVolatilityHealthy
} from "../src/strategy/volatility";

function c(v: Partial<Candle>): Candle {
  return {
    timestamp: v.timestamp ?? 0,
    open: v.open ?? 100,
    high: v.high ?? 101,
    low: v.low ?? 99,
    close: v.close ?? 100,
    volume: v.volume ?? 100
  };
}

describe("volatility helpers", () => {
  it("calculates true range robustly", () => {
    const tr = calculateTrueRange(c({ high: 110, low: 100 }), 95);
    expect(tr).toBe(15);
  });

  it("calculates ATR for period", () => {
    const candles: Candle[] = [
      c({ timestamp: 1, high: 101, low: 99, close: 100 }),
      c({ timestamp: 2, high: 103, low: 99, close: 102 }),
      c({ timestamp: 3, high: 104, low: 101, close: 103 }),
      c({ timestamp: 4, high: 106, low: 102, close: 105 })
    ];
    const atr = calculateAtr(candles, 3);
    expect(atr).toBeGreaterThan(0);
    expect(atr).toBeCloseTo((4 + 3 + 4) / 3, 8);
  });

  it("calculates recent range percent", () => {
    const candles: Candle[] = [
      c({ timestamp: 1, high: 101, low: 99, close: 100 }),
      c({ timestamp: 2, high: 103, low: 98, close: 102 }),
      c({ timestamp: 3, high: 104, low: 97, close: 103 }),
      c({ timestamp: 4, high: 105, low: 99, close: 104 })
    ];
    const pct = calculateRangePct(candles, 4);
    expect(pct).toBeCloseTo((105 - 97) / 104, 8);
  });

  it("evaluates healthy volatility pass/fail", () => {
    const active: Candle[] = [
      c({ timestamp: 1, high: 105, low: 98, close: 102 }),
      c({ timestamp: 2, high: 108, low: 101, close: 107 }),
      c({ timestamp: 3, high: 111, low: 106, close: 110 }),
      c({ timestamp: 4, high: 114, low: 108, close: 113 }),
      c({ timestamp: 5, high: 116, low: 110, close: 115 })
    ];
    const dead: Candle[] = [
      c({ timestamp: 1, high: 100.2, low: 99.8, close: 100 }),
      c({ timestamp: 2, high: 100.2, low: 99.9, close: 100.1 }),
      c({ timestamp: 3, high: 100.3, low: 100, close: 100.1 }),
      c({ timestamp: 4, high: 100.3, low: 100, close: 100.2 }),
      c({ timestamp: 5, high: 100.3, low: 100.1, close: 100.2 })
    ];

    const activeHealth = isVolatilityHealthy({
      candles: active,
      atrPeriod: 3,
      minAtrPct: 0.01,
      rangeLookback: 4,
      minVolatilityRangePct: 0.03
    });
    const deadHealth = isVolatilityHealthy({
      candles: dead,
      atrPeriod: 3,
      minAtrPct: 0.01,
      rangeLookback: 4,
      minVolatilityRangePct: 0.03
    });

    expect(activeHealth.healthy).toBe(true);
    expect(deadHealth.healthy).toBe(false);
  });
});
