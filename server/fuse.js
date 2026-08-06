/*
 * The confluence layer.
 *
 *   levels from 4 sources -> multi-source-support-resistance-zone-fusion
 *                         -> support-resistance-zone-strength-decay-scoring
 *                         -> support-resistance-role-reversal-state-machine
 *                         -> breakout-and-retest-detection
 *
 * THIS IS THE FILE THE PROJECT EXISTS FOR.
 *
 * The predecessor demo derived levels from pivot clustering alone, and then had
 * to hand `source_confluence` — a 0..1 input meaning "how many independent
 * methods put a level here" — a number computed from touch count:
 *
 *     const sourceConfluence = Math.min(1, 0.4 + 0.15 * (cluster.touch_count - cfg.minTouches));
 *
 * It was labelled honestly as a stand-in, but it was still one source wearing
 * the name of four. Here the number is counted:
 *
 *     const sourceConfluence = zone.source_count / sourcesAvailable;
 *
 * and `source_count` is the count of *distinct* sources, which was confirmed by
 * experiment rather than assumed — see tools/probe-fusion.mjs. Two pivot levels
 * at the same price are one source, and the library rejects that cluster with
 * `reason: "insufficient-distinct-sources"`.
 */

import { multiSourceSupportResistanceZoneFusion } from "fintech-algorithms/geometric-chart-patterns/level-confluence-and-zone-scoring/multi-source-support-resistance-zone-fusion";
import { supportResistanceZoneStrengthDecayScoring } from "fintech-algorithms/geometric-chart-patterns/level-confluence-and-zone-scoring/support-resistance-zone-strength-decay-scoring";
import { supportResistanceRoleReversalStateMachine } from "fintech-algorithms/geometric-chart-patterns/level-confluence-and-zone-scoring/support-resistance-role-reversal-state-machine";
import { breakoutAndRetestDetection } from "fintech-algorithms/geometric-chart-patterns/level-confluence-and-zone-scoring/breakout-and-retest-detection";

import { AnalysisError } from "./topics.js";
import { round } from "./params.js";

export function fuseAndScore({ levels, sourcesAvailable, bars, atr, atrMedian, cfg, tolerance, buffer }) {
  if (!levels.length) {
    throw new AnalysisError("no source produced a single level — widen the range or loosen the parameters");
  }

  let fusion;
  try {
    fusion = multiSourceSupportResistanceZoneFusion({
      fusion_tolerance: tolerance,
      minimum_sources: cfg.minimumSources,
      levels: levels.map(({ level_id, source, price, weight }) => ({ level_id, source, price, weight })),
    });
  } catch (cause) {
    throw new AnalysisError(`fusion rejected the level set: ${cause.message}`);
  }

  const byId = new Map(levels.map((level) => [level.level_id, level]));
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const close = bars.map((b) => b.close);
  const lastIndex = bars.length - 1;
  const lastClose = close[lastIndex];

  const zones = fusion.zones
    .map((zone) => scoreZone({
      zone, byId, bars, high, low, close, atr, atrMedian,
      cfg, buffer, lastIndex, lastClose, sourcesAvailable,
    }))
    .sort((a, b) => b.score - a.score);

  const rejected = fusion.rejected_clusters.map((cluster) => ({
    zoneId: cluster.zone_id,
    lower: cluster.lower,
    upper: cluster.upper,
    center: cluster.center,
    sources: cluster.sources,
    sourceCount: cluster.source_count,
    memberIds: cluster.member_ids,
    members: cluster.member_ids.map((id) => byId.get(id)).filter(Boolean),
    reason: cluster.reason,
  }));

  return { zones, rejected, fusion };
}

