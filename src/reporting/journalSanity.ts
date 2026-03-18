import { JournalEntry } from "../exchange/types";

export type TradeSanityThresholds = {
  maxPriceRatio: number;
  minPriceRatio: number;
  maxAbsReturnPct: number;
  maxAbsPnlToNotional: number;
  maxAbsPnlUsd: number;
  pnlMismatchTolerancePct: number;
};

export type SuspiciousClosedTrade = {
  entry: JournalEntry;
  reasons: string[];
};

export type ClosedTradeForReporting = {
  entry: JournalEntry;
  pnl: number;
  entryNotional: number;
  returnPct: number;
};

type ClosedJournalEntry = JournalEntry & {
  side: "SELL";
  pnl: number;
  closedAt: string;
  exitPrice: number;
};

const DEFAULT_THRESHOLDS: TradeSanityThresholds = {
  maxPriceRatio: 15,
  minPriceRatio: 0.05,
  maxAbsReturnPct: 2.5,
  maxAbsPnlToNotional: 2.5,
  maxAbsPnlUsd: 2_000,
  pnlMismatchTolerancePct: 0.15
};

export function getDefaultSanityThresholds(): TradeSanityThresholds {
  return { ...DEFAULT_THRESHOLDS };
}

function isClosedTradeCandidate(entry: JournalEntry): entry is ClosedJournalEntry {
  return (
    entry.side === "SELL" &&
    typeof entry.pnl === "number" &&
    Number.isFinite(entry.pnl) &&
    typeof entry.closedAt === "string" &&
    typeof entry.exitPrice === "number" &&
    Number.isFinite(entry.exitPrice)
  );
}

export function assessClosedTradeSanity(
  entry: JournalEntry,
  options?: {
    thresholds?: Partial<TradeSanityThresholds>;
    expectedPaperTradeSizeUsd?: number;
  }
): SuspiciousClosedTrade | null {
  const thresholds: TradeSanityThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(options?.thresholds ?? {})
  };
  const reasons: string[] = [];

  if (!isClosedTradeCandidate(entry)) {
    reasons.push("MISSING_CLOSED_FIELDS");
    return { entry, reasons };
  }

  if (
    !Number.isFinite(entry.entryPrice) ||
    entry.entryPrice <= 0 ||
    !Number.isFinite(entry.quantity) ||
    entry.quantity <= 0
  ) {
    reasons.push("INVALID_ENTRY_OR_QUANTITY");
    return { entry, reasons };
  }

  if (entry.exitPrice <= 0) {
    reasons.push("INVALID_EXIT_PRICE");
    return { entry, reasons };
  }

  const entryNotional = entry.entryPrice * entry.quantity;
  if (!Number.isFinite(entryNotional) || entryNotional <= 0) {
    reasons.push("INVALID_NOTIONAL");
    return { entry, reasons };
  }

  const priceRatio = entry.exitPrice / entry.entryPrice;
  if (!Number.isFinite(priceRatio) || priceRatio > thresholds.maxPriceRatio || priceRatio < thresholds.minPriceRatio) {
    reasons.push("ABSURD_PRICE_RATIO");
  }

  const returnPct = (entry.exitPrice - entry.entryPrice) / entry.entryPrice;
  if (Math.abs(returnPct) > thresholds.maxAbsReturnPct) {
    reasons.push("IMPLAUSIBLE_RETURN_PCT");
  }

  const absPnl = Math.abs(entry.pnl);
  if (absPnl > entryNotional * thresholds.maxAbsPnlToNotional) {
    reasons.push("PNL_NOTIONAL_MISMATCH");
  }

  const maxAbsPnlUsd =
    typeof options?.expectedPaperTradeSizeUsd === "number" && options.expectedPaperTradeSizeUsd > 0
      ? Math.max(thresholds.maxAbsPnlUsd, options.expectedPaperTradeSizeUsd * 5)
      : thresholds.maxAbsPnlUsd;
  if (absPnl > maxAbsPnlUsd) {
    reasons.push("ABSURD_ABS_PNL");
  }

  const recomputedPnl = (entry.exitPrice - entry.entryPrice) * entry.quantity;
  const mismatchTolerance = Math.max(0.01, Math.abs(recomputedPnl) * thresholds.pnlMismatchTolerancePct);
  if (Math.abs(recomputedPnl - entry.pnl) > mismatchTolerance) {
    reasons.push("PNL_PRICE_MISMATCH");
  }

  return reasons.length > 0 ? { entry, reasons } : null;
}

export function splitClosedTradesForReporting(
  journalEntries: JournalEntry[],
  options?: {
    thresholds?: Partial<TradeSanityThresholds>;
    expectedPaperTradeSizeUsd?: number;
  }
): { included: ClosedTradeForReporting[]; excluded: SuspiciousClosedTrade[] } {
  const included: ClosedTradeForReporting[] = [];
  const excluded: SuspiciousClosedTrade[] = [];

  for (const entry of journalEntries) {
    if (!isClosedTradeCandidate(entry)) {
      continue;
    }
    const suspicious = assessClosedTradeSanity(entry, options);
    if (suspicious) {
      excluded.push(suspicious);
      continue;
    }

    const entryNotional = entry.entryPrice * entry.quantity;
    included.push({
      entry,
      pnl: entry.pnl,
      entryNotional,
      returnPct: (entry.exitPrice - entry.entryPrice) / entry.entryPrice
    });
  }

  return { included, excluded };
}

export function buildJournalReviewReport(input: {
  suspicious: SuspiciousClosedTrade[];
  maxExamples?: number;
}): string {
  const maxExamples = input.maxExamples ?? 5;
  const lines: string[] = [];
  lines.push("=== Journal Review (PAPER ONLY) ===");
  lines.push(`Suspicious closed trades: ${input.suspicious.length}`);

  if (input.suspicious.length === 0) {
    lines.push("No suspicious trades detected.");
    return lines.join("\n");
  }

  lines.push("Examples:");
  for (const [index, item] of input.suspicious.slice(0, maxExamples).entries()) {
    const entry = item.entry;
    lines.push(
      `${index + 1}. ${entry.instrument} opened=${entry.openedAt} closed=${entry.closedAt ?? "N/A"} entry=${
        entry.entryPrice
      } exit=${entry.exitPrice ?? "N/A"} qty=${entry.quantity} pnl=${entry.pnl ?? "N/A"} reasons=${item.reasons.join(
        ","
      )}`
    );
  }
  if (input.suspicious.length > maxExamples) {
    lines.push(`... ${input.suspicious.length - maxExamples} more`);
  }

  return lines.join("\n");
}
