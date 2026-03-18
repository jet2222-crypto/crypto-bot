import { sendAlert } from "./alerts";
import { config } from "./config/env";
import { runCryptoComAuthProbe, runCryptoComReadOnlyProbe } from "./diagnostics/cryptocomProbe";
import { createExecutionAdapter } from "./execution";
import { CryptoComPrivateReadOnlyClient } from "./exchange/cryptocomPrivateReadOnly";
import { getCandles, getInstruments, getMockCandles, getTickers } from "./exchange/cryptocomRest";
import { Candle, ExitReason, JournalEntry, Signal } from "./exchange/types";
import { computeDashboardMetrics, renderDashboard } from "./reporting/dashboard";
import {
  appendBlockedEntryTelemetry,
  appendDailySummaryTelemetry,
  appendRegimeEventTelemetry,
  appendScannerDecisionTelemetry,
  appendTradeTelemetry,
  BlockedEntryReason,
  buildDailySummaryFromJournal,
  buildTradeTelemetryFromJournalEntry,
  readBlockedEntryTelemetry
} from "./telemetry/store";
import { BlockedEntryTelemetryDeduper } from "./telemetry/blockedEntryDeduper";
import { evaluateEntryQuality } from "./lib/entryQualityGate";
import {
  computeMarketRegime,
  MarketRegimeContext,
  MarketRegimeState,
  shouldReuseRegimeSnapshot,
  stabilizeMarketRegime
} from "./lib/marketRegime";
import { REGIME_POLICIES } from "./lib/regimeConfig";
import { buildRiskProfile } from "./lib/riskProfile";
import { buildMarketDataSnapshot } from "./marketData/selector";
import { MarketDataConfidence, MarketDataSnapshot, MarketDataSourceInput, OrphanStatus } from "./marketData/types";
import { PaperPositionManager } from "./risk/limits";
import { computePositionSizing } from "./risk/positionSizing";
import { DataHealthCircuitBreaker } from "./runtime/dataHealth";
import { assessPriceSafety, PriceSource } from "./strategy/priceSafety";
import { appendJournalEntry, readJournal } from "./storage/journal";
import { readOpenPositions, writeOpenPositions } from "./storage/openPositions";
import { analyzeBreakoutSignal, calculateTradeLevels } from "./strategy/breakout";
import { buildScannerShortlist, rankScannerCandidates } from "./strategy/scanner";
import { formatPrice } from "./utils/format";
import { error, info, warn } from "./utils/logger";
import { nowIso } from "./utils/time";
import {
  addRuntimeNote,
  initializeRuntimeSnapshot,
  InstrumentSnapshotRow,
  markBotRunning,
  updateCryptoComDiagnostics,
  updateCycleSnapshot
} from "./web/state";

const riskManager = new PaperPositionManager(config.maxOpenPositions);
let cycleRunning = false;
let cycleCount = 0;
let regimeState: MarketRegimeState | undefined;
const lastUsedCandleTimestampByInstrument = new Map<string, number>();
const lastKnownRealCloseByInstrument = new Map<string, number>();
const marketDataStateByInstrument = new Map<string, MarketDataSnapshot>();
const lastBlockedEntryLogByKey = new Map<string, number>();
const lastScannerDecisionTelemetryKeyByInstrument = new Map<string, string>();
const blockedEntryTelemetryDeduper = new BlockedEntryTelemetryDeduper(10 * 60_000, 0.005);
const alertContext = {
  enabled: config.alertsEnabled,
  mode: config.alertMode,
  webhookUrl: config.alertWebhookUrl,
  telegramBotToken: config.telegramBotToken,
  telegramChatId: config.telegramChatId
} as const;

type LoopSummaryRow = InstrumentSnapshotRow & {
  newClosedCandleSincePrevious: boolean;
  hadPreviousCandle: boolean;
  candidateEntryPrice?: number;
};

function emitAlert(input: Parameters<typeof sendAlert>[1]): void {
  void sendAlert(alertContext, input);
}

function appendJournalSafely(entry: JournalEntry, instrument: string, phase: "open" | "close"): void {
  try {
    appendJournalEntry(entry);
  } catch (journalError) {
    warn(
      `Failed to append ${phase} journal entry for ${instrument}: ${
        journalError instanceof Error ? journalError.message : "unknown"
      }`
    );
  }
}

function appendBlockedEntryTelemetrySafely(entry: Parameters<typeof appendBlockedEntryTelemetry>[0]): void {
  try {
    appendBlockedEntryTelemetry(entry);
  } catch (telemetryError) {
    warn(
      `Failed to append blocked-entry telemetry for ${entry.instrument}: ${
        telemetryError instanceof Error ? telemetryError.message : "unknown"
      }`
    );
  }
}

function appendRegimeTelemetrySafely(entry: Parameters<typeof appendRegimeEventTelemetry>[0]): void {
  try {
    appendRegimeEventTelemetry(entry);
  } catch (telemetryError) {
    warn(
      `Failed to append regime telemetry: ${telemetryError instanceof Error ? telemetryError.message : "unknown"}`
    );
  }
}

function appendTradeTelemetrySafely(entry: Parameters<typeof appendTradeTelemetry>[0]): void {
  try {
    appendTradeTelemetry(entry);
  } catch (telemetryError) {
    warn(
      `Failed to append trade telemetry for ${entry.instrument}: ${
        telemetryError instanceof Error ? telemetryError.message : "unknown"
      }`
    );
  }
}

function appendDailySummaryTelemetrySafely(entry: Parameters<typeof appendDailySummaryTelemetry>[0]): void {
  try {
    appendDailySummaryTelemetry(entry);
  } catch (telemetryError) {
    warn(
      `Failed to append daily summary telemetry for ${entry.day}: ${
        telemetryError instanceof Error ? telemetryError.message : "unknown"
      }`
    );
  }
}

function appendScannerDecisionTelemetrySafely(entry: Parameters<typeof appendScannerDecisionTelemetry>[0]): void {
  try {
    appendScannerDecisionTelemetry(entry);
  } catch (telemetryError) {
    warn(
      `Failed to append scanner-decision telemetry for ${entry.instrument}: ${
        telemetryError instanceof Error ? telemetryError.message : "unknown"
      }`
    );
  }
}

function persistOpenPositionsSafely(): void {
  try {
    writeOpenPositions(riskManager.listOpenPositions());
  } catch (storageError) {
    warn(
      `Failed to persist open positions: ${
        storageError instanceof Error ? storageError.message : "unknown"
      }`
    );
  }
}

function shouldLogBlockedEntry(key: string): boolean {
  const previousCycle = lastBlockedEntryLogByKey.get(key) ?? 0;
  if (cycleCount - previousCycle < 3) {
    return false;
  }
  lastBlockedEntryLogByKey.set(key, cycleCount);
  return true;
}

function currentUtcDay(isoString: string): string {
  return isoString.slice(0, 10);
}

