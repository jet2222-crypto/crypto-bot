import { RegimeConfidence } from "../lib/regimeConfig";

export type PositionSizingDecision = {
  baselineUsd: number;
  regime: string;
  regimeConfidence: RegimeConfidence;
  candidateScore?: number;
  regimeMultiplier: number;
  scoreMultiplier: number;
  unclampedSizeUsd: number;
  finalSizeUsd: number;
  dynamicSizingEnabled: boolean;
  sizingMode: "fixed" | "dynamic";
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function regimeMultiplier(regime: string, confidence: RegimeConfidence): number {
  if (regime === "BULL_TREND") {
    return confidence === "HIGH" ? 1.25 : confidence === "MEDIUM" ? 1.1 : 1.0;
  }
  if (regime === "RANGE_CHOP") {
    return confidence === "HIGH" ? 0.9 : confidence === "MEDIUM" ? 0.75 : 0.6;
  }
  if (regime === "BEAR_TREND") {
    return confidence === "HIGH" ? 0.6 : confidence === "MEDIUM" ? 0.5 : 0.4;
  }
  if (regime === "HIGH_VOL_BREAKOUT") {
    return confidence === "HIGH" ? 1.15 : confidence === "MEDIUM" ? 1.0 : 0.9;
  }
  return 0.75;
}

function scoreMultiplier(candidateScore?: number): number {
  if (typeof candidateScore !== "number") {
    return 1;
  }
  if (candidateScore >= 4) {
    return 1.1;
  }
  if (candidateScore >= 2) {
    return 1.0;
  }
  return 0.9;
}

export function computePositionSizing(input: {
  baselineUsd: number;
  existingUsdNotional: number;
  regime: string;
  regimeConfidence: RegimeConfidence;
  candidateScore?: number;
  minUsd: number;
  maxUsd: number;
  dynamicSizingEnabled: boolean;
}): PositionSizingDecision {
  if (!input.dynamicSizingEnabled) {
    return {
      baselineUsd: input.baselineUsd,
      regime: input.regime,
      regimeConfidence: input.regimeConfidence,
      candidateScore: input.candidateScore,
      regimeMultiplier: 1,
      scoreMultiplier: 1,
      unclampedSizeUsd: input.existingUsdNotional,
      finalSizeUsd: input.existingUsdNotional,
      dynamicSizingEnabled: false,
      sizingMode: "fixed"
    };
  }

  const nextRegimeMultiplier = regimeMultiplier(input.regime, input.regimeConfidence);
  const nextScoreMultiplier = scoreMultiplier(input.candidateScore);
  const unclampedSizeUsd = input.baselineUsd * nextRegimeMultiplier * nextScoreMultiplier;
  const minUsd = Math.min(input.minUsd, input.maxUsd);
  const maxUsd = Math.max(input.minUsd, input.maxUsd);

  return {
    baselineUsd: input.baselineUsd,
    regime: input.regime,
    regimeConfidence: input.regimeConfidence,
    candidateScore: input.candidateScore,
    regimeMultiplier: nextRegimeMultiplier,
    scoreMultiplier: nextScoreMultiplier,
    unclampedSizeUsd,
    finalSizeUsd: clamp(unclampedSizeUsd, minUsd, maxUsd),
    dynamicSizingEnabled: true,
    sizingMode: "dynamic"
  };
}
