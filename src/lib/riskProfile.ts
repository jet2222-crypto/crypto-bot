import { MarketDataConfidence } from "../marketData/types";
import { RegimePolicy } from "./regimeConfig";

export type RiskProfile = {
  entryPermitted: boolean;
  usdNotional: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailingStopPct: number;
  reasons: string[];
};

export function buildRiskProfile(input: {
  baseTradeSizeUsd: number;
  baseStopLossPct: number;
  baseTakeProfitPct: number;
  baseTrailingStopPct: number;
  policy: RegimePolicy;
  marketDataConfidence: MarketDataConfidence;
}): RiskProfile {
  const reasons: string[] = [];
  if (!input.policy.allowNewEntries) {
    reasons.push("REGIME_BLOCKED");
  }
  if (input.policy.requireHighScore && input.marketDataConfidence !== "HIGH") {
    reasons.push("HIGH_SCORE_REQUIRED");
  }

  return {
    entryPermitted: reasons.length === 0,
    usdNotional: input.baseTradeSizeUsd * input.policy.sizeMultiplier,
    stopLossPct: input.baseStopLossPct * input.policy.stopMultiplier,
    takeProfitPct: input.baseTakeProfitPct * input.policy.tpMultiplier,
    trailingStopPct: input.policy.tightenTrailing
      ? input.baseTrailingStopPct * 0.8
      : input.baseTrailingStopPct,
    reasons
  };
}
