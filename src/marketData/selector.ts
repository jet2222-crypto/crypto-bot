import {
  MarketDataConfidence,
  MarketDataSnapshot,
  MarketDataSourceInput,
  MarketDataThresholds,
  OrphanStatus
} from "./types";

function isValidPrice(price: number | undefined): price is number {
  return typeof price === "number" && Number.isFinite(price) && price > 0;
}

function toSourceId(source: MarketDataSourceInput | undefined): MarketDataSnapshot["priceSourceUsed"] {
  if (!source) {
    return undefined;
  }
  return `${source.tier}:${source.kind}`;
}

export function calculateDisagreementBps(left?: number, right?: number): number | undefined {
  if (!isValidPrice(left) || !isValidPrice(right)) {
    return undefined;
  }
  return (Math.abs(left - right) / right) * 10_000;
}

function compareConfidence(left: MarketDataConfidence, right: MarketDataConfidence): number {
  const order: Record<MarketDataConfidence, number> = {
    NONE: 0,
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3
  };
  return order[left] - order[right];
}

function deriveOrphanStatus(unpricedCycles: number, thresholds: MarketDataThresholds): OrphanStatus {
  if (unpricedCycles >= thresholds.quarantineCycles) {
    return "QUARANTINED";
  }
  if (unpricedCycles >= thresholds.orphanCycles) {
    return "ORPHAN";
  }
  if (unpricedCycles >= thresholds.orphanStaleCycles) {
    return "STALE";
  }
  if (unpricedCycles >= thresholds.orphanWarningCycles) {
    return "WARNING";
  }
  return "OK";
}

function choosePriceSource(input: {
  primary?: MarketDataSourceInput;
  reference?: MarketDataSourceInput;
  safety?: MarketDataSourceInput;
}): MarketDataSourceInput | undefined {
  if (input.primary && input.primary.fresh && isValidPrice(input.primary.price)) {
    return input.primary;
  }
  if (input.reference && input.reference.fresh && isValidPrice(input.reference.price)) {
    return input.reference;
  }
  if (input.safety && input.safety.fresh && isValidPrice(input.safety.price)) {
    return input.safety;
  }
  return undefined;
}

function determineConfidence(input: {
  chosen?: MarketDataSourceInput;
  disagreementBps?: number;
  thresholds: MarketDataThresholds;
}): MarketDataConfidence {
  const chosen = input.chosen;
  if (!chosen) {
    return "NONE";
  }

  if (chosen.tier === "PRIMARY") {
    if (input.disagreementBps === undefined || input.disagreementBps <= input.thresholds.highDisagreementBps) {
      return "HIGH";
    }
    if (input.disagreementBps <= input.thresholds.mediumDisagreementBps) {
      return "MEDIUM";
    }
    return "LOW";
  }

  if (chosen.tier === "REFERENCE") {
    return chosen.kind === "LAST_GOOD" ? "LOW" : "MEDIUM";
  }

  return "LOW";
}

export function buildMarketDataSnapshot(input: {
  instrument: string;
  primary?: MarketDataSourceInput;
  reference?: MarketDataSourceInput;
  safety?: MarketDataSourceInput;
  previous?: MarketDataSnapshot;
  thresholds: MarketDataThresholds;
}): MarketDataSnapshot {
  const chosen = choosePriceSource({
    primary: input.primary,
    reference: input.reference,
    safety: input.safety
  });
  const disagreementBps = calculateDisagreementBps(input.primary?.price, input.reference?.price);
  const priceConfidence = determineConfidence({
    chosen,
    disagreementBps,
    thresholds: input.thresholds
  });
  const previousUnpricedCycles = input.previous?.unpricedCycles ?? 0;
  const unpricedCycles =
    compareConfidence(priceConfidence, "MEDIUM") >= 0 ? 0 : previousUnpricedCycles + 1;
  const orphanStatus = deriveOrphanStatus(unpricedCycles, input.thresholds);

  const previousLastGoodPrice = input.previous?.lastGoodPrice;
  const previousLastGoodPriceTs = input.previous?.lastGoodPriceTs;
  const previousLastGoodSource = input.previous?.lastGoodSource;
  const chosenSourceUsed = toSourceId(chosen);
  const chosenPrice = chosen?.price;
  const symbolMappingUsed = chosen?.symbolMappingUsed ?? input.primary?.symbolMappingUsed ?? input.instrument;
  const hasGoodCurrentPrice = compareConfidence(priceConfidence, "MEDIUM") >= 0;

  return {
    instrument: input.instrument,
    primaryPrice: input.primary?.price,
    referencePrice: input.reference?.price,
    safetyPrice: input.safety?.price,
    chosenPrice,
    priceSourceUsed: chosenSourceUsed,
    priceConfidence,
    priceDisagreementBps: disagreementBps,
    primaryFresh: input.primary?.fresh ?? false,
    referenceFresh: input.reference?.fresh ?? false,
    safetyFresh: input.safety?.fresh ?? false,
    isStale: priceConfidence === "LOW" || priceConfidence === "NONE" || orphanStatus !== "OK",
    isTradable:
      orphanStatus !== "QUARANTINED" &&
      (priceConfidence === "HIGH" ||
        priceConfidence === "MEDIUM" ||
        (priceConfidence === "LOW" && input.thresholds.allowLowConfidenceEntries)),
    orphanStatus,
    unpricedCycles,
    lastGoodPrice: hasGoodCurrentPrice ? chosenPrice : previousLastGoodPrice,
    lastGoodPriceTs: hasGoodCurrentPrice ? chosen?.timestamp : previousLastGoodPriceTs,
    lastGoodSource: hasGoodCurrentPrice ? chosenSourceUsed : previousLastGoodSource,
    symbolMappingUsed,
    currentSourceKind: chosen?.kind
  };
}
