/**
 * GET /readyz — Kubernetes readiness probe.
 *
 * `/healthz` is liveness (process up). `/readyz` is readiness — only
 * 200 once we can actually serve traffic. In production that means
 * the Postgres pool can answer a trivial `SELECT 1`. When no pool is
 * wired (memory-mode dev/test), `/readyz` returns 200 immediately:
 * the in-memory store has no async startup, so the process is ready
 * the moment Fastify has bound the port.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';

/**
 * Minimal pool-like interface — we only need to issue a single ping.
 * Both `pg.Pool` and `@borjie/database` connection wrappers expose
 * a `query` method matching this signature.
 */
export interface ReadinessDbPool {
  query(sql: string): Promise<unknown>;
}

export interface RegisterReadyzRoutesDeps {
  /** Optional DB pool; when present, /readyz issues `SELECT 1`. */
  readonly dbPool?: ReadinessDbPool;
  /** Per-probe timeout in ms; default 2_000. */
  readonly probeTimeoutMs?: number;
}

export async function registerReadyzRoutes(
  app: FastifyInstance,
  deps: RegisterReadyzRoutesDeps = {},
): Promise<void> {
  const probeTimeoutMs = deps.probeTimeoutMs ?? 2_000;

  app.get('/readyz', async (_request, reply: FastifyReply) => {
    // Memory mode — no DB to ping. The store is synchronous, so the
    // moment Fastify has accepted the connection we're ready.
    if (!deps.dbPool) {
      return reply.code(200).send({
        ready: true,
        service: 'outcomes-metering',
        mode: 'memory',
      });
    }

    // Race the SELECT 1 against a timeout so a wedged DB connection
    // doesn't pin the readiness probe (K8s would otherwise wait the
    // full HTTP timeout, ~30s).
    try {
      await Promise.race([
        deps.dbPool.query('SELECT 1'),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('db ping timeout')), probeTimeoutMs),
        ),
      ]);
      return reply.code(200).send({
        ready: true,
        service: 'outcomes-metering',
        mode: 'db',
      });
    } catch (err) {
      return reply.code(503).send({
        ready: false,
        service: 'outcomes-metering',
        mode: 'db',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
