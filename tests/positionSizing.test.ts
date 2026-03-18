import { describe, expect, it } from "vitest";
import { PaperPositionManager } from "../src/risk/limits";
import { computePositionSizing } from "../src/risk/positionSizing";

describe("paper position sizing", () => {
  it("preserves prior fixed-size behavior when dynamic sizing is disabled", () => {
    const result = computePositionSizing({
      baselineUsd: 100,
      existingUsdNotional: 70,
      regime: "BEAR_TREND",
      regimeConfidence: "HIGH",
      candidateScore: 4,
      minUsd: 50,
      maxUsd: 150,
      dynamicSizingEnabled: false
    });

    expect(result.sizingMode).toBe("fixed");
    expect(result.finalSizeUsd).toBe(70);
  });

  it("sizes up in bull trend with high confidence", () => {
    const result = computePositionSizing({
      baselineUsd: 100,
      existingUsdNotional: 100,
      regime: "BULL_TREND",
      regimeConfidence: "HIGH",
      candidateScore: 3,
      minUsd: 50,
      maxUsd: 150,
      dynamicSizingEnabled: true
    });

    expect(result.regimeMultiplier).toBe(1.25);
    expect(result.scoreMultiplier).toBe(1);
    expect(result.finalSizeUsd).toBe(125);
  });

  it("sizes down in bear trend", () => {
    const result = computePositionSizing({
      baselineUsd: 100,
      existingUsdNotional: 50,
      regime: "BEAR_TREND",
      regimeConfidence: "MEDIUM",
      candidateScore: 3,
      minUsd: 50,
      maxUsd: 150,
      dynamicSizingEnabled: true
    });

    expect(result.finalSizeUsd).toBe(50);
  });

  it("sizes down in range chop", () => {
    const result = computePositionSizing({
      baselineUsd: 100,
      existingUsdNotional: 0,
      regime: "RANGE_CHOP",
      regimeConfidence: "LOW",
      candidateScore: 3,
      minUsd: 50,
      maxUsd: 150,
      dynamicSizingEnabled: true
    });

    expect(result.regimeMultiplier).toBe(0.6);
    expect(result.finalSizeUsd).toBe(60);
  });

  it("applies score adjustments", () => {
    const strong = computePositionSizing({
      baselineUsd: 100,
      existingUsdNotional: 100,
      regime: "BULL_TREND",
      regimeConfidence: "MEDIUM",
      candidateScore: 4,
      minUsd: 50,
      maxUsd: 150,
      dynamicSizingEnabled: true
    });
    const weak = computePositionSizing({
      baselineUsd: 100,
      existingUsdNotional: 100,
      regime: "BULL_TREND",
      regimeConfidence: "MEDIUM",
      candidateScore: 1,
      minUsd: 50,
      maxUsd: 150,
      dynamicSizingEnabled: true
    });

    expect(strong.scoreMultiplier).toBe(1.1);
    expect(weak.scoreMultiplier).toBe(0.9);
    expect(strong.finalSizeUsd).toBeGreaterThan(weak.finalSizeUsd);
  });

  it("applies min clamp", () => {
    const result = computePositionSizing({
      baselineUsd: 40,
      existingUsdNotional: 40,
      regime: "BEAR_TREND",
      regimeConfidence: "LOW",
      candidateScore: 1,
      minUsd: 50,
      maxUsd: 150,
      dynamicSizingEnabled: true
    });

    expect(result.finalSizeUsd).toBe(50);
  });

  it("applies max clamp", () => {
    const result = computePositionSizing({
      baselineUsd: 140,
      existingUsdNotional: 140,
      regime: "BULL_TREND",
      regimeConfidence: "HIGH",
      candidateScore: 4,
      minUsd: 50,
      maxUsd: 150,
      dynamicSizingEnabled: true
    });

    expect(result.finalSizeUsd).toBe(150);
  });

  it("uses final size usd to derive quantity", () => {
    const sizing = computePositionSizing({
      baselineUsd: 100,
      existingUsdNotional: 100,
      regime: "BULL_TREND",
      regimeConfidence: "HIGH",
      candidateScore: 4,
      minUsd: 50,
      maxUsd: 150,
      dynamicSizingEnabled: true
    });
    const manager = new PaperPositionManager(5);
    const position = manager.openPaperPosition({
      instrument: "BTC_USDT",
      entryPrice: 100,
      usdNotional: sizing.finalSizeUsd,
      positionSizeUsd: sizing.finalSizeUsd,
      sizingMode: sizing.sizingMode,
      sizingRegimeMultiplier: sizing.regimeMultiplier,
      sizingScoreMultiplier: sizing.scoreMultiplier,
      stopLoss: 95,
      takeProfit: 110,
      openedAt: "2026-03-15T00:00:00.000Z"
    });

    expect(position.quantity).toBe(sizing.finalSizeUsd / 100);
    expect(position.positionSizeUsd).toBe(sizing.finalSizeUsd);
  });
});
