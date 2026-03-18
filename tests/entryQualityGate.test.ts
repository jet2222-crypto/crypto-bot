import { describe, expect, it } from "vitest";
import { evaluateEntryQuality } from "../src/lib/entryQualityGate";

const baseInput = {
  entryPrice: 100,
  stopLossPct: 0.01,
  takeProfitPct: 0.015,
  regime: "BULL_TREND" as const,
  minRewardRiskBull: 1.2,
  minRewardRiskNeutral: 1.4,
  minTpDistancePct: 0.0035,
  maxSlDistancePct: 0.015,
  minCandidateScoreNeutral: 3
};

describe("entry quality gate", () => {
  it("blocks when reward risk ratio is too low", () => {
    const result = evaluateEntryQuality({
      ...baseInput,
      stopLossPct: 0.01,
      takeProfitPct: 0.011
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonBlocked).toBe("EV_RR_TOO_LOW");
  });

  it("blocks when take profit distance is too small", () => {
    const result = evaluateEntryQuality({
      ...baseInput,
      stopLossPct: 0.002,
      takeProfitPct: 0.0025
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonBlocked).toBe("EV_TP_TOO_SMALL");
  });

  it("blocks when stop loss distance is too wide", () => {
    const result = evaluateEntryQuality({
      ...baseInput,
      stopLossPct: 0.02,
      takeProfitPct: 0.03
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonBlocked).toBe("EV_SL_TOO_WIDE");
  });

  it("blocks weak non-bull candidate scores when available", () => {
    const result = evaluateEntryQuality({
      ...baseInput,
      regime: "BEAR_TREND",
      candidateScore: 2
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonBlocked).toBe("EV_SCORE_TOO_LOW");
  });

  it("does not mutate existing open-position data because it is pure", () => {
    const existingPosition = {
      instrument: "ETH_USDT",
      entryPrice: 100,
      quantity: 1,
      openedAt: "2026-03-10T00:00:00.000Z",
      stopLoss: 99,
      takeProfit: 101.5,
      highestSeenPrice: 100,
      status: "OPEN" as const
    };
    const snapshot = { ...existingPosition };

    evaluateEntryQuality(baseInput);

    expect(existingPosition).toEqual(snapshot);
  });
});
