// Puppeteer HTML→PDF render service. Single shared browser, one
// page per request, A4 print-fidelity. Mirrors the contract the
// PdfFromHtmlRenderer expects when it falls back to the network
// path (production wiring usually uses the in-process factory).
//
// Contract:
//   POST /render
//     body  { html: string, format?: string }
//     200   application/pdf
//     5xx   text/plain reason
//   GET  /health   → 200 ok (liveness — process is up)
//   GET  /readyz   → 200 ok if we can open + close a page on the
//                    shared browser, 503 otherwise
//   GET  /metrics  → Prometheus exposition (same port; K8s ServiceMonitor scrapes it)
//
// Refs: https://pptr.dev/api/puppeteer.page.pdf

import express from 'express';
import puppeteer from 'puppeteer-core';
import {
  attachMetricsEndpoint,
  attachMetricsMiddleware,
  createMetricsRegistry,
} from './metrics.js';

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium';

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
}

/**
 * Build (without binding) the puppeteer server. The optional
 * `browserFactory` slot lets tests inject a stub browser without
 * launching a real Chromium process.
 */
export function buildPuppeteerApp(opts = {}) {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  const metrics = createMetricsRegistry('puppeteer');
  attachMetricsMiddleware(app, metrics);

  // Inject a custom browser source for tests. Production reuses the
  // module-scoped `browserPromise` to keep a single warm Chromium.
  const factory = opts.browserFactory ?? getBrowser;

  app.get('/health', (_req, res) => res.status(200).json({ ok: true, service: 'puppeteer' }));

  app.get('/readyz', async (_req, res) => {
    try {
      const browser = await factory();
      // Real liveness check: open a fresh page and immediately close
      // it. If Chromium is dead this throws and we surface 503.
      const page = await browser.newPage();
      await page.close();
      const connected = typeof browser.connected === 'boolean' ? browser.connected : true;
      return res.status(200).json({
        ready: true,
        service: 'puppeteer',
        connected,
      });
    } catch (err) {
      return res.status(503).json({
        ready: false,
        service: 'puppeteer',
        reason: err.message ?? String(err),
      });
    }
  });

  attachMetricsEndpoint(app, metrics);

  app.post('/render', async (req, res) => {
    const { html, format } = req.body ?? {};
    if (typeof html !== 'string' || html.length === 0) {
      return res.status(400).type('text/plain').send('missing html');
    }
    let page;
    try {
      const browser = await factory();
      page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: format ?? 'A4',
        printBackground: true,
      });
      res.status(200).type('application/pdf').end(pdf);
    } catch (err) {
      res.status(500).type('text/plain').send(String(err));
    } finally {
      if (page) await page.close().catch(() => undefined);
    }
  });

  return { app, metrics };
}

export function startPuppeteer(port) {
  const { app } = buildPuppeteerApp();
  return app.listen(port, () => {
    console.log(`[puppeteer] listening on :${port}`);
  });
}
