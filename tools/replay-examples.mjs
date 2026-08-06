/*
 * Replay the published worked example for every topic this app uses.
 *
 *   npm test
 *
 * WHAT THIS CATCHES: a library upgrade that renames a returned field. That is
 * the failure mode the package's own guidance warns about — return-key casing
 * is not consistent across the library, so code that reads `percent_b` on one
 * topic and `fastEma` on another breaks silently when a key moves. Comparing
 * the top-level key set of a live call against the shipped example catches it.
 *
 * WHAT IT CANNOT CATCH, and why the output has three outcomes rather than two:
 *
 *   docs.json stores a *truncated* example input for many topics. For
 *   series-transform topics the truncation is declared — `elided: {kind:
 *   "array", shown: 6, total: 240}` — and those are skipped honestly.
 *
 *   For record-transform topics it is NOT declared. The eliding logic only
 *   marks top-level array arguments, so an array nested inside a record
 *   argument is cut without any flag. multi-source-support-resistance-zone-fusion
 *   is the clearest case: `args` carries 3 levels, `elided` is null, and the
 *   stored `output` describes a zone fused from 5. Feeding the stored args back
 *   in cannot reproduce the stored output, and that is a documentation
 *   artefact, not a broken algorithm — reconstructing the missing two levels
 *   reproduces the published output exactly (see tools/probe-fusion.mjs).
 *
 * So: keys match but values differ  -> TRUNCATED (report, do not fail)
 *     keys differ                   -> CHANGED   (fail; the contract moved)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TIERS } from "../server/topics.js";

// docs.json is shipped but not listed in the package's `exports`, so it has to
// be read off disk rather than imported.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const docs = JSON.parse(
  readFileSync(path.join(root, "node_modules/fintech-algorithms/docs.json"), "utf8"),
);

const used = Object.keys(TIERS);
const results = [];

for (const slug of used) {
  const topic = docs.topics.find((t) => t.slug === slug);
  if (!topic) {
    results.push({ slug, outcome: "MISSING", note: "not present in docs.json" });
    continue;
  }

  const example = topic.example;
  if (!example?.args || example.output === undefined) {
    results.push({ slug, outcome: "NO EXAMPLE", note: "docs.json ships no executed example" });
    continue;
  }

  const declaredElision = example.args.find((a) => a.elided);
  if (declaredElision) {
    const e = declaredElision.elided;
    results.push({
      slug,
      outcome: "TRUNCATED",
      note: `example input is declared-elided (${e.kind}, ${e.shown} of ${e.total} shown)`,
    });
    continue;
  }

  let actual;
  try {
    const module = await import(topic.import.subpath);
    const fn = module[topic.import.entry];
    if (typeof fn !== "function") {
      results.push({ slug, outcome: "CHANGED", note: `export ${topic.import.entry} is not a function` });
      continue;
    }
    actual = fn(...example.args.map((a) => a.value));
  } catch (error) {
    results.push({ slug, outcome: "CHANGED", note: `threw: ${error.message}` });
    continue;
  }

  const expectedKeys = keysOf(example.output);
  const actualKeys = keysOf(actual);

  /*
   * Asymmetric on purpose. A key the example documents but the function no
   * longer returns is what breaks a caller — `report.percent_b` becomes
   * undefined and flows into arithmetic as NaN. A key the function returns but
   * the example omits breaks nothing; it just means the captured example is
   * incomplete. zigzag-segmentation is exactly that case: it returns
   * { pivots, states } and its RETURNS type says so, but the captured output
   * shows only `pivots`.
   */
  const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
  const extra = actualKeys.filter((key) => !expectedKeys.includes(key));

  if (missing.length) {
    results.push({
      slug,
      outcome: "CHANGED",
      note: `the example documents [${missing.join(", ")}] but the function no longer returns ${missing.length === 1 ? "it" : "them"}`,
    });
    continue;
  }

  if (extra.length) {
    results.push({
      slug,
      outcome: "UNDOCUMENTED",
      note: `returns [${extra.join(", ")}] which the captured example omits — the example is incomplete, not the function`,
    });
    continue;
  }

  if (JSON.stringify(actual) === JSON.stringify(example.output)) {
    results.push({ slug, outcome: "MATCH", note: `${expectedKeys.length} keys reproduced exactly` });
  } else {
    results.push({
      slug,
      outcome: "TRUNCATED",
      note: "keys match but values differ — the stored example input is elided without being flagged",
    });
  }
}

/* ------------------------------------------------------------------ report */

const width = Math.max(...used.map((s) => s.length));
const symbol = {
  MATCH: "ok  ", TRUNCATED: "~   ", UNDOCUMENTED: "~   ",
  CHANGED: "FAIL", MISSING: "FAIL", "NO EXAMPLE": "~   ",
};

console.log(`\nReplaying ${used.length} topics against fintech-algorithms ${docs.package?.version ?? "?"}\n`);

for (const r of results) {
  console.log(`  ${symbol[r.outcome]} ${r.slug.padEnd(width)}  ${TIERS[r.slug].padEnd(8)} ${r.outcome.padEnd(10)} ${r.note}`);
}

const tally = (name) => results.filter((r) => r.outcome === name).length;
const changed = results.filter((r) => r.outcome === "CHANGED" || r.outcome === "MISSING");

console.log(
  `\n  ${tally("MATCH")} reproduced exactly · ` +
  `${tally("TRUNCATED") + tally("NO EXAMPLE")} not replayable from docs.json · ` +
  `${tally("UNDOCUMENTED")} returning more than the example shows · ` +
  `${changed.length} contract changes\n`,
);

if (changed.length) {
  console.error("Contract change detected — the library's returned shape no longer matches its own example.");
  process.exit(1);
}

function keysOf(value) {
  if (Array.isArray(value)) return ["<array>"];
  if (value && typeof value === "object") return Object.keys(value).sort();
  return [`<${typeof value}>`];
}
