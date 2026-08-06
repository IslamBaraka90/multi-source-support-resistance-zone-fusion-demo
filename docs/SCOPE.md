# Scope — Multi-Source Support & Resistance Zone Fusion

**Status:** built. All four decisions in §10 were approved as recommended and
phases 1–5 are implemented; see the README for how to run it. This document is
kept as the design record — where it says "the plan is", that plan shipped.
**Library:** `fintech-algorithms@0.12.0` (324 topics), installed and probed.
**Skill:** `IslamBaraka90/Fintech-Algorithms-Library` installed at `.agents/skills/fintech-algorithms`.

---

## 1. What this app is

A single Node process that takes a ticker, derives price levels from **four
independent methods**, fuses them into zones, grades those zones, and shows the
whole derivation on one page.

It is the successor to the Support & Resistance demo in `kwealth version 2`.
That app was honest about its own limit, in a comment:

> `source_confluence` is 0..1 and describes how many independent methods put a
> level here. This demo derives levels from one method — pivot clustering — so
> the honest input is a single source, nudged by how well-populated the cluster
> is rather than inflated to look impressive.

So `source_confluence` was a stand-in: a function of touch count wearing the
name of something else. **This app's entire reason to exist is to delete that
line and replace it with a measured count.**

---

## 2. The four level sources

Each source runs independently, produces a list of candidate prices with a
weight, and never sees the others' output. That independence is what makes the
fused count mean something.

| # | Source tag | Topics | Tier | Input |
|---|---|---|---|---|
| 1 | `pivot` | `causal-pivot-detection` → `support-resistance-clustering` | **verified** → **verified** | daily bars |
| 2 | `round-number` | `psychological-round-number-level-generation` | contract | last close + bounds |
| 3 | `volume-profile` | `price-by-volume-profile-construction` → `poc-value-area-hvn-lvn-detection` | contract → contract | intraday tape |
| 4 | `fibonacci` | `zigzag-segmentation` → `fibonacci-retracement-extension-projection` | **verified** → contract | daily closes |

Then the confluence layer:

| Stage | Topic | Tier |
|---|---|---|
| Fuse | `multi-source-support-resistance-zone-fusion` | contract |
| Grade | `support-resistance-zone-strength-decay-scoring` | contract |
| Role | `support-resistance-role-reversal-state-machine` | contract |
| Breakout | `breakout-and-retest-detection` | contract |

Plus the boundary and volatility work:

| Stage | Topic | Tier |
|---|---|---|
| Validate | `ohlc-consistency-validator` | contract |
| Volatility | `atr` | **verified** |

**16 library calls across 12 topics.** Every number on the page comes from one
of them. This repo contributes adapters, parameter derivation and presentation —
no arithmetic that the library already owns.

---

## 3. What I verified by probing, not by assuming

I ran `tools/probe-fusion.mjs` against the installed package before designing
anything. Three findings change the design.

### 3.1 `fusion_tolerance` is in absolute price units

The parameter description does not say. So I took the published worked example's
geometry and re-ran it at 100× the price scale with the same tolerance:

```
same geometry at ~100   -> 1 accepted zone,  1 rejected cluster
same geometry at ~10000 -> 0 accepted zones, 5 rejected clusters
```

A fraction-of-price tolerance would have fused both. It is absolute price.

**Consequence:** a hard-coded `fusion_tolerance` is meaningless across
instruments — `0.25` is a rounding error on a ¥40,000 index and prohibitive on a
$4 stock. It gets **derived from median ATR**, the same trick the previous demo
used for `minSeparation`. The UI exposes it as *"fuse levels within N × ATR"*.

This is the same class of trap as `minSeparation` in the old app, and it is
worth a callout in the UI because it is the single most likely way a learner
copying this code gets a plausible-looking wrong answer.

### 3.2 `source_count` counts *distinct sources*, not levels

Two pivot levels 0.1 apart, tolerance 0.25, `minimum_sources: 2`:

```json
{ "zones": [], "rejected_clusters": [
  { "source_count": 1, "sources": ["pivot"], "member_ids": ["P1","P2"],
    "reason": "insufficient-distinct-sources" } ] }
```

