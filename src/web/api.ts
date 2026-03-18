import { config } from "../config/env";
import { MissedOpportunitySummary } from "../analysis/missedOpportunity";
import { BotConfig, JournalEntry } from "../exchange/types";
import { REGIME_POLICIES } from "../lib/regimeConfig";
import { computeDashboardMetrics } from "../reporting/dashboard";
import { assessMarketOpportunity } from "../reporting/opportunity";
import { splitClosedTradesForReporting } from "../reporting/journalSanity";
import { readBlockedEntryTelemetry } from "../telemetry/store";
import { readOpenPositions } from "../storage/openPositions";
import { RuntimeSnapshot } from "./state";

export type TradesPayload = {
  includeSuspicious: boolean;
  excludedSuspiciousCount: number;
  totalClosedTrades: number;
  trades: Array<
    JournalEntry & {
      suspicious: boolean;
      suspiciousReasons: string[];
    }
  >;
};

function toTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortRecentClosedTrades<T extends { closedAt?: string; openedAt: string }>(trades: T[]): T[] {
  return [...trades].sort((a, b) => {
    const left = Math.max(toTimestamp(a.closedAt), toTimestamp(a.openedAt));
    const right = Math.max(toTimestamp(b.closedAt), toTimestamp(b.openedAt));
    return right - left;
  });
}

export function buildSafeConfigSnapshot(config: BotConfig): Record<string, unknown> {
  return {
    executionMode: config.executionMode,
    liveTradingEnabled: config.liveTradingEnabled,
    liveExecutionDryRun: config.liveExecutionDryRun,
    cryptocomExchangePrivateBaseUrl: config.cryptocomExchangePrivateBaseUrl,
    instruments: config.instruments,
    timeframe: config.timeframe,
    lookback: config.lookback,
    pollIntervalMs: config.pollIntervalMs,
    paperTradeSizeUsd: config.paperTradeSizeUsd,
    breakoutVolumeMultiplier: config.breakoutVolumeMultiplier,
    breakoutBufferPct: config.breakoutBufferPct,
    minRangePct: config.minRangePct,
    useRelaxedEntry: config.useRelaxedEntry,
    atrPeriod: config.atrPeriod,
    minAtrPct: config.minAtrPct,
    minVolatilityRangePct: config.minVolatilityRangePct,
    volFilterEnabled: config.volFilterEnabled,
    stopLossPct: config.stopLossPct,
    takeProfitPct: config.takeProfitPct,
    paperStartingCapitalUsd: config.paperStartingCapitalUsd,
    maxOpenPositions: config.maxOpenPositions,
    paperSizeMinUsd: config.paperSizeMinUsd,
    paperSizeMaxUsd: config.paperSizeMaxUsd,
    paperSizeUseDynamic: config.paperSizeUseDynamic,
    enableTrailingStop: config.enableTrailingStop,
    trailingStopPct: config.trailingStopPct,
    enableSignalExit: config.enableSignalExit,
    scannerEnabled: config.scannerEnabled,
    scannerMaxInstruments: config.scannerMaxInstruments,
    scannerQuoteFilter: config.scannerQuoteFilter,
    scannerTopN: config.scannerTopN,
    scannerMin24hVolume: config.scannerMin24hVolume,
    scannerUseCandleConfirmation: config.scannerUseCandleConfirmation,
    alertsEnabled: config.alertsEnabled,
    alertMode: config.alertMode,
    dataCbMaxConsecutiveMockCycles: config.dataCbMaxConsecutiveMockCycles,
    dataCbMaxConsecutiveFetchFailureCycles: config.dataCbMaxConsecutiveFetchFailureCycles,
    dataCbMaxStaleCandleCycles: config.dataCbMaxStaleCandleCycles,
    dataCbMaxConsecutivePriceRejectCycles: config.dataCbMaxConsecutivePriceRejectCycles,
    dataCbHealthyCyclesToClear: config.dataCbHealthyCyclesToClear,
    orphanPositionMaxUnpricedCycles: config.orphanPositionMaxUnpricedCycles,
    marketDataFreshnessMs: config.marketDataFreshnessMs,
    marketDataHighDisagreementBps: config.marketDataHighDisagreementBps,
    marketDataMediumDisagreementBps: config.marketDataMediumDisagreementBps,
    orphanWarningCycles: config.orphanWarningCycles,
    orphanStaleCycles: config.orphanStaleCycles,
    orphanCycles: config.orphanCycles,
    orphanQuarantineCycles: config.orphanQuarantineCycles,
    allowLastGoodPriceMarking: config.allowLastGoodPriceMarking,
    allowLowConfidenceEntries: config.allowLowConfidenceEntries,
    minRewardRiskBull: config.minRewardRiskBull,
    minRewardRiskNeutral: config.minRewardRiskNeutral,
    minTpDistancePct: config.minTpDistancePct,
    maxSlDistancePct: config.maxSlDistancePct,
    minCandidateScoreNeutral: config.minCandidateScoreNeutral
  };
}

