/*
 * LEVEL SOURCE 4 of 4 — Fibonacci retracements and extensions.
 *
 *   closes -> zigzag-segmentation -> fibonacci-retracement-extension-projection
 *          -> levels
 *
 * Fibonacci levels are only as good as the leg they are drawn from, and picking
 * that leg by eye is where most of the subjectivity in this method lives. So it
 * is not picked by eye: zigzag-segmentation (`verified`) selects the dominant
 * swing, and the projection topic draws from it.
 *
 * ONE HONEST CAVEAT, which the library states in its own summary: the final
 * zigzag swing is *provisional* and the next bar can revise it. That means the
 * levels from this source can move when new data arrives, in a way the pivot
 * clusters cannot. The UI reports which leg was used so the reader can see what
 * would change.
 */

import { zigzagSegment } from "fintech-algorithms/geometric-chart-patterns/pivots-and-levels/zigzag-segmentation";
import { fibonacciRetracementExtensionProjection } from "fintech-algorithms/geometric-chart-patterns/level-confluence-and-zone-scoring/fibonacci-retracement-extension-projection";

export const TAG = "fibonacci";

const RETRACEMENTS = [0.236, 0.382, 0.5, 0.618, 0.786];
const EXTENSIONS = [1, 1.272, 1.618];

/*
 * Not every ratio carries the same claim. The golden pair and the half are what
 * the method is actually about; the shallow and deep ratios are the ones that
 * fit anything if you squint. Weighting them equally would let the weakest
 * ratios carry as much vote as the strongest.
 */
const RETRACEMENT_WEIGHT = { 0.618: 1, 0.5: 0.9, 0.382: 0.75, 0.786: 0.6, 0.236: 0.5 };
const EXTENSION_WEIGHT = { 1: 0.6, 1.272: 0.5, 1.618: 0.6 };

export function fibonacciLevels({ closes, tick, atrMedian, lastClose, low, high, cfg }) {
  /*
   * The zigzag threshold is a fraction of price, so unlike the price-unit
   * parameters elsewhere it is already instrument-relative — but a fixed 5%
   * would still be noise on a utility and invisible on a small-cap. Express it
   * in ATR and convert, so the same slider means the same thing everywhere.
   */
  const threshold = Math.min(0.5, Math.max(0.005,
    (cfg.zigzagAtr * (atrMedian ?? 0)) / Math.abs(lastClose || 1)));

  let zigzag;
  try {
    zigzag = zigzagSegment(closes, threshold, Math.max(1, cfg.swingSpan));
  } catch (cause) {
    return { levels: [], unavailable: `zigzag rejected the series: ${cause.message}`, trace: [] };
  }

  const pivots = zigzag.pivots ?? [];
  if (pivots.length < 2) {
    return {
      levels: [],
      unavailable:
        `zigzag found ${pivots.length} swing point(s) at a ` +
        `${(threshold * 100).toFixed(2)}% threshold — need 2 to define a leg`,
      trace: [{
        topic: "zigzag-segmentation",
        detail: `${pivots.length} swings at ${(threshold * 100).toFixed(2)}%`,
      }],
    };
  }

  const from = pivots[pivots.length - 2];
  const to = pivots[pivots.length - 1];

  if (from.price === to.price) {
    return { levels: [], unavailable: "the dominant leg has zero size", trace: [] };
  }

  let projection;
  try {
    projection = fibonacciRetracementExtensionProjection({
      start_price: from.price,
      end_price: to.price,
      // Where price has retraced *to* is where extensions are measured from.
      // The last close is the only honest answer available right now.
      retracement_end_price: lastClose,
      tick_size: tick,
      retracement_ratios: RETRACEMENTS,
      extension_ratios: EXTENSIONS,
    });
  } catch (cause) {
    return {
      levels: [],
      unavailable: `Fibonacci projection rejected the leg: ${cause.message}`,
      trace: [{ topic: "zigzag-segmentation", detail: `leg ${from.price} -> ${to.price}` }],
    };
  }

  /*
   * Extensions routinely project outside the range the chart covers. Those are
   * not wrong, but they cannot be corroborated by any other source here and
   * would only ever appear as single-source clusters, so they are dropped
   * before fusion rather than shown as rejected noise. The window is widened by
   * one ATR so a level just off the edge still counts.
   */
  const pad = atrMedian ?? 0;
  const inWindow = (price) => price >= low - pad && price <= high + pad;

  const levels = [];

  projection.retracement_levels.forEach((level, index) => {
    if (!inWindow(level.price)) return;
    levels.push({
      level_id: `FIB-R${index}`,
      source: TAG,
      price: level.price,
      weight: RETRACEMENT_WEIGHT[level.ratio] ?? 0.5,
      label: `${(level.ratio * 100).toFixed(1)}% retracement`,
      origin: { kind: "retracement", ratio: level.ratio, rawPrice: level.raw_price },
    });
  });

  projection.extension_levels.forEach((level, index) => {
    if (!inWindow(level.price)) return;
    levels.push({
      level_id: `FIB-E${index}`,
      source: TAG,
      price: level.price,
      weight: EXTENSION_WEIGHT[level.ratio] ?? 0.5,
      label: `${(level.ratio * 100).toFixed(1)}% extension`,
      origin: { kind: "extension", ratio: level.ratio, rawPrice: level.raw_price },
    });
  });

  const dropped =
    projection.retracement_levels.length + projection.extension_levels.length - levels.length;

  return {
    levels,
    leg: {
      fromKind: from.kind,
      fromPrice: from.price,
      fromIndex: from.event_index,
      toKind: to.kind,
      toPrice: to.price,
      toIndex: to.event_index,
      direction: projection.direction,
      size: projection.leg_size,
      provisional: true,
    },
    unavailable: null,
    trace: [
      {
        topic: "zigzag-segmentation",
        detail:
          `${pivots.length} swings at a ${(threshold * 100).toFixed(2)}% threshold ` +
          `(${cfg.zigzagAtr}x ATR); dominant leg is the ${from.kind} at ${from.price} ` +
          `to the ${to.kind} at ${to.price}. The final swing is provisional — the ` +
          `next bar can revise it.`,
      },
      {
        topic: "fibonacci-retracement-extension-projection",
        detail:
          `${levels.length} levels from a ${projection.direction} leg of ` +
          `${projection.leg_size}, snapped to a ${tick} tick` +
          (dropped ? `; ${dropped} projected outside the chart window and were dropped` : ""),
      },
    ],
  };
}
