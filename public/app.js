/*
 * The page. No framework, no build step — the whole client is this file, the
 * stylesheet, and the chart library served from node_modules.
 *
 * Layout: chart and tables in the main column, every parameter plus the
 * pipeline trace and data quality in a sticky sidebar, so the inputs and the
 * consequences are on screen together.
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
 * alone buries the only zones that matter today. Score is one click away.
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
let chart = null;
let candles = null;
let volume = null;
let markers = null;
let priceLines = [];
let lastReport = null;
let sortMode = "proximity";
let inFlight = null;

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
  buildChart();

  $("query").addEventListener("submit", (event) => { event.preventDefault(); run(); });

  $("reset").addEventListener("click", () => {
    for (const slider of SLIDERS) setSlider(slider, defaults[slider.key]);
    run();
  });

  // Re-sorting is a view change, not a recompute — no round trip to Yahoo.
  $("sortMode").addEventListener("change", (event) => {
    sortMode = event.target.value;
    if (lastReport) {
      renderZones(lastReport);
      drawPriceLines(lastReport);
    }
  });

  run();
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

const paint = (s, value) => { $(`v-${s.key}`).textContent = `${value}${s.unit ?? ""}`; };

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
  renderHeader(report);
  renderSummary(report);
  renderChart(report);
  renderZones(report);
  renderSources(report);
  renderRejected(report);
  renderTrace(report);
  renderQuality(report);
}

/* ------------------------------------------------------------------ header */

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
  const stats = [
    ["Last close", num(report.lastClose, dp), `${report.meta.currency} · ${date(report.asOf)}`],
    ["Sources available", `${report.sourcesAvailable} / 4`, "denominator of source_confluence"],
    ["Accepted zones", report.zones.length, `${report.rejected.length} clusters rejected`],
    ["Nearest zone", nearestLabel(report, dp), "by absolute distance"],
    ["ATR median", num(report.atr.median, dp), `period ${report.atr.period} · ${report.atr.warmupBars} warm-up nulls`],
    ["Fusion tolerance", num(report.derived.fusionTolerance, dp), `${report.params.fusionAtr}× ATR, in price`],
    ["Tick size", report.derived.tickSize, "derived from price magnitude"],
    ["Bars analysed", report.dataQuality.barsAnalysed, `of ${report.dataQuality.vendorRows} vendor rows`],
  ];

  $("summary").innerHTML = stats.map(([label, value, sub]) => `
    <dl class="stat"><dt>${label}</dt><dd>${value}<span class="sub">${sub}</span></dd></dl>`).join("");
}

function nearestLabel(report, dp) {
  const nearest = [...report.zones].sort(SORTS.proximity)[0];
  if (!nearest) return "—";
  return `${num(nearest.center, dp)}<span class="sub">${nearest.zoneId} · ${nearest.sourceCount}/${nearest.sourcesAvailable} sources · ${Math.abs(nearest.distanceBps).toFixed(0)} bps</span>`;
}

/* ------------------------------------------------------------------- chart */

function buildChart() {
  const host = $("chart");

  chart = LWC.createChart(host, {
    layout: { background: { type: LWC.ColorType.Solid, color: "transparent" }, textColor: "#8b98a9", fontSize: 11 },
    grid: { vertLines: { color: "rgba(38,49,64,0.45)" }, horzLines: { color: "rgba(38,49,64,0.45)" } },
    rightPriceScale: { borderColor: "#263140", scaleMargins: { top: 0.06, bottom: 0.26 } },
    timeScale: { borderColor: "#263140", rightOffset: 6 },
    crosshair: { mode: LWC.CrosshairMode.Normal },
    // The chart sits inside a scrolling page. Left on, the wheel zooms the
    // chart instead of scrolling past it and the page becomes a trap. Dragging
    // the body and the axes still pans and scales.
    handleScale: { mouseWheel: false, axisPressedMouseMove: true, pinch: true },
  });

  candles = chart.addSeries(LWC.CandlestickSeries, {
    upColor: "#2ea875", downColor: "#e5534b",
    borderUpColor: "#2ea875", borderDownColor: "#e5534b",
    wickUpColor: "#2ea875", wickDownColor: "#e5534b",
  });

  /*
   * Volume on its own overlay scale, pinned to the bottom fifth. It shares the
   * pane so the candles keep their height. This is the DAILY structure series'
   * volume — not the intraday tape the volume profile is built from. Those are
   * different series and conflating them would misrepresent the profile.
   */
  volume = chart.addSeries(LWC.HistogramSeries, {
    priceScaleId: "volume",
    priceFormat: { type: "volume" },
    priceLineVisible: false,
    lastValueVisible: false,
  });
  chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });

  markers = LWC.createSeriesMarkers(candles, []);

  chart.timeScale().subscribeVisibleLogicalRangeChange(drawZones);

  // Track the container rather than the window: the panel also changes width
  // when the layout collapses to one column.
  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (!width || !height) return;
    chart.applyOptions({ width, height });
    drawZones();
  }).observe(host);
}