function maybeWriteDailySummary(
  cycleStartIso: string,
  dashboardMetrics: ReturnType<typeof computeDashboardMetrics>,
  journalEntries: JournalEntry[]
): void {
  const day = currentUtcDay(cycleStartIso);
  const summary = buildDailySummaryFromJournal({
    day,
    journalEntries,
    blockedEntries: readBlockedEntryTelemetry(),
    unrealizedPnlUsd: dashboardMetrics.unrealizedPnlUsd,
    expectedPaperTradeSizeUsd: config.paperTradeSizeUsd
  });
  appendDailySummaryTelemetrySafely(summary);
}

function maybeAppendScannerDecisionTelemetry(rows: LoopSummaryRow[]): void {
  for (const row of rows) {
    if (!row.scannerSelected) {
      continue;
    }
    const dedupeKey = `${row.candleTimestamp}:${row.signal}:${row.holdReason}:${row.hasOpenPosition ? "1" : "0"}`;
    if (lastScannerDecisionTelemetryKeyByInstrument.get(row.instrument) === dedupeKey) {
      continue;
    }
    lastScannerDecisionTelemetryKeyByInstrument.set(row.instrument, dedupeKey);
    appendScannerDecisionTelemetrySafely({
      observedAt: nowIso(),
      instrument: row.instrument,
      timeframe: config.timeframe,
      scannerSelected: row.scannerSelected,
      hasOpenPosition: row.hasOpenPosition,
      signal: row.signal,
      holdReason: row.holdReason,
      latestPrice: row.latestPrice,
      candleTimestamp: row.candleTimestamp
    });
  }
}

function logBlockedEntry(input: {
  instrument: string;
  signal: Signal;
  regime: MarketRegimeContext["regime"];
  reasonBlocked: string;
  price: number;
  candidateScore?: number;
  volumeQuality?: number;
  rewardRiskRatio?: number;
  tpDistancePct?: number;
  slDistancePct?: number;
}): void {
  const shouldEmit = blockedEntryTelemetryDeduper.shouldEmit(
    {
      instrument: input.instrument,
      signal: input.signal,
      regime: input.regime,
      reasonBlocked: input.reasonBlocked as BlockedEntryReason,
      candidateScore: input.candidateScore,
      price: input.price
    },
    Date.now()
  );
  if (!shouldEmit) {
    return;
  }
  appendBlockedEntryTelemetrySafely({
    at: nowIso(),
    instrument: input.instrument,
    signal: input.signal,
    candidateScore: input.candidateScore,
    regime: input.regime,
    reasonBlocked: input.reasonBlocked as BlockedEntryReason,
    price: input.price,
    volumeQuality: input.volumeQuality,
    rewardRiskRatio: input.rewardRiskRatio,
    tpDistancePct: input.tpDistancePct,
    slDistancePct: input.slDistancePct
  });
}

function orphanStatusRank(status: OrphanStatus): number {
  const order: Record<OrphanStatus, number> = {
    OK: 0,
    WARNING: 1,
    STALE: 2,
    ORPHAN: 3,
    QUARANTINED: 4
  };
  return order[status];
}

function confidenceRank(confidence: MarketDataConfidence): number {
  const order: Record<MarketDataConfidence, number> = {
    NONE: 0,
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3
  };
  return order[confidence];
}

function trackOpenPositionHealth(
  openPositions: ReturnType<typeof riskManager.listOpenPositions>
): Record<string, { unpricedCycles: number; orphaned: boolean }> {
  const healthByInstrument: Record<string, { unpricedCycles: number; orphaned: boolean }> = {};
  for (const position of openPositions) {
    const marketData = marketDataStateByInstrument.get(position.instrument);
    const orphanStatus = marketData?.orphanStatus ?? "OK";
    healthByInstrument[position.instrument] = {
      unpricedCycles: marketData?.unpricedCycles ?? 0,
      orphaned: orphanStatus === "ORPHAN" || orphanStatus === "QUARANTINED"
    };
  }
  return healthByInstrument;
}

function logMarketDataTransition(previous: MarketDataSnapshot | undefined, next: MarketDataSnapshot): void {
  if (previous?.priceSourceUsed !== next.priceSourceUsed && next.priceSourceUsed && next.priceSourceUsed !== "PRIMARY:REAL_CANDLE") {
    info(`[MARKET-DATA] Fallback source used ${next.instrument} source=${next.priceSourceUsed}`);
  }
  if (previous && confidenceRank(next.priceConfidence) < confidenceRank(previous.priceConfidence)) {
    warn(
      `[MARKET-DATA] Confidence downgrade ${next.instrument} ${previous.priceConfidence}->${next.priceConfidence}`
    );
  }
  if (
    typeof next.priceDisagreementBps === "number" &&
    next.priceDisagreementBps > config.marketDataMediumDisagreementBps &&
    (!previous?.priceDisagreementBps || previous.priceDisagreementBps <= config.marketDataMediumDisagreementBps)
  ) {
    warn(
      `[MARKET-DATA] Large source disagreement ${next.instrument} ${next.priceDisagreementBps.toFixed(1)}bps`
    );
  }
  if (previous && orphanStatusRank(next.orphanStatus) > orphanStatusRank(previous.orphanStatus)) {
    warn(`[MARKET-DATA] Orphan escalation ${next.instrument} ${previous.orphanStatus}->${next.orphanStatus}`);
    addRuntimeNote(`Orphan escalation ${next.instrument}: ${next.orphanStatus}`);
  }
  if (next.orphanStatus === "QUARANTINED" && previous?.orphanStatus !== "QUARANTINED") {
    warn(`[MARKET-DATA] Quarantine event ${next.instrument}`);
    addRuntimeNote(`Position quarantined ${next.instrument}`);
  }
}

function restoreOpenPositionsOnStartup(): void {
  try {
    const restored = readOpenPositions();
    riskManager.restoreOpenPositions(restored);
    info(`Restored open positions: ${restored.length}`);
  } catch (restoreError) {
    warn(
      `Failed to restore open positions on startup: ${
        restoreError instanceof Error ? restoreError.message : "unknown"
      }`
    );
  }
}

function printSummary(rows: LoopSummaryRow[]): void {
  console.log("");
  console.log("Instrument       Price        Src  Signal   HoldR OpenPosition Scanner Vol      Candle(UTC)          Closed SameWin");
  console.log("---------------------------------------------------------------------------------------------------------------------");
  for (const row of rows) {
    const instrument = row.instrument.padEnd(15, " ");
    const price = formatPrice(row.latestPrice).padEnd(12, " ");
    const source = row.priceSource.toUpperCase().padEnd(5, " ");
    const signal = row.signal.padEnd(8, " ");
    const holdReason = (row.signal === "HOLD" ? holdReasonCode(row.holdReason) : "-").padEnd(6, " ");
    const openPosition = (row.hasOpenPosition ? "YES" : "NO").padEnd(13, " ");
    const scannerSelected = (config.scannerEnabled ? (row.scannerSelected ? "YES" : "NO") : "N/A").padEnd(
      8,
      " "
    );
    const candleTs = new Date(row.candleTimestamp).toISOString().replace("T", " ").slice(0, 19).padEnd(21, " ");
    const closed = (row.usedClosedCandle ? "YES" : "NO").padEnd(7, " ");
    const sameWin = row.hadPreviousCandle ? (row.sameCandleWindowAsPrevious ? "YES" : "NO") : "N/A";
    console.log(
      `${instrument}${price}${source}${signal}${holdReason}${openPosition}${scannerSelected}${row.volatilityTag.padEnd(
        11,
        " "
      )}${candleTs}${closed}${sameWin}`
    );
  }
}

