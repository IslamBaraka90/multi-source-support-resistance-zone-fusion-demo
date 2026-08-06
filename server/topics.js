/*
 * Every library topic this app calls, and how strongly its arithmetic is
 * attested. Reported to the UI so no number is ever shown without saying how
 * much weight it can carry.
 *
 *   verified       — the worked example is replayed and asserted on every build
 *   contract       — signature and shape are checked; the arithmetic is not
 *                    cross-checked against an independent published figure
 *   approximation  — NOT a library tier. This app's own label for a step where
 *                    we shaped data the library could not have produced from
 *                    what the vendor gave us. See server/tape.js.
 */

export const TIERS = {
  "ohlc-consistency-validator": "contract",
  atr: "verified",
  "causal-pivot-detection": "verified",
  "support-resistance-clustering": "verified",
  "zigzag-segmentation": "verified",
  "fibonacci-retracement-extension-projection": "contract",
  "psychological-round-number-level-generation": "contract",
  "price-by-volume-profile-construction": "contract",
  "poc-value-area-hvn-lvn-detection": "contract",
  "multi-source-support-resistance-zone-fusion": "contract",
  "support-resistance-zone-strength-decay-scoring": "contract",
  "support-resistance-role-reversal-state-machine": "contract",
  "breakout-and-retest-detection": "contract",
};

const DOCS = "https://docs.thefintechbuilder.com";

/** Where each topic's contract lives, for the "what am I looking at" links. */
export const TOPIC_DOCS = {
  "ohlc-consistency-validator": `${DOCS}/market-data-engineering/cleaning-and-validation/ohlc-consistency-validator/`,
  atr: `${DOCS}/technical-indicators/volatility-and-channels/atr/`,
  "causal-pivot-detection": `${DOCS}/geometric-chart-patterns/pivots-and-levels/causal-pivot-detection/`,
  "support-resistance-clustering": `${DOCS}/geometric-chart-patterns/pivots-and-levels/support-resistance-clustering/`,
  "zigzag-segmentation": `${DOCS}/geometric-chart-patterns/pivots-and-levels/zigzag-segmentation/`,
  "fibonacci-retracement-extension-projection": `${DOCS}/geometric-chart-patterns/level-confluence-and-zone-scoring/fibonacci-retracement-extension-projection/`,
  "psychological-round-number-level-generation": `${DOCS}/geometric-chart-patterns/level-confluence-and-zone-scoring/psychological-round-number-level-generation/`,
  "price-by-volume-profile-construction": `${DOCS}/geometric-chart-patterns/level-confluence-and-zone-scoring/price-by-volume-profile-construction/`,
  "poc-value-area-hvn-lvn-detection": `${DOCS}/geometric-chart-patterns/level-confluence-and-zone-scoring/poc-value-area-hvn-lvn-detection/`,
  "multi-source-support-resistance-zone-fusion": `${DOCS}/geometric-chart-patterns/level-confluence-and-zone-scoring/multi-source-support-resistance-zone-fusion/`,
  "support-resistance-zone-strength-decay-scoring": `${DOCS}/geometric-chart-patterns/level-confluence-and-zone-scoring/support-resistance-zone-strength-decay-scoring/`,
  "support-resistance-role-reversal-state-machine": `${DOCS}/geometric-chart-patterns/level-confluence-and-zone-scoring/support-resistance-role-reversal-state-machine/`,
  "breakout-and-retest-detection": `${DOCS}/geometric-chart-patterns/level-confluence-and-zone-scoring/breakout-and-retest-detection/`,
};

/** The four independent level sources, in the order the UI shows them. */
export const SOURCES = [
  { tag: "pivot", label: "Pivot clusters", topics: ["causal-pivot-detection", "support-resistance-clustering"] },
  { tag: "round-number", label: "Round numbers", topics: ["psychological-round-number-level-generation"] },
  { tag: "volume-profile", label: "Volume profile", topics: ["price-by-volume-profile-construction", "poc-value-area-hvn-lvn-detection"] },
  { tag: "fibonacci", label: "Fibonacci", topics: ["zigzag-segmentation", "fibonacci-retracement-extension-projection"] },
];

export class AnalysisError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = "AnalysisError";
    this.status = status;
  }
}
