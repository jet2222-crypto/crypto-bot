import { Position } from "../exchange/types";
import { ClosedTradeForReporting } from "./journalSanity";

export type CapitalMode = "paper" | "live";

export type CapitalReport = {
  capitalMode: CapitalMode;
  startingCapitalUsd: number;
  currentEquityUsd: number;
  realizedEquityUsd: number;
  deployedCapitalUsd: number;
  freeCapitalUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  combinedPnlUsd: number;
  realizedReturnPct: number;
  unrealizedReturnPct: number;
  netReturnPct: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
};

export type CapitalReportInput = {
  startingCapitalUsd: number;
  openPositions: Position[];
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  closedTrades: ClosedTradeForReporting[];
};

export interface CapitalReportSource {
  readonly capitalMode: CapitalMode;
  buildReport(input: CapitalReportInput): CapitalReport;
}

function safePct(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return (numerator / denominator) * 100;
}

function computeMaxDrawdown(startingCapitalUsd: number, closedTrades: ClosedTradeForReporting[]): {
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
} {
  const ordered = [...closedTrades].sort((left, right) => {
    const leftTs = Date.parse(left.entry.closedAt ?? left.entry.openedAt);
    const rightTs = Date.parse(right.entry.closedAt ?? right.entry.openedAt);
    return leftTs - rightTs;
  });

  let equity = startingCapitalUsd;
  let peak = startingCapitalUsd;
  let maxDrawdownUsd = 0;
  let maxDrawdownPct = 0;

  for (const trade of ordered) {
    equity += trade.pnl;
    if (equity > peak) {
      peak = equity;
      continue;
    }

    const drawdownUsd = peak - equity;
    const drawdownPct = safePct(drawdownUsd, peak);
    if (drawdownUsd > maxDrawdownUsd) {
      maxDrawdownUsd = drawdownUsd;
    }
    if (drawdownPct > maxDrawdownPct) {
      maxDrawdownPct = drawdownPct;
    }
  }

  return { maxDrawdownUsd, maxDrawdownPct };
}

export class PaperCapitalReportSource implements CapitalReportSource {
  public readonly capitalMode = "paper" as const;

  public buildReport(input: CapitalReportInput): CapitalReport {
    const combinedPnlUsd = input.realizedPnlUsd + input.unrealizedPnlUsd;
    const deployedCapitalUsd = input.openPositions.reduce(
      (sum, position) => sum + position.entryPrice * position.quantity,
      0
    );
    const currentEquityUsd = input.startingCapitalUsd + combinedPnlUsd;
    const realizedEquityUsd = input.startingCapitalUsd + input.realizedPnlUsd;
    const { maxDrawdownUsd, maxDrawdownPct } = computeMaxDrawdown(input.startingCapitalUsd, input.closedTrades);

    return {
      capitalMode: this.capitalMode,
      startingCapitalUsd: input.startingCapitalUsd,
      currentEquityUsd,
      realizedEquityUsd,
      deployedCapitalUsd,
      freeCapitalUsd: currentEquityUsd - deployedCapitalUsd,
      realizedPnlUsd: input.realizedPnlUsd,
      unrealizedPnlUsd: input.unrealizedPnlUsd,
      combinedPnlUsd,
      realizedReturnPct: safePct(input.realizedPnlUsd, input.startingCapitalUsd),
      unrealizedReturnPct: safePct(input.unrealizedPnlUsd, input.startingCapitalUsd),
      netReturnPct: safePct(combinedPnlUsd, input.startingCapitalUsd),
      maxDrawdownUsd,
      maxDrawdownPct
    };
  }
}
