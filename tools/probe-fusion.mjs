/*
 * Probe: what unit is `fusion_tolerance` in?
 *
 * The published parameter description does not say, and the answer decides
 * whether a fixed constant is safe across instruments. Run it and read the
 * output rather than assuming.
 *
 *   node tools/probe-fusion.mjs
 */

import { multiSourceSupportResistanceZoneFusion } from "fintech-algorithms/geometric-chart-patterns/level-confluence-and-zone-scoring/multi-source-support-resistance-zone-fusion";

const levels = [
  { level_id: "A", source: "pivot", price: 99.8, weight: 0.9 },
  { level_id: "B", source: "fibonacci", price: 100.1, weight: 0.7 },
  { level_id: "C", source: "round-number", price: 100.0, weight: 0.8 },
  { level_id: "D", source: "volume-profile", price: 100.2, weight: 1.0 },
  { level_id: "E", source: "pivot", price: 105.0, weight: 0.6 },
];

console.log("=== 1. reconstruct the published worked example ===");
const base = multiSourceSupportResistanceZoneFusion({
  fusion_tolerance: 0.25,
  minimum_sources: 2,
  levels,
});
console.log(JSON.stringify(base, null, 1));

console.log("\n=== 2. same geometry, 100x the price scale, same tolerance ===");
console.log("   fraction-of-price tolerance -> still fuses;  absolute -> falls apart");
const scaled = multiSourceSupportResistanceZoneFusion({
  fusion_tolerance: 0.25,
  minimum_sources: 2,
  levels: levels.map((l) => ({ ...l, price: l.price * 100 })),
});
console.log("accepted zones:", scaled.zones.length, " rejected clusters:", scaled.rejected_clusters.length);
console.log(JSON.stringify(
  [...scaled.zones, ...scaled.rejected_clusters].map((z) => ({
    lower: z.lower, upper: z.upper, sources: z.source_count, reason: z.reason ?? null,
  })), null, 1));

console.log("\n=== 3. two levels from the SAME source ===");
console.log("   does source_count count levels, or distinct sources?");
console.log(JSON.stringify(multiSourceSupportResistanceZoneFusion({
  fusion_tolerance: 0.25,
  minimum_sources: 2,
  levels: [
    { level_id: "P1", source: "pivot", price: 100.0, weight: 0.9 },
    { level_id: "P2", source: "pivot", price: 100.1, weight: 0.9 },
  ],
}), null, 1));
