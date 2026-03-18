import { describe, expect, it } from "vitest";
import { deriveInstrumentsFromTickers, getMockCandles, PublicTicker } from "../src/exchange/cryptocomRest";

describe("deriveInstrumentsFromTickers", () => {
  it("derives unique instrument metadata from ticker rows", () => {
    const tickers: PublicTicker[] = [
      { instrumentName: "BTC_USDT", lastPrice: 50000, change24h: 0.02, volume24h: 1000000 },
      { instrumentName: "ETH_USDT", lastPrice: 3000, change24h: 0.03, volume24h: 800000 },
      { instrumentName: "BTC_USDT", lastPrice: 50500, change24h: 0.021, volume24h: 1100000 }
    ];

    const instruments = deriveInstrumentsFromTickers(tickers);
    expect(instruments).toHaveLength(2);
    expect(instruments.find((item) => item.instrumentName === "BTC_USDT")?.baseCurrency).toBe("BTC");
    expect(instruments.find((item) => item.instrumentName === "BTC_USDT")?.quoteCurrency).toBe("USDT");
  });
});

describe("getMockCandles", () => {
  it("keeps low-priced symbols on realistic scale with seed price", () => {
    const candles = getMockCandles(40, "NOT_USDT", { seedPrice: 0.02, maxDeviationPct: 0.12 });
    const closes = candles.map((candle) => candle.close);
    expect(Math.min(...closes)).toBeGreaterThan(0.0175);
    expect(Math.max(...closes)).toBeLessThan(0.0225);
  });
});
