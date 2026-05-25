// Shared Prometheus metrics helpers for the three render sub-services.
//
// Each render server (Carbone, Typst, Puppeteer) needs its own
// per-process metrics registry so process-wide counters
// (`http_requests_total`, `http_request_duration_seconds`) don't
// collide across services. We can't use the prom-client default
// `register` for all three because the histograms and counters carry
// the same metric names per service and the registry rejects duplicate
// registrations.
//
// Public API:
//   createMetricsRegistry(serviceName) -> { registry, httpDuration,
//                                           httpRequests, recordHttp }
//   attachMetricsMiddleware(app, helpers) — registers Express
//                                            middleware that records
//                                            every request's outcome.
//   attachMetricsEndpoint(app, helpers)  — registers GET /metrics that
//                                          serves the registry in
//                                          Prometheus exposition format.
//
// Refs: https://github.com/siimon/prom-client

import client from 'prom-client';

/**
 * Build a fresh prom-client Registry pre-loaded with default Node
 * metrics + two HTTP-level metrics (a histogram of request durations
 * and a counter of requests by status). Returns the registry plus the
 * helper handles the middleware uses.
 *
 * @param {string} serviceName - prefix used as the `service` label.
 */
export function createMetricsRegistry(serviceName) {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service: serviceName });
  client.collectDefaultMetrics({ register: registry });

  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    // Histogram buckets tuned for render workloads — most calls finish
    // well under 5s but the long tail (Chromium HTML→PDF on a big doc)
    // can spike past 30s.
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [registry],
  });

  const httpRequests = new client.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests grouped by method, route and status',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });

  /**
   * Record a single completed request. Called from the Express
   * middleware below on `res.on('finish')`.
   */
  function recordHttp({ method, route, status, durationSeconds }) {
    const labels = { method, route, status: String(status) };
    httpDuration.observe(labels, durationSeconds);
    httpRequests.inc(labels);
  }

  return { registry, httpDuration, httpRequests, recordHttp };
}

/**
 * Express middleware that records every request once the response
 * finishes. The route label uses `req.route?.path ?? req.path` so
 * dynamic params don't blow up the cardinality (e.g. /render/:templateId
 * collapses to `/render/:templateId` after route matching).
 */
export function attachMetricsMiddleware(app, helpers) {
  app.use((req, res, next) => {
    const startNs = process.hrtime.bigint();
    res.on('finish', () => {
      // After the response is sent, `req.route?.path` is populated by
      // Express when a route matched. Fall back to the request URL so
      // unmatched paths (404) still emit a sample, but bucketed under
      // `unmatched` to keep the cardinality bounded.
      const routePath = req.route?.path ?? (req.path === '/' ? '/' : 'unmatched');
      const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
      helpers.recordHttp({
        method: req.method,
        route: routePath,
        status: res.statusCode,
        durationSeconds,
      });
    });
    next();
  });
}

/**
 * Mount `GET /metrics` returning the Prometheus exposition format from
 * this server's registry. Same port as the app so the K8s
 * ServiceMonitor scrape lands on the right listener.
 */
export function attachMetricsEndpoint(app, helpers) {
  app.get('/metrics', async (_req, res) => {
    try {
      res.set('Content-Type', helpers.registry.contentType);
      res.end(await helpers.registry.metrics());
    } catch (err) {
      res.status(500).type('text/plain').end(String(err));
    }
  });
}
