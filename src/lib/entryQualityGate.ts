import { MarketRegime } from "./regimeConfig";

export type EntryQualityDecision = {
  allowed: boolean;
  reasonBlocked?: "EV_RR_TOO_LOW" | "EV_TP_TOO_SMALL" | "EV_SL_TOO_WIDE" | "EV_SCORE_TOO_LOW";
  rewardRiskRatio: number;
  tpDistancePct: number;
  slDistancePct: number;
};

export function evaluateEntryQuality(input: {
  entryPrice: number;
  stopLossPct: number;
  takeProfitPct: number;
  regime: MarketRegime;
  candidateScore?: number;
  minRewardRiskBull: number;
  minRewardRiskNeutral: number;
  minTpDistancePct: number;
  maxSlDistancePct: number;
  minCandidateScoreNeutral: number;
}): EntryQualityDecision {
  const tpDistancePct = Math.abs(input.takeProfitPct);
  const slDistancePct = Math.abs(input.stopLossPct);
  const rewardRiskRatio = slDistancePct > 0 ? tpDistancePct / slDistancePct : 0;
  const minRewardRisk =
    input.regime === "BULL_TREND" ? input.minRewardRiskBull : input.minRewardRiskNeutral;

  if (rewardRiskRatio < minRewardRisk) {
    return { allowed: false, reasonBlocked: "EV_RR_TOO_LOW", rewardRiskRatio, tpDistancePct, slDistancePct };
  }
  if (tpDistancePct < input.minTpDistancePct) {
    return { allowed: false, reasonBlocked: "EV_TP_TOO_SMALL", rewardRiskRatio, tpDistancePct, slDistancePct };
  }
  if (slDistancePct > input.maxSlDistancePct) {
    return { allowed: false, reasonBlocked: "EV_SL_TOO_WIDE", rewardRiskRatio, tpDistancePct, slDistancePct };
  }
  if (
    input.regime !== "BULL_TREND" &&
    typeof input.candidateScore === "number" &&
    input.candidateScore < input.minCandidateScoreNeutral
  ) {
    return { allowed: false, reasonBlocked: "EV_SCORE_TOO_LOW", rewardRiskRatio, tpDistancePct, slDistancePct };
  }

  return { allowed: true, rewardRiskRatio, tpDistancePct, slDistancePct };
}
