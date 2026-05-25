/**
 * `@borjie/sleep-pass-orchestrator` — public surface + Fastify entrypoint.
 *
 * Always-on heartbeat orchestrator + 8 universally-applicable sleep passes
 * ported from LITFIN PROJECT/src/core/heartbeat. Production wires real
 * adapters at the composition root; in-memory adapters under
 * `./passes/adapters` power tests + local development AND the standalone
 * pod's in-process loop until prod adapters land.
 *
 * Exposes (when the standalone process is invoked directly):
 *   - GET /healthz             liveness (process is up)
 *   - GET /readyz              readiness (memory mode today; DB ping wired
 *                              by the composition root when adapters land)
 *   - GET /metrics             Prometheus exposition on the app port (3040)
 *   - GET /admin/passes/status recent tick + result snapshots for K8s
 *                              readiness checks and ops debugging
 *
 * Env vars consumed at standalone entry:
 *   - `PORT`                      Fastify listen port (default 3040;
 *                                 matches infra/k8s/sleep-pass-orchestrator)
 *   - `HOST`                      Fastify listen host (default 0.0.0.0)
 *   - `HEARTBEAT_INTERVAL_MS`     pass dispatch cadence (default 60_000)
 *   - `SLEEP_PASS_PROD_ADAPTERS`  '1' refuses in-memory mode (prod guard)
 */

import { logger } from './logger.js';
export * from './types.js';
export {
  createOrchestrator,
  nextDueFrom,
  type Orchestrator,
} from './orchestrator.js';
export * from './passes/index.js';
export {
  buildStandaloneOrchestrator,
  type StandaloneOrchestratorBundle,
} from './standalone-bootstrap.js';

// ---------------------------------------------------------------------------
// Standalone Fastify entrypoint — only runs when invoked directly.
// ---------------------------------------------------------------------------

import Fastify, { type FastifyInstance } from 'fastify';
import client from 'prom-client';
import { pathToFileURL } from 'node:url';
import { buildStandaloneOrchestrator } from './standalone-bootstrap.js';
import type { Orchestrator } from './orchestrator.js';
import type { HeartbeatTick, PassResult } from './types.js';

interface BuildAppResult {
  readonly app: FastifyInstance;
  readonly registry: client.Registry;
}

/**
 * Build a Fastify instance with the K8s-required probe + metrics
 * endpoints wired. The actual orchestrator loop is started separately
 * by `main` so the app handle can be reused in tests without booting
 * the timer.
 */
async function buildApp(args: {
  readonly recentTicks: () => ReadonlyArray<HeartbeatTick>;
  readonly recentResults: () => ReadonlyArray<PassResult>;
  readonly mode: 'memory' | 'production';
}): Promise<BuildAppResult> {
  const app = Fastify({ logger: false });

  const registry = new client.Registry();
  registry.setDefaultLabels({ service: 'sleep-pass-orchestrator' });
  client.collectDefaultMetrics({ register: registry });

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'sleep-pass-orchestrator',
  }));

  app.get('/readyz', async () => ({
    ready: true,
    service: 'sleep-pass-orchestrator',
    mode: args.mode,
  }));

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  app.get('/admin/passes/status', async () => ({
    service: 'sleep-pass-orchestrator',
    mode: args.mode,
    recentTicks: args.recentTicks(),
    recentResults: args.recentResults(),
  }));

  return { app, registry };
}

function installSignalHandlers(args: {
  readonly app: FastifyInstance;
  readonly orchestrator: Orchestrator;
}): void {
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[sleep-pass-orchestrator] ${signal} received — stopping`);
    try {
      args.orchestrator.stop();
    } catch (err) {
      logger.error('[sleep-pass-orchestrator] stop() failed', { error: err });
    }
    try {
      await args.app.close();
    } catch (err) {
      logger.error('[sleep-pass-orchestrator] app.close() failed', { error: err });
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

async function main(): Promise<void> {
  const bundle = buildStandaloneOrchestrator();
  const { app } = await buildApp({
    recentTicks: bundle.recentTicks,
    recentResults: bundle.recentResults,
    mode: bundle.mode,
  });

  const port = Number(process.env.PORT ?? 3040);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen({ port, host });
  logger.info(`[sleep-pass-orchestrator] listening on http://${host}:${port}`);

  bundle.orchestrator.start();
  logger.info(`[sleep-pass-orchestrator] heartbeat loop started (mode=${bundle.mode})`);

  installSignalHandlers({ app, orchestrator: bundle.orchestrator });
}

// Detect "run as CLI" robustly. Comparing `file://${argv[1]}` directly breaks
// on paths containing spaces (`import.meta.url` percent-encodes them; argv
// does not), so route both through `pathToFileURL` exactly like
// `packages/database/src/run-migrations.ts` does.
const invokedDirectly = (() => {
  if (typeof process === 'undefined' || !Array.isArray(process.argv)) {
    return false;
  }
  const entry = process.argv[1];
  if (typeof entry !== 'string' || entry.length === 0) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  void main().catch((err) => {
    logger.error('[sleep-pass-orchestrator] fatal', { error: err });
    process.exit(1);
  });
}
