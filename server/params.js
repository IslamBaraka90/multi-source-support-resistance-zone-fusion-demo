/*
 * Every parameter this app hands the library, in one place, each with the
 * reason it is derived rather than fixed.
 *
 * The rule: a parameter expressed in *price* must never be a constant. The
 * library has three such parameters and all three are hostile to constants —
 * see the notes on `fusion_tolerance` and `minSeparation` below. Parameters the
 * caller chooses are expressed in ATR or basis points, and converted to price
 * here, once.
 */

/** What the user actually turns. Nothing here is in price units. */
export const DEFAULT_PARAMS = {
  swingSpan: 5,          // leftSpan and rightSpan for pivot detection
  prominenceAtr: 0.25,   // pivot prominence, in ATR (see minSeparation below)
  clusterBps: 150,       // pivot clustering radius, in basis points
  minTouches: 2,         // pivots needed before a cluster counts as a level
  atrPeriod: 14,         // Wilder period
  halfLifeBars: 60,      // touch/durability decay half-life for zone scoring
  fusionAtr: 0.35,       // fusion tolerance, in ATR (see fusion_tolerance below)
  minimumSources: 2,     // distinct sources a zone must have to be accepted
  zigzagAtr: 3,          // zigzag reversal threshold, in ATR
  valueAreaFraction: 0.7,
  roundStep: 0,          // round-number grid, in rungs from auto (see deriveBaseUnit)
};

export function coerceParams(raw = {}) {
  const p = { ...DEFAULT_PARAMS };
  const clamp = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  p.swingSpan = Math.round(clamp(raw.swingSpan, 1, 30, p.swingSpan));
  p.prominenceAtr = clamp(raw.prominenceAtr, 0, 3, p.prominenceAtr);
  p.clusterBps = clamp(raw.clusterBps, 1, 2000, p.clusterBps);
  p.minTouches = Math.round(clamp(raw.minTouches, 1, 10, p.minTouches));
  p.atrPeriod = Math.round(clamp(raw.atrPeriod, 2, 100, p.atrPeriod));
  p.halfLifeBars = clamp(raw.halfLifeBars, 1, 1000, p.halfLifeBars);
  p.fusionAtr = clamp(raw.fusionAtr, 0.01, 3, p.fusionAtr);
  p.minimumSources = Math.round(clamp(raw.minimumSources, 1, 4, p.minimumSources));
  p.zigzagAtr = clamp(raw.zigzagAtr, 0.5, 15, p.zigzagAtr);
  p.valueAreaFraction = clamp(raw.valueAreaFraction, 0.5, 0.95, p.valueAreaFraction);
  p.roundStep = Math.round(clamp(raw.roundStep, -3, 3, p.roundStep));
  return p;
}

/*
 * tickSize is instrument-dependent, and getting it wrong is not harmless: a
 * 0.01 tolerance on a 1.16 FX rate is larger than every violation Yahoo
 * actually ships in that series, so the validator passes corrupt bars. Scale it
 * to the quote instead — four significant figures of tolerance — capped at a
 * penny so equities keep the conventional increment.
 */
export function deriveTickSize(referencePrice) {
  const exponent = Math.min(-2, Math.max(-8,
    Math.floor(Math.log10(Math.abs(referencePrice) || 1)) - 4));
  // 10 ** -4 is 0.00009999999999999999; parse the decimal literal instead so
  // the tolerance handed to the library is the number it claims to be.
  return Number(`1e${exponent}`);
}

/*
 * Snap a price onto the tick grid and return the exact value the grid produces.
 *
 * Three library topics call `alignedTicks(price, tick)` internally and throw if
 * |price - round(price/tick) * tick| > tick * 1e-8. Passing a "nearly aligned"
 * price is therefore a hard error, not a rounding nuisance. Returning
 * `ticks * tick` rather than the caller's number guarantees the check passes,
 * because it is the same expression the library recomputes.
 */
export function snapToTick(price, tick) {
  return Math.round(price / tick) * tick;
}

/*
 * NOTE ON minSeparation  (causal-pivot-detection)
 * -----------------------------------------------
 * The published parameter description calls this "minimum bars between accepted
 * pivots" and constrains it to an integer. The shipped 0.12.0 implementation
 * compares it against a *price* margin:
 *
 *     highMargin = bars[i].high - max(leftHigh, rightHigh)
 *     ... && highMargin + 1e-12 >= minSeparation
 *
 * (node_modules/fintech-algorithms/src/.../causal-pivot-detection/impl.ts)
 *
 * It is in absolute price units. A fixed constant is therefore meaningless
 * across instruments — 3 is nothing on a $900 stock and prohibitive on a $4
 * one. The caller expresses prominence in ATR and it is converted here.
 */
