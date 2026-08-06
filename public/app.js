/*
 * The page. No framework, no build step — the whole app is this file, the
 * stylesheet, and the chart library served from node_modules.
 *
 * It renders four things in the order you would want to check them:
 *   what came out (zones) -> what went in (sources) -> what was thrown away
 *   (rejected) -> how it was done (trace).
 */

const $ = (id) => document.getElementById(id);

const form = $("controls");
const main = $("main");
const statusEl = $("status");

const SOURCE_COLOUR = {
  pivot: "#4493f8",
  "round-number": "#a371f7",
  "volume-profile": "#db6d28",
  fibonacci: "#3fb950",
};

const GRADE_COLOUR = {
  strong: "#3fb950",
  moderate: "#4493f8",
  weak: "#d29922",
  depleted: "#6a727c",
};

/*
 * Each slider says what it does AND why it is not a constant. The "why" lines
 * are the most useful text on the page: they are the traps this app hit while
 * being written.
 */
const SLIDERS = [
  { key: "fusionAtr", label: "Fusion tolerance", min: 0.05, max: 2, step: 0.05, unit: "x ATR",
    why: "fusion_tolerance is in ABSOLUTE PRICE, which the docs do not say. Verified by experiment: the published example re-run at 100x the price scale with the same tolerance fuses nothing. Derived from ATR here." },
  { key: "minimumSources", label: "Minimum distinct sources", min: 1, max: 4, step: 1, unit: "of 4",
    why: "A zone below this is returned as a rejected cluster with reason insufficient-distinct-sources. Two levels from the same source count once." },
  { key: "swingSpan", label: "Swing span", min: 2, max: 20, step: 1, unit: "bars",
    why: "Bars either side of a pivot. Also the confirmation lag: a pivot is not knowable until span bars later." },
  { key: "prominenceAtr", label: "Pivot prominence", min: 0, max: 2, step: 0.05, unit: "x ATR",
    why: "minSeparation is documented as a bar count but the shipped code compares it to a PRICE margin. Expressed in ATR and converted." },
  { key: "clusterBps", label: "Cluster radius", min: 20, max: 800, step: 10, unit: "bps",
    why: "In basis points by design — a $1 band is noise on one instrument and a whole level on another." },
  { key: "minTouches", label: "Minimum touches", min: 1, max: 6, step: 1, unit: "pivots",
    why: "Pivots needed before a cluster counts as a level rather than noise." },
  { key: "atrPeriod", label: "ATR period", min: 5, max: 50, step: 1, unit: "bars",
    why: "Wilder period. Every price-unit parameter on this page is derived from the resulting ATR." },
  { key: "halfLifeBars", label: "Decay half-life", min: 10, max: 250, step: 5, unit: "bars",
    why: "How fast a touch stops counting. A level respected two years ago is not a level today." },
  { key: "zigzagAtr", label: "ZigZag threshold", min: 1, max: 10, step: 0.5, unit: "x ATR",
    why: "Picks the dominant leg for the Fibonacci source, so nobody has to draw it by eye." },
  { key: "valueAreaFraction", label: "Value area", min: 0.5, max: 0.95, step: 0.05, unit: "of volume",
    why: "Share of volume the value area must contain before expansion stops." },
];

let config = null;
let chart = null;
let candles = null;
let lastReport = null;

/* ------------------------------------------------------------------- boot */

init().catch((error) => flash(error.message, true));

async function init() {
  config = await getJSON("/api/config");

  fill($("range"), config.ranges, "2y");
  fill($("interval"), config.intervals, "1d");

  $("tapePlan").innerHTML = config.tapePlans
    .map((p, i) => `<option value="${i}">${p.label}</option>`)
    .join("");

  $("sliders").innerHTML = SLIDERS.map((s) => `
    <div class="slider">
      <label for="p-${s.key}">${s.label}</label>
      <output id="o-${s.key}"></output>
      <input type="range" id="p-${s.key}" name="${s.key}"
             min="${s.min}" max="${s.max}" step="${s.step}"
             value="${config.defaults[s.key]}">
      <p class="why">${s.why}</p>
    </div>`).join("");

  SLIDERS.forEach((s) => {
    const input = $(`p-${s.key}`);
    const output = $(`o-${s.key}`);
    const sync = () => { output.textContent = `${input.value} ${s.unit}`; };
    input.addEventListener("input", sync);
    sync();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });

  run();
}

/* -------------------------------------------------------------------- run */

