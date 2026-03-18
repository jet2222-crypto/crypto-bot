import { config } from "../config/env";
import { getCandles } from "../exchange/cryptocomRest";
import { readScannerDecisionTelemetry } from "../telemetry/store";
import {
  analyzeMissedOpportunity,
  MissedOpportunityResult,
  MissedOpportunitySummary,
  selectMissedCandidates,
  summarizeMissedOpportunityResults
} from "./missedOpportunity";

const DEFAULT_WINDOW_HOURS = 12;
const CACHE_TTL_MS = 5 * 60_000;

let cachedSummary: MissedOpportunitySummary | null = null;
let cachedAt = 0;
let inflight: Promise<MissedOpportunitySummary> | null = null;

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
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
  return results;
}

export async function computeMissedOpportunitySummary(windowHours = DEFAULT_WINDOW_HOURS): Promise<MissedOpportunitySummary> {
  const until = new Date();
  const since = new Date(until.getTime() - windowHours * 3_600_000);
  const rows = readScannerDecisionTelemetry();
  const candidates = selectMissedCandidates(rows, since.toISOString(), until.toISOString());

  if (candidates.length === 0) {
    return summarizeMissedOpportunityResults({
      windowHours,
      candidatesReviewed: 0,
      analyses: []
    });
  }

  const uniqueInstruments = Array.from(new Set(candidates.map((candidate) => candidate.instrument)));
  const candlePackets = await mapWithConcurrency(uniqueInstruments, 4, async (instrument) => {
    try {
      const candles = await getCandles(instrument, config.timeframe);
      return { instrument, candles };
    } catch {
      return { instrument, candles: [] };
    }
  });
  const candleByInstrument = new Map(candlePackets.map((packet) => [packet.instrument, packet.candles]));
  const analyses: MissedOpportunityResult[] = candidates
    .map((candidate) =>
      analyzeMissedOpportunity({
        decision: candidate,
        candles: candleByInstrument.get(candidate.instrument) ?? [],
        lookback: config.lookback,
        breakoutBufferPct: config.breakoutBufferPct,
        futureCandlesToCheck: 3,
        minWorthwhileMovePct: config.minTpDistancePct * 100
      })
    )
    .filter((item) => item.futureCandlesChecked > 0);

  return summarizeMissedOpportunityResults({
    windowHours,
    candidatesReviewed: candidates.length,
    analyses
  });
}

export async function getCachedMissedOpportunitySummary(windowHours = DEFAULT_WINDOW_HOURS): Promise<MissedOpportunitySummary> {
  const now = Date.now();
  if (cachedSummary && now - cachedAt < CACHE_TTL_MS) {
    return cachedSummary;
  }
  if (inflight) {
    return inflight;
  }
  inflight = computeMissedOpportunitySummary(windowHours)
    .then((summary) => {
      cachedSummary = summary;
      cachedAt = Date.now();
      return summary;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function clearMissedOpportunityCache(): void {
  cachedSummary = null;
  cachedAt = 0;
  inflight = null;
}