export function deriveMinSeparation(prominenceAtr, atrMedian) {
  return prominenceAtr * (atrMedian ?? 0);
}

/*
 * NOTE ON fusion_tolerance  (multi-source-support-resistance-zone-fusion)
 * ----------------------------------------------------------------------
 * Also absolute price, and also undocumented as such. Verified by experiment in
 * tools/probe-fusion.mjs: the published worked example's geometry re-run at
 * 100x the price scale with the same tolerance produces zero accepted zones
 * instead of one. A fraction-of-price tolerance would have fused both.
 *
 * Two levels join the same cluster when their prices are within 2 x tolerance,
 * and the emitted zone spans [min(member) - tolerance, max(member) + tolerance].
 */
export function deriveFusionTolerance(fusionAtr, atrMedian, lastClose) {
  const fromAtr = fusionAtr * (atrMedian ?? 0);
  // An instrument with a degenerate ATR (a halted or synthetic series) would
  // otherwise fuse nothing at all. Fall back to 10 bps of price.
  return fromAtr > 0 ? fromAtr : Math.abs(lastClose) * 0.001;
}

/*
 * Round-number base unit. The library requires it to be tick-aligned, and
 * classifies every 10th multiple as "major" and every 5th as "half" — so the
 * unit chosen decides what counts as a round number at all.
 *
 * Picked from the 1 / 2 / 5 x 10^k ladder so that the visible price range holds
 * roughly 8 to 40 levels: fewer and the source contributes nothing, more and it
 * votes on every zone and stops being evidence.
 *
 * `step` moves along that ladder from the automatic choice: -1 is one rung
 * finer (more levels, each weaker as evidence), +1 one rung coarser. It is
 * expressed in rungs rather than as a price for the same reason as everything
 * else here — "5" means a sensible grid on a $300 stock and a meaningless one
 * on a ¥40,000 index, whereas "one rung coarser" travels.
 */
export function deriveBaseUnit(low, high, tick, step = 0) {
  const span = Math.max(high - low, tick);
  const target = span / 20;
  const exponent = Math.floor(Math.log10(target));

  const rungs = [];
  for (let e = exponent - 2; e <= exponent + 2; e += 1) {
    for (const m of [1, 2, 5]) {
      const unit = m * 10 ** e;
      if (unit >= tick && unit <= span) rungs.push(snapToTick(unit, tick));
    }
  }

  const ladder = [...new Set(rungs)].sort((a, b) => a - b);
  if (!ladder.length) {
    const unit = snapToTick(Math.max(tick, span / 10), tick);
    return { unit, ladder: [unit], index: 0, autoIndex: 0, levelCount: Math.floor(span / unit) };
  }

  // Auto: the finest rung that still yields 8..40 levels; failing that, the
  // rung closest to the target spacing.
  let autoIndex = ladder.findIndex((unit) => {
    const count = Math.floor(span / unit);
    return count >= 8 && count <= 40;
  });
  if (autoIndex < 0) {
    autoIndex = ladder.reduce(
      (best, unit, i) => (Math.abs(unit - target) < Math.abs(ladder[best] - target) ? i : best), 0);
  }

  let index = Math.min(ladder.length - 1, Math.max(0, autoIndex + step));
  // A very fine grid would put a round number on every zone and stop being
  // evidence — and would ship a few thousand levels to the browser.
  while (index < ladder.length - 1 && span / ladder[index] > 250) index += 1;

  return {
    unit: ladder[index],
    ladder,
    index,
    autoIndex,
    levelCount: Math.floor(span / ladder[index]),
  };
}

/*
 * Volume-profile bin width, in ticks.
 *
 * A bin should be small enough that a high-volume node is a level rather than a
 * region, and large enough that the profile is not one trade per bin. A quarter
 * of the daily ATR is the compromise. The row count is then capped, because
 * poc-value-area-hvn-lvn-detection requires *contiguous* rows and this app has
 * to fill the empty ones (see sources/volume-profile.js) — an unbounded price
 * range would otherwise generate tens of thousands of zero-volume rows.
 */
export function deriveBinSizeTicks(atrMedian, tick, low, high, maxRows = 400) {
  const target = Math.max((atrMedian ?? 0) / 4, tick);
  let ticks = Math.max(1, Math.round(target / tick));
  const span = Math.max(high - low, tick);
  while (span / (ticks * tick) > maxRows) ticks *= 2;
  return ticks;
}

/** A wick is not a break. Buffer every break test by a quarter ATR. */
export function deriveBreakBuffer(atrMedian) {
  return 0.25 * (atrMedian ?? 0);
}

export function median(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function round(value, dp) {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}
