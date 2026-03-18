import { describe, expect, it } from "vitest";
import { PublicInstrument, PublicTicker } from "../src/exchange/cryptocomRest";
import { buildScannerShortlist, filterScannerInstruments, rankScannerCandidates } from "../src/strategy/scanner";
import { Candle } from "../src/exchange/types";

describe("scanner filters", () => {
  it("keeps spot-style USDT pairs and excludes leveraged/special instruments", () => {
    const instruments: PublicInstrument[] = [
      { instrumentName: "BTC_USDT", quoteCurrency: "USDT", baseCurrency: "BTC" },
      { instrumentName: "ETH_USDT", quoteCurrency: "USDT", baseCurrency: "ETH" },
      { instrumentName: "BTC_3L_USDT", quoteCurrency: "USDT", baseCurrency: "BTC3L" },
      { instrumentName: "SOL_PERP", quoteCurrency: "USD", baseCurrency: "SOL" },
      { instrumentName: "XRP_USD", quoteCurrency: "USD", baseCurrency: "XRP" }
    ];

    const filtered = filterScannerInstruments(instruments, "USDT", 50);
    expect(filtered).toEqual(["BTC_USDT", "ETH_USDT"]);
  });
});

describe("scanner ranking", () => {
  it("ranks by momentum and volume proxy", () => {
    const instruments = ["BTC_USDT", "ETH_USDT", "SOL_USDT"];
    const tickers: PublicTicker[] = [
      { instrumentName: "BTC_USDT", lastPrice: 50000, change24h: 0.01, volume24h: 1000000 },
      { instrumentName: "ETH_USDT", lastPrice: 3000, change24h: 0.05, volume24h: 5000000 },
      { instrumentName: "SOL_USDT", lastPrice: 100, change24h: -0.01, volume24h: 4000000 }
    ];

    const ranked = rankScannerCandidates(instruments, tickers, 2, 0);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].instrument).toBe("ETH_USDT");
    expect(ranked[1].instrument).toBe("BTC_USDT");
  });

  it("builds a shortlist with top-N cap", () => {
    const instruments: PublicInstrument[] = [
      { instrumentName: "BTC_USDT", quoteCurrency: "USDT", baseCurrency: "BTC" },
      { instrumentName: "ETH_USDT", quoteCurrency: "USDT", baseCurrency: "ETH" },
      { instrumentName: "SOL_USDT", quoteCurrency: "USDT", baseCurrency: "SOL" }
    ];
    const tickers: PublicTicker[] = [
      { instrumentName: "BTC_USDT", lastPrice: 50000, change24h: 0.02, volume24h: 1000000 },
      { instrumentName: "ETH_USDT", lastPrice: 3000, change24h: 0.03, volume24h: 800000 },
      { instrumentName: "SOL_USDT", lastPrice: 120, change24h: 0.01, volume24h: 9000000 }
    ];

    const shortlist = buildScannerShortlist({
      instruments,
      tickers,
      options: {
        quoteFilter: "USDT",
        maxInstruments: 10,
        topN: 2,
        min24hVolume: 0,
        useCandleConfirmation: false,
        lookback: 4
      }
    });

    expect(shortlist).toHaveLength(2);
  });

  it("applies liquidity filter", () => {
    const instruments = ["BTC_USDT", "ETH_USDT"];
    const tickers: PublicTicker[] = [
      { instrumentName: "BTC_USDT", lastPrice: 50000, change24h: 0.02, volume24h: 1000000 },
      { instrumentName: "ETH_USDT", lastPrice: 3000, change24h: 0.04, volume24h: 1000 }
    ];

    const ranked = rankScannerCandidates(instruments, tickers, 5, 100000);
    expect(ranked.map((item) => item.instrument)).toEqual(["BTC_USDT"]);
  });

  it("filters out ultra-low priced symbols", () => {
    const instruments = ["MICRO_USDT", "BTC_USDT"];
    const tickers: PublicTicker[] = [
      { instrumentName: "MICRO_USDT", lastPrice: 0.000001, change24h: 0.2, volume24h: 10000000 },
      { instrumentName: "BTC_USDT", lastPrice: 50000, change24h: 0.01, volume24h: 1000000 }
    ];

    const ranked = rankScannerCandidates(instruments, tickers, 5, 0);
    expect(ranked.map((item) => item.instrument)).toEqual(["BTC_USDT"]);
  });

  it("uses candle confirmation to boost near-breakout candidates", () => {
    const instruments = ["AAA_USDT", "BBB_USDT"];
    const tickers: PublicTicker[] = [
      { instrumentName: "AAA_USDT", lastPrice: 10, change24h: 0.03, volume24h: 1000000 },
      { instrumentName: "BBB_USDT", lastPrice: 10, change24h: 0.03, volume24h: 1000000 }
    ];
    const candles: Record<string, Candle[]> = {
      AAA_USDT: [
        { timestamp: 1, open: 9, high: 10, low: 8.9, close: 9.5, volume: 100 },
        { timestamp: 2, open: 9.5, high: 10.1, low: 9.1, close: 9.7, volume: 110 },
        { timestamp: 3, open: 9.7, high: 10.2, low: 9.3, close: 9.9, volume: 105 },
        { timestamp: 4, open: 9.9, high: 10.3, low: 9.4, close: 10.28, volume: 120 },
        { timestamp: 5, open: 10.28, high: 10.35, low: 9.8, close: 10.34, volume: 130 }
      ],
      BBB_USDT: [
        { timestamp: 1, open: 9, high: 9.2, low: 8.9, close: 9, volume: 100 },
        { timestamp: 2, open: 9, high: 9.1, low: 8.8, close: 8.9, volume: 110 },
        { timestamp: 3, open: 8.9, high: 9, low: 8.7, close: 8.8, volume: 105 },
        { timestamp: 4, open: 8.8, high: 8.9, low: 8.6, close: 8.7, volume: 120 },
        { timestamp: 5, open: 8.7, high: 8.8, low: 8.5, close: 8.6, volume: 130 }
      ]
    };

    const ranked = rankScannerCandidates(instruments, tickers, 2, 0, candles, {
      useCandleConfirmation: true,
      lookback: 4
    });
    expect(ranked[0].instrument).toBe("AAA_USDT");
  });

  it("falls back to ticker-only ranking when candle data is missing", () => {
    const instruments: PublicInstrument[] = [
      { instrumentName: "BTC_USDT", quoteCurrency: "USDT", baseCurrency: "BTC" },
      { instrumentName: "ETH_USDT", quoteCurrency: "USDT", baseCurrency: "ETH" }
    ];
    const tickers: PublicTicker[] = [
      { instrumentName: "BTC_USDT", lastPrice: 50000, change24h: 0.01, volume24h: 1000000 },
      { instrumentName: "ETH_USDT", lastPrice: 3000, change24h: 0.03, volume24h: 1100000 }
    ];

    const shortlist = buildScannerShortlist({
      instruments,
      tickers,
      options: {
        quoteFilter: "USDT",
        maxInstruments: 10,
        topN: 2,
        min24hVolume: 0,
        useCandleConfirmation: true,
        lookback: 4
      }
    });

    expect(shortlist).toHaveLength(2);
    expect(shortlist[0].instrument).toBe("ETH_USDT");
  });
});
