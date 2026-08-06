# Multi-Source Support &amp; Resistance Zone Fusion

A working Node app that derives price levels from **four independent methods**,
fuses them into zones where the methods agree, and grades those zones.

Every number is computed by the
[**`fintech-algorithms`**](https://www.npmjs.com/package/fintech-algorithms)
npm package — 324 zero-dependency TypeScript algorithms. This repository
contributes adapters, parameter derivation and presentation, and no arithmetic
the library already owns.

It is also a **tutorial**. The point is not the app; the point is showing what a
correct, honest pipeline looks like from a vendor feed to a graded answer —
including the four places the library's own documentation will mislead you.

```bash
npm install
npm start           # → http://localhost:5173
```

No build step, no bundler, no framework. One process serves the API and the page.

---

## What this demo covers

Thirteen topics, drawn from three domains of the
[Fintech Builder](https://thefintechbuilder.com) catalogue. The bulk of it is
**one family** — *Level Confluence and Zone Scoring* — which this app implements
almost end to end.

### Domain 8 — Geometric Chart Patterns

**Family: [Level Confluence and Zone Scoring](https://thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/)** — the core of this demo, 8 of its 9 topics used

| Topic | Article | Tier |
|---|---|---|
| Price-by-Volume Profile Construction | [article](https://thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/price-by-volume-profile-construction/) · [contract](https://docs.thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/price-by-volume-profile-construction/) | contract |
| Point of Control, Value Area, HVN &amp; LVN Detection | [article](https://thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/poc-value-area-hvn-lvn-detection/) · [contract](https://docs.thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/poc-value-area-hvn-lvn-detection/) | contract |
| Fibonacci Retracement &amp; Extension Projection | [article](https://thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/fibonacci-retracement-extension-projection/) · [contract](https://docs.thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/fibonacci-retracement-extension-projection/) | contract |
| Psychological Round-Number Level Generation | [article](https://thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/psychological-round-number-level-generation/) · [contract](https://docs.thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/psychological-round-number-level-generation/) | contract |
| **Multi-Source S/R Zone Fusion** | [article](https://thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/multi-source-support-resistance-zone-fusion/) · [contract](https://docs.thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/multi-source-support-resistance-zone-fusion/) | contract |
| S/R Zone Strength &amp; Decay Scoring | [article](https://thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/support-resistance-zone-strength-decay-scoring/) · [contract](https://docs.thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/support-resistance-zone-strength-decay-scoring/) | contract |
| S/R Role-Reversal State Machine | [article](https://thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/support-resistance-role-reversal-state-machine/) · [contract](https://docs.thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/support-resistance-role-reversal-state-machine/) | contract |
| Breakout &amp; Retest Detection | [article](https://thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/breakout-and-retest-detection/) · [contract](https://docs.thefintechbuilder.com/geometric-chart-patterns/level-confluence-and-zone-scoring/breakout-and-retest-detection/) | contract |

*Not used: Market-Wide Zone-Proximity Scanner &amp; Ranking — it ranks many
instruments at once and belongs to a watchlist app, not this one.*

**Family: [Pivots and Levels](https://thefintechbuilder.com/geometric-chart-patterns/pivots-and-levels/)**

| Topic | Article | Tier |
|---|---|---|
| Causal Pivot Detection | [article](https://thefintechbuilder.com/geometric-chart-patterns/pivots-and-levels/causal-pivot-detection/) · [contract](https://docs.thefintechbuilder.com/geometric-chart-patterns/pivots-and-levels/causal-pivot-detection/) | **verified** |
| ZigZag Segmentation | [article](https://thefintechbuilder.com/geometric-chart-patterns/pivots-and-levels/zigzag-segmentation/) · [contract](https://docs.thefintechbuilder.com/geometric-chart-patterns/pivots-and-levels/zigzag-segmentation/) | **verified** |
| Support/Resistance Clustering | [article](https://thefintechbuilder.com/geometric-chart-patterns/pivots-and-levels/support-resistance-clustering/) · [contract](https://docs.thefintechbuilder.com/geometric-chart-patterns/pivots-and-levels/support-resistance-clustering/) | **verified** |

### Domain 1 — Market Data Engineering

**Family: [Cleaning and Validation](https://thefintechbuilder.com/market-data-engineering/cleaning-and-validation/)**

| Topic | Article | Tier |
|---|---|---|
| OHLC Consistency Validator | [article](https://thefintechbuilder.com/market-data-engineering/cleaning-and-validation/ohlc-consistency-validator/) · [contract](https://docs.thefintechbuilder.com/market-data-engineering/cleaning-and-validation/ohlc-consistency-validator/) | contract |

### Domain 7 — Technical Indicators

**Family: [Volatility and Channels](https://thefintechbuilder.com/technical-indicators/volatility-and-channels/)**

| Topic | Article | Tier |
|---|---|---|
| Average True Range (ATR) | [article](https://thefintechbuilder.com/technical-indicators/volatility-and-channels/atr/) · [contract](https://docs.thefintechbuilder.com/technical-indicators/volatility-and-channels/atr/) | **verified** |

### On those tiers

Every number this app shows carries one, and the UI never hides it:

- **`verified`** — the library replays and asserts the published worked example
  on every build. 4 of the 13 topics here.
- **`contract`** — the signature and shape are checked, but the arithmetic is
  not cross-checked against an independent published figure. 9 of the 13.
- **`approximation`** — *not a library tier.* This app's own label for the one
  step where it shaped data the vendor could not supply. See
  [The one approximation](#the-one-approximation).

---

## The npm package

```bash
npm install fintech-algorithms
```

- **Registry:** <https://www.npmjs.com/package/fintech-algorithms>
- **Docs:** <https://docs.thefintechbuilder.com>
- **Articles:** <https://thefintechbuilder.com>
- **Source:** <https://github.com/IslamBaraka90/Fintech-Algorithms-Library>

Zero runtime dependencies, Node ≥ 22, ESM. Algorithms are **subpath-only** — the
root export carries metadata and lookups only, and a sibling topic's function is
never re-exported from another subpath. Import each from its own path:

```js
import { detectCausalPivots }
  from "fintech-algorithms/geometric-chart-patterns/pivots-and-levels/causal-pivot-detection";
```

Turn any docs URL into an import by swapping
`https://docs.thefintechbuilder.com/` for `fintech-algorithms/`.

**The library does not fetch data.** No HTTP client, no vendor SDK, no API key,
no `node:fs`. That is deliberate — vendor APIs get rewritten every few years and
algorithms do not. Supplying the prices is the caller's job, which is what the
next section is about.

---

## The agent skill

The package ships an agent skill, and this repo was built with it:

```bash
npx skills add IslamBaraka90/Fintech-Algorithms-Library
```

It installs to `.agents/skills/fintech-algorithms/` and symlinks into Claude
Code, Cursor, Codex, Copilot, Gemini CLI and others. It gives an agent the
catalogue, the archetypes, the ingestion patterns, the known pitfalls, and a
lookup script:

```bash
node .agents/skills/fintech-algorithms/scripts/lookup.mjs search "support resistance"
node .agents/skills/fintech-algorithms/scripts/lookup.mjs show multi-source-support-resistance-zone-fusion
node .agents/skills/fintech-algorithms/scripts/lookup.mjs domain geometric-chart-patterns
```

Its first rule is the one that matters: **never invent an import path, a
function name, a parameter, or a returned field.** Every subpath mirrors its
docs URL exactly, which makes a plausible guess wrong in a way that reads as
correct. Return-key casing is not consistent across the library either — one
topic returns `percent_b`, another returns `fastEma`. Look it up, or read the
captured example output.

The skill's directories are gitignored here (`.agents/`, `.claude/`,
`skills-lock.json`) — run the command above to install your own.

---

## The full cycle

The library is only the middle of the pipeline. Every live-data app has the
same five stages, and only two of them are the library's job:

```
   your feed   →   your adapter   →   validate   →   compute   →   report
   ─────────       ─────────────      ────────────────────────      ──────
   Yahoo           server/yahoo.js    ← fintech-algorithms →        server/
   Finance         server/tape.js                                   index.js
```

**1 · Feed.** Yahoo Finance chart API, no key. Two series per analysis: daily
bars for structure, and an intraday series for the volume profile.

**2 · Adapter.** [`server/yahoo.js`](server/yahoo.js) is the only file in the
repo that knows a Yahoo field name. It maps the vendor payload to the canonical
shape the library documents:

```js
{ timestamp: "2026-08-06T13:30:00.000Z", symbol: "AAPL",
  open: 311.2, high: 314.0, low: 309.8, close: 312.41, volume: 41_203_100 }
```

Swapping Yahoo for a broker feed, a CSV, or a websocket means rewriting that one
file and nothing else. Vendor holes are dropped **at the boundary** and counted,
never carried forward as a zero.

**3 · Validate.** `validateBars` classifies every row against the OHLC
invariants at a tick-size tolerance. It is a *row-classify* topic: it never
throws, so ignoring its return value is indistinguishable from "every row
passed". [`server/analyze.js`](server/analyze.js) reads it, and then enforces
two stricter invariants the downstream topics require but the validator does not
check. `EURUSD=X` really does ship bars that need this.

**4 · Compute.** Four independent sources, one file each — read any one on its
own without knowing the other three:

| | Source | Files |
|---|---|---|
| 1 | Swing pivots → clusters | [`sources/pivots.js`](server/sources/pivots.js) |
| 2 | Psychological round numbers | [`sources/round-numbers.js`](server/sources/round-numbers.js) |
| 3 | Volume profile → POC / value area / HVN | [`sources/volume-profile.js`](server/sources/volume-profile.js) |
| 4 | ZigZag → Fibonacci projection | [`sources/fibonacci.js`](server/sources/fibonacci.js) |

Then the confluence layer in [`server/fuse.js`](server/fuse.js): fuse → grade →
role reversal → breakout.

**5 · Report.** Every stage returns what it did, with its topic and tier, and
the UI prints it. Nothing is asserted without saying how strongly it is attested.

---

## Why this app exists

The predecessor demo derived levels from pivot clustering alone. It then had to
supply `source_confluence` — a 0..1 input to the zone scorer meaning *"how many
independent methods put a level here"* — from the only thing it had:

```js
// one source wearing the name of four
const sourceConfluence = Math.min(1, 0.4 + 0.15 * (cluster.touch_count - cfg.minTouches));
```

It was labelled honestly as a stand-in, but it was still a touch count in a
confluence-shaped hole. Here the number is measured:

```js
// counted, not estimated
const sourceConfluence = zone.source_count / sourcesAvailable;
```

`source_count` counts **distinct sources**. Two pivot levels at the same price
are one source, and the library rejects that cluster with
`reason: "insufficient-distinct-sources"`.

The denominator is how many sources actually *ran*, not the constant 4. An
index with no intraday volume drops to 3 rather than being capped at 3/4 forever
— penalised for a data gap instead of for a lack of agreement.

---

## Two views over one analysis

**Simple** (the default) answers the ordinary question: the nearest accepted
zone above the price, the nearest below it, what they mean in plain English, and
how much to trust them. Two levels, and the chart shows only those two bands.

**Advanced** is the whole working: every zone, every source's raw levels before
fusion, the rejected clusters, all eleven parameters, and the pipeline trace.

Switching is a pure view change over the same report — no refetch — so the two
views can never disagree about the numbers.

---

## Four things the library's docs get wrong

All four were found by running it, not by reading about it. They are why several
parameters in [`server/params.js`](server/params.js) are derived rather than
fixed. **Re-check them against any newer version.**

### 1. `fusion_tolerance` is in absolute price units

The parameter description does not say so. Re-running the published worked
example's geometry at 100× the price scale with the same tolerance produces
**zero** accepted zones instead of one — so it cannot be a fraction of price.

```bash
npm run probe
```

A hard-coded tolerance is therefore meaningless across instruments. It is
derived from median ATR, and the UI exposes it as *"fuse within N × ATR"*.
`BRK-A` at ~$780,000 a share is in the smoke set specifically to prove this
works: it fuses at a tolerance of ~3,400, where a constant `0.25` finds nothing.

### 2. `minSeparation` is a price margin, not a bar count

`causal-pivot-detection` documents it as *"minimum bars between accepted
pivots"* and constrains it to an integer. The shipped implementation compares it
against a price margin:

```js
const highMargin = bars[i].high - Math.max(leftHigh, rightHigh);
if (... && highMargin + 1e-12 >= minSeparation)
```

Same trap, same fix: expressed in ATR by the caller, converted to price once.

### 3. The volume profile omits empty bins; the POC detector demands contiguous ones

`price-by-volume-profile-construction` builds a `Map` keyed by bin index and
returns the sorted keys, so a price band nobody traded in produces no row.
`poc-value-area-hvn-lvn-detection` then throws
`"profile rows must be ordered and contiguous"` on the first gap.

[`sources/volume-profile.js`](server/sources/volume-profile.js) re-inserts the
missing bins at volume 0. That is not a fudge — a bin with no volume genuinely
is a low-volume node — but skipping it would silently glue two non-adjacent
price bands together.

Related: the **round-number base unit** decides which prices the library classes
as `major` and `half`, not just how far apart they sit. It is exposed as a
slider in **rungs along the 1 / 2 / 5 ladder**, not as a price, for the same
reason as everything else here. On AAPL over two years `auto` picks a grid of 5
(35 levels, 22 zones); `+2` picks 20 (9 levels, 6 zones).

### 4. `docs.json` truncates nested example inputs without flagging them

Captured examples carry an `elided` field, but it only marks **top-level array
arguments**. An array nested inside a record argument is cut with `elided: null`.
The fusion example is the clearest case: `args` carries 3 levels, and the stored
`output` describes a zone fused from 5. This affects `record-transform` topics,
which is 257 of the 324.

Reliable: the captured **output** field names. Not reliable: the captured
**input** arity.

---

## Verification

```bash
npm test         # replay every used topic's published example
npm run smoke    # live run against five deliberately awkward instruments
npm run probe    # the fusion_tolerance experiment from finding 1
```

`npm test` fails only when a key the example documents is no longer returned —
that is what silently turns a caller's field into `undefined` and its arithmetic
into `NaN`. A key the function returns that the example *omits* is reported, not
failed: `zigzag-segmentation` returns `{ pivots, states }` while its captured
example shows only `pivots`.

The smoke set is chosen to break things:

| Symbol | What it tests |
|---|---|
| `AAPL` | a normal, well-behaved equity |
| `BRK-A` | ~$780k a share — any absolute price constant falls apart |
| `EURUSD=X` | four decimals, and real OHLC violations in Yahoo's own data |
| `^GSPC` | an index |
| `TSLA` | wide bars, worst case for the tape approximation |

`EURUSD=X` is the one to watch: Yahoo returns ~17,000 hourly bars with **zero**
volume, so the volume-profile source drops out and the confluence denominator
falls to 3. Zones read `2/3 sources`, not `2/4`.

---

## The one approximation

`price-by-volume-profile-construction` takes a **tape** — `trade_id`,
`timestamp`, `price`, `volume`, `final`. Yahoo does not sell tick data.

[`server/tape.js`](server/tape.js) maps each intraday bar to one trade at its
typical price `(high + low + close) / 3`, carrying the bar's whole volume. It is
wrong in two specific ways, both stated in the file and both surfaced in the UI
under an `approximation` badge:

1. it assumes all of a bar's volume traded at one price;
2. it carries no aggressor side, so nothing downstream may claim one.

What makes it defensible is the interval — hourly bars over two years give
~5,000 allocation points where daily bars would give ~500. It is isolated in one
file: wire a real tape, delete it, and nothing else changes.

---

## Layout

```
app.js                     cPanel entry point. Reads PORT, starts the server.
server/
  index.js                 express app: static frontend + API routes
  yahoo.js                 provider boundary — the only file that knows a Yahoo field name
  tape.js                  intraday bars → Trade[]  (the approximation, isolated)
  params.js                every derived parameter, one place, each with its reason
  topics.js                the 13 topics and their verification tiers
  analyze.js               the pipeline
  fuse.js                  fusion + strength + role reversal + breakout
  sources/                 one file per level source, ~100 lines each
public/                    index.html, app.js, styles.css — no build step
tools/
  replay-examples.mjs      npm test
  smoke.mjs                npm run smoke
  probe-fusion.mjs         the fusion_tolerance experiment
docs/SCOPE.md              the design record and the decisions behind it
```

### Reading it as a tutorial

In this order:

1. [`server/yahoo.js`](server/yahoo.js) — how a vendor boundary is drawn.
2. [`server/analyze.js`](server/analyze.js) — validate, then measure the ATR
   everything else is scaled by.
3. [`server/sources/pivots.js`](server/sources/pivots.js) — the simplest source,
   and both its topics are `verified`.
4. [`server/params.js`](server/params.js) — why nothing in price units is ever a
   constant.
5. [`server/fuse.js`](server/fuse.js) — the line this project exists to delete.

## Routes

| Route | Returns |
|---|---|
| `GET /` | the app |
| `GET /api/config` | ranges, intervals, defaults, topic/tier table |
| `GET /api/analyze?symbol=&range=&interval=&…` | the full report |
| `GET /api/sources?symbol=…` | the four raw level lists **before** fusion |
| `GET /healthz` | `{ ok: true }` |

`/api/sources` exists for teaching: the fusion is only interesting if you can
see what went into it.

---

## Deploying to cPanel

There is **no build step**. Upload and run.

1. Upload or clone the repository into the application root.
2. In **Setup Node.js App**, set:
   - **Application root** — this directory
   - **Application startup file** — `app.js`
   - **Node version** — 22 or newer
3. Run **Run NPM Install**, then start the app.

Notes:

- Passenger injects `PORT`; `app.js` reads it and falls back to 5173 locally, so
  the local and hosted paths are the same code.
- The package is ESM (`"type": "module"`). Node ≥ 22.12 loads it under Passenger
  without a shim. On an older Node, replace `app.js` with a CommonJS file that
  does `import("./server/index.js")`.
- `lightweight-charts` is served from `node_modules`, so the page makes **no**
  external requests and works behind a restrictive host.
- The server needs outbound HTTPS to `query1.finance.yahoo.com`. There is no API
  key and nothing to configure.

---

## Analysis, not advice

These functions compute quantities. A level is an observation about a price
series — not a prediction, not a signal, and not a recommendation about anyone's
money. For decisions about money, talk to a licensed adviser.