Two members, one source, rejected. This is exactly the semantics the brief
wants — the library already refuses to let one method vote twice, and the old
demo's touch-count proxy was papering over that.

### 3.3 Zone bounds are `[min(member) − tolerance, max(member) + tolerance]`

Derived from the worked example and confirmed by reproduction. `center` is the
**weight-weighted mean** of member prices, not the midpoint of the bounds. Both
get shown, because they differ and the difference is informative.

### 3.4 Caveat on the captured examples

`docs.json` prints a **truncated** `call` for several topics — the fusion example
shows 3 input levels but its output implies 5, and the volume-profile example
shows 3 trades but reports `trade_count: 12`. The captured *output* field names
are reliable; the printed *input* arity is not. Reconstructing the fusion
example from 5 levels reproduced the published output byte-for-byte, so the
truncation is cosmetic. Worth knowing before anyone treats a printed call as a
regression fixture.

---

## 4. Data sourcing, and the one honest compromise

Yahoo Finance, no API key, no vendor SDK — same provider boundary pattern as the
previous demo (`server/yahoo.js` is the only file that knows a Yahoo field name).

Two fetches per analysis:

| Series | Interval / range | Feeds |
|---|---|---|
| Structure | `1d` over `1y`–`5y` (user-selectable) | pivots, Fibonacci, ATR, validation, role reversal, breakout |
| Tape | `1h` over `730d`, or `5m` over `60d` | volume profile only |

Verified live against Yahoo just now: `1h/730d` → 5,097 bars, 5,071 with volume;
`5m/60d` → 4,681 bars, 4,677 with volume. Both intervals are real and populated.

### The compromise, stated plainly

`price-by-volume-profile-construction` takes a **`Trade[]` tape** — `trade_id`,
`timestamp`, `price`, `volume`, `final`. Yahoo does not sell tick data. So each
intraday bar is mapped to trades, and **that mapping is this app's invention,
not the library's**.

The plan is one trade per intraday bar at its **typical price**
`(high + low + close) / 3` carrying the bar's full volume — the standard
volume-at-price approximation. It is an approximation in two named ways:

1. It assumes all of a bar's volume traded at one price. On a wide bar that is
   false.
2. It cannot distinguish aggressor side, so nothing downstream may claim to.

Both get printed in the pipeline trace and labelled `approximation` — a distinct
badge from `verified` and `contract`, so a reader can see at a glance that this
input is weaker than the others. Using an hourly or 5-minute bar rather than a
daily one is what keeps the approximation defensible: ~5,000 allocation points
across a year instead of ~250.

**Open question for you — see §10, decision A.** An alternative is to drop the
volume-profile source to three sources and stay entirely on library-native
inputs. I recommend keeping it with the disclosure, because four sources is the
brief and the disclosure is more instructive than the omission.

---

## 5. Pipeline

```
  Yahoo daily  ─┬─> validate ─> ATR ─┬─> pivots ──> cluster ────────┐
                │                    │                              │
                │                    └─> zigzag ──> fibonacci ──────┤
                │                                                   ├─> FUSE ─> zones
                └─> last close ──────────> round numbers ───────────┤
                                                                    │
  Yahoo intraday ─> tape adapter ─> volume profile ─> POC/VA/HVN ───┘
                                                                     │
                            ┌────────────────────────────────────────┘
                            │
                            ├─> zone strength + decay   (source_confluence = REAL)
                            ├─> role-reversal state machine
                            └─> breakout & retest state machine
```

### Parameter derivation (all instrument-relative, none hard-coded)

| Parameter | Derived from | Why not a constant |
|---|---|---|
| `tickSize` | price magnitude, capped at `0.01` | a penny tolerance on a 1.16 FX rate passes corrupt bars |
| `fusion_tolerance` | `fusionAtr × median(ATR)` | §3.1 — absolute price units |
| `base_unit` (round numbers) | price magnitude, tick-aligned | $4 stock rounds at 0.5, ¥40,000 index at 500 |
| `bin_size_ticks` | sized so a bin ≈ ¼ ATR | fixed bins are either 3 bins or 30,000 |
| `minSeparation` (pivots) | `prominenceAtr × median(ATR)` | carried over from the previous demo's finding |
| `break_buffer` | `0.25 × median(ATR)` | a wick is not a break |

