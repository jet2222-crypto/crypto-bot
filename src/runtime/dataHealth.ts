export type DataHealthObservation = {
  instrumentCount: number;
  mockFallbackCount: number;
  fetchFailureCount: number;
  scannerFailure: boolean;
  priceSafetyRejectCount: number;
  realTrustedCount: number;
  realFreshClosedCount: number;
  nowMs: number;
};

export type DataDegradationState = {
  degraded: boolean;
  entriesPaused: boolean;
  reasons: string[];
  inRecovery: boolean;
  recoveryProgress: {
    current: number;
    required: number;
  };
  counters: {
    consecutiveMockCycles: number;
    consecutiveFetchFailureCycles: number;
    staleCandleCycles: number;
    consecutivePriceRejectCycles: number;
    healthyRecoveryCycles: number;
  };
};

export type DataHealthThresholds = {
  maxConsecutiveMockCycles: number;
  maxConsecutiveFetchFailureCycles: number;
  maxStaleCandleCycles: number;
  maxConsecutivePriceRejectCycles: number;
  healthyCyclesToClear: number;
};

function majorityThreshold(count: number): number {
  return Math.max(1, Math.ceil(count / 2));
}

export class DataHealthCircuitBreaker {
  private consecutiveMockCycles = 0;
  private consecutiveFetchFailureCycles = 0;
  private staleCandleCycles = 0;
  private consecutivePriceRejectCycles = 0;
  private healthyRecoveryCycles = 0;
  private degraded = false;
  private reasons: string[] = [];
  private lastHealthyFreshRealAt: number | null = null;

  constructor(
    private readonly thresholds: DataHealthThresholds,
    private readonly timeframeMs: number,
    private readonly startedAtMs: number
  ) {}

  public observeCycle(input: DataHealthObservation): DataDegradationState {
    const hasMockFallback = input.mockFallbackCount > 0;
    const hasFetchFailure = input.fetchFailureCount > 0 || input.scannerFailure;
    const hasPriceReject = input.priceSafetyRejectCount > 0;
    const majorityTrustedReal =
      input.instrumentCount > 0 && input.realTrustedCount >= majorityThreshold(input.instrumentCount);
    const majorityFreshReal =
      input.instrumentCount > 0 && input.realFreshClosedCount >= majorityThreshold(input.instrumentCount);

    this.consecutiveMockCycles = hasMockFallback ? this.consecutiveMockCycles + 1 : 0;
    this.consecutiveFetchFailureCycles = hasFetchFailure ? this.consecutiveFetchFailureCycles + 1 : 0;
    this.consecutivePriceRejectCycles = hasPriceReject ? this.consecutivePriceRejectCycles + 1 : 0;

    if (majorityFreshReal) {
      this.lastHealthyFreshRealAt = input.nowMs;
      this.staleCandleCycles = 0;
    } else {
      const freshnessAnchor = this.lastHealthyFreshRealAt ?? this.startedAtMs;
      const staleDue = this.timeframeMs > 0 && input.nowMs - freshnessAnchor >= this.timeframeMs;
      this.staleCandleCycles = staleDue ? this.staleCandleCycles + 1 : 0;
    }

    const reasons: string[] = [];
    if (this.consecutiveMockCycles >= this.thresholds.maxConsecutiveMockCycles) {
      reasons.push("MOCK_FALLBACKS");
    }
    if (this.consecutiveFetchFailureCycles >= this.thresholds.maxConsecutiveFetchFailureCycles) {
      reasons.push("FETCH_FAILURES");
    }
    if (this.staleCandleCycles >= this.thresholds.maxStaleCandleCycles) {
      reasons.push("STALE_REAL_CANDLES");
    }
    if (this.consecutivePriceRejectCycles >= this.thresholds.maxConsecutivePriceRejectCycles) {
      reasons.push("PRICE_REJECTIONS");
    }

    const healthyCycle =
      !hasMockFallback &&
      !hasFetchFailure &&
      !hasPriceReject &&
      (input.instrumentCount === 0 || majorityTrustedReal);

    if (reasons.length > 0) {
      this.degraded = true;
      this.reasons = reasons;
      this.healthyRecoveryCycles = 0;
    } else if (this.degraded) {
      this.reasons = [];
      this.healthyRecoveryCycles = healthyCycle ? this.healthyRecoveryCycles + 1 : 0;
      if (this.healthyRecoveryCycles >= this.thresholds.healthyCyclesToClear) {
        this.degraded = false;
        this.reasons = [];
      }
    } else {
      this.healthyRecoveryCycles = healthyCycle ? this.healthyRecoveryCycles + 1 : 0;
      this.reasons = [];
    }

    return this.getState();
  }

  public getState(): DataDegradationState {
    return {
      degraded: this.degraded,
      entriesPaused: this.degraded,
      reasons: [...this.reasons],
      inRecovery: this.degraded && this.reasons.length === 0 && this.healthyRecoveryCycles > 0,
      recoveryProgress: {
        current: this.healthyRecoveryCycles,
        required: this.thresholds.healthyCyclesToClear
      },
      counters: {
        consecutiveMockCycles: this.consecutiveMockCycles,
        consecutiveFetchFailureCycles: this.consecutiveFetchFailureCycles,
        staleCandleCycles: this.staleCandleCycles,
        consecutivePriceRejectCycles: this.consecutivePriceRejectCycles,
        healthyRecoveryCycles: this.healthyRecoveryCycles
      }
    };
  }
}
