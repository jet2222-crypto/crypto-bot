import { describe, expect, it } from "vitest";
import { Candle } from "../src/exchange/types";
import { analyzeBreakoutSignal, breakoutSignal, calculateTradeLevels } from "../src/strategy/breakout";

function candle(overrides: Partial<Candle>): Candle {
  return {
    timestamp: overrides.timestamp ?? Date.now(),
    open: overrides.open ?? 100,
    high: overrides.high ?? 110,
    low: overrides.low ?? 90,
    close: overrides.close ?? 100,
    volume: overrides.volume ?? 100
  };
}

describe("breakoutSignal", () => {
  it("returns BUY when price and volume breakout conditions are met", () => {
    const candles: Candle[] = [
      candle({ timestamp: 1, high: 101, close: 100, volume: 100 }),
      candle({ timestamp: 2, high: 102, close: 101, volume: 110 }),
      candle({ timestamp: 3, high: 103, close: 102, volume: 90 }),
      candle({ timestamp: 4, high: 104, close: 103, volume: 95 }),
      candle({ timestamp: 5, high: 120, close: 118, volume: 300 })
    ];

    expect(breakoutSignal(candles, 4, 1.5)).toBe("BUY");
  });

  it("returns HOLD when breakout condition fails", () => {
    const candles: Candle[] = [
      candle({ timestamp: 1, high: 101, close: 100, volume: 100 }),
      candle({ timestamp: 2, high: 102, close: 101, volume: 100 }),
      candle({ timestamp: 3, high: 103, close: 102, volume: 100 }),
      candle({ timestamp: 4, high: 104, close: 103, volume: 100 }),
      candle({ timestamp: 5, high: 104, close: 103, volume: 300 })
    ];

    expect(breakoutSignal(candles, 4, 1.1)).toBe("HOLD");
  });

  it("returns HOLD when volume confirmation fails", () => {
    const candles: Candle[] = [
      candle({ timestamp: 1, high: 101, close: 100, volume: 100 }),
      candle({ timestamp: 2, high: 102, close: 101, volume: 120 }),
      candle({ timestamp: 3, high: 103, close: 102, volume: 110 }),
      candle({ timestamp: 4, high: 104, close: 103, volume: 130 }),
      candle({ timestamp: 5, high: 120, close: 118, volume: 110 })
    ];

    expect(breakoutSignal(candles, 4, 1.2)).toBe("HOLD");
  });

  it("returns SELL when breakdown and volume conditions are met", () => {
    const candles: Candle[] = [
      candle({ timestamp: 1, low: 99, close: 100, volume: 100 }),
      candle({ timestamp: 2, low: 98, close: 99, volume: 105 }),
      candle({ timestamp: 3, low: 97, close: 98, volume: 95 }),
      candle({ timestamp: 4, low: 96, close: 97, volume: 100 }),
      candle({ timestamp: 5, low: 90, close: 91, volume: 260 })
    ];

    expect(breakoutSignal(candles, 4, 1.4)).toBe("SELL");
  });

  it("returns HOLD when price breaks down but volume is not elevated", () => {
    const candles: Candle[] = [
      candle({ timestamp: 1, low: 99, close: 100, volume: 100 }),
      candle({ timestamp: 2, low: 98, close: 99, volume: 105 }),
      candle({ timestamp: 3, low: 97, close: 98, volume: 95 }),
      candle({ timestamp: 4, low: 96, close: 97, volume: 100 }),
      candle({ timestamp: 5, low: 90, close: 91, volume: 100 })
    ];

    expect(breakoutSignal(candles, 4, 1.4)).toBe("HOLD");
  });

  it("respects breakout buffer and returns HOLD when price does not clear threshold", () => {
    const candles: Candle[] = [
      candle({ timestamp: 1, high: 100, close: 99, volume: 100 }),
      candle({ timestamp: 2, high: 101, close: 100, volume: 100 }),
      candle({ timestamp: 3, high: 102, close: 101, volume: 100 }),
      candle({ timestamp: 4, high: 103, close: 102, volume: 100 }),
      candle({ timestamp: 5, high: 104, close: 103.05, volume: 200 })
    ];

    expect(
      breakoutSignal(candles, 4, 1.2, {
        breakoutBufferPct: 0.01,
        minRangePct: 0,
        useRelaxedEntry: false
      })
    ).toBe("HOLD");
  });

  it("supports relaxed entry path when enabled", () => {
    const candles: Candle[] = [
      candle({ timestamp: 1, high: 100, low: 98, close: 99, volume: 100 }),
      candle({ timestamp: 2, high: 101, low: 99, close: 100, volume: 110 }),
      candle({ timestamp: 3, high: 102, low: 100, close: 101, volume: 95 }),
      candle({ timestamp: 4, high: 103, low: 100.5, close: 102, volume: 100 }),
      candle({ timestamp: 5, high: 103.5, low: 101, close: 103.1, volume: 110 })
    ];

    expect(
      breakoutSignal(candles, 4, 1.4, {
        breakoutBufferPct: 0.01,
        minRangePct: 0.01,
        useRelaxedEntry: true
      })
    ).toBe("BUY");
  });

  it("blocks BUY when volatility filter is enabled and volatility is weak", () => {
    const candles: Candle[] = [
      candle({ timestamp: 1, open: 100, high: 100.1, low: 99.9, close: 100, volume: 100 }),
      candle({ timestamp: 2, open: 100, high: 100.2, low: 99.9, close: 100.1, volume: 100 }),
      candle({ timestamp: 3, open: 100.1, high: 100.2, low: 100, close: 100.1, volume: 100 }),
      candle({ timestamp: 4, open: 100.1, high: 100.2, low: 100, close: 100.1, volume: 100 }),
      candle({ timestamp: 5, open: 100.1, high: 100.25, low: 100.05, close: 100.22, volume: 300 })
    ];

    expect(
      breakoutSignal(candles, 4, 1.2, {
        breakoutBufferPct: 0,
        minRangePct: 0,
        useRelaxedEntry: false,
        volFilterEnabled: true,
        atrPeriod: 3,
        minAtrPct: 0.01,
        minVolatilityRangePct: 0.02
      })
    ).toBe("HOLD");
  });

  it("allows BUY when volatility filter is disabled", () => {
    const candles: Candle[] = [
      candle({ timestamp: 1, open: 100, high: 100.1, low: 99.9, close: 100, volume: 100 }),
      candle({ timestamp: 2, open: 100, high: 100.2, low: 99.9, close: 100.1, volume: 100 }),
      candle({ timestamp: 3, open: 100.1, high: 100.2, low: 100, close: 100.1, volume: 100 }),
      candle({ timestamp: 4, open: 100.1, high: 100.2, low: 100, close: 100.1, volume: 100 }),
      candle({ timestamp: 5, open: 100.1, high: 100.25, low: 100.05, close: 100.22, volume: 300 })
    ];

    expect(
      breakoutSignal(candles, 4, 1.2, {
        breakoutBufferPct: 0,
        minRangePct: 0,
        useRelaxedEntry: false,
        volFilterEnabled: false
      })
    ).toBe("BUY");
  });

  it("returns hold reason codes for blocked entries", () => {
    const candles: Candle[] = [
      candle({ timestamp: 1, high: 101, close: 100, volume: 100 }),
      candle({ timestamp: 2, high: 102, close: 101, volume: 100 }),
      candle({ timestamp: 3, high: 103, close: 102, volume: 100 }),
      candle({ timestamp: 4, high: 104, close: 103, volume: 100 }),
      candle({ timestamp: 5, high: 120, close: 118, volume: 90 })
    ];

    const analysis = analyzeBreakoutSignal(candles, 4, 1.2, {
      breakoutBufferPct: 0,
      minRangePct: 0,
      useRelaxedEntry: false
    });

    expect(analysis.signal).toBe("HOLD");
    expect(analysis.holdReason).toBe("VOLUME_FAIL");
  });
});

describe("calculateTradeLevels", () => {
  it("calculates stop loss and take profit from percentages", () => {
    const levels = calculateTradeLevels(100, 0.01, 0.02);
    expect(levels.stopLoss).toBe(99);
    expect(levels.takeProfit).toBe(102);
  });
});