function renderChart(report) {
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

  // Pivots sit at the bar where the swing OCCURRED, not where it was confirmed.
  markers.setMarkers(report.pivots.map((pivot) => ({
    time: time(report.bars[pivot.event_index].timestamp),
    position: pivot.kind === "high" ? "aboveBar" : "belowBar",
    color: "#7d8fa8",
    shape: pivot.kind === "high" ? "arrowDown" : "arrowUp",
    size: 0.6,
  })));

  drawPriceLines(report);
  chart.timeScale().fitContent();
  requestAnimationFrame(drawZones);

  $("chartLegend").innerHTML =
    report.sources.map((s) => `
      <span><i style="background:${SOURCE_COLOUR[s.tag]}"></i>${s.label}${
        s.unavailable ? " (n/a)" : ` ${s.levelCount}`}</span>`).join("")
    + `<span><i style="background:#2ea875"></i>strong</span>`
    + `<span><i style="background:#4c8dff"></i>moderate</span>`
    + `<span><i style="background:#d29922"></i>weak</span>`
    + `<span><i style="background:#7d8fa8;height:7px;width:7px;border-radius:50%"></i>pivot (${report.pivots.length})</span>`
    + `<span><i style="background:rgba(46,168,117,0.38)"></i>volume, daily</span>`;
}

/*
 * Labelled lines for the zones worth naming, drawn by the chart library itself
 * so each gets a price-axis label. Every zone still gets a shaded band; only
 * the top few get a line, because 22 axis labels is not a chart.
 */
function drawPriceLines(report) {
  if (!candles) return;
  for (const line of priceLines.splice(0)) candles.removePriceLine(line);

  for (const zone of sortedZones(report).slice(0, 6)) {
    priceLines.push(candles.createPriceLine({
      price: zone.center,
      color: GRADE_COLOUR[zone.grade] ?? "#7d8fa8",
      // Thickness carries agreement, so multi-source zones read first.
      lineWidth: Math.min(4, zone.sourceCount),
      lineStyle: zone.sourceCount >= 3 ? LWC.LineStyle.Solid : LWC.LineStyle.Dashed,
      axisLabelVisible: true,
      title: `${zone.zoneId} · ${zone.sourceCount}/${zone.sourcesAvailable} · ${zone.grade} ${zone.score.toFixed(0)}`,
    }));
  }
}

/*
 * Zones as shaded bands. A zone IS a band — collapsing it to a line would hide
 * the width, which is the thing the fusion actually produces.
 */
function drawZones() {
  const svg = $("zoneOverlay");
  if (!lastReport || !candles || !chart) return;

  const host = $("chart");
  const width = host.clientWidth;
  const height = host.clientHeight;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // Stop at the price axis rather than guessing its width.
  const plotWidth = Math.max(0, width - chart.priceScale("right").width());

  // Furthest first, so the zones price is near end up drawn on top.
  const ordered = [...lastReport.zones]
    .sort((a, b) => Math.abs(b.distanceBps ?? 0) - Math.abs(a.distanceBps ?? 0));

  svg.innerHTML = ordered.map((zone) => {
    const top = candles.priceToCoordinate(zone.upper);
    const bottom = candles.priceToCoordinate(zone.lower);
    if (top === null || bottom === null) return "";

    const rawHeight = Math.abs(bottom - top);
    // A tight zone on a wide price range collapses to a sub-pixel sliver. Give
    // every band a floor so it reads AS a band.
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
    return `<div class="source-extra">Grid of ${e.baseUnit}. Closest level ${e.closest?.price ?? "—"} at ${num(e.closest?.distance_bps, 0)} bps.</div>`;
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