### Source weights fed to the fusion

The fusion takes a `weight` per level. Each source supplies its own, from its
own output rather than from a table of guesses:

- **pivot** — normalised `touch_count` from the cluster
- **round-number** — `salience_weight` straight off the library output (0.5 minor / 0.75 half / 1.0 major)
- **volume-profile** — normalised `median_ratio` of the HVN, POC weighted highest
- **fibonacci** — ratio salience (0.618 and 0.5 above 0.236 and 0.786)

### The line this app exists to delete

```js
// before — one source wearing the name of four
const sourceConfluence = Math.min(1, 0.4 + 0.15 * (cluster.touch_count - cfg.minTouches));

// after — counted, not estimated
const sourceConfluence = zone.source_count / sourcesAvailable;
```

`sourcesAvailable` is the denominator, not a constant `4`: if a symbol has no
intraday tape (some indices and FX crosses do not), the denominator drops to 3
so the instrument is not silently penalised for a data gap. The UI states which
sources ran and which were unavailable.

---

## 6. Layout and the cPanel constraint

Entry point is **`app.js` at the repo root**, per your cPanel Passenger setup.
One command runs the API and the frontend — no build step, no bundler, no second
process.

```
app.js                      # cPanel entry point. Thin: reads PORT, starts the server.
package.json                # "start": "node app.js", type: module, engines node >=22
server/
  index.js                  # express app: static frontend + API routes
  yahoo.js                  # provider boundary. Only file that knows a Yahoo field name.
  tape.js                   # intraday bars -> Trade[] (the §4 approximation, isolated)
  params.js                 # every derived parameter, one place, each with its reason
  sources/
    pivots.js               # source 1
    round-numbers.js        # source 2
    volume-profile.js       # source 3
    fibonacci.js            # source 4
  fuse.js                   # fusion + strength + role + breakout
public/
  index.html
  app.js
  styles.css
docs/
  SCOPE.md                  # this file
tools/
  probe-fusion.mjs          # the §3 probe — kept, it is the evidence
  replay-examples.mjs       # replays every used topic's published example
```

**One source file per level source** is deliberate. A learner opening
`sources/round-numbers.js` sees one library call, its inputs derived above it,
and its output mapped to `{ level_id, source, price, weight }` — about 40 lines,
readable in one sitting, with no knowledge of the other three required.

### cPanel notes

- Passenger sets `PORT`; `app.js` reads `process.env.PORT` with a local fallback.
- `"type": "module"` with an ESM `app.js` is fine on Node ≥ 22.12 (`require(esm)`
  landed unflagged). Your local Node is 22.22. **Decision B in §10** covers
  falling back to a CommonJS shim if your cPanel Node is older.
- `lightweight-charts` is served from `node_modules` by the Express app, so there
  is no CDN dependency and no external request from the browser.
- Outbound HTTPS to `query1.finance.yahoo.com` must be allowed on the host.

---

## 7. HTTP routes

| Route | Returns |
|---|---|
| `GET /` | the app (static) |
| `GET /api/config` | ranges, intervals, defaults, the topic/tier table |
| `GET /api/analyze?symbol=&range=&interval=&…` | the full report |
| `GET /api/sources?symbol=…` | the four raw level lists *before* fusion |
| `GET /healthz` | `{ ok: true }` — cPanel/Passenger probe |

`/api/sources` exists for teaching: it lets you see the four inputs on their own,
so the fusion is observable as a step rather than a black box.

Errors keep the previous demo's shape — a typed `ProviderError` / `AnalysisError`
carrying its own HTTP status, so a bad ticker is a 404 with a sentence and never
a 500 with a stack trace.

---

## 8. The page

Single page, no framework, no build.

1. **Controls** — symbol, range, interval, and the derived parameters as sliders
   (each labelled in ATR or bps, never in raw price).
2. **Chart** — candles with fused zones drawn as bands, shaded by grade.
3. **Zone table** — score, grade, which sources agree, distance in bps, role,
   breakout state. Sorted by score.
4. **Source panel** — the four raw level lists side by side, so you can see
   which levels fused and which were rejected and why (`insufficient-distinct-sources`
   is a reason code the library gives us; it gets shown verbatim).
