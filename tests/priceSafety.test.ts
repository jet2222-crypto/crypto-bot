import { describe, expect, it } from "vitest";
import { assessPriceSafety } from "../src/strategy/priceSafety";

describe("assessPriceSafety", () => {
  it("rejects absurd mock prices compared with known real reference", () => {
    const result = assessPriceSafety({
      source: "mock",
      latestPrice: 50014.1,
      referencePrice: 0.0181,
      hasOpenPosition: true
    });

    expect(result.trusted).toBe(false);
    expect(result.allowExit).toBe(false);
    expect(result.reason).toBe("MOCK_DEVIATION_TOO_HIGH");
  });

  it("blocks open-position exits when mock reference is missing", () => {
    const result = assessPriceSafety({
      source: "mock",
      latestPrice: 0.02,
      hasOpenPosition: true
    });

    expect(result.trusted).toBe(false);
    expect(result.allowExit).toBe(false);
    expect(result.reason).toBe("MISSING_REFERENCE");
  });

  it("allows normal decision flow for real prices", () => {
    const result = assessPriceSafety({
      source: "real",
      latestPrice: 0.021,
      referencePrice: 0.02,
      hasOpenPosition: true
    });

    expect(result.trusted).toBe(true);
    expect(result.allowEntry).toBe(true);
    expect(result.allowExit).toBe(true);
    expect(result.reason).toBe("OK");
  });
});
