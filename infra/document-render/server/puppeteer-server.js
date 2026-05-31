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
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS ?? 15000);

/**
 * SSRF guard. Untrusted document HTML must never make the headless
 * browser reach cloud-metadata (169.254.169.254), loopback, or internal
 * VPC ranges via <img>/<link>/@import/url()/fetch(). Returns true when a
 * subresource URL must be BLOCKED. Allows public http(s) + inline schemes.
 * (Defence-in-depth alongside the K8s egress NetworkPolicy — and the only
 * layer present in the docker-compose / dev path.)
 */
export function isBlockedRenderUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return true;
  }
  const scheme = u.protocol.toLowerCase();
  if (scheme === 'data:' || scheme === 'about:' || scheme === 'blob:') {
    return false;
  }
  if (scheme !== 'http:' && scheme !== 'https:') return true; // file:/ftp:/gopher:
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') {
    return true;
  }
  if (host === '::1' || host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) {
    return true; // IPv6 loopback / link-local / ULA
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  return false;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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
      // No-JS render: a static document HTML→PDF never needs scripts
      // (mermaid/KaTeX are pre-rendered upstream). Disabling JS removes
      // inline-<script> execution + the JS-driven SSRF/DoS gadget class
      // entirely — defence beyond the subresource interceptor below.
      await page.setJavaScriptEnabled(false);
      // SSRF defence: abort any subresource the document tries to pull
      // from a metadata/loopback/internal host before the request leaves.
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (isBlockedRenderUrl(request.url())) {
          request.abort('blockedbyclient').catch(() => undefined);
        } else {
          request.continue().catch(() => undefined);
        }
      });
      page.setDefaultTimeout(RENDER_TIMEOUT_MS);
      // Hard wall-clock cap so a slow/looping document can never pin a
      // render worker (DoS). networkidle0 resolves fast once SSRF blocks
      // external fetches.
      const pdf = await withTimeout(
        (async () => {
          await page.setContent(html, {
            waitUntil: 'networkidle0',
            timeout: RENDER_TIMEOUT_MS,
          });
          return page.pdf({ format: format ?? 'A4', printBackground: true });
        })(),
        RENDER_TIMEOUT_MS + 2000,
        'pdf render',
      );
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
