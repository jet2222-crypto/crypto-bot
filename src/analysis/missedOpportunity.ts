import { Candle } from "../exchange/types";
import { ScannerDecisionTelemetryEntry } from "../telemetry/store";

export type MissedCandidate = ScannerDecisionTelemetryEntry & {
  scannerSelected: true;
  hasOpenPosition: false;
  signal: "HOLD";
  holdReason: "NO_BREAKOUT";
};

export type MissedOpportunityResult = {
  instrument: string;
  decisionAt: string;
  decisionCandleTimestamp: number;
  decisionPrice: number;
  futureCandlesChecked: number;
  maxFavorableMovePct: number;
  maxAdverseMovePct: number;
  breakoutThresholdExceeded: boolean;
  endCloseReturnPct: number;
  profitableAfterWindow: boolean;
  tooSmallOrNoisy: boolean;
  outcome: "MISSED_BREAKOUT" | "SMALL_OR_NOISY" | "FAILED_OR_REVERSED" | "INSUFFICIENT_FUTURE_CANDLES";
};

export type MissedOpportunitySummary = {
  windowHours: number;
  shortlistedReviewed: number;
  notTraded: number;
  breakoutLikeMoves: number;
  profitable: number;
  failedOrNoisy: number;
  conclusion: string;
};

export function selectMissedCandidates(
  rows: ScannerDecisionTelemetryEntry[],
  sinceIso: string,
  untilIso: string
): MissedCandidate[] {
  const sinceMs = Date.parse(sinceIso);
  const untilMs = Date.parse(untilIso);
  return rows.filter((row): row is MissedCandidate => {
    const observedAtMs = Date.parse(row.observedAt);
    return (
      Number.isFinite(observedAtMs) &&
      observedAtMs >= sinceMs &&
      observedAtMs <= untilMs &&
      row.scannerSelected === true &&
      row.hasOpenPosition === false &&
      row.signal === "HOLD" &&
      row.holdReason === "NO_BREAKOUT"
    );
  });
}

export function analyzeMissedOpportunity(input: {
  decision: MissedCandidate;
  candles: Candle[];
  lookback: number;
  breakoutBufferPct: number;
  futureCandlesToCheck?: number;
  minWorthwhileMovePct?: number;
}): MissedOpportunityResult {
  const futureCount = input.futureCandlesToCheck ?? 3;
  const minWorthwhileMovePct = input.minWorthwhileMovePct ?? 0.35;
  const decisionIndex = input.candles.findIndex((candle) => candle.timestamp === input.decision.candleTimestamp);

  if (decisionIndex < 0 || decisionIndex < input.lookback) {
    return {
      instrument: input.decision.instrument,
      decisionAt: input.decision.observedAt,
      decisionCandleTimestamp: input.decision.candleTimestamp,
      decisionPrice: input.decision.latestPrice,
      futureCandlesChecked: 0,
      maxFavorableMovePct: 0,
      maxAdverseMovePct: 0,
      breakoutThresholdExceeded: false,
      endCloseReturnPct: 0,
      profitableAfterWindow: false,
      tooSmallOrNoisy: true,
      outcome: "INSUFFICIENT_FUTURE_CANDLES"
    };
  }

  const comparisonWindow = input.candles.slice(decisionIndex - input.lookback, decisionIndex);
  const futureCandles = input.candles.slice(decisionIndex + 1, decisionIndex + 1 + futureCount);
  if (futureCandles.length === 0) {
    return {
      instrument: input.decision.instrument,
      decisionAt: input.decision.observedAt,
      decisionCandleTimestamp: input.decision.candleTimestamp,
      decisionPrice: input.decision.latestPrice,
      futureCandlesChecked: 0,
      maxFavorableMovePct: 0,
      maxAdverseMovePct: 0,
      breakoutThresholdExceeded: false,
      endCloseReturnPct: 0,
      profitableAfterWindow: false,
      tooSmallOrNoisy: true,
      outcome: "INSUFFICIENT_FUTURE_CANDLES"
    };
  }

  const highestHigh = Math.max(...comparisonWindow.map((candle) => candle.high));
  const breakoutThreshold = highestHigh * (1 + input.breakoutBufferPct);
  const maxHigh = Math.max(...futureCandles.map((candle) => candle.high));
  const minLow = Math.min(...futureCandles.map((candle) => candle.low));
  const finalClose = futureCandles[futureCandles.length - 1].close;
  const decisionPrice = input.decision.latestPrice;
  const maxFavorableMovePct = ((maxHigh - decisionPrice) / decisionPrice) * 100;
  const maxAdverseMovePct = ((minLow - decisionPrice) / decisionPrice) * 100;
  const endCloseReturnPct = ((finalClose - decisionPrice) / decisionPrice) * 100;
  const breakoutThresholdExceeded = maxHigh > breakoutThreshold;
  const profitableAfterWindow = endCloseReturnPct > 0;
  const tooSmallOrNoisy =
    maxFavorableMovePct < minWorthwhileMovePct || Math.abs(endCloseReturnPct) < minWorthwhileMovePct / 2;

  let outcome: MissedOpportunityResult["outcome"] = "FAILED_OR_REVERSED";
  if (breakoutThresholdExceeded && profitableAfterWindow && !tooSmallOrNoisy) {
    outcome = "MISSED_BREAKOUT";
  } else if (tooSmallOrNoisy) {
    outcome = "SMALL_OR_NOISY";
  }

  return {
    instrument: input.decision.instrument,
    decisionAt: input.decision.observedAt,
    decisionCandleTimestamp: input.decision.candleTimestamp,
    decisionPrice,
    futureCandlesChecked: futureCandles.length,
    maxFavorableMovePct,
    maxAdverseMovePct,
    breakoutThresholdExceeded,
    endCloseReturnPct,
    profitableAfterWindow,
    tooSmallOrNoisy,
    outcome
  };
}

export function summarizeMissedOpportunityResults(input: {
  windowHours: number;
  candidatesReviewed: number;
  analyses: MissedOpportunityResult[];
}): MissedOpportunitySummary {
  if (input.candidatesReviewed === 0) {
    return {
      windowHours: input.windowHours,
      shortlistedReviewed: 0,
      notTraded: 0,
      breakoutLikeMoves: 0,
      profitable: 0,
      failedOrNoisy: 0,
      conclusion: "Not enough data yet"
    };
  }

  const breakoutLikeMoves = input.analyses.filter((item) => item.outcome === "MISSED_BREAKOUT").length;
  const profitable = input.analyses.filter((item) => item.profitableAfterWindow).length;
  const failedOrNoisy = input.analyses.filter(
    (item) => item.outcome === "FAILED_OR_REVERSED" || item.outcome === "SMALL_OR_NOISY"
  ).length;

  return {
    windowHours: input.windowHours,
    shortlistedReviewed: input.candidatesReviewed,
    notTraded: input.candidatesReviewed,
    breakoutLikeMoves,
    profitable,
    failedOrNoisy,
    conclusion:
      breakoutLikeMoves === 0
        ? "low opportunity environment or not enough clean follow-through"
        : "some missed breakouts detected"
  };
}
