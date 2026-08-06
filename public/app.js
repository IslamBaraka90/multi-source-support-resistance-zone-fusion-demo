/*
 * The page. No framework, no build step — the whole client is this file, the
 * stylesheet, and the chart library served from node_modules.
 *
 * Two views over ONE analysis:
 *
 *   Simple    the two zones either side of the current price, in plain English.
 *             The default, because that is the question most people actually
 *             have.
 *   Advanced  every zone, every source, every parameter, the pipeline trace.
 *
 * Switching modes is a pure view change — same report, no refetch — so the two
 * can never disagree about what the numbers are.
 */

const LWC = window.LightweightCharts;
const $ = (id) => document.getElementById(id);

const SOURCE_COLOUR = {
  pivot: "#4c8dff",
  "round-number": "#a371f7",
  "volume-profile": "#db6d28",
  fibonacci: "#2ea875",
};

const GRADE_COLOUR = {
  strong: "#2ea875",
  moderate: "#4c8dff",
  weak: "#d29922",
  depleted: "#7d8fa8",
};

/* Grades are the library's word. This is what they mean to a human. */
const GRADE_PLAIN = {
  strong: "price has reacted here often and recently",
  moderate: "price has reacted here a few times",
  weak: "some reaction here, but old or thin",
  depleted: "price has broken through this repeatedly",
};

/*
 * Each slider says what it does AND why it is not a constant. The hints are the
 * most useful text on the page: they are the traps this app hit while it was
 * being written.
 */
const SLIDERS = [
  { key: "fusionAtr", label: "Fusion tolerance", min: 0.05, max: 2, step: 0.05, unit: "× ATR",
    hint: "fusion_tolerance is in ABSOLUTE PRICE, which the docs do not say. Proven by experiment: the published example re-run at 100× scale fuses nothing. Derived from ATR here." },
  { key: "minimumSources", label: "Min distinct sources", min: 1, max: 4, step: 1, unit: " of 4",
    hint: "Below this a cluster is rejected as insufficient-distinct-sources. Two levels from one source count once." },
  { key: "roundStep", label: "Round-number grid", min: -3, max: 3, step: 1, unit: " rungs",
    hint: "Moves along the 1/2/5 ladder from the automatic choice. Finer means more round numbers, each weaker as evidence; coarser means only the prices people actually watch. In rungs, not price, so it travels across instruments." },
  { key: "swingSpan", label: "Swing span", min: 2, max: 20, step: 1, unit: " bars",
    hint: "Bars either side of a pivot. Also the confirmation lag." },
  { key: "prominenceAtr", label: "Pivot prominence", min: 0, max: 2, step: 0.05, unit: "× ATR",
    hint: "minSeparation is documented as a bar count, but the shipped code compares it to a PRICE margin." },
  { key: "clusterBps", label: "Cluster radius", min: 20, max: 800, step: 10, unit: " bps",
    hint: "In basis points by design — a $1 band is noise on one instrument and a level on another." },
  { key: "minTouches", label: "Min touches", min: 1, max: 6, step: 1, unit: " pivots",
    hint: "Pivots needed before a cluster counts as a level rather than noise." },
  { key: "atrPeriod", label: "ATR period", min: 5, max: 50, step: 1, unit: " bars",
    hint: "Wilder period. Every price-unit parameter here is derived from the result." },
  { key: "halfLifeBars", label: "Decay half-life", min: 10, max: 250, step: 5, unit: " bars",
    hint: "How fast a touch stops counting. A level respected two years ago is not a level today." },
  { key: "zigzagAtr", label: "ZigZag threshold", min: 1, max: 10, step: 0.5, unit: "× ATR",
    hint: "Picks the dominant leg for the Fibonacci source, so nobody draws it by eye." },
  { key: "valueAreaFraction", label: "Value area", min: 0.5, max: 0.95, step: 0.05, unit: " of volume",
    hint: "Share of volume the value area must hold before expansion stops." },
];

/*
 * Proximity first, deliberately. The library's score has no proximity term — a
 * zone 48% away can outrank the one price is sitting on — so ordering by score
 * alone buries the only zones that matter today.
 */
const SORTS = {
  proximity: (a, b) => Math.abs(a.distanceBps ?? 1e9) - Math.abs(b.distanceBps ?? 1e9),
  score: (a, b) => b.score - a.score,
  sources: (a, b) => b.sourceCount - a.sourceCount || b.score - a.score,
};

