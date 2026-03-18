export type MarketRegime = "BULL_TREND" | "BEAR_TREND" | "RANGE_CHOP" | "HIGH_VOL_BREAKOUT";
export type RegimeConfidence = "HIGH" | "MEDIUM" | "LOW";

export type RegimePolicy = {
  allowNewEntries: boolean;
  maxOpenPositions: number;
  sizeMultiplier: number;
  tpMultiplier: number;
  stopMultiplier: number;
  requireHighScore: boolean;
  tightenTrailing: boolean;
};

export const REGIME_POLICIES: Record<MarketRegime, RegimePolicy> = {
  BULL_TREND: {
    allowNewEntries: true,
    maxOpenPositions: 4,
    sizeMultiplier: 1.0,
    tpMultiplier: 1.15,
    stopMultiplier: 1.0,
    requireHighScore: false,
    tightenTrailing: false
  },
  BEAR_TREND: {
    allowNewEntries: true,
    maxOpenPositions: 2,
    sizeMultiplier: 0.5,
    tpMultiplier: 0.8,
    stopMultiplier: 0.9,
    requireHighScore: true,
    tightenTrailing: true
  },
  RANGE_CHOP: {
    allowNewEntries: false,
    maxOpenPositions: 2,
    sizeMultiplier: 0.0,
    tpMultiplier: 0.8,
    stopMultiplier: 0.9,
    requireHighScore: true,
    tightenTrailing: true
  },
  HIGH_VOL_BREAKOUT: {
    allowNewEntries: true,
    maxOpenPositions: 2,
    sizeMultiplier: 0.7,
    tpMultiplier: 1.0,
    stopMultiplier: 1.1,
    requireHighScore: true,
    tightenTrailing: true
  }
};
