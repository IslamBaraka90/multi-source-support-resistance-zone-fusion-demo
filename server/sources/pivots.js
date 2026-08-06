/*
 * LEVEL SOURCE 1 of 4 — pivot clusters.
 *
 *   bars -> causal-pivot-detection -> support-resistance-clustering -> levels
 *
 * The classic method: find swing highs and lows, then group the ones that keep
 * happening at the same price. Both topics are `verified`, which makes this the
 * best-attested of the four sources.
 *
 * This source knows nothing about the other three. That independence is the
 * whole point — it is what lets the fusion stage count agreement instead of
 * counting the same evidence twice.
 */

import { detectCausalPivots } from "fintech-algorithms/geometric-chart-patterns/pivots-and-levels/causal-pivot-detection";
import { clusterPivotLevels } from "fintech-algorithms/geometric-chart-patterns/pivots-and-levels/support-resistance-clustering";

import { deriveMinSeparation, round } from "../params.js";
import { AnalysisError } from "../topics.js";

export const TAG = "pivot";

export function pivotLevels({ bars, cfg, atrMedian }) {
  const minSeparation = deriveMinSeparation(cfg.prominenceAtr, atrMedian);

  let pivots;
  try {
    pivots = detectCausalPivots(bars, cfg.swingSpan, cfg.swingSpan, minSeparation);
  } catch (cause) {
    throw new AnalysisError(`pivot detection rejected the series: ${cause.message}`);
  }

  if (!pivots.length) {
    return {
      levels: [],
      pivots: [],
      clusters: [],
      noise: [],
      unavailable: "no swing points survived — lower the prominence or the swing span",
      trace: [{
        topic: "causal-pivot-detection",
        detail: `0 swing points at prominence ${cfg.prominenceAtr}x ATR`,
      }],
    };
  }

  let clustered;
  try {
    clustered = clusterPivotLevels(pivots, cfg.clusterBps, cfg.minTouches);
  } catch (cause) {
    throw new AnalysisError(`clustering rejected the pivots: ${cause.message}`);
  }

  /*
   * Weight. The fusion stage takes a weight per level and this source has to
   * supply its own, from its own output. Touch count is the natural evidence a
   * cluster carries, normalised against the best cluster in this run so the
   * scale is comparable with the other three sources rather than unbounded.
   */
  const maxTouches = Math.max(...clustered.clusters.map((c) => c.touch_count), 1);

  const levels = clustered.clusters.map((cluster) => ({
    level_id: `PIV-${cluster.cluster_id}`,
    source: TAG,
    price: cluster.level,
    weight: round(0.4 + 0.6 * (cluster.touch_count / maxTouches), 4),
    label: `${cluster.touch_count} touches`,
    origin: {
      kind: cluster.kind,
      touchCount: cluster.touch_count,
      lower: cluster.lower,
      upper: cluster.upper,
      firstConfirmationIndex: cluster.first_confirmation_index,
      lastConfirmationIndex: cluster.last_confirmation_index,
      memberEventIndexes: cluster.member_event_indexes,
    },
  }));

  return {
    levels,
    pivots,
    clusters: clustered.clusters,
    noise: clustered.noise,
    unavailable: null,
    trace: [
      {
        topic: "causal-pivot-detection",
        detail:
          `${pivots.length} swing points ` +
          `(${pivots.filter((p) => p.kind === "high").length} highs, ` +
          `${pivots.filter((p) => p.kind === "low").length} lows) at prominence ` +
          `${cfg.prominenceAtr}x ATR = ${minSeparation.toFixed(4)} in price; ` +
          `confirmation lag ${cfg.swingSpan} bars`,
      },
      {
        topic: "support-resistance-clustering",
        detail:
          `${clustered.clusters.length} levels at >=${cfg.minTouches} touches within ` +
          `${cfg.clusterBps} bps; ${clustered.noise.length} pivots left as noise`,
      },
    ],
  };
}
