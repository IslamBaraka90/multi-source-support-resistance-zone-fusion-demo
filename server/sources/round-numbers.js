/*
 * LEVEL SOURCE 2 of 4 — psychological round numbers.
 *
 *   last close + bounds -> psychological-round-number-level-generation -> levels
 *
 * The only source here that does not look at price history at all. It asks a
 * different question from the other three: not "where has price reacted?" but
 * "where would a human put a resting order?". That is exactly what makes it
 * worth fusing — its evidence is independent by construction, not by luck.
 *
 * The library classifies every 10th multiple of the base unit as `major`, every
 * 5th as `half`, the rest as `minor`, and hands back a `salience_weight` of
 * 1 / 0.75 / 0.5. Those weights are used verbatim; inventing our own would
 * throw away the one thing this topic is actually asserting.
 */

import { psychologicalRoundNumberLevelGeneration } from "fintech-algorithms/geometric-chart-patterns/level-confluence-and-zone-scoring/psychological-round-number-level-generation";

import { deriveBaseUnit, snapToTick } from "../params.js";

export const TAG = "round-number";

export function roundNumberLevels({ lastClose, low, high, tick }) {
  /*
   * The library requires lower_bound <= current_price <= upper_bound and will
   * throw otherwise. The window's own low and high satisfy that by definition —
   * but only when the last close is inside the window, which is not guaranteed
   * once bars have been dropped by validation. Widen rather than assume.
   */
  const lowerBound = snapToTick(Math.min(low, lastClose), tick);
  const upperBound = snapToTick(Math.max(high, lastClose), tick);
  const baseUnit = deriveBaseUnit(lowerBound, upperBound, tick);

  let generated;
  try {
    generated = psychologicalRoundNumberLevelGeneration({
      current_price: lastClose,
      lower_bound: lowerBound,
      upper_bound: upperBound,
      tick_size: tick,
      base_unit: baseUnit,
    });
  } catch (cause) {
    return {
      levels: [],
      unavailable: `round-number generation rejected the bounds: ${cause.message}`,
      trace: [{ topic: "psychological-round-number-level-generation", detail: cause.message }],
    };
  }

  const levels = generated.levels.map((level, index) => ({
    level_id: `RND-${index}`,
    source: TAG,
    price: level.price,
    weight: level.salience_weight,
    label: level.class,
    origin: {
      class: level.class,
      salienceWeight: level.salience_weight,
      distance: level.distance,
      distanceBps: level.distance_bps,
    },
  }));

  const byClass = (name) => generated.levels.filter((l) => l.class === name).length;

  return {
    levels,
    closest: generated.closest_level,
    baseUnit: generated.base_unit,
    unavailable: null,
    trace: [{
      topic: "psychological-round-number-level-generation",
      detail:
        `${generated.level_count} levels on a ${generated.base_unit} grid between ` +
        `${lowerBound} and ${upperBound} ` +
        `(${byClass("major")} major, ${byClass("half")} half, ${byClass("minor")} minor); ` +
        `closest is ${generated.closest_level.price} at ` +
        `${generated.closest_level.distance_bps?.toFixed(1) ?? "n/a"} bps`,
    }],
  };
}
