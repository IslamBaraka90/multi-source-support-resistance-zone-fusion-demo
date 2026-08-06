/*
 * The pipeline.
 *
 *   adapt (yahoo.js) -> validate -> volatility -> 4 sources -> fuse -> report
 *                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *                       fintech-algorithms 0.12.0
 *
 * Every algorithm is imported from its own subpath: as of 0.12.0 a sibling
 * topic's function is not re-exported from a neighbouring subpath.
 */

import { validateBars } from "fintech-algorithms/market-data-engineering/cleaning-and-validation/ohlc-consistency-validator";
import { averageTrueRange } from "fintech-algorithms/technical-indicators/volatility-and-channels/atr";

import { fetchBars, fetchTape } from "./yahoo.js";
import { AnalysisError, TIERS, SOURCES } from "./topics.js";
import {
  coerceParams, deriveTickSize, deriveFusionTolerance, deriveBreakBuffer, median,
} from "./params.js";
import { pivotLevels } from "./sources/pivots.js";
import { roundNumberLevels } from "./sources/round-numbers.js";
import { volumeProfileLevels } from "./sources/volume-profile.js";
import { fibonacciLevels } from "./sources/fibonacci.js";
import { fuseAndScore } from "./fuse.js";

export async function analyze({ symbol, range, interval, tapePlan, params }) {
  const cfg = coerceParams(params);
  const trace = [];
  const step = (name, topic, detail, tierOverride) =>
    trace.push({
      name,
      topic,
      tier: tierOverride ?? (topic ? TIERS[topic] ?? null : null),
      detail,
    });

  /* ------------------------------------------------------------------ fetch */

  // Both series at once: the tape fetch never throws, so a missing intraday
  // feed costs one source rather than the whole request.
  const [structure, tape] = await Promise.all([
    fetchBars(symbol, { range, interval }),
    fetchTape(symbol, tapePlan),
  ]);

  const { meta, bars, droppedByProvider } = structure;

  step("Adapt", null,
    `${bars.length} ${interval} bars from Yahoo Finance over ${range}` +
    (droppedByProvider ? `, ${droppedByProvider} vendor rows had null prices and were dropped` : "") +
    (tape.bars.length
      ? `; plus ${tape.bars.length} ${tape.plan.interval} bars for the volume profile`
      : `; no intraday tape (${tape.unavailable})`));

  /* --------------------------------------------------------------- validate */

  const referencePrice = bars.at(-1)?.close ?? 1;
  const tick = deriveTickSize(referencePrice);

  const verdicts = validateBars(
    bars.map((bar, index) => ({ bar_id: `${bar.symbol}-${index}`, source: "YAHOO", ...bar })),
    { tickSize: tick, toleranceTicks: 1, priceScale: 1 },
  );

  // validateBars is a row-classify topic: it never throws, so ignoring the
  // return value is indistinguishable from "every row passed".
  const invalid = [];
  let clean = bars.filter((bar, i) => {
    if (verdicts[i].valid) return true;
    invalid.push({ timestamp: bar.timestamp, issues: verdicts[i].issues });
    return false;
  });

  /*
   * The validator is tolerance-based by design — it answers "is this bar
   * corrupt?", not "will the next function accept it?". detectCausalPivots
   * applies a *strict* low <= close <= high and throws on a breach, so a bar
   * that is only marginally out still aborts the request. Yahoo really does
   * ship these. Enforce the strict invariant here so a vendor artefact costs
   * one bar rather than the whole analysis.
   */
  const malformed = [];
  clean = clean.filter((bar) => {
    const ordered =
      bar.high >= bar.low &&
      bar.open >= bar.low && bar.open <= bar.high &&
      bar.close >= bar.low && bar.close <= bar.high;
    if (!ordered) malformed.push({ timestamp: bar.timestamp, issues: ["strict OHLC ordering"] });
    return ordered;
  });

  // detectCausalPivots also throws on non-strictly-increasing timestamps, which
  // the OHLC validator does not check.
  const seen = new Set();
  const duplicateTimestamps = [];
  clean = clean.filter((bar) => {
    if (seen.has(bar.timestamp)) {
      duplicateTimestamps.push(bar.timestamp);
      return false;
    }
    seen.add(bar.timestamp);
    return true;
  });

  step("Validate", "ohlc-consistency-validator",
    `${clean.length} bars kept, ${invalid.length} failed OHLC invariants at a ${tick} tick tolerance` +
    (malformed.length ? `, ${malformed.length} breached strict ordering` : "") +
    (duplicateTimestamps.length ? `, ${duplicateTimestamps.length} duplicate timestamps removed` : ""));

  const minimumBars = cfg.swingSpan * 2 + cfg.atrPeriod + 5;
  if (clean.length < minimumBars) {
    throw new AnalysisError(
      `only ${clean.length} usable bars — need at least ${minimumBars} for a ` +
      `${cfg.swingSpan}-bar swing span and a ${cfg.atrPeriod}-period ATR. Widen the range.`,
    );
  }

  /* -------------------------------------------------------------- volatility */

  // Build every column from the same array in one pass. Filtering one column
  // independently would leave the series the same length but shifted, which
  // averageTrueRange cannot detect.
  const high = clean.map((b) => b.high);
  const low = clean.map((b) => b.low);
  const close = clean.map((b) => b.close);

  const { atr } = averageTrueRange(high, low, close, cfg.atrPeriod);
  const atrWarmup = atr.findIndex((v) => v !== null); // measured, not assumed
  const atrMedian = median(atr.filter((v) => v !== null));
  const atrLast = atr.at(-1);

  const lastIndex = clean.length - 1;
  const lastClose = close[lastIndex];
  const windowLow = Math.min(...low);
  const windowHigh = Math.max(...high);

  step("Volatility", "atr",
    `ATR(${cfg.atrPeriod}) = ${fmt(atrLast)}, median ${fmt(atrMedian)}; ` +
    `first ${atrWarmup} positions are warm-up nulls. Every price-unit parameter ` +
    `below is derived from this number.`);

  /* ------------------------------------------------------ the four sources */

  const pivot = pivotLevels({ bars: clean, cfg, atrMedian });
  const rounds = roundNumberLevels({ lastClose, low: windowLow, high: windowHigh, tick });
  const volume = volumeProfileLevels({
    tape, tick, atrMedian, low: windowLow, high: windowHigh, cfg,
  });
  const fib = fibonacciLevels({
    closes: close, tick, atrMedian, lastClose, low: windowLow, high: windowHigh, cfg,
  });

  const results = { pivot, "round-number": rounds, "volume-profile": volume, fibonacci: fib };

  SOURCES.forEach((source) => {
    const result = results[source.tag];
    (result.trace ?? []).forEach((entry) =>
      step(source.label, entry.topic, entry.detail, entry.tier));
    if (result.unavailable) {
      step(source.label, null, `unavailable: ${result.unavailable}`, "unavailable");
    }
  });

  const levels = SOURCES.flatMap((source) => results[source.tag].levels);

  /*
   * The denominator for source_confluence is how many sources actually RAN, not
   * the constant 4. An index with no intraday volume would otherwise be capped
   * at 3/4 confluence forever — penalised for a data gap rather than for a lack
   * of agreement.
   */
  const available = SOURCES.filter((s) => results[s.tag].levels.length > 0);
  const sourcesAvailable = available.length;

  if (sourcesAvailable < cfg.minimumSources) {
    throw new AnalysisError(
      `only ${sourcesAvailable} of 4 level sources produced anything, but a zone ` +
      `needs ${cfg.minimumSources} distinct sources to be accepted. Widen the range ` +
      `or lower the minimum.`,
    );
  }

  /* -------------------------------------------------------------------- fuse */

  const tolerance = deriveFusionTolerance(cfg.fusionAtr, atrMedian, lastClose);
  const buffer = deriveBreakBuffer(atrMedian);

  const { zones, rejected } = fuseAndScore({
    levels, sourcesAvailable, bars: clean, atr, atrMedian, cfg, tolerance, buffer,
  });

  step("Fuse", "multi-source-support-resistance-zone-fusion",
    `${levels.length} levels from ${sourcesAvailable} sources ` +
    `(${available.map((s) => s.label.toLowerCase()).join(", ")}) fused at a ` +
    `${cfg.fusionAtr}x ATR tolerance = ${fmt(tolerance)} in price. ` +
    `${zones.length} zones cleared the ${cfg.minimumSources}-source minimum; ` +
    `${rejected.length} clusters did not.`);

  step("Score", "support-resistance-zone-strength-decay-scoring",
    `${zones.length} zones graded on measured source confluence, decayed touches, ` +
    `rejection quality and breaks (half-life ${cfg.halfLifeBars} bars). ` +
    `source_confluence is source_count / ${sourcesAvailable} — a count, not an estimate.`);

  step("Role", "support-resistance-role-reversal-state-machine",
    `${zones.filter((z) => z.roleReversal?.confirmed).length} zones have a confirmed role flip`);

  step("Breakout", "breakout-and-retest-detection",
    `${zones.filter((z) => z.breakout?.confirmed).length} zones show a confirmed breakout and retest`);

  /* ------------------------------------------------------------------ report */

  return {
    meta,
    params: cfg,
    request: { symbol: meta.symbol, range, interval, tapePlan: tape.plan },
    asOf: clean[lastIndex].timestamp,
    lastClose,
    window: { low: windowLow, high: windowHigh, bars: clean.length },
    atr: { period: cfg.atrPeriod, value: atrLast, median: atrMedian, warmupBars: atrWarmup },
    derived: { tickSize: tick, fusionTolerance: tolerance, breakBuffer: buffer },
    dataQuality: {
      vendorRows: bars.length + droppedByProvider,
      droppedByProvider,
      rejectedByValidator: invalid.length,
      malformedOrdering: malformed.length,
      duplicateTimestamps: duplicateTimestamps.length,
      barsAnalysed: clean.length,
      rejectedSample: [...invalid, ...malformed].slice(0, 5),
      tickSize: tick,
      tape: {
        plan: tape.plan,
        bars: tape.bars.length,
        unavailable: tape.unavailable,
        note: volume.tapeNote ?? null,
      },
    },
    sources: SOURCES.map((source) => ({
      tag: source.tag,
      label: source.label,
      topics: source.topics,
      tiers: source.topics.map((t) => TIERS[t]),
      approximation: source.tag === "volume-profile",
      levelCount: results[source.tag].levels.length,
      levels: results[source.tag].levels,
      unavailable: results[source.tag].unavailable,
      extra: extraFor(source.tag, results[source.tag]),
    })),
    sourcesAvailable,
    bars: clean,
    pivots: pivot.pivots ?? [],
    zones,
    rejected,
    trace,
    tiers: TIERS,
  };
}

function extraFor(tag, result) {
  if (tag === "pivot") return { clusters: result.clusters?.length ?? 0, noise: result.noise?.length ?? 0 };
  if (tag === "round-number") return { baseUnit: result.baseUnit ?? null, closest: result.closest ?? null };
  if (tag === "volume-profile") {
    return result.features
      ? {
        poc: result.features.poc_price,
        valueAreaLow: result.features.value_area_low,
        valueAreaHigh: result.features.value_area_high,
        valueAreaShare: result.features.value_area_share,
        hvn: result.features.hvn.length,
        lvn: result.features.lvn.length,
        bins: result.profile?.rows.length ?? 0,
      }
      : null;
  }
  if (tag === "fibonacci") return result.leg ?? null;
  return null;
}

function fmt(value) {
  return value === null || value === undefined ? "n/a" : Number(value).toFixed(4);
}