export function buildTradesPayload(input: {
  journalEntries: JournalEntry[];
  expectedPaperTradeSizeUsd: number;
  includeSuspicious: boolean;
  limit: number;
}): TradesPayload {
  const split = splitClosedTradesForReporting(input.journalEntries, {
    expectedPaperTradeSizeUsd: input.expectedPaperTradeSizeUsd
  });

  const sane = split.included.map((item) => ({
    ...item.entry,
    suspicious: false,
    suspiciousReasons: [] as string[]
  }));
  const suspicious = split.excluded.map((item) => ({
    ...item.entry,
    suspicious: true,
    suspiciousReasons: item.reasons
  }));

  const source = input.includeSuspicious ? [...sane, ...suspicious] : sane;
  const trades = sortRecentClosedTrades(source).slice(0, input.limit);

  return {
    includeSuspicious: input.includeSuspicious,
    excludedSuspiciousCount: split.excluded.length,
    totalClosedTrades: split.included.length,
    trades
  };
}

export function buildDashboardPayload(input: {
  runtime: RuntimeSnapshot;
  journalEntries: JournalEntry[];
  expectedPaperTradeSizeUsd: number;
  missedOpportunitySummary?: MissedOpportunitySummary;
}): ReturnType<typeof computeDashboardMetrics> &
  ReturnType<typeof assessMarketOpportunity> &
  RuntimeSnapshot["cryptoComDiagnostics"] &
  RuntimeSnapshot["executionDiagnostics"] & {
    scannerMode: "DISABLED" | "SCANNER" | "FALLBACK";
    scannerSource: string;
    scannerFallbackReason?: string;
    missedOpportunitySummary: MissedOpportunitySummary;
  } {
  const metrics = computeDashboardMetrics({
    openPositions: readOpenPositions(),
    journalEntries: input.journalEntries,
    trustedPriceByInstrument: input.runtime.trustedPriceByInstrument,
    lastCycleScannerCount: input.runtime.lastCycleScannerShortlist.length,
    lastCycleTimestamp: input.runtime.lastCycleTimestamp ?? "N/A",
    scannerEnabled: input.runtime.scannerEnabled,
    trailingStopEnabled: input.runtime.trailingStopEnabled,
    signalExitEnabled: input.runtime.signalExitEnabled,
    marketRegime: input.runtime.regimeContext?.regime ?? "RANGE_CHOP",
    marketRegimeConfidence: input.runtime.regimeContext?.confidence ?? "LOW",
    marketRegimePolicy: input.runtime.regimePolicy ?? REGIME_POLICIES.RANGE_CHOP,
    dataDegradation: input.runtime.dataDegradation,
    openPositionHealthByInstrument: input.runtime.openPositionHealthByInstrument,
    instrumentMarketData: input.runtime.instrumentRows.map((row) => row.marketData),
    largeDisagreementThresholdBps: config.marketDataMediumDisagreementBps,
    expectedPaperTradeSizeUsd: input.expectedPaperTradeSizeUsd,
    paperStartingCapitalUsd: config.paperStartingCapitalUsd,
    paperSizeUseDynamic: config.paperSizeUseDynamic
  });
  const recentBlockedEntries = readBlockedEntryTelemetry().filter((entry) => {
    const parsed = Date.parse(entry.at);
    return Number.isFinite(parsed) && Date.now() - parsed <= 15 * 60_000;
  }).length;
  const opportunity = assessMarketOpportunity({
    volatilityPct: input.runtime.regimeContext?.volatilityPct ?? 0,
    breadthScore: input.runtime.regimeContext?.breadthScore ?? 0,
    scannerShortlistCount: input.runtime.lastCycleScannerShortlist.length,
    instrumentCount: input.runtime.instrumentRows.length,
    buySignalCount: input.runtime.instrumentRows.filter((row) => row.signal === "BUY").length,
    recentBlockedEntries,
    regime: input.runtime.regimeContext?.regime ?? "RANGE_CHOP",
    regimeConfidence: input.runtime.regimeContext?.confidence ?? "LOW"
  });
  const scannerFallbackReason = [...input.runtime.notes]
    .reverse()
    .find((note) => note.startsWith("Scanner failed;") || note.startsWith("Scanner returned no candidates;"));
  const scannerMode =
    !input.runtime.scannerEnabled
      ? "DISABLED"
      : input.runtime.lastCycleScannerShortlist.length > 0
        ? "SCANNER"
        : "FALLBACK";
  return {
    ...metrics,
    ...opportunity,
    ...input.runtime.cryptoComDiagnostics,
    ...input.runtime.executionDiagnostics,
    scannerMode,
    scannerSource: scannerMode === "SCANNER" ? "scanner shortlist" : "configured instruments",
    scannerFallbackReason,
    missedOpportunitySummary: input.missedOpportunitySummary ?? {
      windowHours: 12,
      shortlistedReviewed: 0,
      notTraded: 0,
      breakoutLikeMoves: 0,
      profitable: 0,
      failedOrNoisy: 0,
      conclusion: "Not enough data yet"
    }
  };
}
