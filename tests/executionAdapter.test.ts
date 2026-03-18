import { describe, expect, it } from "vitest";
import { BotConfig } from "../src/exchange/types";
import { createExecutionAdapter } from "../src/execution";

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
  pollIntervalMs: 15000,
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
  alertWebhookUrl: "",
  telegramBotToken: "",
  telegramChatId: "",
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

describe("execution adapter selection", () => {
  it("uses paper adapter by default", () => {
    const adapter = createExecutionAdapter(baseConfig);
    expect(adapter.mode).toBe("paper");
    expect(adapter.liveTradingEnabled).toBe(false);
    expect(adapter.liveExecutionDryRun).toBe(true);
  });

  it("refuses live mode when explicit enable flag is false", () => {
    expect(() =>
      createExecutionAdapter({
        ...baseConfig,
        executionMode: "live",
        liveTradingEnabled: false
      })
    ).toThrow("LIVE_TRADING_ENABLED=true");
  });

  it("refuses live mode when credentials are missing", () => {
    expect(() =>
      createExecutionAdapter({
        ...baseConfig,
        executionMode: "live",
        liveTradingEnabled: true,
        cryptocomApiKey: "",
        cryptocomApiSecret: ""
      })
    ).toThrow("CRYPTOCOM_API_KEY");
  });

  it("selects live adapter only when explicitly enabled with credentials", () => {
    const adapter = createExecutionAdapter({
      ...baseConfig,
      executionMode: "live",
      liveTradingEnabled: true,
      cryptocomApiKey: "key",
      cryptocomApiSecret: "secret"
    });

    expect(adapter.mode).toBe("live");
    expect(adapter.liveTradingEnabled).toBe(true);
    expect(adapter.liveExecutionDryRun).toBe(true);
  });
});
