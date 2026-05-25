/**
 * Scheduler Runner — container entrypoint for the `scheduler` service.
 *
 * Responsibilities:
 *   1. Load worker descriptors via `createWorkerRegistry`.
 *   2. Bind each to a node-cron job (with per-worker concurrency guard).
 *   3. Expose `GET /healthz` returning `{ status, workers, stats }`.
 *   4. Graceful shutdown on SIGTERM / SIGINT — in-flight ticks finish,
 *      new ticks are refused.
 *
 * Run with: `node dist/scheduler/scheduler-runner.js`.
 *
 * The runner deliberately stays transport-agnostic: handlers come from
 * the registry's `deps` bag. For local development the `makeNoopDeps`
 * helper wires everything to no-op async functions so the container
 * boots green without database connectivity. Production deployments
 * replace these bindings at the composition root (see
 * `src/scheduler/composition.ts` in a follow-up wave).
 */

import http from 'node:http';
import type { Server } from 'node:http';
import cron, { type ScheduledTask } from 'node-cron';

import {
  createWorkerRegistry,
  emptyStats,
  recordError,
  recordSuccess,
  type WorkerDescriptor,
  type WorkerRegistryDeps,
  type WorkerRunStats,
} from './worker-registry.js';

const PORT = Number.parseInt(process.env.PORT ?? '8080', 10);
const VERSION = process.env.APP_VERSION ?? 'dev';

interface RunnerState {
  readonly stats: Map<string, WorkerRunStats>;
  readonly tasks: ScheduledTask[];
  readonly inFlight: Set<string>;
  shuttingDown: boolean;
}

function logInfo(msg: string, meta: Record<string, unknown> = {}): void {
  // Structured line log — real pino/winston wiring is the caller's job.
  process.stdout.write(
    `${JSON.stringify({ level: 'info', msg, ts: new Date().toISOString(), ...meta })}\n`,
  );
}

function logError(msg: string, meta: Record<string, unknown> = {}): void {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', msg, ts: new Date().toISOString(), ...meta })}\n`,
  );
}

async function runWithTimeout(
  handler: () => Promise<void>,
  timeoutMs: number | undefined,
): Promise<void> {
  if (!timeoutMs) {
    await handler();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`handler timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    handler()
      .then(() => {
        clearTimeout(timer);
        resolve();
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function scheduleWorker(
  state: RunnerState,
  descriptor: WorkerDescriptor,
): ScheduledTask | null {
  if (descriptor.disabled) {
    logInfo('worker_disabled', { workerId: descriptor.id });
    return null;
  }
  if (!cron.validate(descriptor.cron)) {
    logError('invalid_cron_expression', {
      workerId: descriptor.id,
      cron: descriptor.cron,
    });
    return null;
  }

  state.stats.set(descriptor.id, emptyStats(descriptor.id));

  const task = cron.schedule(
    descriptor.cron,
    async () => {
      if (state.shuttingDown) return;
      if (state.inFlight.has(descriptor.id)) {
        logInfo('worker_tick_skipped_overlap', { workerId: descriptor.id });
        return;
      }
      state.inFlight.add(descriptor.id);
      const startedAt = Date.now();
      try {
        await runWithTimeout(descriptor.handler, descriptor.timeoutMs);
        state.stats.set(
          descriptor.id,
          recordSuccess(state.stats.get(descriptor.id) ?? emptyStats(descriptor.id)),
        );
        logInfo('worker_tick_ok', {
          workerId: descriptor.id,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        state.stats.set(
          descriptor.id,
          recordError(
            state.stats.get(descriptor.id) ?? emptyStats(descriptor.id),
            error,
          ),
        );
        logError('worker_tick_failed', {
          workerId: descriptor.id,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        });
      } finally {
        state.inFlight.delete(descriptor.id);
      }
    },
    { timezone: process.env.TZ ?? 'UTC' },
  );
  logInfo('worker_registered', {
    workerId: descriptor.id,
    cron: descriptor.cron,
    description: descriptor.description,
  });
  return task;
}

function buildHealthServer(
  state: RunnerState,
  descriptors: WorkerDescriptor[],
): Server {
  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (req.url === '/healthz' || req.url === '/health') {
      const body = {
        status: state.shuttingDown ? 'draining' : 'ok',
        version: VERSION,
        timestamp: new Date().toISOString(),
        workers: descriptors.map((d) => ({
          id: d.id,
          description: d.description,
          cron: d.cron,
          disabled: Boolean(d.disabled),
          stats: state.stats.get(d.id) ?? emptyStats(d.id),
        })),
        inFlight: Array.from(state.inFlight),
      };
      res.statusCode = state.shuttingDown ? 503 : 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
      return;
    }
    if (req.url === '/readyz') {
      res.statusCode = state.shuttingDown ? 503 : 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          status: state.shuttingDown ? 'draining' : 'ready',
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  return server;
}

/**
 * Default no-op deps bundle — lets the container boot without wiring
 * every downstream dependency. Production composition must replace
 * this with real implementations (see composition.ts).
 */
export function makeNoopDeps(): WorkerRegistryDeps {
  const noop = async (): Promise<void> => undefined;
  return {
    runRenewalScheduler: noop,
    runSlaWorker: noop,
    runVendorRatingWorker: noop,
    runIntelligenceHistoryWorker: noop,
    runFarScheduler: noop,
    runWaitlistVacancyBackfill: noop,
    runArrearsProjectionRefresh: noop,
  };
}

export interface StartSchedulerOptions {
  readonly deps?: WorkerRegistryDeps;
  readonly port?: number;
}

export async function startScheduler(
  options: StartSchedulerOptions = {},
): Promise<{ stop: () => Promise<void> }> {
  const deps = options.deps ?? makeNoopDeps();
  const port = options.port ?? PORT;
  const descriptors = createWorkerRegistry(deps);
  const state: RunnerState = {
    stats: new Map(),
    tasks: [],
    inFlight: new Set(),
    shuttingDown: false,
  };

  for (const d of descriptors) {
    const task = scheduleWorker(state, d);
    if (task) state.tasks.push(task);
  }

  const server = buildHealthServer(state, descriptors);
  await new Promise<void>((resolve) => server.listen(port, resolve));
  logInfo('scheduler_ready', {
    port,
    workerCount: state.tasks.length,
  });

  const stop = async (): Promise<void> => {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    logInfo('scheduler_shutdown_begin');
    for (const task of state.tasks) {
      task.stop();
    }
    // Wait up to 30s for in-flight ticks to drain
    const deadline = Date.now() + 30_000;
    while (state.inFlight.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    logInfo('scheduler_shutdown_complete', {
      stillInFlight: state.inFlight.size,
    });
  };

  const onSignal = (signal: string): void => {
    logInfo('signal_received', { signal });
    stop()
      .then(() => process.exit(0))
      .catch((err) => {
        logError('shutdown_error', {
          error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      });
  };
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  process.once('SIGINT', () => onSignal('SIGINT'));

  return { stop };
}

// Direct-run guard — only auto-start when this module is the entrypoint.
const isEntrypoint = (() => {
  try {
    const url = (import.meta as { url?: string }).url;
    if (!url) return false;
    const argvUrl = `file://${process.argv[1] ?? ''}`;
    return url === argvUrl;
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  startScheduler().catch((err) => {
    logError('scheduler_boot_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
