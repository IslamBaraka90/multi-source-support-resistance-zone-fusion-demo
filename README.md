# Multi-Source Support &amp; Resistance Zone Fusion

A Node app that derives price levels from **four independent methods**, fuses
them into zones, and grades those zones — every number computed by the
[`fintech-algorithms`](https://www.npmjs.com/package/fintech-algorithms) package
rather than by this repository.

One process serves the API and the page. No build step, no bundler, no
framework.

```bash
npm install
npm start
```

Then open <http://localhost:5173>.

---

## Why this exists

The predecessor demo derived levels from pivot clustering alone. It then had to
supply `source_confluence` — a 0..1 input to the zone scorer meaning *"how many
independent methods put a level here"* — from the only thing it had:

```js
// one source wearing the name of four
const sourceConfluence = Math.min(1, 0.4 + 0.15 * (cluster.touch_count - cfg.minTouches));
```

It was labelled honestly as a stand-in, but it was still a touch count in a
confluence-shaped hole. This app replaces it with a measurement:

```js
// counted, not estimated
const sourceConfluence = zone.source_count / sourcesAvailable;
```

`source_count` counts **distinct sources**. Two pivot levels at the same price
are one source, and the library rejects that cluster with
`reason: "insufficient-distinct-sources"`.

---

## The four sources

Each runs independently and never sees the others' output. That independence is
what makes agreement mean something.

| Source | Topics | Tier |
|---|---|---|
| **Pivot clusters** | `causal-pivot-detection` → `support-resistance-clustering` | verified → verified |
| **Round numbers** | `psychological-round-number-level-generation` | contract |
| **Volume profile** | `price-by-volume-profile-construction` → `poc-value-area-hvn-lvn-detection` | contract → contract |
| **Fibonacci** | `zigzag-segmentation` → `fibonacci-retracement-extension-projection` | verified → contract |

Then the confluence layer: `multi-source-support-resistance-zone-fusion` →
`support-resistance-zone-strength-decay-scoring` →
`support-resistance-role-reversal-state-machine` →
`breakout-and-retest-detection`. Plus `ohlc-consistency-validator` and `atr` at
the boundary.

**13 topics.** Every displayed number carries its verification tier: `verified`
means the arithmetic is replayed and asserted on every build of the library;
`contract` means the shape is checked but the numbers are not cross-checked
against an independent published figure. Eight of the thirteen are `contract`,
and the page says so rather than implying otherwise.

---

## Four things worth knowing about the library

All four were found by running it, not by reading about it. They are the reason
several parameters in `server/params.js` are derived rather than fixed.

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
works: it fuses at a tolerance of ~3,400, where a constant `0.25` would find
nothing.

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

`server/sources/volume-profile.js` re-inserts the missing bins at volume 0.
That is not a fudge — a bin with no volume genuinely is a low-volume node — but
skipping it would silently glue two non-adjacent price bands together.

### 4. `docs.json` truncates nested example inputs without flagging them

Captured examples carry an `elided` field, but it only marks **top-level array
arguments**. An array nested inside a record argument is cut with `elided: null`.
The fusion example is the clearest case: `args` carries 3 levels, and the stored
`output` describes a zone fused from 5.

Reliable: the captured **output** field names. Not reliable: the captured
**input** arity. `npm test` classifies each topic accordingly.

---

## Verification

```bash
npm test     # replay every used topic's published example
npm run smoke   # live run against five deliberately awkward instruments
npm run probe   # the fusion_tolerance experiment from finding 1
```

`npm test` fails only when a key the example documents is no longer returned —
that is what silently turns a caller's field into `undefined`. A key the
function returns that the example omits is reported, not failed:
`zigzag-segmentation` returns `{ pivots, states }` while its captured example
shows only `pivots`.

The smoke set is chosen to break things:

| Symbol | What it tests |
|---|---|
| `AAPL` | a normal, well-behaved equity |
| `BRK-A` | ~$780k a share — any absolute price constant falls apart |
| `EURUSD=X` | four decimals, and real OHLC violations in Yahoo's own data |
| `^GSPC` | an index |
| `TSLA` | wide bars, worst case for the tape approximation |

`EURUSD=X` is the one to watch: Yahoo returns ~17,000 hourly bars with **zero**
volume, so the volume-profile source drops out entirely and the denominator of
`source_confluence` falls to 3. Zones then read `2/3 sources`, not `2/4` — an
instrument is not penalised for a data gap it cannot help.

---

## The one approximation

`price-by-volume-profile-construction` takes a **tape** — `trade_id`,
`timestamp`, `price`, `volume`, `final`. Yahoo does not sell tick data.

`server/tape.js` maps each intraday bar to one trade at its typical price
`(high + low + close) / 3`, carrying the bar's whole volume. It is wrong in two
specific ways, both stated in the file and both surfaced in the UI under an
`approximation` badge:

1. it assumes all of a bar's volume traded at one price;
2. it carries no aggressor side, so nothing downstream may claim one.

What makes it defensible is the interval — hourly bars over two years give
~5,000 allocation points, where daily bars would give ~500. It is isolated in
one file: wire a real tape and delete it, and nothing else changes.

---

## Layout

```
app.js                     cPanel entry point. Reads PORT, starts the server.
server/
  index.js                 express app: static frontend + API routes
  yahoo.js                 provider boundary — the only file that knows a Yahoo field name
  tape.js                  intraday bars -> Trade[]  (the approximation, isolated)
  params.js                every derived parameter, one place, each with its reason
  topics.js                the 13 topics and their verification tiers
  analyze.js               the pipeline
  fuse.js                  fusion + strength + role reversal + breakout
  sources/
    pivots.js              source 1     } one file each, ~100 lines,
    round-numbers.js       source 2     } readable on its own without
    volume-profile.js      source 3     } knowing anything about the
    fibonacci.js           source 4     } other three
public/                    index.html, app.js, styles.css — no build step
tools/
  replay-examples.mjs      npm test
  smoke.mjs                npm run smoke
  probe-fusion.mjs         the fusion_tolerance experiment
docs/SCOPE.md              design notes and the decisions behind them
```

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

1. Upload the repository, or clone it, into the application root.
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
money.
