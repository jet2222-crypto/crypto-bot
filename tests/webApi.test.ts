import { describe, expect, it } from "vitest";
import { BotConfig, JournalEntry } from "../src/exchange/types";
import { buildDashboardPayload, buildSafeConfigSnapshot, buildTradesPayload } from "../src/web/api";

const baseConfig: BotConfig = {
  executionMode: "paper",
  liveTradingEnabled: false,
  liveExecutionDryRun: true,
  cryptocomApiKey: "",
  cryptocomApiSecret: "",
  cryptocomExchangePrivateBaseUrl: "https://api.crypto.com/exchange/v1",
  instruments: ["BTC_USDT"],
  timeframe: "5m",
  lookback: 12,
  breakoutVolumeMultiplier: 1.06,
  stopLossPct: 0.006,
  takeProfitPct: 0.012,
  paperStartingCapitalUsd: 5000,
  paperTradeSizeUsd: 100,
  paperSizeMinUsd: 50,
  paperSizeMaxUsd: 150,
  paperSizeUseDynamic: true,
  maxOpenPositions: 4,
  pollIntervalMs: 15_000,
  enableTrailingStop: true,
  trailingStopPct: 0.005,
  enableSignalExit: true,
  breakoutBufferPct: 0.0008,
  minRangePct: 0.0016,
  useRelaxedEntry: true,
  atrPeriod: 14,
  minAtrPct: 0.0006,
  minVolatilityRangePct: 0.0023,
  volFilterEnabled: true,
  scannerEnabled: true,
  scannerMaxInstruments: 250,
  scannerQuoteFilter: "USDT",
  scannerTopN: 10,
  scannerMin24hVolume: 400000,
  scannerUseCandleConfirmation: true,
  alertsEnabled: false,
  alertMode: "console",
  alertWebhookUrl: "https://example.com/secret-webhook",
  telegramBotToken: "SECRET_TOKEN",
  telegramChatId: "SECRET_CHAT",
  dataCbMaxConsecutiveMockCycles: 3,
  dataCbMaxConsecutiveFetchFailureCycles: 3,
  dataCbMaxStaleCandleCycles: 2,
  dataCbMaxConsecutivePriceRejectCycles: 3,
  dataCbHealthyCyclesToClear: 2,
  orphanPositionMaxUnpricedCycles: 8,
  marketDataFreshnessMs: 600000,
  marketDataHighDisagreementBps: 30,
  marketDataMediumDisagreementBps: 100,
  orphanWarningCycles: 2,
  orphanStaleCycles: 4,
  orphanCycles: 8,
  orphanQuarantineCycles: 12,
  allowLastGoodPriceMarking: true,
  allowLowConfidenceEntries: false,
  minRewardRiskBull: 1.2,
  minRewardRiskNeutral: 1.4,
  minTpDistancePct: 0.0035,
  maxSlDistancePct: 0.015,
  minCandidateScoreNeutral: 3
};

function closed(overrides?: Partial<JournalEntry>): JournalEntry {
  return {
    instrument: "ETH_USDT",
    side: "SELL",
    entryPrice: 100,
    exitPrice: 102,
    quantity: 1,
    openedAt: "2026-03-09T00:00:00.000Z",
    closedAt: "2026-03-09T00:10:00.000Z",
    pnl: 2,
    reason: "TAKE_PROFIT",
    exitReason: "TAKE_PROFIT",
    ...overrides
  };
}

