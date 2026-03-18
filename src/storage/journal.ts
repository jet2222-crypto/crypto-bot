import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { JournalEntry } from "../exchange/types";
import { warn } from "../utils/logger";

const journalPath = path.resolve(process.cwd(), "src/storage/trades.json");
const validReasons = new Set([
  "BREAKOUT_BUY_SIGNAL",
  "MANUAL_OPEN",
  "STOP_LOSS",
  "TAKE_PROFIT",
  "TRAILING_STOP",
  "MANUAL",
  "SIGNAL_EXIT"
]);

function isJournalEntry(value: unknown): value is JournalEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<JournalEntry>;
  const hasRequiredStrings =
    typeof candidate.instrument === "string" &&
    (candidate.side === "BUY" || candidate.side === "SELL") &&
    typeof candidate.openedAt === "string" &&
    typeof candidate.reason === "string" &&
    validReasons.has(candidate.reason);
  const hasRequiredNumbers =
    typeof candidate.entryPrice === "number" && typeof candidate.quantity === "number";
  const hasValidExitReason =
    candidate.exitReason === undefined ||
    candidate.exitReason === "STOP_LOSS" ||
    candidate.exitReason === "TAKE_PROFIT" ||
    candidate.exitReason === "TRAILING_STOP" ||
    candidate.exitReason === "MANUAL" ||
    candidate.exitReason === "SIGNAL_EXIT";

  return hasRequiredStrings && hasRequiredNumbers && hasValidExitReason;
}

function ensureJournalFile(): void {
  const dir = path.dirname(journalPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (!existsSync(journalPath)) {
    writeFileSync(journalPath, "[]\n", "utf-8");
  }
}

function resetJournalWithWarning(message: string): JournalEntry[] {
  warn(message);
  writeFileSync(journalPath, "[]\n", "utf-8");
  return [];
}

export function readJournal(): JournalEntry[] {
  ensureJournalFile();

  let raw: string;
  try {
    raw = readFileSync(journalPath, "utf-8").trim();
  } catch {
    return resetJournalWithWarning("Failed to read journal, resetting to empty array.");
  }

  if (!raw) {
    return resetJournalWithWarning("Journal file was empty, resetting to empty array.");
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return resetJournalWithWarning("Journal JSON was not an array, resetting.");
    }
    if (!parsed.every((entry) => isJournalEntry(entry))) {
      return resetJournalWithWarning("Journal JSON had invalid entries, resetting.");
    }
    return parsed;
  } catch {
    return resetJournalWithWarning("Journal JSON was corrupt, resetting.");
  }
}

export function appendJournalEntry(entry: JournalEntry): void {
  const journal = readJournal();
  journal.push(entry);
  writeFileSync(journalPath, JSON.stringify(journal, null, 2), "utf-8");
}