const SORT_NOTE = {
  proximity: "Nearest to the last close first. The library's score has no proximity term, so sorting by it alone buries the zones price is actually near.",
  score: "By the library's strength score — which has no proximity term, so read the distance column before reading anything into this order.",
  sources: "By how many distinct sources agree, which is the thing this app exists to measure.",
};

let config = null;
let defaults = {};
let lastReport = null;
let sortMode = "proximity";
let mode = localStorage.getItem("srMode") === "advanced" ? "advanced" : "simple";
let inFlight = null;

let advancedPane = null;
let simplePane = null;

const sortedZones = (report) => [...report.zones].sort(SORTS[sortMode] ?? SORTS.proximity);

/* -------------------------------------------------------------------- boot */

init().catch((error) => banner(`Could not start: ${error.message}`));

async function init() {
  if (!LWC) throw new Error("charting library failed to load from /vendor/lightweight-charts.js");

  config = await getJSON("/api/config");
  defaults = config.defaults;

  fill($("range"), config.ranges, "2y");
  fill($("interval"), config.intervals, "1d");
  $("tapePlan").innerHTML = config.tapePlans
    .map((p, i) => `<option value="${i}">${p.label}</option>`).join("");

  buildSliders();

  $("query").addEventListener("submit", (event) => { event.preventDefault(); run(); });

  $("reset").addEventListener("click", () => {
    for (const slider of SLIDERS) setSlider(slider, defaults[slider.key]);
    run();
  });

  // Re-sorting and mode switching are view changes, not recomputes.
  $("sortMode").addEventListener("change", (event) => {
    sortMode = event.target.value;
    if (lastReport) {
      renderZones(lastReport);
      advancedPane?.setLines(sortedZones(lastReport).slice(0, 6), lastReport);
    }
  });

  $("modeSimple").addEventListener("click", () => setMode("simple"));
  $("modeAdvanced").addEventListener("click", () => setMode("advanced"));
  $("toAdvanced").addEventListener("click", () => setMode("advanced"));

  applyMode();
  run();
}

function setMode(next) {
  if (mode === next) return;
  mode = next;
  localStorage.setItem("srMode", mode);
  applyMode();
  if (lastReport) render(lastReport);
}

function applyMode() {
  const simple = mode === "simple";
  $("simpleView").hidden = !simple;
  $("advancedView").hidden = simple;
  $("advancedFooter").hidden = simple;
  $("modeSimple").classList.toggle("on", simple);
  $("modeAdvanced").classList.toggle("on", !simple);
  for (const el of document.querySelectorAll(".advanced-only")) el.hidden = simple;
}

function buildSliders() {
  $("sliders").innerHTML = SLIDERS.map((s) => `
    <div class="param">
      <label for="p-${s.key}"><span>${s.label}</span><b id="v-${s.key}"></b></label>
      <input type="range" id="p-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}"
             value="${defaults[s.key]}">
      <span class="hint">${s.hint}</span>
    </div>`).join("");

  for (const s of SLIDERS) {
    const input = $(`p-${s.key}`);
    paint(s, input.value);
    input.addEventListener("input", () => paint(s, input.value));
    // Recompute on release rather than on every pixel of drag.
    input.addEventListener("change", run);
  }
}

function paint(s, value) {
  // The round-number grid is the one slider whose number means nothing on its
  // own — say what it resolves to once a report exists.
  if (s.key === "roundStep") {
    const grid = lastReport?.sources.find((x) => x.tag === "round-number")?.extra?.grid;
    const n = Number(value);
    const word = n === 0 ? "auto" : `${n > 0 ? "+" : ""}${n}`;
    $(`v-${s.key}`).textContent = grid ? `${word} → ${grid.unit}` : word;
    return;
  }
  $(`v-${s.key}`).textContent = `${value}${s.unit ?? ""}`;
}

function setSlider(s, value) {
  $(`p-${s.key}`).value = value;
  paint(s, value);
}

/* --------------------------------------------------------------------- run */