function holdReasonCode(reason: string): string {
  if (reason === "NO_BREAKOUT") {
    return "NBRK";
  }
  if (reason === "VOLUME_FAIL") {
    return "VOL";
  }
  if (reason === "RANGE_FAIL") {
    return "RNG";
  }
  if (reason === "VOLATILITY_FAIL") {
    return "VFLT";
  }
  if (reason === "INSUFFICIENT_DATA") {
    return "DATA";
  }
  if (reason === "PRICE_UNTRUSTED") {
    return "SAFE";
  }
  return "NA";
}

function timeframeToMs(timeframe: string): number {
  const trimmed = timeframe.trim().toLowerCase();
  const match = /^(\d+)([mhd])$/.exec(trimmed);
  if (!match) {
    return 0;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  if (unit === "m") {
    return amount * 60_000;
  }
  if (unit === "h") {
    return amount * 3_600_000;
  }
  if (unit === "d") {
    return amount * 86_400_000;
  }
  return 0;
}

const dataHealthBreaker = new DataHealthCircuitBreaker(
  {
    maxConsecutiveMockCycles: config.dataCbMaxConsecutiveMockCycles,
    maxConsecutiveFetchFailureCycles: config.dataCbMaxConsecutiveFetchFailureCycles,
    maxStaleCandleCycles: config.dataCbMaxStaleCandleCycles,
    maxConsecutivePriceRejectCycles: config.dataCbMaxConsecutivePriceRejectCycles,
    healthyCyclesToClear: config.dataCbHealthyCyclesToClear
  },
  timeframeToMs(config.timeframe),
  Date.now()
);

function selectAnalysisCandle(candles: Candle[], nowMs: number): { candle: Candle; usedClosedCandle: boolean } {
  if (candles.length === 1) {
    return { candle: candles[0], usedClosedCandle: true };
  }

  const tfMs = timeframeToMs(config.timeframe);
  const latest = candles[candles.length - 1];
  if (tfMs > 0 && nowMs < latest.timestamp + tfMs) {
    return { candle: candles[candles.length - 2], usedClosedCandle: true };
  }

  return { candle: latest, usedClosedCandle: true };
}

function getClosedCandlesForCycle(candles: Candle[], nowMs: number): Candle[] {
  const selected = selectAnalysisCandle(candles, nowMs);
  return candles.filter((candle) => candle.timestamp <= selected.candle.timestamp);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function fetchCandlePacket(
  instrument: string
): Promise<{ instrument: string; candles: Candle[]; source: PriceSource }> {
  try {
    const candles = await getCandles(instrument, config.timeframe);
    return { instrument, candles, source: "real" };
  } catch (fetchError) {
    const reason = fetchError instanceof Error ? fetchError.message : "unknown error";
    const openPosition = riskManager.getOpenPosition(instrument);
    const seedPrice =
      lastKnownRealCloseByInstrument.get(instrument) ??
      openPosition?.entryPrice ??
      undefined;
    warn(
      `[MOCK-FALLBACK] LIVE candles unavailable for ${instrument}. Using bounded mock candles. Reason: ${reason}`
    );
    addRuntimeNote(`Mock fallback used for ${instrument}: ${reason}`);
    emitAlert({
      event: "API_FALLBACK_MOCK",
      title: "Mock candle fallback",
      message: `Using mock candles for ${instrument}`,
      meta: { instrument, reason }
    });
    const candles = getMockCandles(120, instrument, { seedPrice, maxDeviationPct: 0.12 });
    return { instrument, candles, source: "mock" };
  }
}

function evaluateExitReason(params: {
  signal: Signal;
  latestClose: number;
  stopLoss: number;
  takeProfit: number;
  trailingStopPrice: number;
}): ExitReason | null {
  if (params.latestClose <= params.stopLoss) {
    return "STOP_LOSS";
  }
  if (params.latestClose >= params.takeProfit) {
    return "TAKE_PROFIT";
  }
  if (config.enableTrailingStop && params.latestClose <= params.trailingStopPrice) {
    return "TRAILING_STOP";
  }
  if (config.enableSignalExit && params.signal === "SELL") {
    return "SIGNAL_EXIT";
  }
  return null;
}

function closePositionFlow(instrument: string, exitReason: ExitReason, exitPrice: number): void {
  const closed = riskManager.closePosition({
    instrument,
    exitPrice,
    closedAt: nowIso(),
    exitReason
  });
  persistOpenPositionsSafely();

  const exitEntry: JournalEntry = {
    instrument,
    side: "SELL",
    entryPrice: closed.closedPosition.entryPrice,
    exitPrice: closed.exitPrice,
    quantity: closed.closedPosition.quantity,
    positionSizeUsd: closed.closedPosition.positionSizeUsd,
    sizingMode: closed.closedPosition.sizingMode,
    sizingRegimeMultiplier: closed.closedPosition.sizingRegimeMultiplier,
    sizingScoreMultiplier: closed.closedPosition.sizingScoreMultiplier,
    openedAt: closed.closedPosition.openedAt,
    closedAt: closed.closedAt,
    pnl: closed.realizedPnl,
    reason: exitReason,
    exitReason,
    entryRegime: closed.closedPosition.entryRegime,
    entryRegimeConfidence: closed.closedPosition.entryRegimeConfidence,
    entryBreadthScore: closed.closedPosition.entryBreadthScore,
    entryVolatilityPct: closed.closedPosition.entryVolatilityPct,
    entryEmaSpreadPct: closed.closedPosition.entryEmaSpreadPct
  };
  appendJournalSafely(exitEntry, instrument, "close");
  const tradeTelemetry = buildTradeTelemetryFromJournalEntry({
    closedEntry: exitEntry,
    mfeUsd: closed.closedPosition.mfeUsd,
    maeUsd: closed.closedPosition.maeUsd
  });
  if (tradeTelemetry) {
    appendTradeTelemetrySafely(tradeTelemetry);
  }
  info(
    `Position CLOSED ${instrument} reason=${exitReason} entry=${formatPrice(closed.closedPosition.entryPrice)} exit=${formatPrice(closed.exitPrice)} pnl=${formatPrice(closed.realizedPnl)} entryRegime=${closed.closedPosition.entryRegime ?? "N/A"} conf=${closed.closedPosition.entryRegimeConfidence ?? "N/A"}`
  );
  emitAlert({
    event: "POSITION_CLOSED",
    title: "Paper position closed",
    message: `${instrument} closed`,
    meta: {
      instrument,
      exitReason,
      exitPrice: closed.exitPrice.toFixed(4),
      pnl: closed.realizedPnl.toFixed(4)
    }
  });
}

function openPositionFlow(params: {
  instrument: string;
  entryPrice: number;
  usdNotional: number;
  sizingMode: "fixed" | "dynamic";
  sizingRegimeMultiplier: number;
  sizingScoreMultiplier: number;
  stopLossPct: number;
  takeProfitPct: number;
  entryRegime: JournalEntry["entryRegime"];
  entryRegimeConfidence: JournalEntry["entryRegimeConfidence"];
  entryBreadthScore: number;
  entryVolatilityPct: number;
  entryEmaSpreadPct: number;
}): void {
  const levels = calculateTradeLevels(params.entryPrice, params.stopLossPct, params.takeProfitPct);
  const opened = riskManager.openPaperPosition({
    instrument: params.instrument,
    entryPrice: params.entryPrice,
    usdNotional: params.usdNotional,
    positionSizeUsd: params.usdNotional,
    sizingMode: params.sizingMode,
    sizingRegimeMultiplier: params.sizingRegimeMultiplier,
    sizingScoreMultiplier: params.sizingScoreMultiplier,
    stopLoss: levels.stopLoss,
    takeProfit: levels.takeProfit,
    openedAt: nowIso(),
    entryRegime: params.entryRegime,
    entryRegimeConfidence: params.entryRegimeConfidence,
    entryBreadthScore: params.entryBreadthScore,
    entryVolatilityPct: params.entryVolatilityPct,
    entryEmaSpreadPct: params.entryEmaSpreadPct
  });
  persistOpenPositionsSafely();

  const openEntry: JournalEntry = {
    instrument: params.instrument,
    side: "BUY",
    entryPrice: opened.entryPrice,
    quantity: opened.quantity,
    positionSizeUsd: opened.positionSizeUsd,
    sizingMode: opened.sizingMode,
    sizingRegimeMultiplier: opened.sizingRegimeMultiplier,
    sizingScoreMultiplier: opened.sizingScoreMultiplier,
    openedAt: opened.openedAt,
    reason: "BREAKOUT_BUY_SIGNAL",
    entryRegime: opened.entryRegime,
    entryRegimeConfidence: opened.entryRegimeConfidence,
    entryBreadthScore: opened.entryBreadthScore,
    entryVolatilityPct: opened.entryVolatilityPct,
    entryEmaSpreadPct: opened.entryEmaSpreadPct
  };
  appendJournalSafely(openEntry, params.instrument, "open");
  info(
    `Position OPENED ${params.instrument} reason=BREAKOUT_BUY_SIGNAL entry=${formatPrice(opened.entryPrice)} qty=${opened.quantity.toFixed(6)} sizeUsd=${(opened.positionSizeUsd ?? params.usdNotional).toFixed(2)} mode=${opened.sizingMode ?? "fixed"} sl=${formatPrice(opened.stopLoss)} tp=${formatPrice(opened.takeProfit)}`
  );
  emitAlert({
    event: "POSITION_OPENED",
    title: "Paper position opened",
    message: `${params.instrument} opened`,
    meta: {
      instrument: params.instrument,
      entryPrice: opened.entryPrice.toFixed(4),
      quantity: opened.quantity.toFixed(6)
    }
  });
}

async function processInstrument(
  instrument: string,
  priceSource: PriceSource,
  candles: Candle[],
  scannerSelectedInCycle: Set<string>,
  cycleNowMs: number,
  effectiveTrailingStopPct: number
): Promise<LoopSummaryRow> {
  if (candles.length === 0) {
    throw new Error(`No candles available for ${instrument}`);
  }

  const selected = selectAnalysisCandle(candles, cycleNowMs);
  const latest = selected.candle;
  if (!Number.isFinite(latest.close) || latest.close <= 0) {
    throw new Error(`Invalid latest close price for ${instrument}`);
  }

  const previousMarketData = marketDataStateByInstrument.get(instrument);
  const primarySource: MarketDataSourceInput | undefined =
    priceSource === "real"
      ? {
          tier: "PRIMARY",
          kind: "REAL_CANDLE",
          price: latest.close,
          timestamp: latest.timestamp,
          fresh: cycleNowMs - latest.timestamp <= config.marketDataFreshnessMs,
          symbolMappingUsed: instrument
        }
      : undefined;
  const safetySource: MarketDataSourceInput | undefined =
    priceSource === "mock"
      ? {
          tier: "SAFETY",
          kind: "MOCK_CANDLE",
          price: latest.close,
          timestamp: latest.timestamp,
          fresh: cycleNowMs - latest.timestamp <= config.marketDataFreshnessMs,
          symbolMappingUsed: instrument
        }
      : undefined;
  const referenceSource: MarketDataSourceInput | undefined =
    config.allowLastGoodPriceMarking &&
    previousMarketData?.lastGoodPrice !== undefined &&
    previousMarketData.lastGoodPriceTs !== undefined &&
    cycleNowMs - previousMarketData.lastGoodPriceTs <= config.marketDataFreshnessMs
      ? {
          tier: "REFERENCE",
          kind: "LAST_GOOD",
          price: previousMarketData.lastGoodPrice,
          timestamp: previousMarketData.lastGoodPriceTs,
          fresh: true,
          symbolMappingUsed: previousMarketData.symbolMappingUsed ?? instrument
        }
      : undefined;

  const marketData = buildMarketDataSnapshot({
    instrument,
    primary: primarySource,
    reference: referenceSource,
    safety: safetySource,
    previous: previousMarketData,
    thresholds: {
      freshnessMs: config.marketDataFreshnessMs,
      highDisagreementBps: config.marketDataHighDisagreementBps,
      mediumDisagreementBps: config.marketDataMediumDisagreementBps,
      orphanWarningCycles: config.orphanWarningCycles,
      orphanStaleCycles: config.orphanStaleCycles,
      orphanCycles: config.orphanCycles,
      quarantineCycles: config.orphanQuarantineCycles,
      allowLastGoodPriceMarking: config.allowLastGoodPriceMarking,
      allowLowConfidenceEntries: config.allowLowConfidenceEntries
    }
  });
  marketDataStateByInstrument.set(instrument, marketData);
  logMarketDataTransition(previousMarketData, marketData);

  if (priceSource === "real" && marketData.currentSourceKind === "REAL_CANDLE" && marketData.chosenPrice !== undefined) {
    lastKnownRealCloseByInstrument.set(instrument, marketData.chosenPrice);
  }

  const breakout = analyzeBreakoutSignal(candles, config.lookback, config.breakoutVolumeMultiplier, {
    breakoutBufferPct: config.breakoutBufferPct,
    minRangePct: config.minRangePct,
    useRelaxedEntry: config.useRelaxedEntry,
    volFilterEnabled: config.volFilterEnabled,
    atrPeriod: config.atrPeriod,
    minAtrPct: config.minAtrPct,
    minVolatilityRangePct: config.minVolatilityRangePct
  });
  const signal = breakout.signal;
  const volatilityTag = breakout.volatility.healthy
    ? `OK(${(breakout.volatility.atrPct * 100).toFixed(2)}%)`
    : `LOW(${(breakout.volatility.atrPct * 100).toFixed(2)}%)`;

  if (breakout.blockedByVolatility) {
    info(
      `BUY blocked by volatility ${instrument} atrPct=${(breakout.volatility.atrPct * 100).toFixed(
        3
      )}% rangePct=${(breakout.volatility.rangePct * 100).toFixed(3)}%`
    );
  }

  const previousUsedTs = lastUsedCandleTimestampByInstrument.get(instrument);
  const hadPreviousCandle = previousUsedTs !== undefined;
  const sameCandleWindowAsPrevious = previousUsedTs !== undefined && previousUsedTs === latest.timestamp;
  const newClosedCandleSincePrevious =
    previousUsedTs !== undefined ? latest.timestamp > previousUsedTs : false;
  lastUsedCandleTimestampByInstrument.set(instrument, latest.timestamp);

  const openPosition = riskManager.getOpenPosition(instrument);
  const safety = assessPriceSafety({
    source: priceSource,
    latestPrice: marketData.chosenPrice ?? latest.close,
    referencePrice: lastKnownRealCloseByInstrument.get(instrument) ?? openPosition?.entryPrice,
    hasOpenPosition: Boolean(openPosition),
    maxMockDeviationPct: 0.35
  });

  if (!safety.trusted) {
    warn(
      `[PRICE-SAFETY] Ignoring ${priceSource} price for ${instrument}: reason=${safety.reason}${
        safety.deviationPct !== undefined ? ` deviation=${(safety.deviationPct * 100).toFixed(2)}%` : ""
      }`
    );
    addRuntimeNote(`Price safety rejected ${instrument}: ${safety.reason}`);
  }

  if (openPosition) {
    const managementPrice =
      marketData.currentSourceKind === "LAST_GOOD" || marketData.orphanStatus === "QUARANTINED"
        ? undefined
        : marketData.chosenPrice;
    if (!safety.allowExit || managementPrice === undefined || marketData.priceConfidence === "NONE") {
      warn(
        `[PRICE-SAFETY] Skipping exit evaluation for ${instrument} because price data is not trustworthy enough for management.`
      );
    } else {
      const highestState = riskManager.updateHighestSeenPrice(instrument, managementPrice);
      if (highestState.updated) {
        persistOpenPositionsSafely();
      }

      const activePosition = highestState.position ?? openPosition;
      const trailingStopPrice =
        config.enableTrailingStop && activePosition.highestSeenPrice > 0
          ? PaperPositionManager.trailingStopPrice(activePosition.highestSeenPrice, effectiveTrailingStopPct)
          : Number.NEGATIVE_INFINITY;

      const exitReason = evaluateExitReason({
        signal,
        latestClose: managementPrice,
        stopLoss: activePosition.stopLoss,
        takeProfit: activePosition.takeProfit,
        trailingStopPrice
      });

      if (exitReason) {
        closePositionFlow(instrument, exitReason, managementPrice);
      }
    }
  }

  return {
    instrument,
    latestPrice: marketData.chosenPrice ?? Number.NaN,
    signal,
    hasOpenPosition: riskManager.hasOpenPosition(instrument),
    scannerSelected: scannerSelectedInCycle.has(instrument),
    volatilityTag,
    candleTimestamp: latest.timestamp,
    usedClosedCandle: selected.usedClosedCandle,
    sameCandleWindowAsPrevious,
    newClosedCandleSincePrevious,
    hadPreviousCandle,
    holdReason:
      signal === "BUY" && (!safety.allowEntry || !marketData.isTradable || marketData.currentSourceKind === "LAST_GOOD")
        ? "PRICE_UNTRUSTED"
        : breakout.holdReason,
    priceSource,
    trustedForPnl:
      (marketData.priceConfidence === "HIGH" || marketData.priceConfidence === "MEDIUM") &&
      marketData.orphanStatus !== "QUARANTINED",
    marketData,
    candidateEntryPrice:
      signal === "BUY" &&
      safety.allowEntry &&
      marketData.isTradable &&
      marketData.currentSourceKind !== "LAST_GOOD" &&
      !riskManager.hasOpenPosition(instrument)
        ? marketData.chosenPrice
        : undefined
  };
}

async function fetchCandlesBatch(
  instruments: string[]
): Promise<Record<string, { candles: Candle[]; source: PriceSource }>> {
  const start = Date.now();
  const entries = await mapWithConcurrency(instruments, 4, async (instrument) => fetchCandlePacket(instrument));
  const byInstrument: Record<string, { candles: Candle[]; source: PriceSource }> = {};
  for (const entry of entries) {
    byInstrument[entry.instrument] = { candles: entry.candles, source: entry.source };
  }
  info(`Candle fetch batch: ${instruments.length} instruments in ${Date.now() - start}ms`);
  return byInstrument;
}

async function resolveScannerShortlistWithFallback(): Promise<string[]> {
  const [instruments, tickers] = await Promise.all([getInstruments(), getTickers()]);

  const baseShortlist = buildScannerShortlist({
    instruments,
    tickers,
    options: {
      quoteFilter: config.scannerQuoteFilter,
      maxInstruments: config.scannerMaxInstruments,
      topN: config.scannerTopN,
      min24hVolume: config.scannerMin24hVolume,
      useCandleConfirmation: false,
      lookback: config.lookback
    }
  });

  if (!config.scannerUseCandleConfirmation || baseShortlist.length === 0) {
    return baseShortlist.map((item) => item.instrument);
  }

  try {
    const candleByInstrument: Record<string, Candle[]> = {};
    const confirmed = await mapWithConcurrency(baseShortlist, 4, async (candidate) => {
      try {
        const candles = await getCandles(candidate.instrument, config.timeframe);
        return { instrument: candidate.instrument, candles };
      } catch {
        return null;
      }
    });
    for (const item of confirmed) {
      if (item) {
        candleByInstrument[item.instrument] = item.candles;
      }
    }

    if (Object.keys(candleByInstrument).length === 0) {
      warn("Scanner candle confirmation unavailable. Using ticker-only ranking.");
      return baseShortlist.map((item) => item.instrument);
    }

    const reranked = rankScannerCandidates(
      baseShortlist.map((item) => item.instrument),
      tickers,
      config.scannerTopN,
      config.scannerMin24hVolume,
      candleByInstrument,
      {
        useCandleConfirmation: true,
        lookback: config.lookback
      }
    );
    return reranked.map((item) => item.instrument);
  } catch (scannerError) {
    warn(
      `Scanner candle confirmation failed; using ticker-only ranking. Reason: ${
        scannerError instanceof Error ? scannerError.message : "unknown"
      }`
    );
    return baseShortlist.map((item) => item.instrument);
  }
}

async function getLoopInstruments(): Promise<{
  instruments: string[];
  scannerSelected: Set<string>;
  scannerFailed: boolean;
}> {
  const openPositionInstruments = riskManager.listOpenPositions().map((position) => position.instrument);

  if (!config.scannerEnabled) {
    return {
      instruments: Array.from(new Set([...config.instruments, ...openPositionInstruments])),
      scannerSelected: new Set<string>(),
      scannerFailed: false
    };
  }

  try {
    const selected = await resolveScannerShortlistWithFallback();
    if (selected.length === 0) {
      warn("Scanner returned no candidates. Falling back to configured instruments.");
      addRuntimeNote("Scanner returned no candidates; used configured instruments.");
      return {
        instruments: Array.from(new Set([...config.instruments, ...openPositionInstruments])),
        scannerSelected: new Set<string>(),
        scannerFailed: false
      };
    }

    info(`Scanner selected ${selected.length} instruments: ${selected.join(",")}`);
    return {
      instruments: Array.from(new Set([...selected, ...openPositionInstruments])),
      scannerSelected: new Set(selected),
      scannerFailed: false
    };
  } catch (scannerError) {
    warn(
      `Scanner failed, falling back to configured instruments. Reason: ${
        scannerError instanceof Error ? scannerError.message : "unknown"
      }`
    );
    addRuntimeNote("Scanner failed; used configured instruments.");
    return {
      instruments: Array.from(new Set([...config.instruments, ...openPositionInstruments])),
      scannerSelected: new Set<string>(),
      scannerFailed: true
    };
  }
}

function handleDegradedStateTransition(previous: ReturnType<typeof dataHealthBreaker.getState>, next: ReturnType<typeof dataHealthBreaker.getState>): void {
  if (!previous.degraded && next.degraded) {
    const reasonText = next.reasons.join(",");
    warn(`[DATA-CB] Degraded mode ON. New entries paused. reasons=${reasonText}`);
    addRuntimeNote(`Degraded mode ON: ${reasonText}`);
    emitAlert({
      event: "DEGRADED_MODE_ON",
      title: "Degraded data mode enabled",
      message: "New paper entries paused",
      meta: { reasons: reasonText }
    });
  } else if (previous.degraded && !previous.inRecovery && next.inRecovery) {
    info(
      `[DATA-CB] Recovery in progress ${next.recoveryProgress.current}/${next.recoveryProgress.required}.`
    );
  } else if (previous.degraded && !next.degraded) {
    info("[DATA-CB] Degraded mode cleared. New entries resumed.");
    addRuntimeNote("Degraded mode cleared: healthy real data resumed.");
    emitAlert({
      event: "DEGRADED_MODE_OFF",
      title: "Degraded data mode cleared",
      message: "New paper entries resumed"
    });
  }
}

async function runCycle(): Promise<void> {
  if (cycleRunning) {
    warn("Previous cycle still running; skipping this interval tick.");
    return;
  }

  cycleRunning = true;
  cycleCount += 1;
  const cycleStartIso = nowIso();
  const cycleStart = Date.now();
  try {
    info(`Cycle #${cycleCount} start ${cycleStartIso}`);
    const selection = await getLoopInstruments();
    const cycleInstruments = selection.instruments.includes("BTC_USDT")
      ? selection.instruments
      : [...selection.instruments, "BTC_USDT"];
    const candlesByInstrument = await fetchCandlesBatch(cycleInstruments);
    const closedCandleByInstrument = Object.fromEntries(
      Object.entries(candlesByInstrument).map(([instrument, packet]) => [
        instrument,
        getClosedCandlesForCycle(packet.candles, cycleStart)
      ])
    );
    const btcClosedCandles = closedCandleByInstrument.BTC_USDT ?? closedCandleByInstrument["BTCUSD-PERP"];
    const btcRegimeTimestamp =
      btcClosedCandles && btcClosedCandles.length > 0 ? btcClosedCandles[btcClosedCandles.length - 1].timestamp : 0;
    const reusedRegime = shouldReuseRegimeSnapshot(regimeState, btcRegimeTimestamp);
    const existingRegimeContext = regimeState?.active;
    const regimeContext =
      reusedRegime
        ? existingRegimeContext ?? computeMarketRegime({
            btcCandles: btcClosedCandles,
            candleByInstrument: closedCandleByInstrument,
            shortlistInstruments:
              selection.scannerSelected.size > 0 ? Array.from(selection.scannerSelected) : selection.instruments,
            at: cycleStartIso
          })
        : (() => {
            const rawRegime = computeMarketRegime({
              btcCandles: btcClosedCandles,
              candleByInstrument: closedCandleByInstrument,
              shortlistInstruments:
                selection.scannerSelected.size > 0 ? Array.from(selection.scannerSelected) : selection.instruments,
              at: cycleStartIso
            });
            const stabilized = stabilizeMarketRegime(regimeState, rawRegime);
            regimeState = stabilized.state;
            return stabilized.context;
          })();
    const regimePolicy = REGIME_POLICIES[regimeContext.regime];
    if (!reusedRegime) {
      appendRegimeTelemetrySafely({
        at: regimeContext.at,
        btcClosedCandleTime: regimeContext.candleTimestamp,
        regime: regimeContext.regime,
        confidence: regimeContext.confidence,
        btcPrice: regimeContext.btcPrice,
        emaFast: regimeContext.emaFast,
        emaSlow: regimeContext.emaSlow,
        emaSpreadPct: regimeContext.emaSpreadPct,
        volatilityPct: regimeContext.volatilityPct,
        breadthScore: regimeContext.breadthScore,
        bullScore: regimeContext.bullScore,
        chopScore: regimeContext.chopScore,
        reasons: regimeContext.reasons
      });
    }
    info(
      `[REGIME] reused=${reusedRegime ? "true" : "false"} regime=${regimeContext.regime} conf=${
        regimeContext.confidence
      } btc=${regimeContext.btcPrice.toFixed(
        2
      )} emaFast=${regimeContext.emaFast.toFixed(2)} emaSlow=${regimeContext.emaSlow.toFixed(
        2
      )} emaSpreadPct=${(regimeContext.emaSpreadPct * 100).toFixed(3)} volatilityPct=${(
        regimeContext.volatilityPct * 100
      ).toFixed(3)} breadth=${regimeContext.breadthScore.toFixed(3)} bull=${regimeContext.bullScore} chop=${
        regimeContext.chopScore
      } reasons=${regimeContext.reasons.join(",")}`
    );
    const rows: LoopSummaryRow[] = [];
    for (const instrument of selection.instruments) {
      const candlePacket = candlesByInstrument[instrument];
      const row = await processInstrument(
        instrument,
        candlePacket?.source ?? "mock",
        candlePacket?.candles ?? getMockCandles(120, instrument),
        selection.scannerSelected,
        cycleStart,
        regimePolicy.tightenTrailing ? config.trailingStopPct * 0.8 : config.trailingStopPct
      );
      rows.push(row);
    }
    const comparableRows = rows.filter((row) => row.hadPreviousCandle);
    const instrumentsWithNewClosed = comparableRows.filter((row) => row.newClosedCandleSincePrevious).length;
    if (rows.length > 0 && comparableRows.length === 0) {
      info("Cycle candle status: initial baseline established (first observed closed candles).");
    } else if (rows.length > 0) {
      info(
        `Cycle candle status: ${
          instrumentsWithNewClosed > 0
            ? `${instrumentsWithNewClosed}/${comparableRows.length} instruments have new closed candles`
            : "still within same closed-candle window as previous cycle"
        }`
      );
    }

    if (cycleCount % 3 === 0) {
      const holdSamples = rows
        .filter((row) => row.signal === "HOLD" && row.newClosedCandleSincePrevious)
        .slice(0, 2);
      for (const sample of holdSamples) {
        info(`HOLD sample ${sample.instrument} reason=${sample.holdReason} vol=${sample.volatilityTag}`);
      }
    }
    printSummary(rows);

    const trustedPriceByInstrument: Record<string, number> = {};
    for (const row of rows) {
      if (row.trustedForPnl) {
        trustedPriceByInstrument[row.instrument] = row.latestPrice;
      }
    }

    const previousDegradation = dataHealthBreaker.getState();
    const currentDegradation = dataHealthBreaker.observeCycle({
      instrumentCount: rows.length,
      mockFallbackCount: rows.filter((row) => row.priceSource === "mock").length,
      fetchFailureCount: rows.filter((row) => row.priceSource === "mock").length,
      scannerFailure: selection.scannerFailed,
      priceSafetyRejectCount: rows.filter((row) => !row.trustedForPnl).length,
      realTrustedCount: rows.filter((row) => row.priceSource === "real" && row.trustedForPnl).length,
      realFreshClosedCount: rows.filter((row) => row.priceSource === "real" && row.newClosedCandleSincePrevious).length,
      nowMs: cycleStart
    });
    handleDegradedStateTransition(previousDegradation, currentDegradation);

    for (const row of rows) {
      if (row.candidateEntryPrice === undefined) {
        continue;
      }
      if (currentDegradation.entriesPaused) {
        info(`Entry blocked by degraded mode ${row.instrument} price=${formatPrice(row.candidateEntryPrice)}`);
        continue;
      }
      const riskProfile = buildRiskProfile({
        baseTradeSizeUsd: config.paperTradeSizeUsd,
        baseStopLossPct: config.stopLossPct,
        baseTakeProfitPct: config.takeProfitPct,
        baseTrailingStopPct: config.trailingStopPct,
        policy: regimePolicy,
        marketDataConfidence: row.marketData.priceConfidence
      });
      const effectiveMaxOpenPositions = Math.min(config.maxOpenPositions, regimePolicy.maxOpenPositions);
      if (!riskProfile.entryPermitted) {
        const blockReason = riskProfile.reasons.join(",");
        logBlockedEntry({
          instrument: row.instrument,
          signal: row.signal,
          regime: regimeContext.regime,
          reasonBlocked: riskProfile.reasons[0] ?? "REGIME_BLOCKED",
          price: row.candidateEntryPrice,
          candidateScore: regimeContext.bullScore
        });
        if (shouldLogBlockedEntry(`${row.instrument}:${regimeContext.regime}:${blockReason}`)) {
          info(
            `Entry blocked instrument=${row.instrument} signal=${row.signal} conf=${row.marketData.priceConfidence} regime=${regimeContext.regime} bull=${regimeContext.bullScore} chop=${regimeContext.chopScore} reasonBlocked=${blockReason}`
          );
        }
        continue;
      }
      if (riskManager.hasOpenPosition(row.instrument)) {
        logBlockedEntry({
          instrument: row.instrument,
          signal: row.signal,
          regime: regimeContext.regime,
          reasonBlocked: "DUPLICATE_OPEN_POSITION",
          price: row.candidateEntryPrice,
          candidateScore: regimeContext.bullScore
        });
        continue;
      }
      if (riskManager.listOpenPositions().length >= effectiveMaxOpenPositions) {
        logBlockedEntry({
          instrument: row.instrument,
          signal: row.signal,
          regime: regimeContext.regime,
          reasonBlocked: "MAX_OPEN_POSITIONS",
          price: row.candidateEntryPrice,
          candidateScore: regimeContext.bullScore
        });
        continue;
      }
      const qualityGate = evaluateEntryQuality({
        entryPrice: row.candidateEntryPrice,
        stopLossPct: riskProfile.stopLossPct,
        takeProfitPct: riskProfile.takeProfitPct,
        regime: regimeContext.regime,
        candidateScore: regimeContext.bullScore,
        minRewardRiskBull: config.minRewardRiskBull,
        minRewardRiskNeutral: config.minRewardRiskNeutral,
        minTpDistancePct: config.minTpDistancePct,
        maxSlDistancePct: config.maxSlDistancePct,
        minCandidateScoreNeutral: config.minCandidateScoreNeutral
      });
      if (!qualityGate.allowed) {
        logBlockedEntry({
          instrument: row.instrument,
          signal: row.signal,
          regime: regimeContext.regime,
          reasonBlocked: qualityGate.reasonBlocked ?? "EV_RR_TOO_LOW",
          price: row.candidateEntryPrice,
          candidateScore: regimeContext.bullScore,
          rewardRiskRatio: qualityGate.rewardRiskRatio,
          tpDistancePct: qualityGate.tpDistancePct,
          slDistancePct: qualityGate.slDistancePct
        });
        if (shouldLogBlockedEntry(`${row.instrument}:${regimeContext.regime}:${qualityGate.reasonBlocked}`)) {
          info(
            `Entry blocked instrument=${row.instrument} signal=${row.signal} regime=${regimeContext.regime} reasonBlocked=${qualityGate.reasonBlocked} rr=${qualityGate.rewardRiskRatio.toFixed(2)} tpPct=${(qualityGate.tpDistancePct * 100).toFixed(2)} slPct=${(qualityGate.slDistancePct * 100).toFixed(2)}`
          );
        }
        continue;
      }
      const sizingDecision = computePositionSizing({
        baselineUsd: config.paperTradeSizeUsd,
        existingUsdNotional: riskProfile.usdNotional,
        regime: regimeContext.regime,
        regimeConfidence: regimeContext.confidence,
        candidateScore: regimeContext.bullScore,
        minUsd: config.paperSizeMinUsd,
        maxUsd: config.paperSizeMaxUsd,
        dynamicSizingEnabled: config.paperSizeUseDynamic
      });
      if (sizingDecision.finalSizeUsd <= 0) {
        continue;
      }
      openPositionFlow({
        instrument: row.instrument,
        entryPrice: row.candidateEntryPrice,
        usdNotional: sizingDecision.finalSizeUsd,
        sizingMode: sizingDecision.sizingMode,
        sizingRegimeMultiplier: sizingDecision.regimeMultiplier,
        sizingScoreMultiplier: sizingDecision.scoreMultiplier,
        stopLossPct: riskProfile.stopLossPct,
        takeProfitPct: riskProfile.takeProfitPct,
        entryRegime: regimeContext.regime,
        entryRegimeConfidence: regimeContext.confidence,
        entryBreadthScore: regimeContext.breadthScore,
        entryVolatilityPct: regimeContext.volatilityPct,
        entryEmaSpreadPct: regimeContext.emaSpreadPct
      });
      row.hasOpenPosition = true;
    }

    const openPositionHealthByInstrument = trackOpenPositionHealth(riskManager.listOpenPositions());

    const journalEntries = readJournal();
    const dashboardMetrics = computeDashboardMetrics({
      openPositions: riskManager.listOpenPositions(),
      journalEntries,
      trustedPriceByInstrument,
      lastCycleScannerCount: selection.scannerSelected.size,
      lastCycleTimestamp: cycleStartIso,
      scannerEnabled: config.scannerEnabled,
      trailingStopEnabled: config.enableTrailingStop,
      signalExitEnabled: config.enableSignalExit,
      marketRegime: regimeContext.regime,
      marketRegimeConfidence: regimeContext.confidence,
      marketRegimePolicy: regimePolicy,
      dataDegradation: currentDegradation,
      openPositionHealthByInstrument,
      instrumentMarketData: rows.map((row) => row.marketData),
      largeDisagreementThresholdBps: config.marketDataMediumDisagreementBps,
      expectedPaperTradeSizeUsd: config.paperTradeSizeUsd,
      paperStartingCapitalUsd: config.paperStartingCapitalUsd,
      paperSizeUseDynamic: config.paperSizeUseDynamic
    });
    maybeWriteDailySummary(cycleStartIso, dashboardMetrics, journalEntries);
    maybeAppendScannerDecisionTelemetry(rows);
    console.log(renderDashboard(dashboardMetrics));
    updateCycleSnapshot({
      cycleTimestampIso: cycleStartIso,
      cycleDurationMs: Date.now() - cycleStart,
      scannerShortlist: Array.from(selection.scannerSelected),
      rows,
      regimeContext,
      regimePolicy,
      dataDegradation: currentDegradation,
      openPositionHealthByInstrument
    });
  } catch (cycleError) {
    const reason = cycleError instanceof Error ? cycleError.message : "unknown";
    error(`Unexpected cycle error: ${reason}`);
    addRuntimeNote(`Runtime cycle error: ${reason}`);
    emitAlert({
      event: "RUNTIME_ERROR",
      title: "Runtime cycle error",
      message: reason
    });
  } finally {
    info(`Cycle duration: ${Date.now() - cycleStart}ms`);
    cycleRunning = false;
  }
}

export function startBot(): void {
  const executionAdapter = createExecutionAdapter(config);
  restoreOpenPositionsOnStartup();
  initializeRuntimeSnapshot({
    scannerEnabled: config.scannerEnabled,
    trailingStopEnabled: config.enableTrailingStop,
    signalExitEnabled: config.enableSignalExit,
    executionMode: executionAdapter.mode,
    liveTradingEnabled: executionAdapter.liveTradingEnabled,
    liveExecutionDryRun: executionAdapter.liveExecutionDryRun
  });
  markBotRunning(nowIso());
  void runCryptoComAuthProbe({
    apiKey: config.cryptocomApiKey,
    apiSecret: config.cryptocomApiSecret,
    clientFactory: () =>
      new CryptoComPrivateReadOnlyClient({
        apiKey: config.cryptocomApiKey ?? "",
        apiSecret: config.cryptocomApiSecret ?? "",
        apiBaseUrl: config.cryptocomExchangePrivateBaseUrl
      })
  }).then((probe) => {
    info(
      `Crypto.com auth check configured=${probe.authConfigured ? "yes" : "no"} succeeded=${
        probe.authSucceeded ? "yes" : "no"
      } endpoint=${probe.endpointUsed} summary=${probe.accountSummaryAvailable ? "yes" : "no"}`
    );
    info(`Crypto.com auth check message: ${probe.readableMessage}`);
  });
  void runCryptoComReadOnlyProbe({
    apiKey: config.cryptocomApiKey,
    apiSecret: config.cryptocomApiSecret,
    clientFactory: () =>
      new CryptoComPrivateReadOnlyClient({
        apiKey: config.cryptocomApiKey ?? "",
        apiSecret: config.cryptocomApiSecret ?? "",
        apiBaseUrl: config.cryptocomExchangePrivateBaseUrl
      })
  }).then((diagnostics) => {
    updateCryptoComDiagnostics(diagnostics);
    info(
      `Crypto.com auth probe configured=${diagnostics.cryptoComAuthConfigured ? "yes" : "no"} healthy=${
        diagnostics.cryptoComAuthHealthy ? "yes" : "no"
      } balances=${diagnostics.cryptoComAccountSummaryAvailable ? "yes" : "no"} openOrders=${
        diagnostics.cryptoComOpenOrdersAvailable ? "yes" : "no"
      } tradeHistory=${diagnostics.cryptoComTradeHistoryAvailable ? "yes" : "no"}`
    );
    for (const warningText of diagnostics.warnings) {
      warn(`Crypto.com auth probe warning: ${warningText}`);
    }
    if (diagnostics.cryptoComConnectionMessage) {
      info(`Crypto.com auth probe message: ${diagnostics.cryptoComConnectionMessage}`);
    }
  });

  info("========================================");
  info("CRYPTO BOT STARTING - PAPER MODE ONLY");
  info("No real orders are placed in this build.");
  info("========================================");
  info(
    `Execution mode=${config.executionMode} liveTradingEnabled=${config.liveTradingEnabled ? "true" : "false"} liveExecutionDryRun=${config.liveExecutionDryRun ? "true" : "false"} adapter=${executionAdapter.mode}`
  );
  if (executionAdapter.mode === "live") {
    warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    warn("LIVE EXECUTION ADAPTER ENABLED");
    warn(
      executionAdapter.liveExecutionDryRun
        ? "DRY RUN ACTIVE: ORDER REQUESTS ARE SIMULATED AND NOT SENT"
        : "REAL ORDERS ARE POSSIBLE IN THIS MODE"
    );
    warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  }
  info(
    `Config timeframe=${config.timeframe} lookback=${config.lookback} poll=${config.pollIntervalMs}ms trailingStop=${config.enableTrailingStop ? "on" : "off"} signalExit=${config.enableSignalExit ? "on" : "off"} scanner=${config.scannerEnabled ? "on" : "off"} alerts=${config.alertsEnabled ? config.alertMode : "off"} relaxedEntry=${config.useRelaxedEntry ? "on" : "off"} volFilter=${config.volFilterEnabled ? "on" : "off"} dataCb=on`
  );
  info(`Configured base instruments: ${config.instruments.join(",")}`);

  emitAlert({
    event: "BOT_STARTUP",
    title: "Paper bot startup",
    message: "Bot started in PAPER MODE ONLY",
    meta: {
      scannerEnabled: config.scannerEnabled,
      alertsEnabled: config.alertsEnabled,
      alertMode: config.alertMode,
      relaxedEntry: config.useRelaxedEntry
    }
  });

  void runCycle();
  setInterval(() => {
    void runCycle();
  }, config.pollIntervalMs);
}

if (require.main === module) {
  startBot();
}
