// Carbone HTTP server — minimal compatible surface for the
// `packages/document-studio` CarboneRenderer.
//
// Contract (mirrors carbone-on-prem REST):
//   POST /render/:templateId
//     body  { data: any, convertTo: 'pdf'|'docx'|'xlsx'|'pptx'|... }
//     200   binary file (no JSON envelope)
//     5xx   text/plain error reason
//   GET  /health   → 200 ok (liveness — process is up)
//   GET  /readyz   → 200 ok if carbone.set succeeded at boot, 503 otherwise
//   GET  /metrics  → Prometheus exposition (same port; K8s ServiceMonitor scrapes it)
//
// Templates are read from `TEMPLATES_DIR` (default /app/templates) by
// `:templateId` lookup. In dev the host mounts the studio's templates
// dir straight in via docker-compose.
//
// Refs: https://carbone.io/api-reference.html

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import carbone from 'carbone';
import {
  attachMetricsEndpoint,
  attachMetricsMiddleware,
  createMetricsRegistry,
} from './metrics.js';

const TEMPLATES_DIR = process.env.TEMPLATES_DIR ?? '/app/templates';
const RENDER_TIMEOUT_MS = Number(process.env.CARBONE_RENDER_TIMEOUT_MS ?? 60000);
const MAX_OUTPUT_BYTES = Number(
  process.env.CARBONE_MAX_OUTPUT_BYTES ?? 50 * 1024 * 1024,
);

/**
 * Build (without binding) the carbone server. Exported separately from
 * `startCarbone` so unit tests can attach to supertest without an open
 * port and so `/readyz` boot state is testable in isolation.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.skipCarboneInit] - when true, skip the
 *   `carbone.set` call. Used by tests to avoid touching the carbone
 *   tmp dir; the readyz state is then driven by `opts.readyState`.
 * @param {{ ready: boolean, reason?: string }} [opts.readyState] -
 *   override readiness for tests.
 */
export function buildCarboneApp(opts = {}) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const metrics = createMetricsRegistry('carbone');
  attachMetricsMiddleware(app, metrics);

  // Readiness state — populated once at boot when `carbone.set`
  // returns. Tests can pre-set this via `opts.readyState`.
  const readyState = opts.readyState ?? { ready: false, reason: 'not_initialised' };

  if (!opts.skipCarboneInit) {
    try {
      // Carbone's `set` returns undefined synchronously; if it throws
      // the install is broken. We treat success as ready.
      carbone.set({
        // Honour a custom factory pool size when present so the K8s
        // deployment can tune throughput per replica.
        ...(process.env.CARBONE_FACTORY_COUNT
          ? { factories: Number(process.env.CARBONE_FACTORY_COUNT) }
          : {}),
      });
      readyState.ready = true;
      delete readyState.reason;
    } catch (err) {
      readyState.ready = false;
      readyState.reason = `carbone.set failed: ${err.message ?? String(err)}`;
    }
  }

  app.get('/health', (_req, res) => res.status(200).json({ ok: true, service: 'carbone' }));

  app.get('/readyz', (_req, res) => {
    if (readyState.ready) {
      return res.status(200).json({ ready: true, service: 'carbone' });
    }
    return res.status(503).json({
      ready: false,
      service: 'carbone',
      reason: readyState.reason ?? 'unknown',
    });
  });

  attachMetricsEndpoint(app, metrics);

  app.post('/render/:templateId', (req, res) => {
    const { templateId } = req.params;
    const { data, convertTo } = req.body ?? {};
    if (!data || typeof data !== 'object') {
      return res.status(400).type('text/plain').send('missing data field');
    }
    const templatePath = resolveTemplate(templateId);
    if (!templatePath) {
      // Reflect only the safe, basename-stripped version of the id so no
      // raw user input appears in the response body (js/reflected-xss).
      const safeId = String(templateId ?? '').replace(/[^\w.\-]/g, '_').slice(0, 120);
      return res
        .status(404)
        .type('text/plain')
        .send(`template not found: ${safeId}`);
    }
    const options = convertTo ? { convertTo } : {};
    // Carbone has no built-in per-render timeout (unlike puppeteer/typst);
    // a malicious template/data set could hang the LibreOffice subprocess.
    // Guard with a wall-clock cap + a one-shot response latch.
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      res.status(504).type('text/plain').send('render timed out');
    }, RENDER_TIMEOUT_MS);
    carbone.render(templatePath, data, options, (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        return res.status(500).type('text/plain').send(String(err));
      }
      if (result && result.length > MAX_OUTPUT_BYTES) {
        return res.status(413).type('text/plain').send('rendered output too large');
      }
      res
        .status(200)
        .set(
          'Content-Disposition',
          `attachment; filename="${path.basename(templateId)}.bin"`,
        )
        .set('X-Content-Type-Options', 'nosniff')
        .end(result);
    });
  });

  return { app, metrics, readyState };
}

export function startCarbone(port) {
  const { app } = buildCarboneApp();
  return app.listen(port, () => {
    console.log(`[carbone] listening on :${port}`);
  });
}

function resolveTemplate(templateId) {
  // Reject path traversal — only basename allowed, AND the resolved path
  // must stay inside TEMPLATES_DIR (containment defence beyond basename,
  // covers symlink/edge cases if the volume is ever made writable).
  const safe = path.basename(String(templateId ?? ''));
  const baseDir = path.resolve(TEMPLATES_DIR);
  const exact = path.resolve(baseDir, safe);
  if (exact !== baseDir && !exact.startsWith(baseDir + path.sep)) return null;
  if (fs.existsSync(exact)) return exact;
  // Also try common suffixes if the caller passed a bare id.
  for (const ext of ['.docx', '.odt', '.xlsx', '.pptx', '.html']) {
    const candidate = `${exact}${ext}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
