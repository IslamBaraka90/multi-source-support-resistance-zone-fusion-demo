/*
 * Live smoke run across a deliberately awkward set of instruments.
 *
 *   node tools/smoke.mjs [SYMBOL ...]
 *
 * The defaults are not a random watchlist — each one is here to break something
 * specific:
 *
 *   AAPL     a normal, well-behaved equity
 *   BRK-A    ~$700k a share; any absolute price constant falls apart on it
 *   EURUSD=X four decimals, and a series Yahoo ships with real OHLC violations
 *   ^GSPC    an index: no usable volume, so the profile source must drop out
 *   TSLA     wide bars, the worst case for the bar-to-tape approximation
 */

import { analyze } from "../server/analyze.js";

const symbols = process.argv.slice(2).length ? process.argv.slice(2)
  : ["AAPL", "BRK-A", "EURUSD=X", "^GSPC", "TSLA"];

let failures = 0;

for (const symbol of symbols) {
  process.stdout.write(`\n${"=".repeat(72)}\n${symbol}\n${"=".repeat(72)}\n`);
  try {
    const report = await analyze({ symbol, range: "2y", interval: "1d", params: {} });

    console.log(`${report.meta.name} · ${report.meta.exchange} · ${report.meta.currency}`);
    console.log(`last close ${report.lastClose}  as of ${report.asOf}`);
    console.log(`tick ${report.derived.tickSize}  fusion tolerance ${report.derived.fusionTolerance.toFixed(6)}  ATR ${report.atr.median?.toFixed(6)}`);
    console.log(`bars ${report.dataQuality.barsAnalysed} of ${report.dataQuality.vendorRows} vendor rows`);

    console.log("\nsources:");
    for (const source of report.sources) {
      const status = source.unavailable ? `UNAVAILABLE — ${source.unavailable}` : `${source.levelCount} levels`;
      console.log(`  ${source.label.padEnd(16)} ${status}`);
    }
    console.log(`  -> ${report.sourcesAvailable} of 4 sources ran`);

    console.log(`\nzones: ${report.zones.length} accepted, ${report.rejected.length} clusters rejected`);
    for (const zone of report.zones.slice(0, 6)) {
      console.log(
        `  ${zone.zoneId}  ${String(zone.grade).padEnd(9)} ${zone.score.toFixed(1).padStart(5)}  ` +
        `${zone.lower.toFixed(4)}–${zone.upper.toFixed(4)}  ` +
        `${zone.sourceCount}/${zone.sourcesAvailable} sources [${zone.sources.join(", ")}]  ` +
        `${zone.touchCount} touches  ${String(zone.distanceBps).padStart(8)} bps away`,
      );
    }

    if (!report.zones.length) {
      console.log("  (no zone cleared the minimum-source bar)");
    }
  } catch (error) {
    failures += 1;
    console.error(`FAILED [${error.name}] ${error.message}`);
  }
}

console.log(`\n${"=".repeat(72)}`);
console.log(failures ? `${failures} of ${symbols.length} symbols failed` : `all ${symbols.length} symbols analysed`);
process.exit(failures ? 1 : 0);
