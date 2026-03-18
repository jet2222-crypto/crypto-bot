import { MarketRegime, RegimeConfidence } from "../lib/regimeConfig";

export type OpportunityState = "DEAD" | "NORMAL" | "FRENZY";

export type OpportunityAssessment = {
  opportunityScore: number;
  opportunityState: OpportunityState;
  opportunityReasons: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function assessMarketOpportunity(input: {
  volatilityPct: number;
  breadthScore: number;
  scannerShortlistCount: number;
  instrumentCount: number;
  buySignalCount: number;
  recentBlockedEntries: number;
  regime: MarketRegime;
  regimeConfidence: RegimeConfidence;
}): OpportunityAssessment {
  const instrumentCount = Math.max(1, input.instrumentCount);
  const buySignalRate = input.buySignalCount / instrumentCount;
  const blockedPressureDenominator = Math.max(1, input.scannerShortlistCount + input.buySignalCount);
  const blockedPressure = input.recentBlockedEntries / blockedPressureDenominator;

  const volatilityScore = clamp((input.volatilityPct / 0.015) * 3, 0, 3);
  const breadthScore = clamp(((input.breadthScore + 0.1) / 0.6) * 2, 0, 2);
  const scannerScore = clamp((input.scannerShortlistCount / 8) * 1.5, 0, 1.5);
  const signalScore = clamp((buySignalRate / 0.25) * 2, 0, 2);
  const confidenceScore =
    input.regimeConfidence === "HIGH" ? 1.5 : input.regimeConfidence === "MEDIUM" ? 0.8 : 0.2;
  const blockedPenalty = clamp(blockedPressure * 1.25, 0, 2.5);
  const chopPenalty = input.regime === "RANGE_CHOP" ? 0.6 : 0;

  const rawScore =
    volatilityScore + breadthScore + scannerScore + signalScore + confidenceScore - blockedPenalty - chopPenalty;
  const opportunityScore = Number(clamp(rawScore, 0, 10).toFixed(1));

  const opportunityState: OpportunityState =
    opportunityScore < 3 ? "DEAD" : opportunityScore < 7 ? "NORMAL" : "FRENZY";

  const reasons: string[] = [];
  if (input.volatilityPct < 0.004) {
    reasons.push("low volatility");
  }
  if (input.breadthScore < 0.1) {
    reasons.push("weak breadth");
  }
  if (blockedPenalty >= 1) {
    reasons.push("frequent blocked signals");
  }
  if (input.volatilityPct >= 0.012) {
    reasons.push("strong volatility expansion");
  }
  if (input.breadthScore >= 0.35) {
    reasons.push("broad scanner participation");
  }
  if (input.regime !== "RANGE_CHOP" && input.regimeConfidence !== "LOW") {
    reasons.push("trend persistence improving");
  }
  if (buySignalRate >= 0.15) {
    reasons.push("more fresh BUY signals");
  }

  return {
    opportunityScore,
    opportunityState,
    opportunityReasons: reasons.slice(0, 4)
  };
}