async function run() {
  const symbol = $("symbol").value.trim().toUpperCase();
  if (!symbol) return;
  $("symbol").value = symbol;

  const query = new URLSearchParams({
    symbol,
    range: $("range").value,
    interval: $("interval").value,
  });

  const plan = config.tapePlans[Number($("tapePlan").value)];
  query.set("tapeInterval", plan.interval);
  query.set("tapeRange", plan.range);
  for (const s of SLIDERS) query.set(s.key, $(`p-${s.key}`).value);

  // A slider drag can outrun the network; ignore any response that is not the
  // most recent request.
  const token = Symbol("request");
  inFlight = token;
  $("run").disabled = true;
  $("run").textContent = "Working…";
  banner(null);

  try {
    const report = await getJSON(`/api/analyze?${query}`);
    if (inFlight !== token) return;
    lastReport = report;
    render(report);
  } catch (error) {
    if (inFlight === token) banner(error.message);
  } finally {
    if (inFlight === token) {
      $("run").disabled = false;
      $("run").textContent = "Analyse";
    }
  }
}

function banner(message, kind = "error") {
  $("banner").hidden = !message;
  $("banner").className = `banner ${kind === "error" ? "" : kind}`;
  $("banner").textContent = message ?? "";
}

function render(report) {
  for (const s of SLIDERS) paint(s, $(`p-${s.key}`).value);
  if (mode === "simple") renderSimple(report);
  else renderAdvanced(report);
}

/* ====================================================== SIMPLE ============ */

/** The nearest accepted zone above the last close, and the nearest below it. */
function bracket(report) {
  const above = report.zones
    .filter((z) => z.center > report.lastClose)
    .sort((a, b) => a.center - b.center)[0] ?? null;
  const below = report.zones
    .filter((z) => z.center <= report.lastClose)
    .sort((a, b) => b.center - a.center)[0] ?? null;
  return { above, below };
}

function renderSimple(report) {
  const dp = decimals(report.derived.tickSize);
  const { above, below } = bracket(report);
  const inside = report.zones.find((z) => z.insideZone) ?? null;

  $("sSymbol").textContent = `${report.meta.symbol} · ${report.meta.name}`;
  $("sMeta").textContent = `${report.meta.exchange} · ${report.window.bars} daily bars to ${date(report.asOf)}`;
  $("sPrice").textContent = num(report.lastClose, dp);
  $("sPriceNote").textContent = `${report.meta.currency} · last close`;

  $("sLadder").innerHTML = [
    zoneCard("resistance", above, report, dp),
    `<div class="rung-now">
       <span class="rung-tag">Price now</span>
       <span class="rung-price">${num(report.lastClose, dp)}</span>
       <span class="rung-note muted">${inside
         ? `Price is <em>inside</em> zone ${inside.zoneId} right now — it is not above or below this level, it is in it.`
         : "Between the two zones below and above."}</span>
     </div>`,
    zoneCard("support", below, report, dp),
  ].join("");

  $("sWhy").innerHTML =
    `Four independent methods each propose their own levels &mdash; swing pivots, ` +
    `round numbers, volume profile and Fibonacci. Only prices where <em>several ` +
    `different methods land in the same place</em> become a zone. On ` +
    `${report.meta.symbol} that filter kept ${report.zones.length} zones and ` +
    `rejected ${report.rejected.length} clusters for having too few distinct ` +
    `sources. The two shown here are the closest above and below the price.`;

  const contractCount = Object.values(report.tiers).filter((t) => t === "contract").length;
  $("sTrust").innerHTML =
    `These come from ${report.sourcesAvailable} of 4 methods on ` +
    `${report.window.bars} bars of daily data. ${contractCount} of the ` +
    `${Object.keys(report.tiers).length} calculations behind them are shape-checked ` +
    `but not cross-checked against an independent published figure. A zone is ` +
    `where price <em>has</em> reacted, which is not a promise that it will again.`;

  // Build the simple chart lazily, the first time it is actually shown.
  if (!simplePane) simplePane = createPane("simpleChart", "simpleOverlay");
  const shown = [above, below].filter(Boolean);
  simplePane.setData(report, { markers: false });
  simplePane.setLines(shown, report);
  simplePane.setZones(shown);
}

