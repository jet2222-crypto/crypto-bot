import { PublicInstrument, PublicTicker } from "../exchange/cryptocomRest";
import { Candle } from "../exchange/types";
import { isVolatilityHealthy } from "./volatility";

export type ScannerCandidate = {
  instrument: string;
  score: number;
  change24h: number;
  volume24h: number;
  lastPrice: number;
};

export type ScannerOptions = {
  quoteFilter: string;
  maxInstruments: number;
  topN: number;
  min24hVolume: number;
  useCandleConfirmation: boolean;
  lookback: number;
};

const LEVERAGED_TOKEN_PATTERN = /(UP|DOWN|BULL|BEAR|[235]L|[235]S)$/;
const MIN_EFFECTIVE_PRICE = 0.00001;

function parseInstrumentParts(instrument: string): { base: string; quote: string } | null {
  const upper = instrument.trim().toUpperCase();
  if (!upper.includes("_")) {
    return null;
  }
  const parts = upper.split("_").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const quote = parts[parts.length - 1];
  const base = parts.slice(0, -1).join("_");
  return base && quote ? { base, quote } : null;
}

function isEligibleInstrument(instrument: PublicInstrument, quoteFilter: string): boolean {
  const parts = parseInstrumentParts(instrument.instrumentName);
  if (!parts) {
    return false;
  }

  const quote = instrument.quoteCurrency?.toUpperCase() ?? parts.quote;
  if (quote !== quoteFilter) {
    return false;
  }

  const base = instrument.baseCurrency?.toUpperCase() ?? parts.base;
  if (!base || LEVERAGED_TOKEN_PATTERN.test(base)) {
    return false;
  }

  const name = instrument.instrumentName.toUpperCase();
  if (
    name.includes("PERP") ||
    name.includes("INDEX") ||
    name.includes("MOVE") ||
    name.includes("VOL")
  ) {
    return false;
  }

  return true;
}

function scoreTicker(ticker: PublicTicker): number {
  const change = ticker.change24h ?? 0;
  const volume = ticker.volume24h ?? 0;
  const volumeScore = Math.log10(Math.max(1, volume));
  const momentumScore = change * 250;
  const downsidePenalty = change < 0 ? Math.abs(change) * 200 : 0;
  const positivePriceBias = ticker.lastPrice > 0 ? 1 : 0;
  return momentumScore - downsidePenalty + volumeScore * 4 + positivePriceBias;
}

function candleConfirmationScore(candles: Candle[], lookback: number): number {
  if (candles.length < lookback + 1 || lookback <= 0) {
    return 0;
  }

  const latest = candles[candles.length - 1];
  const window = candles.slice(candles.length - 1 - lookback, candles.length - 1);
  const highest = Math.max(...window.map((candle) => candle.high));
  const lowest = Math.min(...window.map((candle) => candle.low));
  const breakoutProximity = latest.close / Math.max(highest, 1e-9);
  const volatility = isVolatilityHealthy({
    candles,
    atrPeriod: Math.max(5, Math.floor(lookback / 2)),
    minAtrPct: 0.0001,
    rangeLookback: lookback,
    minVolatilityRangePct: 0.001
  });

  const rangeScore = Math.min(15, volatility.rangePct * 1000);
  const atrScore = Math.min(12, volatility.atrPct * 4000);
  const proximityScore = breakoutProximity >= 1 ? 8 : Math.max(0, (breakoutProximity - 0.985) * 100);
  const healthyBonus = volatility.healthy ? 4 : -6;

  return rangeScore + atrScore + proximityScore + healthyBonus;
}

export function filterScannerInstruments(
  instruments: PublicInstrument[],
  quoteFilter: string,
  maxInstruments: number
): string[] {
  const upperQuote = quoteFilter.trim().toUpperCase();
  const unique = new Set<string>();
  for (const row of instruments) {
    if (!isEligibleInstrument(row, upperQuote)) {
      continue;
    }
    unique.add(row.instrumentName.toUpperCase());
    if (unique.size >= maxInstruments) {
      break;
    }
  }
  return Array.from(unique);
}

export function rankScannerCandidates(
  instruments: string[],
  tickers: PublicTicker[],
  topN: number,
  min24hVolume: number,
  candleByInstrument?: Record<string, Candle[]>,
  options?: { useCandleConfirmation: boolean; lookback: number }
): ScannerCandidate[] {
  const tickerByInstrument = new Map<string, PublicTicker>();
  for (const ticker of tickers) {
    tickerByInstrument.set(ticker.instrumentName.toUpperCase(), ticker);
  }

  const scored: ScannerCandidate[] = [];
  for (const instrument of instruments) {
    const key = instrument.toUpperCase();
    const ticker = tickerByInstrument.get(key);
    if (!ticker) {
      continue;
    }

    const volume24h = ticker.volume24h ?? 0;
    if (volume24h < min24hVolume) {
      continue;
    }
    if (ticker.lastPrice < MIN_EFFECTIVE_PRICE) {
      continue;
    }

    let score = scoreTicker(ticker);
    if (options?.useCandleConfirmation && candleByInstrument?.[key]) {
      score += candleConfirmationScore(candleByInstrument[key], options.lookback);
    }

    const candidate: ScannerCandidate = {
      instrument: key,
      score,
      change24h: ticker.change24h ?? 0,
      volume24h,
      lastPrice: ticker.lastPrice
    };
    scored.push(candidate);
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, topN));
}

export function buildScannerShortlist(params: {
  instruments: PublicInstrument[];
  tickers: PublicTicker[];
  options: ScannerOptions;
  candleByInstrument?: Record<string, Candle[]>;
}): ScannerCandidate[] {
  const filtered = filterScannerInstruments(
    params.instruments,
    params.options.quoteFilter,
    Math.max(1, params.options.maxInstruments)
  );

  return rankScannerCandidates(
    filtered,
    params.tickers,
    Math.max(1, params.options.topN),
    Math.max(0, params.options.min24hVolume),
    params.candleByInstrument,
    {
      useCandleConfirmation: params.options.useCandleConfirmation,
      lookback: Math.max(1, params.options.lookback)
    }
  );
}
