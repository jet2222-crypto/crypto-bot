import { describe, expect, it } from "vitest";
import { DataHealthCircuitBreaker } from "../src/runtime/dataHealth";

function createBreaker(): DataHealthCircuitBreaker {
  return new DataHealthCircuitBreaker(
    {
      maxConsecutiveMockCycles: 3,
      maxConsecutiveFetchFailureCycles: 3,
      maxStaleCandleCycles: 2,
      maxConsecutivePriceRejectCycles: 3,
      healthyCyclesToClear: 2
    },
    300_000,
    0
  );
}

describe("data health circuit breaker", () => {
  it("does not overreact to short transient network hiccups", () => {
    const breaker = createBreaker();

    const first = breaker.observeCycle({
      instrumentCount: 4,
      mockFallbackCount: 1,
      fetchFailureCount: 1,
      scannerFailure: false,
      priceSafetyRejectCount: 0,
      realTrustedCount: 0,
      realFreshClosedCount: 0,
      nowMs: 10_000
    });
    const second = breaker.observeCycle({
      instrumentCount: 4,
      mockFallbackCount: 1,
      fetchFailureCount: 1,
      scannerFailure: false,
      priceSafetyRejectCount: 0,
      realTrustedCount: 0,
      realFreshClosedCount: 0,
      nowMs: 20_000
    });
    const recovered = breaker.observeCycle({
      instrumentCount: 4,
      mockFallbackCount: 0,
      fetchFailureCount: 0,
      scannerFailure: false,
      priceSafetyRejectCount: 0,
      realTrustedCount: 4,
      realFreshClosedCount: 0,
      nowMs: 30_000
    });

    expect(first.degraded).toBe(false);
    expect(second.degraded).toBe(false);
    expect(recovered.degraded).toBe(false);
  });

  it("activates degraded mode after sustained failure cycles", () => {
    const breaker = createBreaker();

    breaker.observeCycle({
      instrumentCount: 4,
      mockFallbackCount: 1,
      fetchFailureCount: 1,
      scannerFailure: false,
      priceSafetyRejectCount: 0,
      realTrustedCount: 0,
      realFreshClosedCount: 0,
      nowMs: 10_000
    });
    breaker.observeCycle({
      instrumentCount: 4,
      mockFallbackCount: 1,
      fetchFailureCount: 1,
      scannerFailure: false,
      priceSafetyRejectCount: 0,
      realTrustedCount: 0,
      realFreshClosedCount: 0,
      nowMs: 20_000
    });
    const third = breaker.observeCycle({
      instrumentCount: 4,
      mockFallbackCount: 1,
      fetchFailureCount: 1,
      scannerFailure: false,
      priceSafetyRejectCount: 0,
      realTrustedCount: 0,
      realFreshClosedCount: 0,
      nowMs: 30_000
    });

    expect(third.degraded).toBe(true);
    expect(third.reasons).toContain("MOCK_FALLBACKS");
  });

  it("activates degraded mode after stale real candle cycles beyond timeframe", () => {
    const breaker = createBreaker();

    breaker.observeCycle({
      instrumentCount: 4,
      mockFallbackCount: 0,
      fetchFailureCount: 0,
      scannerFailure: false,
      priceSafetyRejectCount: 0,
      realTrustedCount: 4,
      realFreshClosedCount: 0,
      nowMs: 310_000
    });
    const second = breaker.observeCycle({
      instrumentCount: 4,
      mockFallbackCount: 0,
      fetchFailureCount: 0,
      scannerFailure: false,
      priceSafetyRejectCount: 0,
      realTrustedCount: 4,
      realFreshClosedCount: 0,
      nowMs: 320_000
    });

    expect(second.degraded).toBe(true);
    expect(second.reasons).toContain("STALE_REAL_CANDLES");
  });

  it("recovers after consecutive healthy real-data cycles", () => {
    const breaker = createBreaker();

    breaker.observeCycle({
      instrumentCount: 4,
      mockFallbackCount: 1,
      fetchFailureCount: 1,
      scannerFailure: false,
      priceSafetyRejectCount: 0,
      realTrustedCount: 0,
      realFreshClosedCount: 0,
      nowMs: 10_000
    });
    breaker.observeCycle({
      instrumentCount: 4,
      mockFallbackCount: 1,
      fetchFailureCount: 1,
      scannerFailure: false,
      priceSafetyRejectCount: 0,
      realTrustedCount: 0,
      realFreshClosedCount: 0,
      nowMs: 20_000
    });
    breaker.observeCycle({
      instrumentCount: 4,
      mockFallbackCount: 1,
      fetchFailureCount: 1,
      scannerFailure: false,
      priceSafetyRejectCount: 0,
      realTrustedCount: 0,
      realFreshClosedCount: 0,
      nowMs: 25_000
    });
    const inRecovery = breaker.observeCycle({
      instrumentCount: 4,
      mockFallbackCount: 0,
      fetchFailureCount: 0,
      scannerFailure: false,
      priceSafetyRejectCount: 0,
      realTrustedCount: 4,
      realFreshClosedCount: 0,
      nowMs: 30_000
    });

    const recovered = breaker.observeCycle({
      instrumentCount: 4,
      mockFallbackCount: 0,
      fetchFailureCount: 0,
      scannerFailure: false,
      priceSafetyRejectCount: 0,
      realTrustedCount: 4,
      realFreshClosedCount: 0,
      nowMs: 40_000
    });

    expect(inRecovery.degraded).toBe(true);
    expect(inRecovery.reasons).toEqual([]);
    expect(inRecovery.inRecovery).toBe(true);
    expect(inRecovery.recoveryProgress.current).toBe(1);
    expect(recovered.degraded).toBe(false);
    expect(recovered.entriesPaused).toBe(false);
  });
});