describe("web api helpers", () => {
  it("buildSafeConfigSnapshot omits secrets", () => {
    const safe = buildSafeConfigSnapshot(baseConfig);
    expect(safe.alertMode).toBe("console");
    expect("alertWebhookUrl" in safe).toBe(false);
    expect("telegramBotToken" in safe).toBe(false);
    expect("telegramChatId" in safe).toBe(false);
    expect(safe.dataCbMaxConsecutiveMockCycles).toBe(3);
    expect(safe.marketDataFreshnessMs).toBe(600000);
    expect(safe.paperStartingCapitalUsd).toBe(5000);
    expect(safe.paperSizeUseDynamic).toBe(true);
    expect(safe.liveExecutionDryRun).toBe(true);
  });

  it("buildTradesPayload excludes suspicious by default", () => {
    const payload = buildTradesPayload({
      journalEntries: [
        closed(),
        closed({
          instrument: "NOT_USDT",
          entryPrice: 0.0181,
          exitPrice: 50014.1,
          quantity: 5524.861878453039,
          pnl: 276_326_872
        })
      ],
      expectedPaperTradeSizeUsd: 100,
      includeSuspicious: false,
      limit: 20
    });

    expect(payload.totalClosedTrades).toBe(1);
    expect(payload.excludedSuspiciousCount).toBe(1);
    expect(payload.trades).toHaveLength(1);
    expect(payload.trades[0].suspicious).toBe(false);
  });

  it("buildTradesPayload can include suspicious and mark them", () => {
    const payload = buildTradesPayload({
      journalEntries: [
        closed(),
        closed({
          instrument: "NOT_USDT",
          entryPrice: 0.0181,
          exitPrice: 50014.1,
          quantity: 5524.861878453039,
          pnl: 276_326_872
        })
      ],
      expectedPaperTradeSizeUsd: 100,
      includeSuspicious: true,
      limit: 20
    });

    expect(payload.trades).toHaveLength(2);
    expect(payload.trades.some((trade) => trade.suspicious)).toBe(true);
  });

  it("buildDashboardPayload exposes degraded mode state", () => {
    const payload = buildDashboardPayload({
      runtime: {
        botRunning: true,
        startedAt: "2026-03-10T00:00:00.000Z",
        heartbeatAt: "2026-03-10T00:05:05.000Z",
        lastCycleTimestamp: "2026-03-10T00:05:00.000Z",
        lastCycleDurationMs: 500,
        scannerEnabled: true,
        trailingStopEnabled: true,
        signalExitEnabled: true,
        regimeContext: {
          regime: "BULL_TREND",
          confidence: "HIGH",
          btcPrice: 100000,
          emaFast: 99500,
          emaSlow: 99000,
          emaSpreadPct: 0.005,
          volatilityPct: 0.01,
          breadthScore: 0.4,
          bullScore: 4,
          chopScore: 0,
          reasons: ["BTC_ABOVE_FAST_SLOW"],
          at: "2026-03-10T00:05:00.000Z"
          ,
          candleTimestamp: 123
        },
        regimePolicy: {
          allowNewEntries: true,
          maxOpenPositions: 4,
          sizeMultiplier: 1,
          tpMultiplier: 1.15,
          stopMultiplier: 1,
          requireHighScore: false,
          tightenTrailing: false
        },
        dataDegradation: {
          degraded: true,
          entriesPaused: true,
          reasons: ["FETCH_FAILURES"],
          inRecovery: true,
          recoveryProgress: {
            current: 1,
            required: 2
          },
          counters: {
            consecutiveMockCycles: 0,
            consecutiveFetchFailureCycles: 3,
            staleCandleCycles: 0,
            consecutivePriceRejectCycles: 0,
            healthyRecoveryCycles: 0
          }
        },
        lastCycleScannerShortlist: ["BTC_USDT"],
        openPositionHealthByInstrument: {},
        instrumentRows: [],
        trustedPriceByInstrument: {},
        notes: [],
        cryptoComDiagnostics: {
          cryptoComAuthConfigured: true,
          cryptoComAuthHealthy: true,
          cryptoComCapabilities: {
            balances: true,
            openOrders: false,
            tradeHistory: false
          },
          cryptoComAccountSummaryAvailable: true,
          cryptoComOpenOrdersAvailable: false,
          cryptoComTradeHistoryAvailable: false,
          cryptoComConnectionMessage: "Authenticated connectivity healthy",
          lastAuthenticatedProbeAt: "2026-03-10T00:05:02.000Z",
          warnings: [],
          visibleBalances: [{ asset: "USDT", available: "1000.00", total: "1000.00" }],
          visibleBalanceCount: 1,
          allBalancesZero: false,
          quoteBalanceUsdOrUsdt: "1000.00"
        },
        executionDiagnostics: {
          adapterMode: "paper",
          liveTradingEnabled: false,
          liveExecutionDryRun: true,
          lastSubmissionAttempt: null
        }
      },
      journalEntries: [],
      expectedPaperTradeSizeUsd: 100
    });

    expect(payload.degradedMode).toBe(true);
    expect(payload.entriesPaused).toBe(true);
    expect(payload.degradedReasons).toEqual(["FETCH_FAILURES"]);
    expect(payload.degradedRecoveryActive).toBe(true);
    expect(payload.marketRegime).toBe("BULL_TREND");
    expect(payload.capitalMode).toBe("paper");
    expect(payload.startingCapitalUsd).toBe(5000);
    expect(payload.dynamicSizingEnabled).toBe(true);
    expect(typeof payload.currentEquityUsd).toBe("number");
    expect(payload.cryptoComAuthHealthy).toBe(true);
    expect(payload.cryptoComAccountSummaryAvailable).toBe(true);
    expect(payload.visibleBalanceCount).toBe(1);
    expect(payload.allBalancesZero).toBe(false);
    expect(payload.quoteBalanceUsdOrUsdt).toBe("1000.00");
    expect(typeof payload.opportunityScore).toBe("number");
    expect(["DEAD", "NORMAL", "FRENZY"]).toContain(payload.opportunityState);
    expect(Array.isArray(payload.opportunityReasons)).toBe(true);
  });
});
