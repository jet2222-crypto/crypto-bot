import dotenv from "dotenv";
import { BotConfig } from "../exchange/types";

dotenv.config({ quiet: true });

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value: string | undefined, fallback: number): number {
  const parsed = Math.floor(toNumber(value, fallback));
  return parsed > 0 ? parsed : fallback;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return fallback;
}

function toAlertMode(value: string | undefined): "console" | "webhook" | "telegram" {
  const normalized = (value ?? "console").trim().toLowerCase();
  if (normalized === "webhook" || normalized === "telegram" || normalized === "console") {
    return normalized;
  }
  return "console";
}

function toExecutionMode(value: string | undefined): "paper" | "live" {
  const normalized = (value ?? "paper").trim().toLowerCase();
  return normalized === "live" ? "live" : "paper";
}

function toBoundedNumber(
  value: string | undefined,
  fallback: number,
  minInclusive: number,
  maxInclusive?: number
): number {
  const parsed = toNumber(value, fallback);
  if (parsed < minInclusive) {
    return fallback;
  }
  if (typeof maxInclusive === "number" && parsed > maxInclusive) {
    return fallback;
  }
  return parsed;
}

function parseInstruments(raw: string | undefined): string[] {
  if (!raw) {
    return ["BTC_USDT", "ETH_USDT"];
  }

  const list = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return list.length > 0 ? list : ["BTC_USDT", "ETH_USDT"];
}

function timeframeToMs(timeframe: string): number {
  const match = /^(\d+)([mhd])$/i.exec(timeframe.trim());
  if (!match) {
    return 60_000;
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) {
    return 60_000;
  }
  if (unit === "m") {
    return amount * 60_000;
  }
  if (unit === "h") {
    return amount * 3_600_000;
  }
  return amount * 86_400_000;
}

const timeframe = process.env.TIMEFRAME ?? "1m";
const pollIntervalMs = toInteger(process.env.POLL_INTERVAL_MS, 10000);
const orphanBaseCycles = toInteger(process.env.ORPHAN_POSITION_MAX_UNPRICED_CYCLES, 8);

