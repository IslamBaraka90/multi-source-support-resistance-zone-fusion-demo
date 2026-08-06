/*
 * Intraday bars -> Trade[].
 *
 * THIS FILE IS THE ONE APPROXIMATION IN THE APP. Everything else is either a
 * library call or a mapping between library shapes. This is neither.
 *
 * `price-by-volume-profile-construction` takes a tape:
 *
 *     { trade_id, timestamp, price, volume, final }
 *
 * Yahoo Finance does not sell tick data. So each intraday bar is turned into
 * one trade at its typical price, carrying the bar's whole volume. That is the
 * standard volume-at-price approximation, and it is wrong in two specific ways
 * that anything downstream must not paper over:
 *
 *   1. It assumes every share in a bar traded at a single price. On a wide bar
 *      that is false, and the error grows with the bar's range.
 *   2. It carries no aggressor side, so nothing downstream may claim to know
 *      whether volume was bought or sold.
 *
 * What makes it defensible is the interval. Run on hourly bars over two years
 * this allocates ~5,000 points; run on daily bars it would be ~500, and the
 * profile would be a histogram of nothing. The tier badge for anything derived
 * from this output is `approximation`, never `contract`, and the UI says so.
 *
 * If you later wire a real tape — a broker feed, a Databento/Polygon tick file —
 * delete this file and hand the trades straight to the profile constructor. The
 * rest of the app does not change.
 */

import { snapToTick } from "./params.js";

/**
 * @param {object[]} bars intraday bars, chronological, volume > 0
 * @param {number} tick   instrument tick size
 * @returns {{ trades: object[], windowEnd: string, note: string }}
 */
export function barsToTape(bars, tick) {
  const trades = [];
  let previous = -Infinity;

  bars.forEach((bar, index) => {
    const time = Date.parse(bar.timestamp);

    // The library rejects a tape that goes backwards. Yahoo occasionally
    // repeats an intraday stamp across a session boundary; drop rather than
    // reorder, because reordering would invent a sequence that never happened.
    if (!Number.isFinite(time) || time < previous) return;
    previous = time;

    // Typical price, snapped onto the tick grid. The snap is not cosmetic:
    // the library recomputes round(price / tick) * tick and throws if the
    // input does not land on it.
    const typical = snapToTick((bar.high + bar.low + bar.close) / 3, tick);
    if (!Number.isFinite(typical) || typical <= 0) return;
    if (!(bar.volume > 0)) return;

    trades.push({
      trade_id: `${bar.symbol}-${index}`,
      timestamp: new Date(time).toISOString(),
      price: typical,
      volume: bar.volume,
      // Every one of these is a settled historical bar. There is no such thing
      // as a provisional trade in this adapter, and saying `true` here is a
      // statement about the source, not a default.
      final: true,
    });
  });

  const windowEnd = trades.length
    ? trades[trades.length - 1].timestamp
    : new Date(0).toISOString();

  return {
    trades,
    windowEnd,
    note:
      `${trades.length} intraday bars mapped to one trade each at typical price ` +
      `(high + low + close) / 3, tick-aligned. This is an approximation of a tape, ` +
      `not a tape: all of a bar's volume is placed at one price and no aggressor ` +
      `side is implied.`,
  };
}
