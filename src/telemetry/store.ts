import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config/env";
import { JournalEntry } from "../exchange/types";
import { MarketRegime, RegimeConfidence } from "../lib/regimeConfig";
import { ClosedTradeForReporting, splitClosedTradesForReporting } from "../reporting/journalSanity";
import { readJournal } from "../storage/journal";
import { warn } from "../utils/logger";

export type TradeTelemetryEntry = {
  openedAt: string;
  closedAt: string;
  instrument: string;
  side: "LONG";
  entry: number;
  exit: number;
  qty: number;
  positionSizeUsd?: number;
  sizingMode?: "fixed" | "dynamic";
  pnlUsd: number;
  pnlPct: number;
  entryRegime?: MarketRegime;
  entryRegimeConfidence?: RegimeConfidence;
  entryBreadthScore?: number;
  entryVolatilityPct?: number;
  entryEmaSpreadPct?: number;
  exitReason?: JournalEntry["exitReason"];
  holdingMinutes: number;
  mfeUsd: number;
  maeUsd: number;
};

export type RegimeTelemetryEntry = {
  at: string;
  btcClosedCandleTime: number;
  regime: MarketRegime;
  confidence: RegimeConfidence;
  btcPrice: number;
  emaFast: number;
  emaSlow: number;
  emaSpreadPct: number;
  volatilityPct: number;
  breadthScore: number;
  bullScore: number;
  chopScore: number;
  reasons: string[];
};

export type BlockedEntryReason =
  | "REGIME_BLOCKED"
  | "HIGH_SCORE_REQUIRED"
  | "MAX_OPEN_POSITIONS"
  | "DUPLICATE_OPEN_POSITION"
  | "EV_RR_TOO_LOW"
  | "EV_TP_TOO_SMALL"
  | "EV_SL_TOO_WIDE"
  | "EV_SCORE_TOO_LOW";

export type BlockedEntryTelemetryEntry = {
  at: string;
  instrument: string;
  signal: string;
  candidateScore?: number;
  regime: MarketRegime;
  reasonBlocked: BlockedEntryReason;
  price: number;
  volumeQuality?: number;
  rewardRiskRatio?: number;
  tpDistancePct?: number;
  slDistancePct?: number;
};

export type DailySummaryTelemetryEntry = {
  day: string;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  combinedPnlUsd: number;
  averageWinnerUsd: number;
  averageLoserUsd: number;
  profitFactor: number;
  maxConsecutiveLosses: number;
  averageHoldingMinutes: number;
  closedTradesByRegime: Record<string, number>;
  pnlByRegime: Record<string, number>;
  blockedEntriesByRegime: Record<string, number>;
  blockedEntriesByReason: Record<string, number>;
};

export type ScannerDecisionTelemetryEntry = {
  observedAt: string;
  instrument: string;
  timeframe: string;
  scannerSelected: boolean;
  hasOpenPosition: boolean;
  signal: string;
  holdReason: string;
  latestPrice: number;
  candleTimestamp: number;
};

type TelemetryKind = "trades" | "regime_events" | "blocked_entries" | "daily_summary" | "scanner_decisions";

export type TelemetryPaths = {
  dataDir: string;
  exportsDir: string;
  tradesPath: string;
  regimeEventsPath: string;
  blockedEntriesPath: string;
  dailySummaryPath: string;
  scannerDecisionsPath: string;
  tradesExportPath: string;
  regimeExportPath: string;
  blockedExportPath: string;
  summaryExportPath: string;
};