async function run() {
  const button = $("run");
  button.disabled = true;
  flash("Fetching Yahoo Finance and running the pipeline…");

  const params = new URLSearchParams();
  params.set("symbol", $("symbol").value.trim());
  params.set("range", $("range").value);
  params.set("interval", $("interval").value);

  const plan = config.tapePlans[Number($("tapePlan").value)];
  params.set("tapeInterval", plan.interval);
  params.set("tapeRange", plan.range);

  SLIDERS.forEach((s) => params.set(s.key, $(`p-${s.key}`).value));

  try {
    const report = await getJSON(`/api/analyze?${params}`);
    lastReport = report;
    render(report);
    main.hidden = false;
    flash(`${report.zones.length} zones from ${report.sourcesAvailable} sources · ${report.dataQuality.barsAnalysed} bars`);
  } catch (error) {
    flash(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function render(report) {
  renderSummary(report);
  renderChart(report);
  renderZones(report);
  renderSources(report);
  renderRejected(report);
  renderTrace(report);
  renderQuality(report);
}

/* ---------------------------------------------------------------- summary */

function renderSummary(report) {
  const dp = decimals(report.derived.tickSize);
  const stats = [
    ["Instrument", report.meta.symbol, `${report.meta.name} · ${report.meta.exchange}`],
    ["Last close", report.lastClose.toFixed(dp), `${report.meta.currency} · ${new Date(report.asOf).toISOString().slice(0, 10)}`],
    ["Sources available", `${report.sourcesAvailable} / 4`, "the denominator of source_confluence"],
    ["Accepted zones", report.zones.length, `${report.rejected.length} clusters rejected`],
    ["ATR median", report.atr.median?.toFixed(dp) ?? "n/a", `period ${report.atr.period} · ${report.atr.warmupBars} warm-up nulls`],
    ["Fusion tolerance", report.derived.fusionTolerance.toFixed(dp), `${report.params.fusionAtr}x ATR, in price`],
    ["Tick size", report.derived.tickSize, "derived from price magnitude"],
    ["Bars analysed", report.dataQuality.barsAnalysed, `of ${report.dataQuality.vendorRows} vendor rows`],
  ];

  $("summary").innerHTML = stats.map(([label, value, sub]) => `
    <dl class="stat">
      <dt>${label}</dt>
      <dd>${value}<span class="sub">${sub}</span></dd>
    </dl>`).join("");
}

/* ------------------------------------------------------------------ chart */

function renderChart(report) {
  const el = $("chart");

  if (!chart) {
    chart = LightweightCharts.createChart(el, {
      layout: { background: { color: "#161b22" }, textColor: "#9198a1", attributionLogo: false },
      grid: { vertLines: { color: "#1c222a" }, horzLines: { color: "#1c222a" } },
      rightPriceScale: { borderColor: "#262d36" },
      timeScale: { borderColor: "#262d36", rightOffset: 6 },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      autoSize: true,
    });

    candles = chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: "#3fb950", downColor: "#f85149",
      wickUpColor: "#3fb950", wickDownColor: "#f85149",
      borderVisible: false,
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => drawZones());
    new ResizeObserver(() => drawZones()).observe(el);
  }

  candles.setData(report.bars.map((bar) => ({
    time: Math.floor(Date.parse(bar.timestamp) / 1000),
    open: bar.open, high: bar.high, low: bar.low, close: bar.close,
  })));

  chart.timeScale().fitContent();
  requestAnimationFrame(drawZones);

  $("chartLegend").innerHTML = report.sources.map((source) => `
    <span class="swatch">
      <i style="background:${SOURCE_COLOUR[source.tag]}"></i>
      ${source.label}${source.unavailable ? " (unavailable)" : ` · ${source.levelCount} levels`}
    </span>`).join("")
    + `<span class="swatch"><i style="background:#3fb950"></i>strong</span>`
    + `<span class="swatch"><i style="background:#4493f8"></i>moderate</span>`
    + `<span class="swatch"><i style="background:#d29922"></i>weak</span>`;
}

/*
 * Zones are drawn as an SVG overlay rather than as price lines: a zone is a
 * band, and collapsing it to a line would hide exactly the thing the fusion
 * produces — its width.
 */
function drawZones() {
  const svg = $("zoneOverlay");
  if (!lastReport || !candles) return;

  const width = $("chart").clientWidth;
  const height = $("chart").clientHeight;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const parts = lastReport.zones.map((zone) => {
    const top = candles.priceToCoordinate(zone.upper);
    const bottom = candles.priceToCoordinate(zone.lower);
    if (top === null || bottom === null) return "";

    const y = Math.min(top, bottom);
    const h = Math.max(1.5, Math.abs(bottom - top));
    const colour = GRADE_COLOUR[zone.grade] ?? "#6a727c";
    // More agreement, more presence. The opacity IS the source count.
    const alpha = 0.06 + 0.07 * zone.sourceCount;

    return `
      <rect x="0" y="${y}" width="${width - 76}" height="${h}"
            fill="${colour}" fill-opacity="${alpha}" />
      <line x1="0" y1="${y}" x2="${width - 76}" y2="${y}"
            stroke="${colour}" stroke-opacity="0.5" stroke-width="1" />
      <line x1="0" y1="${y + h}" x2="${width - 76}" y2="${y + h}"
            stroke="${colour}" stroke-opacity="0.5" stroke-width="1" />
      <text x="8" y="${y + h / 2 + 4}" fill="${colour}" font-size="10.5"
            font-family="ui-monospace, monospace" opacity="0.95">
        ${zone.zoneId} · ${zone.sourceCount}/${zone.sourcesAvailable} · ${zone.score.toFixed(0)}
      </text>`;
  });

  svg.innerHTML = parts.join("");
}

/* ------------------------------------------------------------------ zones */

function renderZones(report) {
  const dp = decimals(report.derived.tickSize);

  $("zonesCaption").textContent =
    `${report.zones.length} zones cleared the ${report.params.minimumSources}-source minimum. ` +
    `source_confluence is source_count / ${report.sourcesAvailable} — counted, not estimated. ` +
    `Sorted by the library's score, which has no proximity term, so check the distance column.`;

  const rows = report.zones.map((zone) => {
    const colour = GRADE_COLOUR[zone.grade] ?? "#6a727c";
    const flip = zone.roleReversal?.confirmed;
    const brk = zone.breakout?.confirmed;

    return `
      <tr class="${zone.insideZone ? "inside-zone" : ""}">
        <td class="mono">${zone.zoneId}</td>
        <td>
          <div class="score-cell">
            <span class="score-bar"><i style="width:${zone.score}%;background:${colour}"></i></span>
            <span class="mono">${zone.score.toFixed(1)}</span>
            <span class="grade grade-${zone.grade}">${zone.grade}</span>
          </div>
        </td>
        <td class="num">${zone.lower.toFixed(dp)} – ${zone.upper.toFixed(dp)}</td>
        <td class="num">${zone.center.toFixed(dp)}</td>
        <td>
          <span class="confluence"><b>${zone.sourceCount}</b><span>/${zone.sourcesAvailable}</span></span>
        </td>
        <td><div class="chips">${zone.sources.map((s) => `<span class="chip chip-${s}">${s}</span>`).join("")}</div></td>
        <td class="num">${zone.touchCount}</td>
        <td class="num">${zone.breakCount}</td>
        <td class="num">${zone.distanceBps === null ? "n/a" : zone.distanceBps.toFixed(0)}</td>
        <td>${zone.insideZone ? '<span class="flag flag-on">inside</span>' : `<span class="flag">${zone.currentRole}</span>`}</td>
        <td>${flip ? `<span class="flag flag-on">→ ${zone.roleReversal.finalRole}</span>` : '<span class="flag">—</span>'}</td>
        <td>${brk ? `<span class="flag flag-on">${zone.breakout.direction} confirmed</span>` : `<span class="flag">${zone.breakout?.state ?? "—"}</span>`}</td>
      </tr>`;
  }).join("");

  $("zoneTable").innerHTML = `
    <thead><tr>
      <th>Zone</th><th>Score</th><th>Band</th><th>Centre</th>
      <th>Sources</th><th>Which</th><th>Touches</th><th>Breaks</th>
      <th>Distance (bps)</th><th>Now</th><th>Role flip</th><th>Breakout</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="12">No zone cleared the minimum-source bar.</td></tr>'}</tbody>`;
}

/* ---------------------------------------------------------------- sources */

function renderSources(report) {
  const dp = decimals(report.derived.tickSize);

  $("sourcePanel").innerHTML = report.sources.map((source) => {
    const topics = source.topics.map((topic, i) => `
      <a href="${config.docs[topic]}" target="_blank" rel="noopener">
        <span class="tier tier-${source.approximation && i === 0 ? "approximation" : source.tiers[i]}">${source.approximation && i === 0 ? "approx. input" : source.tiers[i]}</span>
        ${topic}
      </a>`).join("");

    const body = source.unavailable
      ? `<div class="unavailable-note"><strong>Unavailable.</strong> ${escapeHtml(source.unavailable)}<br>
         The denominator of <code>source_confluence</code> drops to ${report.sourcesAvailable} so this
         instrument is not penalised for a data gap.</div>`
      : `<div class="level-list">${source.levels.map((level) => `
          <div class="level">
            <span class="price" style="color:${SOURCE_COLOUR[source.tag]}">${level.price.toFixed(dp)}</span>
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
  if (source.tag === "pivot") return `<div class="source-extra">${e.clusters} clusters accepted, ${e.noise} pivots left as noise.</div>`;
  if (source.tag === "round-number") return `<div class="source-extra">Grid of ${e.baseUnit}. Closest level ${e.closest?.price ?? "n/a"} at ${e.closest?.distance_bps?.toFixed(0) ?? "n/a"} bps.</div>`;
  if (source.tag === "volume-profile") {
    return `<div class="source-extra">POC ${Number(e.poc).toFixed(dp)} · value area ${Number(e.valueAreaLow).toFixed(dp)}–${Number(e.valueAreaHigh).toFixed(dp)} holding ${(e.valueAreaShare * 100).toFixed(1)}% of volume across ${e.bins} bins. ${e.hvn} HVNs fused; ${e.lvn} LVNs found but <em>not</em> fused — an LVN is a price that price moves through.</div>`;
  }
  if (source.tag === "fibonacci") {
    return `<div class="source-extra">Leg: ${e.fromKind} ${Number(e.fromPrice).toFixed(dp)} → ${e.toKind} ${Number(e.toPrice).toFixed(dp)} (${e.direction}, size ${Number(e.size).toFixed(dp)}). The final zigzag swing is provisional — the next bar can revise it.</div>`;
  }
  return "";
}

/* -------------------------------------------------------------- rejected */

function renderRejected(report) {
  const dp = decimals(report.derived.tickSize);

  const rows = report.rejected.map((cluster) => `
    <tr>
      <td class="mono">${cluster.zoneId}</td>
      <td class="num">${cluster.lower.toFixed(dp)} – ${cluster.upper.toFixed(dp)}</td>
      <td class="num">${cluster.center.toFixed(dp)}</td>
      <td class="num">${cluster.sourceCount}</td>
      <td><div class="chips">${cluster.sources.map((s) => `<span class="chip chip-${s}">${s}</span>`).join("")}</div></td>
      <td>${cluster.members.length} level${cluster.members.length === 1 ? "" : "s"}</td>
      <td class="mono">${cluster.reason}</td>
    </tr>`).join("");

  $("rejectedTable").innerHTML = `
    <thead><tr>
      <th>Cluster</th><th>Band</th><th>Centre</th><th>Sources</th>
      <th>Which</th><th>Members</th><th>Reason</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="7">Every cluster cleared the minimum.</td></tr>'}</tbody>`;
}

/* ------------------------------------------------------------------ trace */

function renderTrace(report) {
  $("trace").innerHTML = report.trace.map((entry) => {
    const tier = entry.tier
      ? `<span class="tier tier-${entry.tier}">${entry.tier}</span>`
      : "";
    const topic = entry.topic
      ? `<a href="${config.docs[entry.topic] ?? "#"}" target="_blank" rel="noopener">${entry.topic}</a>`
      : "";

    return `
      <li>
        <span class="n"></span>
        <span class="stage">${escapeHtml(entry.name)}</span>
        <span class="body">
          ${tier} ${topic}
          <div class="detail">${escapeHtml(entry.detail)}</div>
        </span>
      </li>`;
  }).join("");
}

/* ---------------------------------------------------------------- quality */

function renderQuality(report) {
  const q = report.dataQuality;
  const cells = [
    ["Vendor rows", q.vendorRows],
    ["Null prices dropped", q.droppedByProvider],
    ["Failed OHLC invariants", q.rejectedByValidator],
    ["Breached strict ordering", q.malformedOrdering],
    ["Duplicate timestamps", q.duplicateTimestamps],
    ["Bars analysed", q.barsAnalysed],
    ["Tick size", q.tickSize],
    ["Intraday bars", q.tape.bars],
  ];

  const notes = [];
  if (q.tape.unavailable) notes.push(`<strong>No volume profile.</strong> ${escapeHtml(q.tape.unavailable)}`);
  if (q.tape.note) notes.push(`<strong>Volume profile input is an approximation.</strong> ${escapeHtml(q.tape.note)}`);
  if (q.rejectedSample.length) {
    notes.push(`<strong>Rejected bars (first ${q.rejectedSample.length}):</strong> `
      + q.rejectedSample.map((r) => `${r.timestamp.slice(0, 10)} — ${(r.issues ?? []).join("; ")}`).join(" · "));
  }

  $("quality").innerHTML = cells.map(([label, value]) => `
    <div><dt>${label}</dt><dd>${value}</dd></div>`).join("")
    + (notes.length ? `<div class="full"><dt>Notes</dt><dd>${notes.join("<br><br>")}</dd></div>` : "");
}

/* ---------------------------------------------------------------- helpers */

async function getJSON(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

function fill(select, values, chosen) {
  select.innerHTML = values.map((v) => `<option${v === chosen ? " selected" : ""}>${v}</option>`).join("");
}

/** Show prices at the precision the instrument's own tick size implies. */
function decimals(tick) {
  return Math.max(0, Math.min(8, Math.round(-Math.log10(tick))));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

let statusTimer = null;
function flash(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = `status on${isError ? " error" : ""}`;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusEl.className = "status"; }, isError ? 9000 : 3500);
}
