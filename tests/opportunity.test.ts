import { describe, expect, it } from "vitest";
import { assessMarketOpportunity } from "../src/reporting/opportunity";

describe("market opportunity assessment", () => {
  it("classifies dead conditions", () => {
    const result = assessMarketOpportunity({
      volatilityPct: 0.001,
      breadthScore: -0.2,
      scannerShortlistCount: 1,
      instrumentCount: 10,
      buySignalCount: 0,
      recentBlockedEntries: 4,
      regime: "RANGE_CHOP",
      regimeConfidence: "LOW"
    });

    expect(result.opportunityState).toBe("DEAD");
    expect(result.opportunityScore).toBeLessThan(3);
    expect(result.opportunityReasons).toContain("low volatility");
  });

  it("classifies normal conditions", () => {
    const result = assessMarketOpportunity({
      volatilityPct: 0.008,
      breadthScore: 0.18,
      scannerShortlistCount: 5,
      instrumentCount: 10,
      buySignalCount: 1,
      recentBlockedEntries: 1,
      regime: "BULL_TREND",
      regimeConfidence: "MEDIUM"
    });

    expect(result.opportunityState).toBe("NORMAL");
    expect(result.opportunityScore).toBeGreaterThanOrEqual(3);
    expect(result.opportunityScore).toBeLessThan(7);
  });

  it("classifies frenzy conditions", () => {
    const result = assessMarketOpportunity({
      volatilityPct: 0.018,
      breadthScore: 0.55,
      scannerShortlistCount: 10,
      instrumentCount: 12,
      buySignalCount: 4,
      recentBlockedEntries: 0,
      regime: "HIGH_VOL_BREAKOUT",
      regimeConfidence: "HIGH"
    });

    expect(result.opportunityState).toBe("FRENZY");
    expect(result.opportunityScore).toBeGreaterThanOrEqual(7);
    expect(result.opportunityReasons).toContain("strong volatility expansion");
  });
});
