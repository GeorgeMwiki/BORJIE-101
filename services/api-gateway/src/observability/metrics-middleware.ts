// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union. Tracked at hono-dev/hono#3891.
/**
 * Gateway-wide metrics middleware.
 *
 * Intercepts every /api/v1/* request, records latency + status code
 * buckets into the metrics registry. For AI chat + MCP + voice + brain
 * paths it also bumps the feature-specific counter so the SystemHealth
 * dashboard can draw events/sec per surface without parsing URLs itself.
 */

import type { MiddlewareHandler } from 'hono';
import { getMetricsRegistry } from './metrics-registry.js';

const HOT_PREFIXES: ReadonlyArray<[string, string]> = [
  ['/api/v1/ai/chat', 'ai-chat'],
  ['/api/v1/brain', 'brain'],
  ['/api/v1/mcp', 'mcp'],
  ['/api/v1/voice', 'voice'],
  ['/api/v1/public/marketing', 'marketing-brain'],
  ['/api/v1/workflow', 'workflow'],
];

function pathSurface(path: string): string {
  for (const [prefix, label] of HOT_PREFIXES) {
    if (path.startsWith(prefix)) return label;
  }
  return 'other';
}

export function createMetricsMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const started = Date.now();
    const surface = pathSurface(c.req.path);
    try {
      await next();
    } finally {
      const latency = Date.now() - started;
      const status = String(c.res.status ?? 0);
      const tenantId =
        (c.get('tenantId') as string | undefined) ??
        (c.get('user') as { tenantId?: string } | undefined)?.tenantId ??
        'unknown';
      const registry = getMetricsRegistry();
      registry.counter('gateway.request.total', 'Gateway HTTP requests', {
        surface,
        status,
        tenantId,
      });
      registry.observe(
        'gateway.request.latency_ms',
        'Gateway HTTP request latency (ms)',
        latency,
        { surface, status },
      );
    }
  };
}
