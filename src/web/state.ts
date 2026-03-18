import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CryptoComProbeDiagnostics, emptyCryptoComProbeDiagnostics } from "../diagnostics/cryptocomProbe";
import { Signal } from "../exchange/types";
import { MarketRegimeContext } from "../lib/marketRegime";
import { RegimePolicy } from "../lib/regimeConfig";
import { MarketDataSnapshot } from "../marketData/types";
import { DataDegradationState } from "../runtime/dataHealth";
import { PriceSource } from "../strategy/priceSafety";
import { ExecutionMode, NormalizedExecutionStatus, SubmissionState } from "../execution/types";

export type InstrumentSnapshotRow = {
  instrument: string;
  latestPrice: number;
  signal: Signal;
  hasOpenPosition: boolean;
  scannerSelected: boolean;
  volatilityTag: string;
  candleTimestamp: number;
  usedClosedCandle: boolean;
  sameCandleWindowAsPrevious: boolean;
  holdReason: string;
  priceSource: PriceSource;
  trustedForPnl: boolean;
  marketData: MarketDataSnapshot;
};

export type RuntimeSnapshot = {
  botRunning: boolean;
  startedAt: string | null;
  lastCycleTimestamp: string | null;
  lastCycleDurationMs: number | null;
  scannerEnabled: boolean;
  trailingStopEnabled: boolean;
  signalExitEnabled: boolean;
  regimeContext: MarketRegimeContext | null;
  regimePolicy: RegimePolicy | null;
  dataDegradation: DataDegradationState;
  openPositionHealthByInstrument: Record<
    string,
    {
      unpricedCycles: number;
      orphaned: boolean;
    }
  >;
  lastCycleScannerShortlist: string[];
  instrumentRows: InstrumentSnapshotRow[];
  trustedPriceByInstrument: Record<string, number>;
  notes: string[];
  heartbeatAt: string | null;
  cryptoComDiagnostics: CryptoComProbeDiagnostics;
  executionDiagnostics: {
    adapterMode: ExecutionMode;
    liveTradingEnabled: boolean;
    liveExecutionDryRun: boolean;
    lastSubmissionAttempt: {
      at: string;
      action: "ENTRY" | "CLOSE" | "CANCEL";
      instrument?: string;
      orderId?: string;
      clientOrderId?: string;
      status: NormalizedExecutionStatus;
      submissionState: SubmissionState;
      confirmedByExchange: boolean;
      pendingConfirmation: boolean;
      exchangeStatus?: string;
      summary: string;
    } | null;
  };
};

const LIVE_STATUS_PATH = path.resolve(process.cwd(), "data/live_status.json");
const LIVE_STATUS_HEARTBEAT_MAX_AGE_MS = 30_000;

const runtimeSnapshot: RuntimeSnapshot = {
  botRunning: false,
  startedAt: null,
  lastCycleTimestamp: null,
  lastCycleDurationMs: null,
  scannerEnabled: false,
  trailingStopEnabled: false,
  signalExitEnabled: false,
  regimeContext: null,
  regimePolicy: null,
  dataDegradation: {
    degraded: false,
    entriesPaused: false,
    reasons: [],
    counters: {
      consecutiveMockCycles: 0,
      consecutiveFetchFailureCycles: 0,
      staleCandleCycles: 0,
      consecutivePriceRejectCycles: 0,
      healthyRecoveryCycles: 0
    },
    inRecovery: false,
    recoveryProgress: {
      current: 0,
      required: 0
    }
  },
  openPositionHealthByInstrument: {},
  lastCycleScannerShortlist: [],
  instrumentRows: [],
  trustedPriceByInstrument: {},
  notes: [],
  heartbeatAt: null,
  cryptoComDiagnostics: emptyCryptoComProbeDiagnostics(),
  executionDiagnostics: {
    adapterMode: "paper",
    liveTradingEnabled: false,
    liveExecutionDryRun: true,
    lastSubmissionAttempt: null
  }
};

function dedupeNotes(notes: string[]): string[] {
  const out: string[] = [];
  for (const note of notes) {
    if (!out.includes(note)) {
      out.push(note);
    }
  }
  return out.slice(-10);
}

