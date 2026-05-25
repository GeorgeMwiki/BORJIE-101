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
      return res
        .status(404)
        .type('text/plain')
        .send(`template not found: ${templateId}`);
    }
    const options = convertTo ? { convertTo } : {};
    carbone.render(templatePath, data, options, (err, result) => {
      if (err) {
        return res.status(500).type('text/plain').send(String(err));
      }
      res.status(200).end(result);
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
  // Reject path traversal — only basename allowed.
  const safe = path.basename(templateId);
  const exact = path.join(TEMPLATES_DIR, safe);
  if (fs.existsSync(exact)) return exact;
  // Also try common suffixes if the caller passed a bare id.
  for (const ext of ['.docx', '.odt', '.xlsx', '.pptx', '.html']) {
    const candidate = `${exact}${ext}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
