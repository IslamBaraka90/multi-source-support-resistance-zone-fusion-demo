/*
 * LEVEL SOURCE 3 of 4 — volume profile.
 *
 *   intraday bars -> tape.js -> price-by-volume-profile-construction
 *                            -> poc-value-area-hvn-lvn-detection -> levels
 *
 * Where did the volume actually change hands? A price that absorbed a lot of
 * volume is a level for a different reason than a swing high is: it marks
 * accepted value rather than a rejection.
 *
 * Two things about this source are unlike the other three:
 *
 *   1. Its input is an approximation. See server/tape.js — Yahoo sells no tick
 *      data, so bars are mapped to trades by this app. Anything derived here is
 *      badged `approximation`, not `contract`.
 *   2. It can be genuinely unavailable. Indices and FX crosses report no
 *      intraday volume. That is a data fact, and the pipeline drops to three
 *      sources rather than fabricating a fourth.
 */

import { priceByVolumeProfileConstruction } from "fintech-algorithms/geometric-chart-patterns/level-confluence-and-zone-scoring/price-by-volume-profile-construction";
import { pocValueAreaHvnLvnDetection } from "fintech-algorithms/geometric-chart-patterns/level-confluence-and-zone-scoring/poc-value-area-hvn-lvn-detection";

import { barsToTape } from "../tape.js";
import { deriveBinSizeTicks, round } from "../params.js";

export const TAG = "volume-profile";

export function volumeProfileLevels({ tape, tick, atrMedian, low, high, cfg }) {
  if (!tape.bars.length) {
    return { levels: [], unavailable: tape.unavailable ?? "no intraday tape", trace: [] };
  }

  const { trades, windowEnd, note } = barsToTape(tape.bars, tick);
  if (trades.length < 50) {
    return {
      levels: [],
      unavailable: `only ${trades.length} usable intraday points — too few for a profile`,
      trace: [],
    };
  }

  const binSizeTicks = deriveBinSizeTicks(atrMedian, tick, low, high);

  let profile;
  try {
    profile = priceByVolumeProfileConstruction({
      tick_size: tick,
      bin_size_ticks: binSizeTicks,
      window_end: windowEnd,
      trades,
    });
  } catch (cause) {
    return {
      levels: [],
      unavailable: `profile construction rejected the tape: ${cause.message}`,
      trace: [],
    };
  }

  /*
   * THE GAP-FILL, and why it is not optional.
   *
   * price-by-volume-profile-construction emits a row only for bins that
   * received volume — it builds a Map keyed by bin index and returns the sorted
   * keys. poc-value-area-hvn-lvn-detection then demands rows that are ordered
   * AND contiguous, and throws "profile rows must be ordered and contiguous" on
   * the first gap.
   *
   * So a price band nobody traded in has to be re-inserted with volume 0. That
   * is not a fudge: a bin with no volume genuinely is a low-volume node, and
   * the LVN detector is entitled to see it. Skipping the fill would instead
   * silently glue two non-adjacent price bands together.
   */
  const rows = fillGaps(profile.rows, profile.bin_width);

  if (rows.length < 3) {
    return {
      levels: [],
      unavailable: `profile has only ${rows.length} price bins — the detector needs at least 3`,
      trace: [],
    };
  }

  let features;
  try {
    features = pocValueAreaHvnLvnDetection({
      profile_rows: rows.map((r) => ({ lower: r.lower, upper: r.upper, volume: r.volume })),
      value_area_fraction: cfg.valueAreaFraction,
      hvn_median_ratio: 1.2,
      lvn_median_ratio: 0.65,
    });
  } catch (cause) {
    return {
      levels: [],
      unavailable: `POC / value-area detection rejected the profile: ${cause.message}`,
      trace: [],
    };
  }

  /*
   * Which of the returned features are levels?
   *
   * The POC and the two value-area edges are prices, and each is a level in the
   * ordinary sense. High-volume nodes are levels too, weighted by how far above
   * the profile's median volume they sit. Low-volume nodes are deliberately NOT
   * emitted — an LVN is a price that price moves *through*, which is the
   * opposite claim, and feeding it to a support/resistance fusion would be
   * asserting something this source does not believe.
   */
  const levels = [];

  levels.push({
    level_id: "VOL-POC",
    source: TAG,
    price: features.poc_price,
    weight: 1,
    label: "point of control",
    origin: { kind: "poc", volume: features.poc_volume },
  });

  levels.push({
    level_id: "VOL-VAL",
    source: TAG,
    price: features.value_area_low,
    weight: 0.6,
    label: "value area low",
    origin: { kind: "value-area-low", share: features.value_area_share },
  });
  levels.push({
    level_id: "VOL-VAH",
    source: TAG,
    price: features.value_area_high,
    weight: 0.6,
    label: "value area high",
    origin: { kind: "value-area-high", share: features.value_area_share },
  });

  const maxRatio = Math.max(...features.hvn.map((n) => n.median_ratio), 1);
  features.hvn.forEach((node, index) => {
    levels.push({
      level_id: `VOL-HVN-${index}`,
      source: TAG,
      price: node.price,
      weight: round(0.4 + 0.5 * (node.median_ratio / maxRatio), 4),
      label: `HVN ${node.median_ratio.toFixed(2)}x median`,
      origin: { kind: "hvn", volume: node.volume, medianRatio: node.median_ratio },
    });
  });

  const filled = rows.length - profile.rows.length;

  return {
    levels,
    profile: { ...profile, rows },
    features,
    unavailable: null,
    tapeNote: note,
    trace: [
      { topic: null, tier: "approximation", detail: note },
      {
        topic: "price-by-volume-profile-construction",
        detail:
          `${profile.eligible_trade_count} points binned into ${profile.rows.length} traded ` +
          `bins of ${profile.bin_width} (${binSizeTicks} ticks)` +
          (filled ? `, plus ${filled} empty bins re-inserted for contiguity` : "") +
          `; total volume ${profile.total_volume.toLocaleString("en-US")}`,
      },
      {
        topic: "poc-value-area-hvn-lvn-detection",
        detail:
          `POC ${features.poc_price}, value area ${features.value_area_low}-${features.value_area_high} ` +
          `holding ${(features.value_area_share * 100).toFixed(1)}% of volume ` +
          `(target ${(cfg.valueAreaFraction * 100).toFixed(0)}%); ` +
          `${features.hvn.length} high-volume nodes, ${features.lvn.length} low-volume nodes ` +
          `(LVNs are reported but not fused — see the source comment)`,
      },
    ],
  };
}

/** Re-insert the bins the constructor omitted, at volume 0. */
function fillGaps(rows, binWidth) {
  if (rows.length < 2) return rows;
  const filled = [];

  for (let i = 0; i < rows.length; i += 1) {
    filled.push(rows[i]);
    const next = rows[i + 1];
    if (!next) break;

    for (let index = rows[i].bin_index + 1; index < next.bin_index; index += 1) {
      const lower = Number((rows[i].lower + (index - rows[i].bin_index) * binWidth).toFixed(12));
      filled.push({
        bin_index: index,
        lower,
        upper: Number((lower + binWidth).toFixed(12)),
        midpoint: Number((lower + binWidth / 2).toFixed(12)),
        volume: 0,
        share: 0,
      });
    }
  }
  return filled;
}
