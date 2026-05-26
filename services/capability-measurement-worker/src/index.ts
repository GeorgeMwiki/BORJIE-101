/**
 * `@borjie/capability-measurement-worker` — entrypoint.
 *
 * Long-running pod. Each 5-minute tick computes the three measurement
 * axes (competence / calibration / utility) for every live capability
 * across every tenant, over the 7d / 28d / 91d rolling windows.
 *
 * Launch shape:
 *   1. Validate env via `loadConfig`. Bail fast on schema errors.
 *   2. If `DATABASE_URL` is unset, log + exit 0 (degraded no-op).
 *   3. Build a logger with the full TelemetryConfig.
 *   4. Stand up a tiny HTTP server on PORT (default 4017) exposing
 *      `GET /health`.
 *   5. Register a setInterval cron tick that calls
 *      `runMeasurementTick`. Composition root injects real repos.
 *   6. Block. SIGTERM / SIGINT trigger graceful shutdown.
 *
 * Spec: `Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md §9`.
 *
 * @module capability-measurement-worker
 */

import { createServer, type Server } from 'node:http';

import {
  createInMemoryCapabilityRepository,
  createInMemoryInvocationRepository,
  createInMemoryMeasurementRepository,
  createInMemoryOutcomeRepository,
  type CapabilityRepository,
  type InvocationRepository,
  type MeasurementRepository,
  type OutcomeRepository,
} from '@borjie/capability-catalogue';
import { createLogger, type Logger } from '@borjie/observability';

import { isOperational, loadConfig, type WorkerConfig } from './config.js';
import {
  runMeasurementTick,
  type TickDeps,
  type TickLogger,
  type TickReport,
} from './cron/measurement-cron.js';

// Re-export cron primitives for in-process callers + tests.
export { runMeasurementTick, type TickDeps, type TickLogger, type TickReport };
export { loadConfig, isOperational, type WorkerConfig };

// ---------------------------------------------------------------------------
// Bootstrap shape
// ---------------------------------------------------------------------------

export interface MainOptions {
  /** Override the loaded config (tests). */
  readonly config?: Partial<WorkerConfig>;
  /** Override repositories (tests). */
  readonly deps?: {
    readonly listTenants?: () => Promise<ReadonlyArray<string>>;
    readonly capabilityRepo?: CapabilityRepository;
    readonly invocationRepo?: InvocationRepository;
    readonly outcomeRepo?: OutcomeRepository;
    readonly measurementRepo?: MeasurementRepository;
    readonly now?: () => Date;
  };
}

export interface MainHandle {
  readonly config: WorkerConfig;
  readonly logger: Logger;
  readonly server: Server | null;
  /** Stop cron, close health server, signal graceful shutdown. */
  stop(): Promise<void>;
  /** Useful for tests — run a tick on demand. */
  tickOnce(): Promise<TickReport>;
}

/**
 * Boot the worker. Returns a handle the caller can `.stop()`.
 */
