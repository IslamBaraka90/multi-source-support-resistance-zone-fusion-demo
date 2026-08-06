import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import { ProviderError, RANGES, INTERVALS, TAPE_PLANS } from "./yahoo.js";
import { analyze } from "./analyze.js";
import { AnalysisError, TIERS, TOPIC_DOCS, SOURCES } from "./topics.js";
import { DEFAULT_PARAMS } from "./params.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

export function createServer() {
  const app = express();

  app.use(express.static(path.join(root, "public")));

  // Serve the charting library from node_modules so the page has no CDN
  // dependency and works offline — and behind a cPanel host that may not allow
  // arbitrary outbound requests from the browser.
  app.use(
    "/vendor/lightweight-charts.js",
    express.static(
      path.join(root, "node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js"),
    ),
  );

  // Passenger and most process managers want a cheap liveness endpoint that
  // does not reach out to a vendor.
  app.get("/healthz", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

  app.get("/api/config", (_req, res) => {
    res.json({
      ranges: RANGES,
      intervals: INTERVALS,
      tapePlans: TAPE_PLANS,
      defaults: DEFAULT_PARAMS,
      sources: SOURCES,
      tiers: TIERS,
      docs: TOPIC_DOCS,
    });
  });

  app.get("/api/analyze", async (req, res) => {
    const { symbol, range, interval, tapeInterval, tapeRange, ...params } = req.query;
    if (!symbol) return res.status(400).json({ error: "symbol is required" });

    try {
      const report = await analyze({
        symbol,
        range,
        interval,
        tapePlan: { interval: tapeInterval, range: tapeRange },
        params,
      });
      res.json(report);
    } catch (error) {
      fail(res, error);
    }
  });

  /*
   * The four sources on their own, before fusion. This exists for teaching: the
   * fusion is only interesting if you can see what went into it, and a route
   * that returns the raw level lists makes that step observable rather than a
   * black box.
   */
  app.get("/api/sources", async (req, res) => {
    const { symbol, range, interval, tapeInterval, tapeRange, ...params } = req.query;
    if (!symbol) return res.status(400).json({ error: "symbol is required" });

    try {
      const report = await analyze({
        symbol,
        range,
        interval,
        tapePlan: { interval: tapeInterval, range: tapeRange },
        params,
      });
      res.json({
        meta: report.meta,
        asOf: report.asOf,
        lastClose: report.lastClose,
        derived: report.derived,
        sourcesAvailable: report.sourcesAvailable,
        sources: report.sources,
      });
    } catch (error) {
      fail(res, error);
    }
  });

  return app;
}

function fail(res, error) {
  if (error instanceof ProviderError || error instanceof AnalysisError) {
    return res.status(error.status).json({ error: error.message, kind: error.name });
  }
  console.error("[analyze] unexpected failure", error);
  res.status(500).json({ error: error.message ?? "unexpected server error", kind: "ServerError" });
}
