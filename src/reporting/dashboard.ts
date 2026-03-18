import { JournalEntry, Position } from "../exchange/types";
import { MarketRegime, RegimeConfidence, RegimePolicy } from "../lib/regimeConfig";
import { MarketDataConfidence, MarketDataSnapshot, OrphanStatus } from "../marketData/types";
import { DataDegradationState } from "../runtime/dataHealth";
import { PaperCapitalReportSource } from "./capital";
import { splitClosedTradesForReporting } from "./journalSanity";
import { formatPrice } from "../utils/format";

export type DashboardMetrics = {
  capitalMode: "paper" | "live";
  startingCapitalUsd: number;
  currentEquityUsd: number;
  realizedEquityUsd: number;
  deployedCapitalUsd: number;
  freeCapitalUsd: number;
  dynamicSizingEnabled: boolean;
  openPositionCount: number;
  openInstruments: string[];
  closedTradesCount: number;
  excludedCorruptTradesCount: number;
  winsCount: number;
  lossesCount: number;
  winRatePct: number;
  realizedPnlUsd: number;
  realizedPnlPct: number;
  unrealizedPnlUsd: number;
  combinedPnlUsd: number;
  realizedReturnPct: number;
  unrealizedReturnPct: number;
  netReturnPct: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  unpricedOpenPositionsCount: number;
  lastCycleScannerCount: number;
  lastCycleTimestamp: string;
  scannerEnabled: boolean;
  trailingStopEnabled: boolean;
  signalExitEnabled: boolean;
  marketRegime: MarketRegime;
  marketRegimeConfidence: RegimeConfidence;
  marketRegimePolicy: RegimePolicy;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  unpricedInstrumentCount: number;
  fallbackSourceUsageCount: number;
  largeDisagreementCount: number;
  degradedMode: boolean;
  degradedReasons: string[];
  entriesPaused: boolean;
  degradedRecoveryActive: boolean;
  degradedRecoveryProgress: {
    current: number;
    required: number;
  };
  dataHealth: DataDegradationState["counters"];
  orphanedOpenPositionsCount: number;
  closedTradesByEntryRegime: Array<{
    regime: MarketRegime | "UNKNOWN";
    trades: number;
    wins: number;
    losses: number;
    realizedPnlUsd: number;
  }>;
  openPositionDetails: Array<{
    instrument: string;
    entryPrice: number;
    currentPrice?: number;
    quantity: number;
    positionSizeUsd?: number;
    sizingMode?: "fixed" | "dynamic";
    sizingRegimeMultiplier?: number;
    sizingScoreMultiplier?: number;
    unrealizedPnl?: number;
    stopLoss: number;
    takeProfit: number;
    highestSeenPrice: number;
    unpricedCycles: number;
    orphanStatus: OrphanStatus;
    priceSourceUsed?: string;
    confidence: MarketDataConfidence;
    disagreementBps?: number;
  }>;
};

function toUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)} USD`;
}

function toPlainUsd(value: number): string {
  return `${value.toFixed(2)} USD`;
}

function toPct(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

export function computeDashboardMetrics(input: {
  openPositions: Position[];
  journalEntries: JournalEntry[];
  trustedPriceByInstrument: Record<string, number>;
  lastCycleScannerCount: number;
  lastCycleTimestamp: string;
  scannerEnabled: boolean;
  trailingStopEnabled: boolean;
  signalExitEnabled: boolean;
  marketRegime: MarketRegime;
  marketRegimeConfidence: RegimeConfidence;
  marketRegimePolicy: RegimePolicy;
  dataDegradation: DataDegradationState;
  openPositionHealthByInstrument?: Record<string, { unpricedCycles: number; orphaned: boolean }>;
  instrumentMarketData?: MarketDataSnapshot[];
  largeDisagreementThresholdBps?: number;
  expectedPaperTradeSizeUsd?: number;
  paperStartingCapitalUsd?: number;
  paperSizeUseDynamic?: boolean;
}): DashboardMetrics {
  const closedSplit = splitClosedTradesForReporting(input.journalEntries, {
    expectedPaperTradeSizeUsd: input.expectedPaperTradeSizeUsd
  });
  const closedTradesCount = closedSplit.included.length;
  const excludedCorruptTradesCount = closedSplit.excluded.length;
  const winsCount = closedSplit.included.filter((entry) => entry.pnl > 0).length;
  const lossesCount = closedSplit.included.filter((entry) => entry.pnl < 0).length;
  const winRatePct = closedTradesCount > 0 ? (winsCount / closedTradesCount) * 100 : 0;

  const realizedPnlUsd = closedSplit.included.reduce((sum, entry) => sum + entry.pnl, 0);
  const realizedNotional = closedSplit.included.reduce((sum, entry) => sum + entry.entryNotional, 0);
  const realizedPnlPct = realizedNotional > 0 ? (realizedPnlUsd / realizedNotional) * 100 : 0;
  const regimeBuckets = new Map<
    MarketRegime | "UNKNOWN",
    { regime: MarketRegime | "UNKNOWN"; trades: number; wins: number; losses: number; realizedPnlUsd: number }
  >();
  for (const closed of closedSplit.included) {
    const regime = closed.entry.entryRegime ?? "UNKNOWN";
    const bucket = regimeBuckets.get(regime) ?? {
      regime,
      trades: 0,
      wins: 0,
      losses: 0,
      realizedPnlUsd: 0
    };
    bucket.trades += 1;
    bucket.wins += closed.pnl > 0 ? 1 : 0;
    bucket.losses += closed.pnl < 0 ? 1 : 0;
    bucket.realizedPnlUsd += closed.pnl;
    regimeBuckets.set(regime, bucket);
  }

  const openDetails = input.openPositions.map((position) => {
    const health = input.openPositionHealthByInstrument?.[position.instrument] ?? {
      unpricedCycles: 0,
      orphaned: false
    };
    const marketData = input.instrumentMarketData?.find((item) => item.instrument === position.instrument);
    const trustedPrice = input.trustedPriceByInstrument[position.instrument];
    if (typeof trustedPrice === "number") {
      return {
        instrument: position.instrument,
        entryPrice: position.entryPrice,
        currentPrice: trustedPrice,
        quantity: position.quantity,
        positionSizeUsd: position.positionSizeUsd,
        sizingMode: position.sizingMode,
        sizingRegimeMultiplier: position.sizingRegimeMultiplier,
        sizingScoreMultiplier: position.sizingScoreMultiplier,
        unrealizedPnl: (trustedPrice - position.entryPrice) * position.quantity,
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
        highestSeenPrice: position.highestSeenPrice,
        unpricedCycles: health.unpricedCycles,
        orphanStatus: marketData?.orphanStatus ?? (health.orphaned ? "ORPHAN" : "OK"),
        priceSourceUsed: marketData?.priceSourceUsed,
        confidence: marketData?.priceConfidence ?? "NONE",
        disagreementBps: marketData?.priceDisagreementBps
      };
    }
    return {
      instrument: position.instrument,
      entryPrice: position.entryPrice,
      quantity: position.quantity,
      positionSizeUsd: position.positionSizeUsd,
      sizingMode: position.sizingMode,
      sizingRegimeMultiplier: position.sizingRegimeMultiplier,
      sizingScoreMultiplier: position.sizingScoreMultiplier,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      highestSeenPrice: position.highestSeenPrice,
      unpricedCycles: health.unpricedCycles,
      orphanStatus: marketData?.orphanStatus ?? (health.orphaned ? "ORPHAN" : "OK"),
      priceSourceUsed: marketData?.priceSourceUsed,
      confidence: marketData?.priceConfidence ?? "NONE",
      disagreementBps: marketData?.priceDisagreementBps
    };
  });

  const unrealizedPnlUsd = openDetails.reduce((sum, detail) => sum + (detail.unrealizedPnl ?? 0), 0);
  const unpricedOpenPositionsCount = openDetails.filter((detail) => detail.unrealizedPnl === undefined).length;
  const instrumentMarketData = input.instrumentMarketData ?? [];
  const capitalReport = new PaperCapitalReportSource().buildReport({
    startingCapitalUsd: input.paperStartingCapitalUsd ?? 5000,
    openPositions: input.openPositions,
    realizedPnlUsd,
    unrealizedPnlUsd,
    closedTrades: closedSplit.included
  });

  return {
    capitalMode: capitalReport.capitalMode,
    startingCapitalUsd: capitalReport.startingCapitalUsd,
    currentEquityUsd: capitalReport.currentEquityUsd,
    realizedEquityUsd: capitalReport.realizedEquityUsd,
    deployedCapitalUsd: capitalReport.deployedCapitalUsd,
    freeCapitalUsd: capitalReport.freeCapitalUsd,
    dynamicSizingEnabled: input.paperSizeUseDynamic ?? false,
    openPositionCount: input.openPositions.length,
    openInstruments: input.openPositions.map((position) => position.instrument),
    closedTradesCount,
    excludedCorruptTradesCount,
    winsCount,
    lossesCount,
    winRatePct,
    realizedPnlUsd,
    realizedPnlPct,
    unrealizedPnlUsd,
    combinedPnlUsd: realizedPnlUsd + unrealizedPnlUsd,
    realizedReturnPct: capitalReport.realizedReturnPct,
    unrealizedReturnPct: capitalReport.unrealizedReturnPct,
    netReturnPct: capitalReport.netReturnPct,
    maxDrawdownUsd: capitalReport.maxDrawdownUsd,
    maxDrawdownPct: capitalReport.maxDrawdownPct,
    unpricedOpenPositionsCount,
    lastCycleScannerCount: input.lastCycleScannerCount,
    lastCycleTimestamp: input.lastCycleTimestamp,
    scannerEnabled: input.scannerEnabled,
    trailingStopEnabled: input.trailingStopEnabled,
    signalExitEnabled: input.signalExitEnabled,
    marketRegime: input.marketRegime,
    marketRegimeConfidence: input.marketRegimeConfidence,
    marketRegimePolicy: input.marketRegimePolicy,
    highConfidenceCount: instrumentMarketData.filter((item) => item.priceConfidence === "HIGH").length,
    mediumConfidenceCount: instrumentMarketData.filter((item) => item.priceConfidence === "MEDIUM").length,
    lowConfidenceCount: instrumentMarketData.filter((item) => item.priceConfidence === "LOW").length,
    unpricedInstrumentCount: instrumentMarketData.filter((item) => item.priceConfidence === "NONE").length,
    fallbackSourceUsageCount: instrumentMarketData.filter(
      (item) => item.priceSourceUsed === "REFERENCE:LAST_GOOD" || item.priceSourceUsed === "SAFETY:MOCK_CANDLE"
    ).length,
    largeDisagreementCount: instrumentMarketData.filter(
      (item) =>
        typeof item.priceDisagreementBps === "number" &&
        item.priceDisagreementBps > (input.largeDisagreementThresholdBps ?? 100)
    ).length,
    degradedMode: input.dataDegradation.degraded,
    degradedReasons: input.dataDegradation.reasons,
    entriesPaused: input.dataDegradation.entriesPaused,
    degradedRecoveryActive: input.dataDegradation.inRecovery,
    degradedRecoveryProgress: input.dataDegradation.recoveryProgress,
    dataHealth: input.dataDegradation.counters,
    orphanedOpenPositionsCount: openDetails.filter(
      (detail) => detail.orphanStatus === "ORPHAN" || detail.orphanStatus === "QUARANTINED"
    ).length,
    closedTradesByEntryRegime: Array.from(regimeBuckets.values()),
    openPositionDetails: openDetails
  };
}

export function renderDashboard(metrics: DashboardMetrics): string {
  const lines: string[] = [];
  lines.push("========================================");
  lines.push("PAPER BOT DASHBOARD");
  lines.push(`Open Positions: ${metrics.openPositionCount}`);
  lines.push(`Open Instruments: ${metrics.openInstruments.length > 0 ? metrics.openInstruments.join(",") : "-"}`);
  lines.push(`Closed Trades: ${metrics.closedTradesCount}`);
  lines.push(`Excluded Corrupt Trades: ${metrics.excludedCorruptTradesCount}`);
  lines.push(`Capital Mode: ${metrics.capitalMode.toUpperCase()}`);
  lines.push(`Starting Capital: ${toPlainUsd(metrics.startingCapitalUsd)}`);
  lines.push(`Current Equity: ${toPlainUsd(metrics.currentEquityUsd)}`);
  lines.push(`Realized Equity: ${toPlainUsd(metrics.realizedEquityUsd)}`);
  lines.push(`Deployed Capital: ${toPlainUsd(metrics.deployedCapitalUsd)}`);
  lines.push(`Free Capital: ${toPlainUsd(metrics.freeCapitalUsd)}`);
  lines.push(`Paper Sizing: ${metrics.dynamicSizingEnabled ? "DYNAMIC" : "FIXED"}`);
  lines.push(`Wins / Losses: ${metrics.winsCount} / ${metrics.lossesCount}`);
  lines.push(`Win Rate: ${metrics.winRatePct.toFixed(1)}%`);
  lines.push(`Realized PnL: ${toUsd(metrics.realizedPnlUsd)} (${toPct(metrics.realizedPnlPct)})`);
  lines.push(`Unrealized PnL: ${toUsd(metrics.unrealizedPnlUsd)}`);
  lines.push(`Combined PnL: ${toUsd(metrics.combinedPnlUsd)}`);
  lines.push(`Net Return: ${toPct(metrics.netReturnPct)}`);
  lines.push(`Realized Return: ${toPct(metrics.realizedReturnPct)}`);
  lines.push(`Unrealized Return: ${toPct(metrics.unrealizedReturnPct)}`);
  lines.push(`Max Drawdown: ${toUsd(metrics.maxDrawdownUsd)} (${toPct(metrics.maxDrawdownPct)})`);
  lines.push(
    `Price Confidence: high=${metrics.highConfidenceCount} medium=${metrics.mediumConfidenceCount} low=${metrics.lowConfidenceCount} none=${metrics.unpricedInstrumentCount}`
  );
  lines.push(
    `Integrity: fallback=${metrics.fallbackSourceUsageCount} largeDisagreement=${metrics.largeDisagreementCount}`
  );
  if (metrics.unpricedOpenPositionsCount > 0) {
    lines.push(`Unpriced Open Positions: ${metrics.unpricedOpenPositionsCount} (excluded from unrealized PnL)`);
  }
  lines.push(`Scanner: ${metrics.scannerEnabled ? "ON" : "OFF"} (last shortlist=${metrics.lastCycleScannerCount})`);
  lines.push(`Trailing Stop: ${metrics.trailingStopEnabled ? "ON" : "OFF"}`);
  lines.push(`Signal Exit: ${metrics.signalExitEnabled ? "ON" : "OFF"}`);
  lines.push(`Market Regime: ${metrics.marketRegime}`);
  lines.push(`Regime Confidence: ${metrics.marketRegimeConfidence}`);
  lines.push(
    `Regime Policy: entries=${metrics.marketRegimePolicy.allowNewEntries ? "on" : "off"} maxOpen=${
      metrics.marketRegimePolicy.maxOpenPositions
    } size=${metrics.marketRegimePolicy.sizeMultiplier.toFixed(2)} tp=${metrics.marketRegimePolicy.tpMultiplier.toFixed(
      2
    )} stop=${metrics.marketRegimePolicy.stopMultiplier.toFixed(2)} trailing=${
      metrics.marketRegimePolicy.tightenTrailing ? "tight" : "base"
    }`
  );
  lines.push(`Degraded Mode: ${metrics.degradedMode ? "ON" : "OFF"}${metrics.entriesPaused ? " (entries paused)" : ""}`);
  if (metrics.degradedReasons.length > 0) {
    lines.push(`Degraded Reasons: ${metrics.degradedReasons.join(",")}`);
  }
  if (metrics.degradedRecoveryActive) {
    lines.push(
      `Recovery: ${metrics.degradedRecoveryProgress.current}/${metrics.degradedRecoveryProgress.required} healthy cycles`
    );
  }
  lines.push(
    `Data Health: mock=${metrics.dataHealth.consecutiveMockCycles} fetch=${metrics.dataHealth.consecutiveFetchFailureCycles} stale=${metrics.dataHealth.staleCandleCycles} reject=${metrics.dataHealth.consecutivePriceRejectCycles} recover=${metrics.dataHealth.healthyRecoveryCycles}`
  );
  if (metrics.orphanedOpenPositionsCount > 0) {
    lines.push(`Orphaned Open Positions: ${metrics.orphanedOpenPositionsCount}`);
  }
  if (metrics.closedTradesByEntryRegime.length > 0) {
    lines.push("Closed Trades By Entry Regime:");
    for (const bucket of metrics.closedTradesByEntryRegime) {
      lines.push(
        `- ${bucket.regime} trades=${bucket.trades} wins=${bucket.wins} losses=${bucket.losses} pnl=${toUsd(
          bucket.realizedPnlUsd
        )}`
      );
    }
  }
  lines.push(`Last Cycle: ${metrics.lastCycleTimestamp}`);

  if (metrics.openPositionDetails.length > 0) {
    lines.push("Open Position Details:");
    for (const detail of metrics.openPositionDetails) {
      lines.push(
        `- ${detail.instrument} entry=${formatPrice(detail.entryPrice)} current=${
          detail.currentPrice !== undefined ? formatPrice(detail.currentPrice) : "N/A"
        } qty=${detail.quantity.toFixed(6)} sizeUsd=${detail.positionSizeUsd?.toFixed(2) ?? "N/A"} mode=${
          detail.sizingMode ?? "N/A"
        } xReg=${detail.sizingRegimeMultiplier?.toFixed(2) ?? "N/A"} xScore=${
          detail.sizingScoreMultiplier?.toFixed(2) ?? "N/A"
        } uPnL=${
          detail.unrealizedPnl !== undefined ? toUsd(detail.unrealizedPnl) : "N/A"
        } sl=${formatPrice(detail.stopLoss)} tp=${formatPrice(detail.takeProfit)} high=${formatPrice(
          detail.highestSeenPrice
        )} src=${detail.priceSourceUsed ?? "N/A"} conf=${detail.confidence}${
          detail.disagreementBps !== undefined ? ` xsrc=${detail.disagreementBps.toFixed(1)}bps` : ""
        } unpriced=${detail.unpricedCycles} status=${detail.orphanStatus}`
      );
    }
  }

  lines.push("========================================");
  return lines.join("\n");
}