export const config: BotConfig = {
  executionMode: toExecutionMode(process.env.EXECUTION_MODE),
  liveTradingEnabled: toBoolean(process.env.LIVE_TRADING_ENABLED, false),
  liveExecutionDryRun: toBoolean(process.env.LIVE_EXECUTION_DRY_RUN, true),
  cryptocomApiKey: process.env.CRYPTOCOM_API_KEY,
  cryptocomApiSecret: process.env.CRYPTOCOM_API_SECRET,
  cryptocomExchangePrivateBaseUrl:
    process.env.CRYPTOCOM_EXCHANGE_PRIVATE_BASE_URL?.trim() || "https://api.crypto.com/exchange/v1",
  instruments: parseInstruments(process.env.INSTRUMENTS),
  timeframe,
  lookback: toInteger(process.env.LOOKBACK, 20),
  breakoutVolumeMultiplier: toBoundedNumber(process.env.BREAKOUT_VOLUME_MULTIPLIER, 1.08, 0.1),
  breakoutBufferPct: toBoundedNumber(process.env.BREAKOUT_BUFFER_PCT, 0.001, 0, 0.2),
  minRangePct: toBoundedNumber(process.env.MIN_RANGE_PCT, 0.0018, 0, 0.5),
  useRelaxedEntry: toBoolean(process.env.USE_RELAXED_ENTRY, true),
  atrPeriod: toInteger(process.env.ATR_PERIOD, 14),
  minAtrPct: toBoundedNumber(process.env.MIN_ATR_PCT, 0.0006, 0, 1),
  minVolatilityRangePct: toBoundedNumber(process.env.MIN_VOLATILITY_RANGE_PCT, 0.0025, 0, 1),
  volFilterEnabled: toBoolean(process.env.VOL_FILTER_ENABLED, true),
  stopLossPct: toBoundedNumber(process.env.STOP_LOSS_PCT, 0.01, 0.0001, 0.99),
  takeProfitPct: toBoundedNumber(process.env.TAKE_PROFIT_PCT, 0.02, 0.0001, 10),
  paperStartingCapitalUsd: toBoundedNumber(process.env.PAPER_STARTING_CAPITAL_USD, 5000, 1),
  paperTradeSizeUsd: toBoundedNumber(process.env.PAPER_TRADE_SIZE_USD, 100, 0.01),
  paperSizeMinUsd: toBoundedNumber(process.env.PAPER_SIZE_MIN_USD, 50, 0.01),
  paperSizeMaxUsd: toBoundedNumber(process.env.PAPER_SIZE_MAX_USD, 150, 0.01),
  paperSizeUseDynamic: toBoolean(process.env.PAPER_SIZE_USE_DYNAMIC, true),
  maxOpenPositions: toInteger(process.env.MAX_OPEN_POSITIONS, 3),
  pollIntervalMs,
  enableTrailingStop: toBoolean(process.env.ENABLE_TRAILING_STOP, true),
  trailingStopPct: toBoundedNumber(process.env.TRAILING_STOP_PCT, 0.01, 0.0001, 0.99),
  enableSignalExit: toBoolean(process.env.ENABLE_SIGNAL_EXIT, false),
  scannerEnabled: toBoolean(process.env.SCANNER_ENABLED, false),
  scannerMaxInstruments: toInteger(process.env.SCANNER_MAX_INSTRUMENTS, 200),
  scannerQuoteFilter: (process.env.SCANNER_QUOTE_FILTER ?? "USDT").trim().toUpperCase(),
  scannerTopN: toInteger(process.env.SCANNER_TOP_N, 20),
  scannerMin24hVolume: toBoundedNumber(process.env.SCANNER_MIN_24H_VOLUME, 500000, 0),
  scannerUseCandleConfirmation: toBoolean(process.env.SCANNER_USE_CANDLE_CONFIRMATION, true),
  alertsEnabled: toBoolean(process.env.ALERTS_ENABLED, false),
  alertMode: toAlertMode(process.env.ALERT_MODE),
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  dataCbMaxConsecutiveMockCycles: toInteger(process.env.DATA_CB_MAX_CONSECUTIVE_MOCK_CYCLES, 3),
  dataCbMaxConsecutiveFetchFailureCycles: toInteger(process.env.DATA_CB_MAX_CONSECUTIVE_FETCH_FAILURE_CYCLES, 3),
  dataCbMaxStaleCandleCycles: toInteger(process.env.DATA_CB_MAX_STALE_CANDLE_CYCLES, 2),
  dataCbMaxConsecutivePriceRejectCycles: toInteger(process.env.DATA_CB_MAX_CONSECUTIVE_PRICE_REJECT_CYCLES, 3),
  dataCbHealthyCyclesToClear: toInteger(process.env.DATA_CB_HEALTHY_CYCLES_TO_CLEAR, 2),
  orphanPositionMaxUnpricedCycles: orphanBaseCycles,
  marketDataFreshnessMs: toInteger(
    process.env.MARKET_DATA_FRESHNESS_MS,
    Math.max(timeframeToMs(timeframe) * 2, pollIntervalMs * 4)
  ),
  marketDataHighDisagreementBps: toInteger(process.env.MARKET_DATA_HIGH_DISAGREEMENT_BPS, 30),
  marketDataMediumDisagreementBps: toInteger(process.env.MARKET_DATA_MEDIUM_DISAGREEMENT_BPS, 100),
  orphanWarningCycles: toInteger(process.env.ORPHAN_WARNING_CYCLES, 2),
  orphanStaleCycles: toInteger(process.env.ORPHAN_STALE_CYCLES, 4),
  orphanCycles: toInteger(process.env.ORPHAN_ORPHAN_CYCLES, orphanBaseCycles),
  orphanQuarantineCycles: toInteger(process.env.ORPHAN_QUARANTINE_CYCLES, orphanBaseCycles + 4),
  allowLastGoodPriceMarking: toBoolean(process.env.ALLOW_LAST_GOOD_PRICE_MARKING, true),
  allowLowConfidenceEntries: toBoolean(process.env.ALLOW_LOW_CONFIDENCE_ENTRIES, false),
  minRewardRiskBull: toBoundedNumber(process.env.MIN_REWARD_RISK_BULL, 1.2, 0.1),
  minRewardRiskNeutral: toBoundedNumber(process.env.MIN_REWARD_RISK_NEUTRAL, 1.4, 0.1),
  minTpDistancePct: toBoundedNumber(process.env.MIN_TP_DISTANCE_PCT, 0.0035, 0.0001),
  maxSlDistancePct: toBoundedNumber(process.env.MAX_SL_DISTANCE_PCT, 0.015, 0.0001),
  minCandidateScoreNeutral: toBoundedNumber(process.env.MIN_CANDIDATE_SCORE_NEUTRAL, 3, 0)
};
