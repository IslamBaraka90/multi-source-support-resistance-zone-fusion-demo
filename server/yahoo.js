/*
 * Provider boundary: Yahoo Finance -> canonical Bar[].
 *
 * Nothing below this file sees a Yahoo field name. The analytics layer is
 * handed the canonical shape documented by the library:
 *
 *   { timestamp: ISO-8601, symbol, open, high, low, close, volume }
 *
 * Swapping Yahoo for another vendor means rewriting this file and nothing else.
 */

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

// Yahoo rejects requests without a browser-shaped User-Agent.
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  Accept: "application/json",
};

/** Ranges offered for the structure series (daily bars). */
export const RANGES = ["6mo", "1y", "2y", "5y", "10y", "max"];
export const INTERVALS = ["1d", "1wk"];

/*
 * Ranges for the tape series that feeds the volume profile. Yahoo caps
 * intraday history hard, and the cap is per-interval, not global:
 *
 *   5m  -> 60 days     15m -> 60 days      1h -> 730 days
 *
 * Asking for 1h/max returns daily bars without saying so, which would silently
 * turn the volume profile into a 250-point approximation. Only the pairs below
 * are offered, and each one was checked against the live API.
 */
export const TAPE_PLANS = [
  { interval: "1h", range: "730d", label: "hourly, 2 years" },
  { interval: "1h", range: "1y", label: "hourly, 1 year" },
  { interval: "15m", range: "60d", label: "15-minute, 60 days" },
  { interval: "5m", range: "60d", label: "5-minute, 60 days" },
];

export class ProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

const TICKER = /^[A-Z0-9.\-^=]{1,20}$/;

export function normaliseSymbol(symbol) {
  const ticker = String(symbol || "").trim().toUpperCase();
  if (!TICKER.test(ticker)) {
    throw new ProviderError(`"${symbol}" is not a plausible ticker symbol.`, 400);
  }
  return ticker;
}

/**
 * Fetch candles for one symbol.
 * @returns {{ meta: object, bars: object[], droppedByProvider: number }}
 */
export async function fetchBars(symbol, { range = "1y", interval = "1d" } = {}) {
  const ticker = normaliseSymbol(symbol);
  const url = `${CHART_URL}/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`;

  let response;
  try {
    response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  } catch (cause) {
    throw new ProviderError(`could not reach Yahoo Finance: ${cause.message}`);
  }

  if (response.status === 404) {
    throw new ProviderError(`Yahoo Finance has no data for "${ticker}".`, 404);
  }
  if (response.status === 429) {
    throw new ProviderError("Yahoo Finance is rate-limiting this IP. Wait a moment.", 429);
  }
  if (!response.ok) {
    throw new ProviderError(`Yahoo Finance returned HTTP ${response.status}.`);
  }

  const payload = await response.json();
  const error = payload?.chart?.error;
  if (error) throw new ProviderError(`Yahoo Finance: ${error.description ?? error.code}`, 404);

  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp?.length || !quote) {
    throw new ProviderError(`Yahoo Finance returned no candles for "${ticker}".`, 404);
  }

  return {
    meta: adaptMeta(result.meta, ticker),
    ...adaptBars(result, quote, ticker),
  };
}

/*
 * The volume profile is a *nice to have*: plenty of instruments (indices, FX
 * crosses) report no usable intraday volume at all, and that is a data fact
 * rather than an error. So this never throws — it returns why it failed, and
 * the pipeline drops to three sources and says so.
 */
export async function fetchTape(symbol, plan) {
  const chosen = TAPE_PLANS.find((p) => p.interval === plan?.interval && p.range === plan?.range)
    ?? TAPE_PLANS[0];

  try {
    const { bars } = await fetchBars(symbol, chosen);
    const withVolume = bars.filter((bar) => bar.volume > 0);

    if (withVolume.length < 50) {
      return {
        plan: chosen,
        bars: [],
        unavailable:
          `Yahoo returned ${bars.length} ${chosen.interval} bars but only ` +
          `${withVolume.length} carried volume — too few to build a profile from.`,
      };
    }
    return { plan: chosen, bars: withVolume, unavailable: null };
  } catch (cause) {
    return { plan: chosen, bars: [], unavailable: `intraday fetch failed: ${cause.message}` };
  }
}

function adaptMeta(meta = {}, ticker) {
  return {
    symbol: meta.symbol ?? ticker,
    name: meta.longName ?? meta.shortName ?? meta.symbol ?? ticker,
    currency: meta.currency ?? "USD",
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? "unknown",
    timezone: meta.exchangeTimezoneName ?? "UTC",
    instrumentType: meta.instrumentType ?? "EQUITY",
    regularMarketPrice: numeric(meta.regularMarketPrice),
  };
}

function adaptBars(result, quote, ticker) {
  const bars = [];

  for (let i = 0; i < result.timestamp.length; i += 1) {
    const bar = {
      timestamp: new Date(result.timestamp[i] * 1000).toISOString(),
      symbol: ticker,
      // Number() on every field: Yahoo nulls out holidays and halted sessions,
      // and a string or null flowing into arithmetic produces NaN silently
      // rather than throwing.
      open: numeric(quote.open?.[i]),
      high: numeric(quote.high?.[i]),
      low: numeric(quote.low?.[i]),
      close: numeric(quote.close?.[i]),
      volume: numeric(quote.volume?.[i]) ?? 0,
    };

    // A hole in the vendor payload is dropped here, at the boundary, and
    // counted — never carried forward as a zero.
    if (bar.open === null || bar.high === null || bar.low === null || bar.close === null) {
      continue;
    }
    bars.push(bar);
  }

  return { bars, droppedByProvider: result.timestamp.length - bars.length };
}

function numeric(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
