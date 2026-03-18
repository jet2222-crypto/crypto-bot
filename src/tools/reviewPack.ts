import { writeReviewPack } from "../telemetry/store";

const paths = writeReviewPack(process.cwd());

console.log(`Review pack generated:
${paths.tradesExportPath}
${paths.regimeExportPath}
${paths.blockedExportPath}
${paths.summaryExportPath}`);