function makePaths(rootDir: string): TelemetryPaths {
  const dataDir = path.resolve(rootDir, "data");
  const exportsDir = path.resolve(rootDir, "exports");
  return {
    dataDir,
    exportsDir,
    tradesPath: path.join(dataDir, "trades.jsonl"),
    regimeEventsPath: path.join(dataDir, "regime_events.jsonl"),
    blockedEntriesPath: path.join(dataDir, "blocked_entries.jsonl"),
    dailySummaryPath: path.join(dataDir, "daily_summary.jsonl"),
    scannerDecisionsPath: path.join(dataDir, "scanner_decisions.jsonl"),
    tradesExportPath: path.join(exportsDir, "trades_latest.csv"),
    regimeExportPath: path.join(exportsDir, "regime_latest.csv"),
    blockedExportPath: path.join(exportsDir, "blocked_latest.csv"),
    summaryExportPath: path.join(exportsDir, "summary_latest.json")
  };
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function ensurePaths(paths: TelemetryPaths): void {
  ensureDir(paths.dataDir);
  ensureDir(paths.exportsDir);
}

function appendJsonl(paths: TelemetryPaths, kind: TelemetryKind, row: object): void {
  const pathByKind: Record<TelemetryKind, string> = {
    trades: paths.tradesPath,
    regime_events: paths.regimeEventsPath,
    blocked_entries: paths.blockedEntriesPath,
    daily_summary: paths.dailySummaryPath
    ,
    scanner_decisions: paths.scannerDecisionsPath
  };
  try {
    ensurePaths(paths);
    appendFileSync(pathByKind[kind], `${JSON.stringify(row)}\n`, "utf-8");
  } catch (appendError) {
    warn(
      `Telemetry append failed for ${kind}: ${appendError instanceof Error ? appendError.message : "unknown"}`
    );
  }
}

function readJsonlFile<T>(filePath: string): T[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const raw = readFileSync(filePath, "utf-8").trim();
    if (!raw) {
      return [];
    }
    const rows: T[] = [];
    for (const line of raw.split("\n")) {
      try {
        rows.push(JSON.parse(line) as T);
      } catch {
        continue;
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function csvEscape(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  const asString =
    typeof value === "string"
      ? value
      : Array.isArray(value) || typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/[",\n]/.test(asString)) {
    return `"${asString.replace(/"/g, "\"\"")}"`;
  }
  return asString;
}

function toCsv<T extends object>(rows: T[], preferredHeaders?: string[]): string {
  const headers =
    preferredHeaders && preferredHeaders.length > 0
      ? preferredHeaders
      : Array.from(
          rows.reduce<Set<string>>((set, row) => {
            Object.keys(row).forEach((key) => set.add(key));
            return set;
          }, new Set<string>())
        );
  if (headers.length === 0) {
    return "";
  }
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape((row as Record<string, unknown>)[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function utcDayFromIso(isoString: string): string {
  return isoString.slice(0, 10);
}

function countByKey(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function maxConsecutiveLosses(trades: TradeTelemetryEntry[]): number {
  let current = 0;
  let max = 0;
  const ordered = [...trades].sort((left, right) => left.closedAt.localeCompare(right.closedAt));
  for (const trade of ordered) {
    if (trade.pnlUsd < 0) {
      current += 1;
      if (current > max) {
        max = current;
      }
    } else {
      current = 0;
    }
  }
  return max;
}

export function getTelemetryPaths(rootDir = process.cwd()): TelemetryPaths {
  return makePaths(rootDir);
}

export function appendTradeTelemetry(entry: TradeTelemetryEntry, rootDir = process.cwd()): void {
  appendJsonl(makePaths(rootDir), "trades", entry);
}

export function appendRegimeEventTelemetry(entry: RegimeTelemetryEntry, rootDir = process.cwd()): void {
  appendJsonl(makePaths(rootDir), "regime_events", entry);
}

export function appendBlockedEntryTelemetry(entry: BlockedEntryTelemetryEntry, rootDir = process.cwd()): void {
  appendJsonl(makePaths(rootDir), "blocked_entries", entry);
}

export function appendDailySummaryTelemetry(entry: DailySummaryTelemetryEntry, rootDir = process.cwd()): void {
  appendJsonl(makePaths(rootDir), "daily_summary", entry);
}

export function appendScannerDecisionTelemetry(entry: ScannerDecisionTelemetryEntry, rootDir = process.cwd()): void {
  appendJsonl(makePaths(rootDir), "scanner_decisions", entry);
}

export function readTradeTelemetry(rootDir = process.cwd()): TradeTelemetryEntry[] {
  return readJsonlFile<TradeTelemetryEntry>(makePaths(rootDir).tradesPath);
}

export function readRegimeTelemetry(rootDir = process.cwd()): RegimeTelemetryEntry[] {
  return readJsonlFile<RegimeTelemetryEntry>(makePaths(rootDir).regimeEventsPath);
}

export function readBlockedEntryTelemetry(rootDir = process.cwd()): BlockedEntryTelemetryEntry[] {
  return readJsonlFile<BlockedEntryTelemetryEntry>(makePaths(rootDir).blockedEntriesPath);
}

export function readDailySummaryTelemetry(rootDir = process.cwd()): DailySummaryTelemetryEntry[] {
  return readJsonlFile<DailySummaryTelemetryEntry>(makePaths(rootDir).dailySummaryPath);
}

export function readScannerDecisionTelemetry(rootDir = process.cwd()): ScannerDecisionTelemetryEntry[] {
  return readJsonlFile<ScannerDecisionTelemetryEntry>(makePaths(rootDir).scannerDecisionsPath);
}

export function buildTradeTelemetryFromJournalEntry(input: {
  closedEntry: JournalEntry;
  mfeUsd?: number;
  maeUsd?: number;
}): TradeTelemetryEntry | null {
  const closedAtMs = input.closedEntry.closedAt ? Date.parse(input.closedEntry.closedAt) : Number.NaN;
  const openedAtMs = Date.parse(input.closedEntry.openedAt);
  if (
    input.closedEntry.side !== "SELL" ||
    typeof input.closedEntry.closedAt !== "string" ||
    typeof input.closedEntry.exitPrice !== "number" ||
    typeof input.closedEntry.pnl !== "number" ||
    !Number.isFinite(openedAtMs) ||
    !Number.isFinite(closedAtMs) ||
    input.closedEntry.entryPrice <= 0
  ) {
    return null;
  }

  const pnlPct = ((input.closedEntry.exitPrice - input.closedEntry.entryPrice) / input.closedEntry.entryPrice) * 100;
  return {
    openedAt: input.closedEntry.openedAt,
    closedAt: input.closedEntry.closedAt,
    instrument: input.closedEntry.instrument,
    side: "LONG",
    entry: input.closedEntry.entryPrice,
    exit: input.closedEntry.exitPrice,
    qty: input.closedEntry.quantity,
    positionSizeUsd: input.closedEntry.positionSizeUsd,
    sizingMode: input.closedEntry.sizingMode,
    pnlUsd: input.closedEntry.pnl,
    pnlPct,
    entryRegime: input.closedEntry.entryRegime,
    entryRegimeConfidence: input.closedEntry.entryRegimeConfidence,
    entryBreadthScore: input.closedEntry.entryBreadthScore,
    entryVolatilityPct: input.closedEntry.entryVolatilityPct,
    entryEmaSpreadPct: input.closedEntry.entryEmaSpreadPct,
    exitReason: input.closedEntry.exitReason,
    holdingMinutes: Math.max(0, (closedAtMs - openedAtMs) / 60_000),
    mfeUsd: input.mfeUsd ?? 0,
    maeUsd: input.maeUsd ?? 0
  };
}

export function buildDailySummaryTelemetry(input: {
  day: string;
  unrealizedPnlUsd: number;
  tradeRows: TradeTelemetryEntry[];
  blockedEntries: BlockedEntryTelemetryEntry[];
}): DailySummaryTelemetryEntry {
  const dayTrades = input.tradeRows.filter((trade) => utcDayFromIso(trade.closedAt) === input.day);
  const wins = dayTrades.filter((trade) => trade.pnlUsd > 0);
  const losses = dayTrades.filter((trade) => trade.pnlUsd < 0);
  const realizedPnlUsd = dayTrades.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const averageHoldingMinutes =
    dayTrades.length > 0
      ? dayTrades.reduce((sum, trade) => sum + trade.holdingMinutes, 0) / dayTrades.length
      : 0;
  const grossWins = wins.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const grossLossAbs = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlUsd, 0));
  const closedTradesByRegime = countByKey(dayTrades.map((trade) => trade.entryRegime ?? "UNKNOWN"));
  const pnlByRegime = dayTrades.reduce<Record<string, number>>((acc, trade) => {
    const key = trade.entryRegime ?? "UNKNOWN";
    acc[key] = (acc[key] ?? 0) + trade.pnlUsd;
    return acc;
  }, {});
  const dayBlocked = input.blockedEntries.filter((entry) => utcDayFromIso(entry.at) === input.day);

  return {
    day: input.day,
    closedTrades: dayTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: dayTrades.length > 0 ? (wins.length / dayTrades.length) * 100 : 0,
    realizedPnlUsd,
    unrealizedPnlUsd: input.unrealizedPnlUsd,
    combinedPnlUsd: realizedPnlUsd + input.unrealizedPnlUsd,
    averageWinnerUsd: wins.length > 0 ? grossWins / wins.length : 0,
    averageLoserUsd: losses.length > 0 ? losses.reduce((sum, trade) => sum + trade.pnlUsd, 0) / losses.length : 0,
    profitFactor: grossLossAbs > 0 ? grossWins / grossLossAbs : grossWins > 0 ? grossWins : 0,
    maxConsecutiveLosses: maxConsecutiveLosses(dayTrades),
    averageHoldingMinutes,
    closedTradesByRegime,
    pnlByRegime,
    blockedEntriesByRegime: countByKey(dayBlocked.map((entry) => entry.regime)),
    blockedEntriesByReason: countByKey(dayBlocked.map((entry) => entry.reasonBlocked))
  };
}

export function buildDailySummariesForExport(input: {
  journalEntries: JournalEntry[];
  blockedEntries: BlockedEntryTelemetryEntry[];
  expectedPaperTradeSizeUsd: number;
  currentUtcDay?: string;
  currentUnrealizedPnlUsd?: number;
}): DailySummaryTelemetryEntry[] {
  const split = splitClosedTradesForReporting(input.journalEntries, {
    expectedPaperTradeSizeUsd: input.expectedPaperTradeSizeUsd
  });
  const tradeRows = split.included
    .filter((trade) => typeof trade.entry.closedAt === "string")
    .map(toTradeTelemetryForSummary);
  const days = new Set<string>();
  for (const trade of tradeRows) {
    days.add(utcDayFromIso(trade.closedAt));
  }
  for (const blockedEntry of input.blockedEntries) {
    days.add(utcDayFromIso(blockedEntry.at));
  }
  const currentUtcDay = input.currentUtcDay ?? new Date().toISOString().slice(0, 10);
  days.add(currentUtcDay);

  return Array.from(days)
    .sort()
    .map((day) =>
      buildDailySummaryTelemetry({
        day,
        unrealizedPnlUsd: day === currentUtcDay ? input.currentUnrealizedPnlUsd ?? 0 : 0,
        tradeRows,
        blockedEntries: input.blockedEntries
      })
    );
}

export function writeReviewPack(
  rootDir = process.cwd(),
  input?: {
    journalEntries?: JournalEntry[];
    blockedEntries?: BlockedEntryTelemetryEntry[];
    expectedPaperTradeSizeUsd?: number;
    currentUtcDay?: string;
    currentUnrealizedPnlUsd?: number;
  }
): TelemetryPaths {
  const paths = makePaths(rootDir);
  try {
    ensurePaths(paths);
    writeFileSync(
      paths.tradesExportPath,
      toCsv(readTradeTelemetry(rootDir), [
        "openedAt",
        "closedAt",
        "instrument",
        "side",
        "entry",
        "exit",
        "qty",
        "positionSizeUsd",
        "sizingMode",
        "pnlUsd",
        "pnlPct",
        "entryRegime",
        "entryRegimeConfidence",
        "entryBreadthScore",
        "entryVolatilityPct",
        "entryEmaSpreadPct",
        "exitReason",
        "holdingMinutes",
        "mfeUsd",
        "maeUsd"
      ]),
      "utf-8"
    );
    writeFileSync(
      paths.regimeExportPath,
      toCsv(readRegimeTelemetry(rootDir), [
        "at",
        "btcClosedCandleTime",
        "regime",
        "confidence",
        "btcPrice",
        "emaFast",
        "emaSlow",
        "emaSpreadPct",
        "volatilityPct",
        "breadthScore",
        "bullScore",
        "chopScore",
        "reasons"
      ]),
      "utf-8"
    );
    writeFileSync(
      paths.blockedExportPath,
      toCsv(readBlockedEntryTelemetry(rootDir), [
        "at",
        "instrument",
        "signal",
        "candidateScore",
        "regime",
        "reasonBlocked",
        "price",
        "volumeQuality",
        "rewardRiskRatio",
        "tpDistancePct",
        "slDistancePct"
      ]),
      "utf-8"
    );
    const dailySummaries = buildDailySummariesForExport({
      journalEntries: input?.journalEntries ?? readJournal(),
      blockedEntries: input?.blockedEntries ?? readBlockedEntryTelemetry(rootDir),
      expectedPaperTradeSizeUsd: input?.expectedPaperTradeSizeUsd ?? config.paperTradeSizeUsd,
      currentUtcDay: input?.currentUtcDay,
      currentUnrealizedPnlUsd: input?.currentUnrealizedPnlUsd
    });
    const latestSummary = dailySummaries[dailySummaries.length - 1] ?? null;
    writeFileSync(paths.summaryExportPath, `${JSON.stringify({ latestSummary, dailySummaries }, null, 2)}\n`, "utf-8");
  } catch (exportError) {
    warn(`Telemetry export failed: ${exportError instanceof Error ? exportError.message : "unknown"}`);
  }
  return paths;
}

export function buildDailySummaryFromJournal(input: {
  day: string;
  journalEntries: JournalEntry[];
  blockedEntries: BlockedEntryTelemetryEntry[];
  unrealizedPnlUsd: number;
  expectedPaperTradeSizeUsd: number;
}): DailySummaryTelemetryEntry {
  const split = splitClosedTradesForReporting(input.journalEntries, {
    expectedPaperTradeSizeUsd: input.expectedPaperTradeSizeUsd
  });
  const dayTrades = split.included
    .filter((trade) => trade.entry.closedAt && utcDayFromIso(trade.entry.closedAt) === input.day)
    .map(toTradeTelemetryForSummary);
  return buildDailySummaryTelemetry({
    day: input.day,
    unrealizedPnlUsd: input.unrealizedPnlUsd,
    tradeRows: dayTrades,
    blockedEntries: input.blockedEntries
  });
}

function toTradeTelemetryForSummary(trade: ClosedTradeForReporting): TradeTelemetryEntry {
  const openedAtMs = Date.parse(trade.entry.openedAt);
  const closedAtMs = trade.entry.closedAt ? Date.parse(trade.entry.closedAt) : openedAtMs;
  return {
    openedAt: trade.entry.openedAt,
    closedAt: trade.entry.closedAt ?? trade.entry.openedAt,
    instrument: trade.entry.instrument,
    side: "LONG",
    entry: trade.entry.entryPrice,
    exit: trade.entry.exitPrice ?? trade.entry.entryPrice,
    qty: trade.entry.quantity,
    pnlUsd: trade.pnl,
    pnlPct: trade.returnPct * 100,
    entryRegime: trade.entry.entryRegime,
    entryRegimeConfidence: trade.entry.entryRegimeConfidence,
    entryBreadthScore: trade.entry.entryBreadthScore,
    entryVolatilityPct: trade.entry.entryVolatilityPct,
    entryEmaSpreadPct: trade.entry.entryEmaSpreadPct,
    exitReason: trade.entry.exitReason,
    holdingMinutes: Math.max(0, (closedAtMs - openedAtMs) / 60_000),
    mfeUsd: 0,
    maeUsd: 0
  };
}
