export type MarketDataConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type OrphanStatus = "OK" | "WARNING" | "STALE" | "ORPHAN" | "QUARANTINED";
export type MarketDataSourceTier = "PRIMARY" | "REFERENCE" | "SAFETY";
export type MarketDataSourceKind = "REAL_CANDLE" | "LAST_GOOD" | "MOCK_CANDLE";

export type MarketDataSourceInput = {
  tier: MarketDataSourceTier;
  kind: MarketDataSourceKind;
  price: number;
  timestamp: number;
  fresh: boolean;
  symbolMappingUsed?: string;
};

export type MarketDataSnapshot = {
  instrument: string;
  primaryPrice?: number;
  referencePrice?: number;
  safetyPrice?: number;
  chosenPrice?: number;
  priceSourceUsed?: `${MarketDataSourceTier}:${MarketDataSourceKind}`;
  priceConfidence: MarketDataConfidence;
  priceDisagreementBps?: number;
  primaryFresh: boolean;
  referenceFresh: boolean;
  safetyFresh: boolean;
  isStale: boolean;
  isTradable: boolean;
  orphanStatus: OrphanStatus;
  unpricedCycles: number;
  lastGoodPrice?: number;
  lastGoodPriceTs?: number;
  lastGoodSource?: `${MarketDataSourceTier}:${MarketDataSourceKind}`;
  symbolMappingUsed?: string;
  currentSourceKind?: MarketDataSourceKind;
};

export type MarketDataThresholds = {
  freshnessMs: number;
  highDisagreementBps: number;
  mediumDisagreementBps: number;
  orphanWarningCycles: number;
  orphanStaleCycles: number;
  orphanCycles: number;
  quarantineCycles: number;
  allowLastGoodPriceMarking: boolean;
  allowLowConfidenceEntries: boolean;
};