function ensureLiveStatusDir(): void {
  const dir = path.dirname(LIVE_STATUS_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function heartbeatFresh(heartbeatAt: string | null, maxAgeMs = LIVE_STATUS_HEARTBEAT_MAX_AGE_MS): boolean {
  if (!heartbeatAt) {
    return false;
  }
  const parsed = Date.parse(heartbeatAt);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return Date.now() - parsed <= maxAgeMs;
}

function cloneSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
  return {
    ...snapshot,
    regimeContext: snapshot.regimeContext ? { ...snapshot.regimeContext, reasons: [...snapshot.regimeContext.reasons] } : null,
    regimePolicy: snapshot.regimePolicy ? { ...snapshot.regimePolicy } : null,
    dataDegradation: {
      ...snapshot.dataDegradation,
      reasons: [...snapshot.dataDegradation.reasons],
      counters: { ...snapshot.dataDegradation.counters },
      recoveryProgress: { ...snapshot.dataDegradation.recoveryProgress }
    },
    openPositionHealthByInstrument: { ...snapshot.openPositionHealthByInstrument },
    lastCycleScannerShortlist: [...snapshot.lastCycleScannerShortlist],
    instrumentRows: snapshot.instrumentRows.map((row) => ({ ...row, marketData: { ...row.marketData } })),
    trustedPriceByInstrument: { ...snapshot.trustedPriceByInstrument },
    notes: [...snapshot.notes],
    cryptoComDiagnostics: {
      ...snapshot.cryptoComDiagnostics,
      cryptoComCapabilities: { ...snapshot.cryptoComDiagnostics.cryptoComCapabilities },
      warnings: [...snapshot.cryptoComDiagnostics.warnings],
      visibleBalances: snapshot.cryptoComDiagnostics.visibleBalances.map((balance) => ({ ...balance }))
    },
    executionDiagnostics: {
      ...snapshot.executionDiagnostics,
      lastSubmissionAttempt: snapshot.executionDiagnostics.lastSubmissionAttempt
        ? { ...snapshot.executionDiagnostics.lastSubmissionAttempt }
        : null
    }
  };
}

function persistRuntimeSnapshot(snapshot: RuntimeSnapshot): void {
  try {
    ensureLiveStatusDir();
    const tempPath = `${LIVE_STATUS_PATH}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
    renameSync(tempPath, LIVE_STATUS_PATH);
  } catch {
    // Shared status persistence is non-fatal by design.
  }
}

function parseRuntimeSnapshot(raw: string): RuntimeSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeSnapshot>;
    const merged = {
      ...cloneSnapshot(runtimeSnapshot),
      ...parsed,
      dataDegradation: {
        ...runtimeSnapshot.dataDegradation,
        ...(parsed.dataDegradation ?? {}),
        reasons: [...(parsed.dataDegradation?.reasons ?? [])],
        counters: {
          ...runtimeSnapshot.dataDegradation.counters,
          ...(parsed.dataDegradation?.counters ?? {})
        },
        recoveryProgress: {
          ...runtimeSnapshot.dataDegradation.recoveryProgress,
          ...(parsed.dataDegradation?.recoveryProgress ?? {})
        }
      },
      regimeContext: parsed.regimeContext
        ? { ...parsed.regimeContext, reasons: [...(parsed.regimeContext.reasons ?? [])] }
        : null,
      regimePolicy: parsed.regimePolicy ? { ...parsed.regimePolicy } : null,
      openPositionHealthByInstrument: { ...(parsed.openPositionHealthByInstrument ?? {}) },
      lastCycleScannerShortlist: [...(parsed.lastCycleScannerShortlist ?? [])],
      instrumentRows: (parsed.instrumentRows ?? []).map((row) => ({ ...row, marketData: { ...row.marketData } })),
      trustedPriceByInstrument: { ...(parsed.trustedPriceByInstrument ?? {}) },
      notes: [...(parsed.notes ?? [])],
      cryptoComDiagnostics: parsed.cryptoComDiagnostics
        ? {
            ...runtimeSnapshot.cryptoComDiagnostics,
            ...parsed.cryptoComDiagnostics,
            cryptoComCapabilities: {
              ...runtimeSnapshot.cryptoComDiagnostics.cryptoComCapabilities,
              ...(parsed.cryptoComDiagnostics.cryptoComCapabilities ?? {})
            },
            warnings: [...(parsed.cryptoComDiagnostics.warnings ?? [])],
            visibleBalances: (parsed.cryptoComDiagnostics.visibleBalances ?? []).map((balance) => ({ ...balance }))
          }
        : emptyCryptoComProbeDiagnostics(),
      executionDiagnostics: parsed.executionDiagnostics
        ? {
            ...runtimeSnapshot.executionDiagnostics,
            ...parsed.executionDiagnostics,
            lastSubmissionAttempt: parsed.executionDiagnostics.lastSubmissionAttempt
              ? { ...parsed.executionDiagnostics.lastSubmissionAttempt }
              : null
          }
        : { ...runtimeSnapshot.executionDiagnostics }
    } satisfies RuntimeSnapshot;
    merged.botRunning = heartbeatFresh(merged.heartbeatAt);
    return merged;
  } catch {
    return null;
  }
}

export function initializeRuntimeSnapshot(input: {
  scannerEnabled: boolean;
  trailingStopEnabled: boolean;
  signalExitEnabled: boolean;
  executionMode: ExecutionMode;
  liveTradingEnabled: boolean;
  liveExecutionDryRun: boolean;
}): void {
  runtimeSnapshot.scannerEnabled = input.scannerEnabled;
  runtimeSnapshot.trailingStopEnabled = input.trailingStopEnabled;
  runtimeSnapshot.signalExitEnabled = input.signalExitEnabled;
  runtimeSnapshot.executionDiagnostics.adapterMode = input.executionMode;
  runtimeSnapshot.executionDiagnostics.liveTradingEnabled = input.liveTradingEnabled;
  runtimeSnapshot.executionDiagnostics.liveExecutionDryRun = input.liveExecutionDryRun;
}

export function markBotRunning(startedAtIso: string): void {
  runtimeSnapshot.botRunning = true;
  runtimeSnapshot.startedAt = startedAtIso;
  runtimeSnapshot.heartbeatAt = startedAtIso;
  persistRuntimeSnapshot(cloneSnapshot(runtimeSnapshot));
}

export function updateCycleSnapshot(input: {
  cycleTimestampIso: string;
  cycleDurationMs: number;
  scannerShortlist: string[];
  rows: InstrumentSnapshotRow[];
  regimeContext: MarketRegimeContext;
  regimePolicy: RegimePolicy;
  dataDegradation: DataDegradationState;
  openPositionHealthByInstrument: RuntimeSnapshot["openPositionHealthByInstrument"];
}): void {
  runtimeSnapshot.lastCycleTimestamp = input.cycleTimestampIso;
  runtimeSnapshot.lastCycleDurationMs = input.cycleDurationMs;
  runtimeSnapshot.lastCycleScannerShortlist = [...input.scannerShortlist];
  runtimeSnapshot.regimeContext = { ...input.regimeContext, reasons: [...input.regimeContext.reasons] };
  runtimeSnapshot.regimePolicy = { ...input.regimePolicy };
  runtimeSnapshot.dataDegradation = {
    ...input.dataDegradation,
    reasons: [...input.dataDegradation.reasons],
    counters: { ...input.dataDegradation.counters },
    recoveryProgress: { ...input.dataDegradation.recoveryProgress }
  };
  runtimeSnapshot.openPositionHealthByInstrument = { ...input.openPositionHealthByInstrument };
  runtimeSnapshot.instrumentRows = input.rows.map((row) => ({ ...row, marketData: { ...row.marketData } }));
  runtimeSnapshot.trustedPriceByInstrument = {};
  for (const row of input.rows) {
    if (row.trustedForPnl) {
      runtimeSnapshot.trustedPriceByInstrument[row.instrument] = row.latestPrice;
    }
  }
  runtimeSnapshot.botRunning = true;
  runtimeSnapshot.heartbeatAt = new Date().toISOString();
  persistRuntimeSnapshot(cloneSnapshot(runtimeSnapshot));
}

export function addRuntimeNote(note: string): void {
  runtimeSnapshot.notes = dedupeNotes([...runtimeSnapshot.notes, note]);
  persistRuntimeSnapshot(cloneSnapshot(runtimeSnapshot));
}

export function updateCryptoComDiagnostics(diagnostics: CryptoComProbeDiagnostics): void {
  runtimeSnapshot.cryptoComDiagnostics = {
    ...diagnostics,
    cryptoComCapabilities: { ...diagnostics.cryptoComCapabilities },
    warnings: [...diagnostics.warnings],
    visibleBalances: diagnostics.visibleBalances.map((balance) => ({ ...balance }))
  };
  persistRuntimeSnapshot(cloneSnapshot(runtimeSnapshot));
}

export function updateExecutionSubmissionAttempt(
  attempt: RuntimeSnapshot["executionDiagnostics"]["lastSubmissionAttempt"]
): void {
  runtimeSnapshot.executionDiagnostics.lastSubmissionAttempt = attempt ? { ...attempt } : null;
  persistRuntimeSnapshot(cloneSnapshot(runtimeSnapshot));
}

export function getRuntimeSnapshot(): RuntimeSnapshot {
  if (existsSync(LIVE_STATUS_PATH)) {
    try {
      const parsed = parseRuntimeSnapshot(readFileSync(LIVE_STATUS_PATH, "utf-8"));
      if (parsed) {
        return parsed;
      }
    } catch {
      // fall through to in-memory/default state
    }
  }
  const snapshot = cloneSnapshot(runtimeSnapshot);
  snapshot.botRunning = heartbeatFresh(snapshot.heartbeatAt);
  return snapshot;
}

export function getLiveStatusPath(): string {
  return LIVE_STATUS_PATH;
}
