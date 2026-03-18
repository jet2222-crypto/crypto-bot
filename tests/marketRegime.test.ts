import { describe, expect, it } from "vitest";
import { Candle } from "../src/exchange/types";
import { computeMarketRegime, shouldReuseRegimeSnapshot, stabilizeMarketRegime } from "../src/lib/marketRegime";

function makeCandles(start: number, values: number[]): Candle[] {
  return values.map((close, index) => ({
    timestamp: start + index * 60_000,
    open: close,
    high: close * 1.002,
    low: close * 0.998,
    close,
    volume: 1000 + index
  }));
}

describe("market regime", () => {
  it("classifies bullish trend when BTC is above fast and slow EMA with positive breadth", () => {
    const btcCandles = makeCandles(0, Array.from({ length: 35 }, (_, index) => 90 + index));
    const altCandles = makeCandles(0, Array.from({ length: 10 }, (_, index) => 10 + index));
    const result = computeMarketRegime({
      btcCandles,
      candleByInstrument: {
        BTC_USDT: btcCandles,
        ETH_USDT: altCandles,
        SOL_USDT: altCandles
      },
      shortlistInstruments: ["ETH_USDT", "SOL_USDT"],
      at: "2026-03-10T00:00:00.000Z"
    });

    expect(result.regime).toBe("BULL_TREND");
    expect(result.confidence).toBe("HIGH");
  });

  it("falls back safely to range chop when BTC data is missing", () => {
    const result = computeMarketRegime({
      candleByInstrument: {},
      shortlistInstruments: [],
      at: "2026-03-10T00:00:00.000Z"
    });

    expect(result.regime).toBe("RANGE_CHOP");
    expect(result.confidence).toBe("LOW");
  });

  it("reuses regime snapshot within the same closed-candle window", () => {
    const state = {
      active: {
        regime: "BULL_TREND" as const,
        confidence: "HIGH" as const,
        btcPrice: 100,
        emaFast: 99,
        emaSlow: 98,
        emaSpreadPct: 0.01,
        volatilityPct: 0.01,
        breadthScore: 0.5,
        bullScore: 4,
        chopScore: 0,
        reasons: [],
        at: "2026-03-10T00:00:00.000Z",
        candleTimestamp: 123
      },
      pendingBullCount: 0,
      pendingChopCount: 0,
      lastCandleTimestamp: 123
    };

    expect(shouldReuseRegimeSnapshot(state, 123)).toBe(true);
    expect(shouldReuseRegimeSnapshot(state, 124)).toBe(false);
  });

  it("hysteresis blocks immediate flip from range chop to bull trend", () => {
    const rawBull = {
      regime: "BULL_TREND" as const,
      confidence: "HIGH" as const,
      btcPrice: 100,
      emaFast: 99,
      emaSlow: 98,
      emaSpreadPct: 0.01,
      volatilityPct: 0.01,
      breadthScore: 0.5,
      bullScore: 4,
      chopScore: 0,
      reasons: ["TREND_CONFIRMED"],
      at: "2026-03-10T00:00:00.000Z",
      candleTimestamp: 123
    };
    const first = stabilizeMarketRegime(
      {
        active: {
          ...rawBull,
          regime: "RANGE_CHOP",
          confidence: "LOW",
          reasons: ["CHOP"]
        },
        pendingBullCount: 0,
        pendingChopCount: 0,
        lastCandleTimestamp: 122
      },
      rawBull
    );

    expect(first.context.regime).toBe("RANGE_CHOP");
    expect(first.state.pendingBullCount).toBe(1);
  });

  it("switches regime only after confirmation", () => {
    const rawBull = {
      regime: "BULL_TREND" as const,
      confidence: "HIGH" as const,
      btcPrice: 100,
      emaFast: 99,
      emaSlow: 98,
      emaSpreadPct: 0.01,
      volatilityPct: 0.01,
      breadthScore: 0.5,
      bullScore: 4,
      chopScore: 0,
      reasons: ["TREND_CONFIRMED"],
      at: "2026-03-10T00:00:00.000Z",
      candleTimestamp: 123
    };
    const first = stabilizeMarketRegime(
      {
        active: {
          ...rawBull,
          regime: "RANGE_CHOP",
          confidence: "LOW",
          reasons: ["CHOP"]
        },
        pendingBullCount: 0,
        pendingChopCount: 0,
        lastCandleTimestamp: 122
      },
      rawBull
    );
    const second = stabilizeMarketRegime(first.state, { ...rawBull, candleTimestamp: 124 });

    expect(second.context.regime).toBe("BULL_TREND");
    expect(second.state.pendingBullCount).toBe(2);
  });
});
