import { describe, expect, it } from "vitest";
import { buildRiskProfile } from "../src/lib/riskProfile";
import { REGIME_POLICIES } from "../src/lib/regimeConfig";

describe("risk profile", () => {
  it("scales size and targets for bullish regime", () => {
    const profile = buildRiskProfile({
      baseTradeSizeUsd: 100,
      baseStopLossPct: 0.01,
      baseTakeProfitPct: 0.02,
      baseTrailingStopPct: 0.005,
      policy: REGIME_POLICIES.BULL_TREND,
      marketDataConfidence: "HIGH"
    });

    expect(profile.entryPermitted).toBe(true);
    expect(profile.usdNotional).toBe(100);
    expect(profile.takeProfitPct).toBeCloseTo(0.023);
  });

  it("blocks entries when the regime requires high score and confidence is not high", () => {
    const profile = buildRiskProfile({
      baseTradeSizeUsd: 100,
      baseStopLossPct: 0.01,
      baseTakeProfitPct: 0.02,
      baseTrailingStopPct: 0.005,
      policy: REGIME_POLICIES.BEAR_TREND,
      marketDataConfidence: "MEDIUM"
    });

    expect(profile.entryPermitted).toBe(false);
    expect(profile.reasons).toContain("HIGH_SCORE_REQUIRED");
  });
});