function zoneCard(kind, zone, report, dp) {
  const isResistance = kind === "resistance";
  const label = isResistance ? "Next resistance above" : "Next support below";

  if (!zone) {
    return `<div class="rung rung-${kind} rung-empty">
      <span class="rung-tag">${label}</span>
      <span class="rung-price">none</span>
      <span class="rung-note muted">No zone ${isResistance ? "above" : "below"} the
        current price cleared the agreement threshold in this window. That is a
        real answer, not a missing one — widen the range to look further back.</span>
    </div>`;
  }

  const pct = Math.abs(zone.distanceBps / 100).toFixed(2);
  const colour = GRADE_COLOUR[zone.grade] ?? "#7d8fa8";

  return `<div class="rung rung-${kind}" style="--rung:${colour}">
    <span class="rung-tag">${label}</span>
    <span class="rung-price">${num(zone.center, dp)}</span>
    <span class="rung-move">${pct}% ${isResistance ? "above" : "below"} the price</span>
    <div class="rung-band">
      Anywhere in <b>${num(zone.lower, dp)} – ${num(zone.upper, dp)}</b> counts as this zone
    </div>
    <div class="rung-meta">
      <span class="rung-agree"><b>${zone.sourceCount}</b> of ${zone.sourcesAvailable} methods agree</span>
      <div class="chips">${zone.sources.map((s) => `<span class="chip chip-${s}">${plainSource(s)}</span>`).join("")}</div>
    </div>
    <div class="rung-strength">
      <span class="bar"><i style="width:${Math.max(3, zone.score)}%;background:${colour}"></i></span>
      <span class="grade grade-${zone.grade}">${zone.grade}</span>
      <span class="muted">— ${GRADE_PLAIN[zone.grade] ?? ""}</span>
    </div>
    <div class="rung-history muted">
      Price has touched this band <b>${zone.touchCount}</b> time${zone.touchCount === 1 ? "" : "s"}
      and closed decisively through it <b>${zone.breakCount}</b> time${zone.breakCount === 1 ? "" : "s"}.
      ${zone.roleReversal?.confirmed
        ? `It used to act as the opposite and has since flipped to ${zone.roleReversal.finalRole}.`
        : ""}
    </div>
  </div>`;
}

const plainSource = (tag) => ({
  pivot: "swing highs & lows",
  "round-number": "round numbers",
  "volume-profile": "heavy volume",
  fibonacci: "Fibonacci",
}[tag] ?? tag);

/* ==================================================== ADVANCED ============ */

function renderAdvanced(report) {
  if (!advancedPane) advancedPane = createPane("chart", "zoneOverlay");

  renderHeader(report);
  renderSummary(report);

  advancedPane.setData(report, { markers: true });
  advancedPane.setLines(sortedZones(report).slice(0, 6), report);
  advancedPane.setZones(report.zones);

  $("chartLegend").innerHTML =
    report.sources.map((s) => `
      <span><i style="background:${SOURCE_COLOUR[s.tag]}"></i>${s.label}${
        s.unavailable ? " (n/a)" : ` ${s.levelCount}`}</span>`).join("")
    + `<span><i style="background:#2ea875"></i>strong</span>`
    + `<span><i style="background:#4c8dff"></i>moderate</span>`
    + `<span><i style="background:#d29922"></i>weak</span>`
    + `<span><i style="background:#7d8fa8;height:7px;width:7px;border-radius:50%"></i>pivot (${report.pivots.length})</span>`
    + `<span><i style="background:rgba(46,168,117,0.38)"></i>volume, daily</span>`;

  renderZones(report);
  renderSources(report);
  renderRejected(report);
  renderTrace(report);
  renderQuality(report);
}

function renderHeader(report) {
  const dp = decimals(report.derived.tickSize);
  $("chartTitle").textContent = `${report.meta.symbol} · ${report.meta.name}`;
  $("chartSub").innerHTML =
    `${report.meta.exchange} · ${num(report.lastClose, dp)} ${report.meta.currency} ` +
    `<span class="muted">as of ${date(report.asOf)}</span> · ` +
    `ATR(${report.atr.period}) ${num(report.atr.value, dp)} · ` +
    `${report.zones.length} zones from ${report.sourcesAvailable} of 4 sources`;
  $("lagNote").textContent = report.params.swingSpan;
}

