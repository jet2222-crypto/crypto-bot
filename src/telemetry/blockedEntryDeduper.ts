import { BlockedEntryReason } from "./store";

export type BlockedEntryDedupeInput = {
  instrument: string;
  signal: string;
  regime: string;
  reasonBlocked: BlockedEntryReason;
  candidateScore?: number;
  price: number;
};

type BlockedEntryCacheValue = {
  atMs: number;
  price: number;
};

function candidateScoreKey(candidateScore?: number): string {
  return typeof candidateScore === "number" ? candidateScore.toFixed(4) : "na";
}

function priceMovedMaterially(previousPrice: number, nextPrice: number, thresholdPct: number): boolean {
  if (!Number.isFinite(previousPrice) || previousPrice <= 0) {
    return true;
  }
  if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
    return false;
  }
  return Math.abs(nextPrice - previousPrice) / previousPrice >= thresholdPct;
}

export class BlockedEntryTelemetryDeduper {
  private readonly cache = new Map<string, BlockedEntryCacheValue>();

  constructor(
    private readonly cooldownMs: number,
    private readonly materialPriceChangePct: number
  ) {}

  public shouldEmit(input: BlockedEntryDedupeInput, nowMs: number): boolean {
    const key = [
      input.instrument,
      input.signal,
      input.regime,
      input.reasonBlocked,
      candidateScoreKey(input.candidateScore)
    ].join("|");
    const previous = this.cache.get(key);

    if (!previous) {
      this.cache.set(key, { atMs: nowMs, price: input.price });
      return true;
    }

    if (priceMovedMaterially(previous.price, input.price, this.materialPriceChangePct)) {
      this.cache.set(key, { atMs: nowMs, price: input.price });
      return true;
    }

    if (nowMs - previous.atMs >= this.cooldownMs) {
      this.cache.set(key, { atMs: nowMs, price: input.price });
      return true;
    }

    return false;
  }
}