5. **Pipeline trace** — every stage, its topic, its **tier badge**, and a
   sentence of what it did with real counts. Carried over from the previous demo,
   extended with the `approximation` badge from §4.
6. **Data quality** — vendor rows, dropped, rejected, deduplicated, tick size.

Every displayed number carries its tier. That is non-negotiable per the skill's
rule 3, and it is also the most useful thing on the page.

---

## 9. Verification plan

- `tools/replay-examples.mjs` replays the published worked example for all 12
  topics and asserts field-for-field. Runs as `npm test`. This is what catches a
  library upgrade changing a return key.
- `tools/probe-fusion.mjs` stays in the repo as the evidence for §3.
- Live smoke run across a deliberately awkward set: `AAPL` (normal), `BRK-A`
  (~$700k, breaks any absolute constant), `EURUSD=X` (four decimals, known bad
  bars in the previous demo), `^GSPC` (index, no real volume), `TSLA` (wide bars,
  worst case for the §4 approximation).
- The `BRK-A` and `EURUSD=X` cases exist specifically to prove §3.1 is handled.

**No numeric claim ships without its tier.** Eight of the twelve topics are
`contract`, which means their arithmetic is not attested against an independent
published figure — the UI says so rather than implying otherwise.

---

## 10. Decisions — all four approved as recommended

*Answered 2026-08-07: keep the volume profile, ESM entry point, watchlist
deferred, `lightweight-charts`. The recommendations below are what shipped.*

**A. Volume profile — keep or drop?**
Keeping it means one documented approximation (bar → trade, §4) in an otherwise
library-native pipeline, and gets you the four sources the brief asks for.
Dropping it gives three fully-native sources and no asterisk.
*My recommendation: keep it, disclosed and badged.* The approximation is a real
thing practitioners do, and showing it labelled is more instructive than hiding
the topic.

**B. cPanel Node version?**
If your cPanel Node is ≥ 22.12, `app.js` stays ESM and nothing special happens.
If it is older, `app.js` becomes a 3-line CommonJS shim that dynamically
`import()`s the ESM server. Tell me the version and I will pick.

**C. Watchlist route — in scope now, or phase 2?**
`market-wide-zone-proximity-scanner-ranking` (D08-F06-A09) ranks *many* symbols
by how close each is to a strong zone. It reuses this engine unchanged and would
add a second page. It is not in the brief. *My recommendation: phase 2*, once the
single-symbol path is reviewed.

**D. Chart library?**
`lightweight-charts` v5, as in the previous demo — served locally, no CDN. Say if
you would rather I do it in plain SVG to keep the dependency count at one.

---

## 11. Phasing

| Phase | Deliverable | |
|---|---|---|
| 0 | repo, GitHub, skill install, library probe, this document | ✅ |
| 1 | Provider boundary + validation + ATR + `/healthz`, verified against the awkward symbols | ✅ |
| 2 | The four sources, each standalone, exposed via `/api/sources` | ✅ |
| 3 | Fusion + strength with real `source_confluence`, role reversal, breakout | ✅ |
| 4 | Frontend: chart, zone table, source panel, trace | ✅ |
| 5 | `npm test` replay harness, README, cPanel deployment notes | ✅ |

### What the build added to §3

A fourth library finding, which only showed up once the replay harness existed:

**3.5 — `docs.json`'s `elided` flag only covers top-level array arguments.**
An array nested inside a record argument is truncated with `elided: null`, which
is why §3.4 looked like a self-contradiction. This affects `record-transform`
topics, which is 257 of the 324. `tools/replay-examples.mjs` classifies on the
returned key set instead of on value equality because of it, and fails only when
a documented key stops being returned.

Related, and found the same way: `zigzag-segmentation` returns
`{ pivots, states }` — its RETURNS type says so — but its captured example
output shows only `pivots`. Harmless here, since this app reads `.pivots`, but
it is the reason the harness treats "returns more than documented" as a report
rather than a failure.

### Deferred, unchanged

Decision C stands: `market-wide-zone-proximity-scanner-ranking` (the watchlist
route) is phase 2 work and is not built.