function renderSummary(report) {
  const dp = decimals(report.derived.tickSize);
  const nearest = [...report.zones].sort(SORTS.proximity)[0];

  const stats = [
    ["Last close", num(report.lastClose, dp), `${report.meta.currency} · ${date(report.asOf)}`],
    ["Sources available", `${report.sourcesAvailable} / 4`, "denominator of source_confluence"],
    ["Accepted zones", report.zones.length, `${report.rejected.length} clusters rejected`],
    ["Nearest zone", nearest ? num(nearest.center, dp) : "—",
      nearest ? `${nearest.zoneId} · ${nearest.sourceCount}/${nearest.sourcesAvailable} sources · ${Math.abs(nearest.distanceBps).toFixed(0)} bps` : "—"],
    ["ATR median", num(report.atr.median, dp), `period ${report.atr.period} · ${report.atr.warmupBars} warm-up nulls`],
    ["Fusion tolerance", num(report.derived.fusionTolerance, dp), `${report.params.fusionAtr}× ATR, in price`],
    ["Tick size", report.derived.tickSize, "derived from price magnitude"],
    ["Bars analysed", report.dataQuality.barsAnalysed, `of ${report.dataQuality.vendorRows} vendor rows`],
  ];

  $("summary").innerHTML = stats.map(([label, value, sub]) => `
    <dl class="stat"><dt>${label}</dt><dd>${value}<span class="sub">${sub}</span></dd></dl>`).join("");
}

/* ======================================================= CHART ============ */

/*
 * One factory, two panes. The simple view gets its own chart rather than
 * sharing: moving a lightweight-charts host between hidden containers breaks
 * its sizing, and a second instance costs far less than the bugs that causes.
 */
