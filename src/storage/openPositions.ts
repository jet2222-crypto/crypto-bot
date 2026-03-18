import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Position } from "../exchange/types";
import { warn } from "../utils/logger";

const openPositionsPath = path.resolve(process.cwd(), "src/storage/open_positions.json");

function ensureOpenPositionsFile(): void {
  const dir = path.dirname(openPositionsPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(openPositionsPath)) {
    writeFileSync(openPositionsPath, "[]\n", "utf-8");
  }
}

function isPosition(value: unknown): value is Position {
  if (!value || typeof value !== "object") {
    return false;
  }

  const pos = value as Partial<Position>;
  const hasCore =
    typeof pos.instrument === "string" &&
    typeof pos.entryPrice === "number" &&
    typeof pos.quantity === "number" &&
    typeof pos.openedAt === "string" &&
    typeof pos.stopLoss === "number" &&
    typeof pos.takeProfit === "number" &&
    typeof pos.highestSeenPrice === "number" &&
    (pos.status === "OPEN" || pos.status === "CLOSED");
  return hasCore;
}

function resetWithWarning(message: string): Position[] {
  warn(message);
  writeFileSync(openPositionsPath, "[]\n", "utf-8");
  return [];
}

export function readOpenPositions(): Position[] {
  ensureOpenPositionsFile();

  let raw: string;
  try {
    raw = readFileSync(openPositionsPath, "utf-8").trim();
  } catch {
    return resetWithWarning("Failed to read open positions file, resetting.");
  }

  if (!raw) {
    return resetWithWarning("Open positions file was empty, resetting.");
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return resetWithWarning("Open positions JSON was not an array, resetting.");
    }
    if (!parsed.every((item) => isPosition(item))) {
      return resetWithWarning("Open positions JSON had invalid entries, resetting.");
    }
    return parsed.filter((position) => position.status === "OPEN");
  } catch {
    return resetWithWarning("Open positions JSON was corrupt, resetting.");
  }
}

export function writeOpenPositions(positions: Position[]): void {
  ensureOpenPositionsFile();
  const openOnly = positions.filter((position) => position.status === "OPEN");
  writeFileSync(openPositionsPath, JSON.stringify(openOnly, null, 2), "utf-8");
}
