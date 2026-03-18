import { Candle, Signal } from "../exchange/types";
import { isVolatilityHealthy } from "./volatility";

export type BreakoutOptions = {
  breakoutBufferPct: number;
  minRangePct: number;
  useRelaxedEntry: boolean;
  volFilterEnabled: boolean;
  atrPeriod: number;
  minAtrPct: number;
  minVolatilityRangePct: number;
};

export type HoldReason =
  | "NONE"
  | "INSUFFICIENT_DATA"
  | "NO_BREAKOUT"
  | "VOLUME_FAIL"
  | "RANGE_FAIL"
  | "VOLATILITY_FAIL";

export type BreakoutAnalysis = {
  signal: Signal;
  blockedByVolatility: boolean;
  volatility: ReturnType<typeof isVolatilityHealthy>;
  holdReason: HoldReason;
};

function defaultVolatility() {
  return { healthy: true, atr: 0, atrPct: 0, rangePct: 0 };
}

function effectiveVolumeMultiplier(latestPrice: number, baseMultiplier: number, useRelaxedEntry: boolean): number {
  let adjusted = baseMultiplier;

  // Smaller-priced symbols often show bursty relative volume; allow a modest relaxation.
  if (latestPrice < 0.1) {
    adjusted *= 0.9;
  }

  if (useRelaxedEntry) {
    adjusted *= 0.95;
  }

  return Math.max(1.01, adjusted);
}

export function analyzeBreakoutSignal(
  candles: Candle[],
  lookback: number,
  volumeMultiplier: number,
  options?: Partial<BreakoutOptions>
): BreakoutAnalysis {
  const volatility =
    options?.volFilterEnabled
      ? isVolatilityHealthy({
          candles,
          atrPeriod: options.atrPeriod ?? 14,
          minAtrPct: options.minAtrPct ?? 0,
          rangeLookback: lookback,
          minVolatilityRangePct: options.minVolatilityRangePct ?? 0
        })
      : defaultVolatility();

  if (lookback <= 0 || candles.length < lookback + 1) {
    return { signal: "HOLD", blockedByVolatility: false, volatility, holdReason: "INSUFFICIENT_DATA" };
  }

  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const windowStart = candles.length - 1 - lookback;
  const comparisonWindow = candles.slice(windowStart, candles.length - 1);

  const breakoutBufferPct = options?.breakoutBufferPct ?? 0;
  const minRangePct = options?.minRangePct ?? 0;
  const useRelaxedEntry = options?.useRelaxedEntry ?? false;
  const volFilterEnabled = options?.volFilterEnabled ?? false;

  const highestHigh = Math.max(...comparisonWindow.map((candle) => candle.high));
  const lowestLow = Math.min(...comparisonWindow.map((candle) => candle.low));
  const averageVolume =
    comparisonWindow.reduce((sum, candle) => sum + candle.volume, 0) / comparisonWindow.length;
  const rangePct = (highestHigh - lowestLow) / Math.max(latest.close, 1e-9);
  const isRangeExpanded = rangePct >= minRangePct;

  const breakoutThreshold = highestHigh * (1 + breakoutBufferPct);
  const breakdownThreshold = lowestLow * (1 - breakoutBufferPct);
  const isPriceBreakout = latest.close > breakoutThreshold;
  const isBreakdown = latest.close < breakdownThreshold;

  const adaptiveVolumeMultiplier = effectiveVolumeMultiplier(latest.close, volumeMultiplier, useRelaxedEntry);
  const isVolumeConfirmed = latest.volume > averageVolume * adaptiveVolumeMultiplier;
  const relaxedVolumeConfirmed = latest.volume > averageVolume * Math.max(0.95, adaptiveVolumeMultiplier * 0.75);

  const isRelaxedBullishBreak = latest.close > highestHigh && latest.close > previous.close;
  const isRelaxedBearishBreak = latest.close < lowestLow && latest.close < previous.close;

  const strictBuyCandidate = isPriceBreakout;
  const relaxedBuyCandidate = useRelaxedEntry && isRelaxedBullishBreak;
  const buyCandidate = strictBuyCandidate || relaxedBuyCandidate;

  if (buyCandidate) {
    if (relaxedBuyCandidate && !isRangeExpanded) {
      return { signal: "HOLD", blockedByVolatility: false, volatility, holdReason: "RANGE_FAIL" };
    }

    const buyVolumePass = strictBuyCandidate ? isVolumeConfirmed : relaxedVolumeConfirmed;
    if (!buyVolumePass) {
      return { signal: "HOLD", blockedByVolatility: false, volatility, holdReason: "VOLUME_FAIL" };
    }

    if (volFilterEnabled && !volatility.healthy) {
      return { signal: "HOLD", blockedByVolatility: true, volatility, holdReason: "VOLATILITY_FAIL" };
    }

    return { signal: "BUY", blockedByVolatility: false, volatility, holdReason: "NONE" };
  }

  if ((isBreakdown && isVolumeConfirmed) || (useRelaxedEntry && isRangeExpanded && isRelaxedBearishBreak && relaxedVolumeConfirmed)) {
    return { signal: "SELL", blockedByVolatility: false, volatility, holdReason: "NONE" };
  }

  return { signal: "HOLD", blockedByVolatility: false, volatility, holdReason: "NO_BREAKOUT" };
}

export function breakoutSignal(
  candles: Candle[],
  lookback: number,
  volumeMultiplier: number,
  options?: Partial<BreakoutOptions>
): Signal {
  return analyzeBreakoutSignal(candles, lookback, volumeMultiplier, options).signal;
}

export function calculateTradeLevels(
  entryPrice: number,
  stopLossPct: number,
  takeProfitPct: number
): { stopLoss: number; takeProfit: number } {
  const stopLoss = entryPrice * (1 - stopLossPct);
  const takeProfit = entryPrice * (1 + takeProfitPct);

  return { stopLoss, takeProfit };
}
