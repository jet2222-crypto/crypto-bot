export type PriceSource = "real" | "mock";

export type PriceSafetyResult = {
  trusted: boolean;
  allowEntry: boolean;
  allowExit: boolean;
  reason: "OK" | "MISSING_REFERENCE" | "MOCK_DEVIATION_TOO_HIGH";
  deviationPct?: number;
};

export function assessPriceSafety(params: {
  source: PriceSource;
  latestPrice: number;
  referencePrice?: number;
  hasOpenPosition: boolean;
  maxMockDeviationPct?: number;
}): PriceSafetyResult {
  if (params.source === "real") {
    return { trusted: true, allowEntry: true, allowExit: true, reason: "OK" };
  }

  if (!params.referencePrice || !Number.isFinite(params.referencePrice) || params.referencePrice <= 0) {
    return {
      trusted: false,
      allowEntry: false,
      allowExit: !params.hasOpenPosition ? false : false,
      reason: "MISSING_REFERENCE"
    };
  }

  const maxDeviationPct = params.maxMockDeviationPct ?? 0.35;
  const deviationPct = Math.abs(params.latestPrice - params.referencePrice) / params.referencePrice;
  if (deviationPct > maxDeviationPct) {
    return {
      trusted: false,
      allowEntry: false,
      allowExit: false,
      reason: "MOCK_DEVIATION_TOO_HIGH",
      deviationPct
    };
  }

  return {
    trusted: true,
    allowEntry: true,
    allowExit: true,
    reason: "OK",
    deviationPct
  };
}
