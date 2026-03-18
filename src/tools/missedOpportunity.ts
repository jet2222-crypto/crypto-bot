import { analyzeMissedOpportunity, selectMissedCandidates } from "../analysis/missedOpportunity";
import { config } from "../config/env";
import { getCandles } from "../exchange/cryptocomRest";
import { readScannerDecisionTelemetry } from "../telemetry/store";
import { formatPrice } from "../utils/format";

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

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

async function main(): Promise<void> {
  const hoursArg = Number(process.argv[2] ?? "12");
  const hours = Number.isFinite(hoursArg) && hoursArg > 0 ? hoursArg : 12;
  const until = new Date();
  const since = new Date(until.getTime() - hours * 3_600_000);

  const rows = readScannerDecisionTelemetry();
  const candidates = selectMissedCandidates(rows, since.toISOString(), until.toISOString());

  if (candidates.length === 0) {
    console.log(`MISSED OPPORTUNITY ANALYSIS (last ${hours}h)`);
    console.log("Shortlisted reviewed: 0");
    console.log("Not traded: 0");
    console.log("Breakout-like moves afterward: 0");
    console.log("Would likely have been profitable: 0");
    console.log("Would likely have failed/noised out: 0");
    console.log("");
    console.log("Conclusion:");
    console.log("- no shortlisted non-traded NO_BREAKOUT decisions found in this window");
    return;
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
  const analyses = candidates
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

  const missedBreakouts = analyses.filter((item) => item.outcome === "MISSED_BREAKOUT");
  const profitable = analyses.filter((item) => item.profitableAfterWindow);
  const failedOrNoisy = analyses.filter(
    (item) => item.outcome === "FAILED_OR_REVERSED" || item.outcome === "SMALL_OR_NOISY"
  );
  const topExamples = [...analyses]
    .sort((left, right) => right.maxFavorableMovePct - left.maxFavorableMovePct)
    .slice(0, 5);

  console.log(`MISSED OPPORTUNITY ANALYSIS (last ${hours}h)`);
  console.log(`Shortlisted reviewed: ${candidates.length}`);
  console.log(`Not traded: ${candidates.length}`);
  console.log(`Breakout-like moves afterward: ${missedBreakouts.length}`);
  console.log(`Would likely have been profitable: ${profitable.length}`);
  console.log(`Would likely have failed/noised out: ${failedOrNoisy.length}`);
  console.log("");
  console.log("Top examples:");
  if (topExamples.length === 0) {
    console.log("- no analyzable candidates");
  } else {
    for (const example of topExamples) {
      console.log(
        `- ${example.instrument} decision=${new Date(example.decisionCandleTimestamp).toISOString()} price=${formatPrice(
          example.decisionPrice
        )} fav=${pct(example.maxFavorableMovePct)} adv=${pct(example.maxAdverseMovePct)} end=${pct(
          example.endCloseReturnPct
        )} outcome=${example.outcome}`
      );
    }
  }
  console.log("");
  console.log("Conclusion:");
  if (missedBreakouts.length === 0) {
    console.log("- low opportunity environment or breakout filter behaved reasonably");
  } else {
    console.log("- some missed breakouts detected");
  }
}

void main();