function createPane(hostId, overlayId) {
  const host = $(hostId);
  const svg = $(overlayId);

  const chart = LWC.createChart(host, {
    layout: { background: { type: LWC.ColorType.Solid, color: "transparent" }, textColor: "#8b98a9", fontSize: 11 },
    grid: { vertLines: { color: "rgba(38,49,64,0.45)" }, horzLines: { color: "rgba(38,49,64,0.45)" } },
    rightPriceScale: { borderColor: "#263140", scaleMargins: { top: 0.06, bottom: 0.26 } },
    timeScale: { borderColor: "#263140", rightOffset: 6 },
    crosshair: { mode: LWC.CrosshairMode.Normal },
    // The chart sits inside a scrolling page. Left on, the wheel zooms the
    // chart instead of scrolling past it and the page becomes a trap.
    handleScale: { mouseWheel: false, axisPressedMouseMove: true, pinch: true },
  });

  const candles = chart.addSeries(LWC.CandlestickSeries, {
    upColor: "#2ea875", downColor: "#e5534b",
    borderUpColor: "#2ea875", borderDownColor: "#e5534b",
    wickUpColor: "#2ea875", wickDownColor: "#e5534b",
  });

  /*
   * Volume on its own overlay scale, pinned to the bottom fifth so the candles
   * keep their height. This is the DAILY structure series' volume — NOT the
   * intraday tape the volume profile is built from. Different series;
   * conflating them would misrepresent where the profile came from.
   */
  const volume = chart.addSeries(LWC.HistogramSeries, {
    priceScaleId: "volume",
    priceFormat: { type: "volume" },
    priceLineVisible: false,
    lastValueVisible: false,
  });
  chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });

  const markers = LWC.createSeriesMarkers(candles, []);

  const pane = { chart, candles, volume, markers, lines: [], zones: [], report: null };

  pane.setData = (report, { markers: showMarkers }) => {
    pane.report = report;
    const dp = decimals(report.derived.tickSize);
    const time = (iso) => Math.floor(Date.parse(iso) / 1000);

    candles.applyOptions({
      priceFormat: { type: "price", precision: dp, minMove: report.derived.tickSize },
    });

    candles.setData(report.bars.map((bar) => ({
      time: time(bar.timestamp),
      open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    })));

    volume.setData(report.bars.map((bar) => ({
      time: time(bar.timestamp),
      value: bar.volume,
      color: bar.close >= bar.open ? "rgba(46,168,117,0.38)" : "rgba(229,83,75,0.38)",
    })));

    // Pivots sit at the bar where the swing OCCURRED, not where it was
    // confirmed. Off in the simple view — it is a detail, not an answer.
    markers.setMarkers(showMarkers
      ? report.pivots.map((pivot) => ({
        time: time(report.bars[pivot.event_index].timestamp),
        position: pivot.kind === "high" ? "aboveBar" : "belowBar",
        color: "#7d8fa8",
        shape: pivot.kind === "high" ? "arrowDown" : "arrowUp",
        size: 0.6,
      }))
      : []);

    chart.timeScale().fitContent();
  };

  /* Labelled lines drawn by the chart itself, so each gets a price-axis label. */
  pane.setLines = (zones, report) => {
    for (const line of pane.lines.splice(0)) candles.removePriceLine(line);
    for (const zone of zones) {
      pane.lines.push(candles.createPriceLine({
        price: zone.center,
        color: GRADE_COLOUR[zone.grade] ?? "#7d8fa8",
        // Thickness carries agreement, so multi-source zones read first.
        lineWidth: Math.min(4, zone.sourceCount),
        lineStyle: zone.sourceCount >= 3 ? LWC.LineStyle.Solid : LWC.LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${zone.zoneId} · ${zone.sourceCount}/${zone.sourcesAvailable} · ${zone.grade} ${zone.score.toFixed(0)}`,
      }));
      void report;
    }
  };

  pane.setZones = (zones) => { pane.zones = zones; pane.draw(); };

  /*
   * Zones as shaded bands. A zone IS a band — collapsing it to a line would
   * hide the width, which is what the fusion actually produces.
   */
  pane.draw = () => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    // Stop at the price axis rather than guessing its width.
    const plotWidth = Math.max(0, width - chart.priceScale("right").width());

    // Furthest first, so the zones price is near end up drawn on top.
    const ordered = [...pane.zones]
      .sort((a, b) => Math.abs(b.distanceBps ?? 0) - Math.abs(a.distanceBps ?? 0));

    svg.innerHTML = ordered.map((zone) => {
      const top = candles.priceToCoordinate(zone.upper);
      const bottom = candles.priceToCoordinate(zone.lower);
      if (top === null || bottom === null) return "";

      const rawHeight = Math.abs(bottom - top);
      // A tight zone on a wide price range collapses to a sub-pixel sliver.
      // Give every band a floor so it reads AS a band.
      const h = Math.max(3, rawHeight);
      const y = Math.min(top, bottom) - (h - rawHeight) / 2;

      const colour = GRADE_COLOUR[zone.grade] ?? "#7d8fa8";
      // More agreement, more presence. The opacity IS the source count.
      const alpha = 0.08 + 0.09 * zone.sourceCount;
      const label = `${zone.zoneId} · ${zone.sourceCount}/${zone.sourcesAvailable} · ${zone.grade} ${zone.score.toFixed(0)}`;

      return `
        <rect x="0" y="${y}" width="${plotWidth}" height="${h}" fill="${colour}" fill-opacity="${alpha}"/>
        <line x1="0" y1="${y}" x2="${plotWidth}" y2="${y}" stroke="${colour}" stroke-opacity="0.7"/>
        <line x1="0" y1="${y + h}" x2="${plotWidth}" y2="${y + h}" stroke="${colour}" stroke-opacity="0.7"/>
        <text x="7" y="${y - 3}" fill="${colour}" font-size="10" font-family="ui-monospace, monospace"
              paint-order="stroke" stroke="#0d1117" stroke-width="3" opacity="0.95">${label}</text>`;
    }).join("");
  };

  chart.timeScale().subscribeVisibleLogicalRangeChange(() => pane.draw());

  // Track the container rather than the window: the panel also changes width
  // when the layout collapses to one column, and when a hidden view is shown.
  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (!width || !height) return;
    chart.applyOptions({ width, height });
    pane.draw();
  }).observe(host);

  return pane;
}

/* ------------------------------------------------------------------- zones */

function renderZones(report) {
  const dp = decimals(report.derived.tickSize);

  $("zonesCaption").textContent =
    `${report.zones.length} zones cleared the ${report.params.minimumSources}-source minimum. ` +
    `source_confluence is source_count / ${report.sourcesAvailable} — counted, not estimated. ` +
    SORT_NOTE[sortMode];

  const rows = sortedZones(report).map((zone) => {
    const colour = GRADE_COLOUR[zone.grade] ?? "#7d8fa8";
    const above = zone.distance >= 0;

    return `
      <tr class="${zone.insideZone ? "inside-zone" : ""}">
        <td class="mono">${zone.zoneId}</td>
        <td><span class="role ${zone.currentRole}">${zone.currentRole}</span></td>
        <td class="num">${num(zone.center, dp)}</td>
        <td class="mono muted">${num(zone.lower, dp)}–${num(zone.upper, dp)}
          <span class="muted">(${num(zone.widthBps, 0)}bp)</span></td>
        <td class="num" style="color:${zone.insideZone ? "#4c8dff" : above ? "#e5534b" : "#2ea875"}">
          ${zone.insideZone ? "inside" : `${above ? "+" : ""}${num(zone.distanceBps / 100, 2)}%`}</td>
        <td><span class="confluence"><b>${zone.sourceCount}</b><span>/${zone.sourcesAvailable}</span></span></td>
        <td><div class="chips">${zone.sources.map((s) => `<span class="chip chip-${s}">${s}</span>`).join("")}</div></td>
        <td class="num">${zone.touchCount}</td>
        <td class="num">${zone.breakCount}</td>
        <td>
          <div class="strength" title="source ${num(zone.components.source, 1)} · touch ${num(zone.components.touch, 1)} · rejection ${num(zone.components.rejection, 1)} · durability ${num(zone.components.durability, 1)} · penalty −${num(zone.components.break_penalty, 1)}">
            <span class="bar"><i style="width:${Math.max(2, zone.score)}%;background:${colour}"></i></span>
            <span class="grade grade-${zone.grade}">${zone.grade} ${num(zone.score, 0)}</span>
          </div>
        </td>
        <td>${zone.roleReversal?.confirmed
          ? `<span class="flag flag-on">flipped → ${zone.roleReversal.finalRole}</span>`
          : '<span class="flag">—</span>'}</td>
        <td>${zone.breakout?.confirmed
          ? `<span class="flag flag-on">${zone.breakout.direction} confirmed</span>`
          : `<span class="flag">${zone.breakout?.state ?? "—"}</span>`}</td>
      </tr>`;
  }).join("");

  $("zoneTable").innerHTML = `
    <thead><tr>
      <th>Zone</th><th>Now</th><th class="num">Centre</th><th>Band</th><th class="num">Dist.</th>
      <th>Sources</th><th>Which</th><th class="num">Touches</th><th class="num">Breaks</th>
      <th>Strength</th><th>Role flip</th><th>Breakout</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="12" class="pad muted">No zone cleared the minimum-source bar. Lower the minimum, or widen the fusion tolerance.</td></tr>'}</tbody>`;
}

/* ----------------------------------------------------------------- sources */

function renderSources(report) {
  const dp = decimals(report.derived.tickSize);

  $("sourcePanel").innerHTML = report.sources.map((source) => {
    const topics = source.topics.map((topic, i) => {
      const approx = source.approximation && i === 0;
      return `<a href="${config.docs[topic]}" target="_blank" rel="noopener">
        <span class="tier tier-${approx ? "approximation" : source.tiers[i]}">${approx ? "approx. input" : source.tiers[i]}</span>
        ${topic}</a>`;
    }).join("");

    const body = source.unavailable
      ? `<div class="unavailable-note"><strong>Unavailable.</strong> ${escapeHtml(source.unavailable)}
         The denominator of <code>source_confluence</code> drops to ${report.sourcesAvailable},
         so this instrument is not penalised for a data gap.</div>`
      : `<div class="level-list">${source.levels.map((level) => `
          <div class="level">
            <span class="price" style="color:${SOURCE_COLOUR[source.tag]}">${num(level.price, dp)}</span>
            <span class="label">${escapeHtml(level.label)}</span>
            <span class="w">w ${level.weight}</span>
          </div>`).join("")}</div>`;

    return `
      <div class="source">
        <div class="source-head">
          <span class="source-dot" style="background:${SOURCE_COLOUR[source.tag]}"></span>
          <h3>${source.label}</h3>
        </div>
        <div class="source-count">${source.levelCount} levels proposed</div>
        <div class="source-topics">${topics}</div>
        ${extraLine(source, dp)}
        ${body}
      </div>`;
  }).join("");
}

function extraLine(source, dp) {
  const e = source.extra;
  if (!e) return "";
  if (source.tag === "pivot") {
    return `<div class="source-extra">${e.clusters} clusters accepted, ${e.noise} pivots left as noise.</div>`;
  }
  if (source.tag === "round-number") {
    const g = e.grid;
    const moved = g && g.step !== 0
      ? ` Moved ${Math.abs(g.step)} rung${Math.abs(g.step) === 1 ? "" : "s"} ${g.step > 0 ? "coarser" : "finer"} than the automatic ${g.autoUnit}.`
      : " Grid chosen automatically from the 1/2/5 ladder.";
    return `<div class="source-extra">Grid of ${e.baseUnit}.${moved} Closest level ${e.closest?.price ?? "—"} at ${num(e.closest?.distance_bps, 0)} bps.</div>`;
  }
  if (source.tag === "volume-profile") {
    return `<div class="source-extra">POC ${num(e.poc, dp)} · value area ${num(e.valueAreaLow, dp)}–${num(e.valueAreaHigh, dp)} holding ${(e.valueAreaShare * 100).toFixed(1)}% of volume across ${e.bins} bins. ${e.hvn} HVNs fused; ${e.lvn} LVNs found but <em>not</em> fused — an LVN is a price that price moves through.</div>`;
  }
  if (source.tag === "fibonacci") {
    return `<div class="source-extra">Leg: ${e.fromKind} ${num(e.fromPrice, dp)} → ${e.toKind} ${num(e.toPrice, dp)} (${e.direction}, size ${num(e.size, dp)}). The final zigzag swing is provisional — the next bar can revise it.</div>`;
  }
  return "";
}

/* ---------------------------------------------------------------- rejected */

function renderRejected(report) {
  const dp = decimals(report.derived.tickSize);

  const rows = report.rejected.map((cluster) => `
    <tr>
      <td class="mono">${cluster.zoneId}</td>
      <td class="num">${num(cluster.center, dp)}</td>
      <td class="mono muted">${num(cluster.lower, dp)}–${num(cluster.upper, dp)}</td>
      <td class="num">${cluster.sourceCount}</td>
      <td><div class="chips">${cluster.sources.map((s) => `<span class="chip chip-${s}">${s}</span>`).join("")}</div></td>
      <td class="muted">${cluster.members.map((m) => escapeHtml(m.label)).join(", ") || "—"}</td>
      <td class="mono muted">${cluster.reason}</td>
    </tr>`).join("");

  $("rejectedTable").innerHTML = `
    <thead><tr>
      <th>Cluster</th><th class="num">Centre</th><th>Band</th><th class="num">Sources</th>
      <th>Which</th><th>Members</th><th>Reason</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="pad muted">Every cluster cleared the minimum.</td></tr>'}</tbody>`;
}

/* ------------------------------------------------------------------- trace */

function renderTrace(report) {
  $("trace").innerHTML = report.trace.map((entry) => `
    <li>
      <span class="step-name">${escapeHtml(entry.name)}</span>
      ${entry.tier ? `<span class="tier tier-${entry.tier}">${entry.tier}</span>` : ""}
      ${entry.topic ? `<a href="${config.docs[entry.topic] ?? "#"}" target="_blank" rel="noopener">${entry.topic}</a>` : ""}
      <br>${escapeHtml(entry.detail)}
    </li>`).join("");
}

/* ----------------------------------------------------------------- quality */

function renderQuality(report) {
  const q = report.dataQuality;
  const rows = [
    ["Vendor rows", q.vendorRows, false],
    ["Null prices dropped", q.droppedByProvider, q.droppedByProvider > 0],
    ["Failed OHLC invariants", q.rejectedByValidator, q.rejectedByValidator > 0],
    ["Breached strict ordering", q.malformedOrdering, q.malformedOrdering > 0],
    ["Duplicate timestamps", q.duplicateTimestamps, q.duplicateTimestamps > 0],
    ["Bars analysed", q.barsAnalysed, false],
    ["Tick size", q.tickSize, false],
    ["Intraday bars", q.tape.bars, q.tape.bars === 0],
  ];

  $("quality").innerHTML = rows.map(([label, value, warn]) =>
    `<dt>${label}</dt><dd class="${warn ? "warn" : ""}">${value}</dd>`).join("");

  const notes = [];
  if (q.tape.unavailable) notes.push(`<strong>No volume profile.</strong> ${escapeHtml(q.tape.unavailable)}`);
  if (q.tape.note) notes.push(`<strong>Profile input is an approximation.</strong> ${escapeHtml(q.tape.note)}`);
  if (q.rejectedSample.length) {
    notes.push(`<strong>Rejected bars:</strong> ` + q.rejectedSample
      .map((r) => `${date(r.timestamp)} — ${(r.issues ?? []).join("; ")}`).join(" · "));
  }

  $("qualityNotes").innerHTML = notes.map((n) => `<p>${n}</p>`).join("");
}

/* ------------------------------------------------------------------ format */

async function getJSON(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

function fill(select, values, chosen) {
  select.innerHTML = values.map((v) => `<option${v === chosen ? " selected" : ""}>${v}</option>`).join("");
}

function num(value, dp = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Show prices at the precision the instrument's own tick size implies. */
function decimals(tick) {
  return Math.max(0, Math.min(8, Math.round(-Math.log10(tick))));
}

const date = (iso) => (iso ? iso.slice(0, 10) : "—");

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}
