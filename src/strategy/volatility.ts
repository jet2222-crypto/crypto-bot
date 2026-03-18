import { Candle } from "../exchange/types";

export type VolatilityHealth = {
  healthy: boolean;
  atr: number;
  atrPct: number;
  rangePct: number;
};

export function calculateTrueRange(candle: Candle, previousClose: number): number {
  const highLow = candle.high - candle.low;
  const highPrevClose = Math.abs(candle.high - previousClose);
  const lowPrevClose = Math.abs(candle.low - previousClose);
  return Math.max(highLow, highPrevClose, lowPrevClose);
}

export function calculateAtr(candles: Candle[], period: number): number {
  if (period <= 0 || candles.length < period + 1) {
    return 0;
  }

  const start = candles.length - period;
  let sumTr = 0;
  for (let i = start; i < candles.length; i += 1) {
    const previousClose = candles[i - 1].close;
    sumTr += calculateTrueRange(candles[i], previousClose);
  }
  return sumTr / period;
}

export function calculateRangePct(candles: Candle[], lookback: number): number {
  if (lookback <= 0 || candles.length < lookback) {
    return 0;
  }

  const window = candles.slice(candles.length - lookback);
  const highest = Math.max(...window.map((candle) => candle.high));
  const lowest = Math.min(...window.map((candle) => candle.low));
  const latestClose = window[window.length - 1].close;
  return (highest - lowest) / Math.max(latestClose, 1e-9);
}

export function isVolatilityHealthy(params: {
  candles: Candle[];
  atrPeriod: number;
  minAtrPct: number;
  rangeLookback: number;
  minVolatilityRangePct: number;
}): VolatilityHealth {
  const atr = calculateAtr(params.candles, params.atrPeriod);
  const latestClose = params.candles.length > 0 ? params.candles[params.candles.length - 1].close : 0;
  const atrPct = atr / Math.max(latestClose, 1e-9);
  const rangePct = calculateRangePct(params.candles, params.rangeLookback);
  const healthy = atrPct >= params.minAtrPct && rangePct >= params.minVolatilityRangePct;

  return {
    healthy,
    atr,
    atrPct,
    rangePct
  };
}