export async function main(options: MainOptions = {}): Promise<MainHandle> {
  const config = options.config
    ? ({ ...loadConfig(), ...options.config } as WorkerConfig)
    : loadConfig();

  const logger = buildLogger(config);
  logger.info(
    `capability-measurement-worker: starting (env=${config.NODE_ENV}, port=${config.PORT})`,
  );

  // Degraded mode — no DB, log + exit 0.
  if (!isOperational(config) && options.deps === undefined) {
    logger.warn(
      'capability-measurement-worker: DATABASE_URL unset — degraded no-op mode',
    );
    return makeNoOpHandle(config, logger);
  }

  const tickDeps = buildTickDeps(options, logger);
  const server = await startHealthServer(config, logger);
  const stopCron = startCronLoop({
    intervalMs: config.CAPABILITY_MEASUREMENT_TICK_MS,
    runTick: () => runMeasurementTick(tickDeps),
    oneshot: Boolean(config.CAPABILITY_MEASUREMENT_ONESHOT),
    logger,
  });

  let stopped = false;
  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    logger.info('capability-measurement-worker: stop requested');
    stopCron();
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
    logger.info('capability-measurement-worker: stop complete');
  }

  installSignalHandlers({ logger, stop });

  return Object.freeze({
    config,
    logger,
    server,
    stop,
    async tickOnce() {
      return runMeasurementTick(tickDeps);
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildLogger(config: WorkerConfig): Logger {
  return createLogger({
    service: {
      name: config.SERVICE_NAME,
      version: '0.1.0',
      environment: (config.NODE_ENV === 'test'
        ? 'development'
        : config.NODE_ENV) as 'development' | 'staging' | 'production',
    },
    enabled: true,
    logLevel: config.LOG_LEVEL,
    traceSampleRatio: 0.1,
    metricsIntervalMs: 60_000,
    consoleExport: config.NODE_ENV === 'development',
  });
}

function makeNoOpHandle(config: WorkerConfig, logger: Logger): MainHandle {
  return Object.freeze({
    config,
    logger,
    server: null,
    async stop() {
      return;
    },
    async tickOnce() {
      return Object.freeze({
        tenantsSwept: 0,
        capabilitiesSwept: 0,
        measurementsPersisted: 0,
        measurementsSkipped: 0,
      });
    },
  });
}

function buildTickDeps(options: MainOptions, logger: Logger): TickDeps {
  const tickLogger: TickLogger = {
    info(obj, msg) {
      logger.info(msg ?? 'tick.info', obj);
    },
    warn(obj, msg) {
      logger.warn(msg ?? 'tick.warn', obj);
    },
    error(obj, msg) {
      logger.error(msg ?? 'tick.error', obj);
    },
  };
  const fallbackRepo = createInMemoryCapabilityRepository({ rows: [] });
  const fallbackInv = createInMemoryInvocationRepository();
  const fallbackOut = createInMemoryOutcomeRepository();
  const fallbackMeas = createInMemoryMeasurementRepository();

  return {
    listTenants: options.deps?.listTenants ?? (async () => []),
    capabilityRepo: options.deps?.capabilityRepo ?? fallbackRepo,
    invocationRepo: options.deps?.invocationRepo ?? fallbackInv,
    outcomeRepo: options.deps?.outcomeRepo ?? fallbackOut,
    measurementRepo: options.deps?.measurementRepo ?? fallbackMeas,
    now: options.deps?.now ?? (() => new Date()),
    logger: tickLogger,
  };
}

async function startHealthServer(
  config: WorkerConfig,
  logger: Logger,
): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: config.SERVICE_NAME,
          version: '0.1.0',
        }),
      );
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.PORT, config.HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  logger.info(
    `capability-measurement-worker: health server listening on http://${config.HOST}:${config.PORT}`,
  );
  return server;
}

function startCronLoop(args: {
  readonly intervalMs: number;
  readonly runTick: () => Promise<TickReport>;
  readonly oneshot: boolean;
  readonly logger: Logger;
}): () => void {
  if (args.oneshot) {
    void args.runTick().catch((err: unknown) => {
      args.logger.error('oneshot tick failed', { error: String(err) });
    });
    return () => {
      /* nothing to stop */
    };
  }
  const handle = setInterval(() => {
    void args.runTick().catch((err: unknown) => {
      args.logger.error('cron tick failed', { error: String(err) });
    });
  }, args.intervalMs);
  // setInterval keeps the event loop alive; release ref so SIGTERM can win.
  if (typeof handle.unref === 'function') handle.unref();
  return () => clearInterval(handle);
}

function installSignalHandlers(args: {
  readonly logger: Logger;
  readonly stop: () => Promise<void>;
}): void {
  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    args.logger.info(`capability-measurement-worker: ${signal} received`);
    void args.stop().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
}

// ---------------------------------------------------------------------------
// CLI guard — only main() when this file is the program entry.
// ---------------------------------------------------------------------------

const isDirect =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /index(\.js|\.ts)?$/.test(process.argv[1]) &&
  process.argv[1].includes('capability-measurement-worker');

if (isDirect) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`capability-measurement-worker: fatal — ${msg}\n`);
    process.exit(2);
  });
}
