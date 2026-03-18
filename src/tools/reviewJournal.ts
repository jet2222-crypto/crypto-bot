import { config } from "../config/env";
import { buildJournalReviewReport, splitClosedTradesForReporting } from "../reporting/journalSanity";
import { readJournal } from "../storage/journal";

function main(): void {
  const entries = readJournal();
  const split = splitClosedTradesForReporting(entries, {
    expectedPaperTradeSizeUsd: config.paperTradeSizeUsd
  });

  const report = buildJournalReviewReport({
    suspicious: split.excluded,
    maxExamples: 10
  });

  console.log(report);
}

main();
