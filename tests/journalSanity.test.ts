import { describe, expect, it } from "vitest";
import { JournalEntry } from "../src/exchange/types";
import {
  assessClosedTradeSanity,
  buildJournalReviewReport,
  splitClosedTradesForReporting
} from "../src/reporting/journalSanity";

function makeClosedTrade(overrides?: Partial<JournalEntry>): JournalEntry {
  return {
    instrument: "ETH_USDT",
    side: "SELL",
    entryPrice: 100,
    exitPrice: 103,
    quantity: 1,
    openedAt: "2026-03-08T00:00:00.000Z",
    closedAt: "2026-03-08T00:05:00.000Z",
    pnl: 3,
    reason: "TAKE_PROFIT",
    exitReason: "TAKE_PROFIT",
    ...overrides
  };
}

describe("journal sanity filtering", () => {
  it("keeps sane trades in reporting set", () => {
    const split = splitClosedTradesForReporting([makeClosedTrade()], {
      expectedPaperTradeSizeUsd: 100
    });
    expect(split.included).toHaveLength(1);
    expect(split.excluded).toHaveLength(0);
  });

  it("flags absurd price-ratio and pnl trades as suspicious", () => {
    const suspicious = assessClosedTradeSanity(
      makeClosedTrade({
        instrument: "NOT_USDT",
        entryPrice: 0.0181,
        exitPrice: 50_014.1,
        quantity: 5524.861878453039,
        pnl: 276_326_872
      }),
      { expectedPaperTradeSizeUsd: 100 }
    );
    expect(suspicious).not.toBeNull();
    expect(suspicious?.reasons).toContain("ABSURD_PRICE_RATIO");
    expect(suspicious?.reasons).toContain("ABSURD_ABS_PNL");
  });

  it("builds a readable review report", () => {
    const split = splitClosedTradesForReporting(
      [
        makeClosedTrade(),
        makeClosedTrade({
          instrument: "ENJ_USDT",
          entryPrice: 0.1,
          exitPrice: 10_000,
          quantity: 1000,
          pnl: 9_999_900
        })
      ],
      { expectedPaperTradeSizeUsd: 100 }
    );

    const report = buildJournalReviewReport({ suspicious: split.excluded, maxExamples: 1 });
    expect(report).toContain("Suspicious closed trades: 1");
    expect(report).toContain("ENJ_USDT");
    expect(report).toContain("reasons=");
  });
});
