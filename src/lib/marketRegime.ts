import { Candle } from "../exchange/types";
import { MarketRegime, RegimeConfidence } from "./regimeConfig";

export type MarketRegimeContext = {
  regime: MarketRegime;
  confidence: RegimeConfidence;
  btcPrice: number;
  emaFast: number;
  emaSlow: number;
  emaSpreadPct: number;
  volatilityPct: number;
  breadthScore: number;
  bullScore: number;
  chopScore: number;
  reasons: string[];
  at: string;
  candleTimestamp: number;
};

export type MarketRegimeState = {
  active: MarketRegimeContext | null;
  pendingBullCount: number;
  pendingChopCount: number;
  lastCandleTimestamp?: number;
};

export function shouldReuseRegimeSnapshot(
  previousState: MarketRegimeState | undefined,
  candleTimestamp: number
): boolean {
  return previousState?.lastCandleTimestamp !== undefined && previousState.lastCandleTimestamp === candleTimestamp;
}

function ema(values: number[], period: number): number {
  if (values.length === 0) {
    return 0;
  }
  const k = 2 / (period + 1);
  let current = values[0];
  for (let index = 1; index < values.length; index += 1) {
    current = values[index] * k + current * (1 - k);
  }
  return current;
}

function averageAbsoluteMovePct(candles: Candle[], lookback: number): number {
  const window = candles.slice(-lookback);
  if (window.length < 2) {
    return 0;
  }
  let sum = 0;
  for (let index = 1; index < window.length; index += 1) {
    const previousClose = window[index - 1].close;
    if (previousClose <= 0) {
      continue;
    }
    sum += Math.abs(window[index].close - previousClose) / previousClose;
  }
  return sum / Math.max(1, window.length - 1);
}

function breadthScoreFromShortlist(candleByInstrument: Record<string, Candle[]>, instruments: string[]): number {
  const scores: number[] = [];
  for (const instrument of instruments) {
    const candles = candleByInstrument[instrument];
    if (!candles || candles.length < 8) {
      continue;
    }
    const closes = candles.map((candle) => candle.close);
    const latest = closes[closes.length - 1];
    const previous = closes[closes.length - 2];
    const shortEma = ema(closes.slice(-8), 5);
    const aboveShortEma = latest > shortEma ? 1 : -1;
    const positiveMomentum = latest > previous ? 1 : -1;
    scores.push((aboveShortEma + positiveMomentum) / 2);
  }
  if (scores.length === 0) {
    return 0;
  }
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

export function computeMarketRegime(input: {
  btcCandles?: Candle[];
  candleByInstrument: Record<string, Candle[]>;
  shortlistInstruments: string[];
  at: string;
}): MarketRegimeContext {
  const btcCandles = input.btcCandles;
  if (!btcCandles || btcCandles.length < 30) {
    return {
      regime: "RANGE_CHOP",
      confidence: "LOW",
      btcPrice: 0,
      emaFast: 0,
      emaSlow: 0,
      emaSpreadPct: 0,
      volatilityPct: 0,
      breadthScore: 0,
      bullScore: 0,
      chopScore: 3,
      reasons: ["INSUFFICIENT_BTC_DATA"],
      at: input.at,
      candleTimestamp: 0
    };
  }

  const closes = btcCandles.map((candle) => candle.close);
  const btcPrice = closes[closes.length - 1];
  const emaFast = ema(closes.slice(-12), 9);
  const emaSlow = ema(closes.slice(-30), 21);
  const emaSpreadPct = emaSlow > 0 ? (emaFast - emaSlow) / emaSlow : 0;
  const volatilityPct = averageAbsoluteMovePct(btcCandles, 14);
  const breadthScore = breadthScoreFromShortlist(input.candleByInstrument, input.shortlistInstruments);
  const reasons: string[] = [];

  const bullScore =
    (btcPrice > emaFast ? 1 : 0) +
    (emaFast > emaSlow ? 1 : 0) +
    (emaSpreadPct > 0.0015 ? 1 : 0) +
    (breadthScore > 0.25 ? 1 : 0);
  const chopScore =
    (Math.abs(emaSpreadPct) < 0.0012 ? 1 : 0) +
    (Math.abs(breadthScore) < 0.15 ? 1 : 0) +
    (volatilityPct < 0.012 ? 1 : 0);

  let regime: MarketRegime = "RANGE_CHOP";
  let confidence: RegimeConfidence = "LOW";

  if (volatilityPct >= 0.02 && Math.abs(emaSpreadPct) >= 0.003 && Math.abs(breadthScore) >= 0.25) {
    regime = "HIGH_VOL_BREAKOUT";
    confidence = volatilityPct >= 0.03 ? "HIGH" : "MEDIUM";
    reasons.push("ELEVATED_VOLATILITY", "BREADTH_EXPANSION");
  } else if (btcPrice < emaFast && emaFast < emaSlow && breadthScore <= -0.25) {
    regime = "BEAR_TREND";
    confidence = breadthScore <= -0.4 ? "HIGH" : "MEDIUM";
    reasons.push("BTC_BELOW_FAST_SLOW", "NEGATIVE_BREADTH");
  } else if (bullScore >= 4) {
    regime = "BULL_TREND";
    confidence = breadthScore > 0.4 ? "HIGH" : "MEDIUM";
    reasons.push("BTC_ABOVE_FAST_SLOW", "POSITIVE_BREADTH", "TREND_CONFIRMED");
  } else {
    regime = "RANGE_CHOP";
    confidence = chopScore >= 2 ? "MEDIUM" : "LOW";
    reasons.push("MIXED_TREND", "CHOPPY_BREADTH");
  }

  return {
    regime,
    confidence,
    btcPrice,
    emaFast,
    emaSlow,
    emaSpreadPct,
    volatilityPct,
    breadthScore,
    bullScore,
    chopScore,
    reasons,
    at: input.at,
    candleTimestamp: btcCandles[btcCandles.length - 1].timestamp
  };
}

export function stabilizeMarketRegime(
  previousState: MarketRegimeState | undefined,
  nextEvaluation: MarketRegimeContext
): { context: MarketRegimeContext; state: MarketRegimeState } {
  if (!previousState?.active) {
    return {
      context: nextEvaluation,
      state: {
        active: nextEvaluation,
        pendingBullCount: 0,
        pendingChopCount: 0,
        lastCandleTimestamp: nextEvaluation.candleTimestamp
      }
    };
  }

  let active = nextEvaluation;
  let pendingBullCount = 0;
  let pendingChopCount = 0;

  if (previousState.active.regime === "RANGE_CHOP" && nextEvaluation.regime === "BULL_TREND") {
    pendingBullCount = previousState.pendingBullCount + 1;
    if (pendingBullCount < 2) {
      active = { ...nextEvaluation, regime: "RANGE_CHOP", reasons: [...nextEvaluation.reasons, "BULL_PENDING_CONFIRM"] };
    }
  } else if (previousState.active.regime === "BULL_TREND" && nextEvaluation.regime === "RANGE_CHOP") {
    pendingChopCount = previousState.pendingChopCount + 1;
    if (pendingChopCount < 2) {
      active = { ...nextEvaluation, regime: "BULL_TREND", reasons: [...nextEvaluation.reasons, "CHOP_PENDING_CONFIRM"] };
    }
  } else {
    active = nextEvaluation;
  }

  return {
    context: active,
    state: {
      active,
      pendingBullCount,
      pendingChopCount,
      lastCandleTimestamp: nextEvaluation.candleTimestamp
    }
  };
}