function scoreZone({
  zone, byId, bars, high, low, close, atr, atrMedian,
  cfg, buffer, lastIndex, lastClose, sourcesAvailable,
}) {
  const atrAt = (i) => atr[i] ?? atrMedian ?? null;

  /*
   * Touch evidence. The library scores the zone; deciding what counts as a
   * touch and how hard price was rejected is this application's judgement, so
   * it is computed explicitly here rather than implied to come from the
   * library.
   *
   * A touch is a bar whose range intersects the zone band. Rejection is how far
   * price travelled away from the band afterwards, in whichever direction it
   * left, normalised by the ATR at that bar so the figure is comparable across
   * instruments.
   */
  const lookahead = Math.max(3, cfg.swingSpan * 2);
  const touches = [];
  let firstTouch = null;
  let lastTouch = null;

  for (let i = 0; i <= lastIndex; i += 1) {
    if (low[i] > zone.upper || high[i] < zone.lower) continue;

    if (firstTouch === null) firstTouch = i;
    lastTouch = i;

    const end = Math.min(lastIndex, i + lookahead);
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i + 1; j <= end; j += 1) {
      highest = Math.max(highest, high[j]);
      lowest = Math.min(lowest, low[j]);
    }
    const up = Number.isFinite(highest) ? highest - zone.upper : 0;
    const down = Number.isFinite(lowest) ? zone.lower - lowest : 0;
    const excursion = Math.max(0, up, down);
    const scale = atrAt(i);

    touches.push({
      index: i,
      timestamp: bars[i].timestamp,
      age_bars: lastIndex - i,
      rejection_atr: scale && scale > 0 ? round(excursion / scale, 6) : 0,
    });
  }

  /*
   * Break count: a decisive close through the band, buffered by a quarter ATR
   * so a wick or a rounding artefact is not counted as a break. Counted from
   * the zone's first contact, because a "break" of a zone price had not reached
   * yet is not a break.
   */
  const from = firstTouch ?? 0;
  let breakCount = 0;
  let side = null;
  for (let i = from; i <= lastIndex; i += 1) {
    const next =
      close[i] > zone.upper + buffer ? "above" :
      close[i] < zone.lower - buffer ? "below" : side;
    if (side && next && next !== side) breakCount += 1;
    side = next;
  }

  /* ------------------------------------------------- the point of the project */

  const sourceConfluence = Math.min(1, zone.source_count / Math.max(1, sourcesAvailable));

  const strength = supportResistanceZoneStrengthDecayScoring({
    source_confluence: round(sourceConfluence, 6),
    zone_age_bars: Math.max(0, lastIndex - from),
    half_life_bars: cfg.halfLifeBars,
    break_count: breakCount,
    rejection_target_atr: 1,
    touches: touches.map((t) => ({ age_bars: t.age_bars, rejection_atr: t.rejection_atr })),
  });

  /*
   * Role reversal. The fused zone carries no memory of whether it formed as a
   * ceiling or a floor — it is a price band several methods agree on. What it
   * is doing *now* is a separate question, and this state machine is what
   * answers it: a broken resistance that price retested from above is acting as
   * support.
   */
  let roleReversal = null;
  const closesAfter = close.slice(from);
  const initialRole = close[from] >= zone.center ? "support" : "resistance";

  if (closesAfter.length > 1 && zone.upper > zone.lower) {
    try {
      roleReversal = supportResistanceRoleReversalStateMachine({
        zone_lower: zone.lower,
        zone_upper: zone.upper,
        initial_role: initialRole,
        closes: closesAfter,
        break_buffer: buffer,
        confirmation_closes: 2,
      });
    } catch {
      roleReversal = null; // degenerate zone; reported as unavailable, not faked
    }
  }

  /* Breakout and retest, in whichever direction price currently sits. */
  let breakout = null;
  const direction = lastClose >= zone.center ? "up" : "down";
  const barsAfter = bars.slice(from).map((b) => ({ high: b.high, low: b.low, close: b.close }));

  if (barsAfter.length && zone.upper > zone.lower) {
    try {
      breakout = breakoutAndRetestDetection({
        zone_lower: zone.lower,
        zone_upper: zone.upper,
        break_buffer: buffer,
        retest_tolerance: buffer,
        breakout_closes: 2,
        max_retest_bars: Math.max(2, cfg.swingSpan * 3),
        direction,
        bars: barsAfter,
      });
    } catch {
      breakout = null;
    }
  }

  const members = zone.member_ids.map((id) => byId.get(id)).filter(Boolean);

  return {
    zoneId: zone.zone_id,
    lower: zone.lower,
    upper: zone.upper,
    center: zone.center,
    // The bounds are [min(member) - tolerance, max(member) + tolerance] and the
    // centre is the WEIGHT-weighted mean of member prices, not the midpoint of
    // the bounds. They differ, and the difference says which side of the band
    // the evidence actually sits on.
    midpoint: round((zone.lower + zone.upper) / 2, 8),
    sources: zone.sources,
    sourceCount: zone.source_count,
    sourceConfluence: round(sourceConfluence, 4),
    sourcesAvailable,
    weightSum: zone.weight_sum,
    memberIds: zone.member_ids,
    members,
    currentRole: lastClose >= zone.center ? "support" : "resistance",
    distance: round(zone.center - lastClose, 8),
    distanceBps: lastClose ? round(((zone.center - lastClose) / lastClose) * 10_000, 2) : null,
    widthBps: zone.center ? round(((zone.upper - zone.lower) / zone.center) * 10_000, 2) : null,
    insideZone: lastClose >= zone.lower && lastClose <= zone.upper,
    touchCount: touches.length,
    touches: touches.slice(-12),
    firstTouchIndex: firstTouch,
    lastTouchIndex: lastTouch,
    firstTouchAt: firstTouch === null ? null : bars[firstTouch].timestamp,
    lastTouchAt: lastTouch === null ? null : bars[lastTouch].timestamp,
    breakCount,
    score: strength.score,
    grade: strength.grade,
    components: strength.components,
    decayedTouchEvidence: strength.decayed_touch_evidence,
    roleReversal: roleReversal && {
      initialRole,
      state: roleReversal.state,
      finalRole: roleReversal.final_role,
      confirmed: roleReversal.confirmed,
      retestSeen: roleReversal.retest_seen,
      transitions: roleReversal.transitions.length,
    },
    breakout: breakout && {
      direction: breakout.direction,
      state: breakout.state,
      confirmed: breakout.confirmed,
      breakoutIndex: breakout.breakout_index,
      retestIndex: breakout.retest_index,
      confirmationIndex: breakout.confirmation_index,
      transitions: breakout.transitions.length,
    },
  };
}
