/**
 * Prometheus metrics wiring for the outcomes-metering service.
 *
 * Exposes:
 *   - Default Node metrics (event loop lag, GC pauses, RSS, etc.) via
 *     `prom-client`'s `collectDefaultMetrics`.
 *   - `http_request_duration_seconds` histogram labelled by method,
 *     route, and status.
 *   - `http_requests_total` counter labelled the same.
 *
 * Registers a `GET /metrics` route on the Fastify instance so K8s'
 * ServiceMonitor scrape lands on the same port the app listens on
 * (no separate metrics server — matches the deployment shape in
 * `infra/k8s/outcomes-metering/base/deployment.yaml`).
 */

import client from 'prom-client';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const SERVICE_NAME = 'outcomes-metering';

export interface MetricsHandle {
  readonly registry: client.Registry;
}

/**
 * Build a service-scoped registry and register the HTTP middleware
 * + `/metrics` route on the given Fastify app. Idempotent across
 * multiple calls on the same app by virtue of registering listeners
 * (Fastify itself rejects duplicate routes — guard with a marker).
 */
export function registerMetrics(app: FastifyInstance): MetricsHandle {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service: SERVICE_NAME });
  client.collectDefaultMetrics({ register: registry });

  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    // SLO-aligned buckets — outcomes-metering serves quick reads and
    // small idempotent writes, so the long tail beyond 5s indicates a
    // problem worth surfacing.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const httpRequests = new client.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests by method, route and status',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });

  app.addHook('onRequest', async (request) => {
    // hrtime returns bigint nanoseconds — store on the request so the
    // onResponse hook below can compute the delta without a closure.
    (request as unknown as { __metricsStartNs: bigint }).__metricsStartNs =
      process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const startNs = (request as unknown as { __metricsStartNs?: bigint })
      .__metricsStartNs;
    if (startNs === undefined) return;
    const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;

    // `routeOptions.url` is the registered template (e.g.
    // `/outcomes/billing/:tenantId/:month`), which keeps cardinality
    // bounded. Fall back to the raw URL when no route matched (404s).
    const route =
      (request.routeOptions as { url?: string } | undefined)?.url ??
      (request.url.split('?')[0] || 'unmatched');
    const labels = {
      method: request.method,
      route,
      status: String(reply.statusCode),
    };
    httpDuration.observe(labels, durationSeconds);
    httpRequests.inc(labels);
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  return { registry };
}
