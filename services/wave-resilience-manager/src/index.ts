/**
 * `@borjie/wave-resilience-manager` — public surface + standalone
 * entrypoint.
 *
 * Per AGENT_SELF_REVIVAL_SPEC. The service wires:
 *   - in-memory progress + attempts repositories (degraded mode)
 *   - the crash-detector cron (every 60 s)
 *   - a stdlib HTTP server with /healthz + /report endpoints
 *
 * Production wires the Drizzle-backed repositories at the composition
 * root (future wave); the in-memory adapters are sufficient for tests
 * + the standalone supervisor that runs before DB plumbing lands.
 */

import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createInMemoryProgressRepository } from './storage/progress-repository.js';
import { createInMemoryAttemptsRepository } from './storage/attempts-repository.js';
import { startDetectorCron } from './cron/detector-cron.js';
import { createHealthServer } from './routes/health.js';
import { buildReportHandler } from './routes/report.js';
import type { ResilienceLogger } from './types.js';

export * from './types.js';
export {
  loadConfig,
  NOTIFICATION_CHANNELS,
  CROSS_REPO_LEDGER_MODES,
  DEFAULT_DAILY_REVIVAL_BUDGET,
  type ResilienceManagerConfig,
  type NotificationChannel,
  type CrossRepoLedgerMode,
  type TwilioConfig,
} from './config.js';
export {
  createInMemoryProgressRepository,
  type ProgressRepository,
} from './storage/progress-repository.js';
export {
  createInMemoryAttemptsRepository,
  type AttemptsRepository,
} from './storage/attempts-repository.js';
export {
  createInMemoryDailyCounterRepository,
  todayUtc,
  type DailyCounterRepository,
} from './storage/daily-counter-repository.js';
export {
  createNotifier,
  type ResolvedNotifier,
} from './notification/notifier-factory.js';
export {
  type Notifier,
  type UnrecoverableNotice,
  formatUnrecoverableBody,
} from './notification/notifier-interface.js';
export { createSmsNotifier, resolveTwilioCreds } from './notification/sms-notifier.js';
export { createSlackNotifier } from './notification/slack-notifier.js';
export { createEmailNotifier } from './notification/email-notifier.js';
export { createLoggerNotifier } from './notification/logger-notifier.js';
export {
  runCrashDetectorSweep,
  isHeartbeatStale,
  type CrashDetectorDeps,
  type DetectorSweepResult,
} from './detector/crash-detector.js';
export {
  decideRevival,
  selectLastCheckpoint,
  type RevivalDeciderDeps,
} from './decider/revival-decider.js';
export {
  buildContinuationPrompt,
  type BuildContinuationPromptInput,
} from './builder/continuation-prompt-builder.js';
export {
  resumeWave,
  type AgentDispatcher,
  type AgentResumerDeps,
  type ResumeWaveResult,
} from './resumer/agent-resumer.js';
export {
  signalCompletion,
  canComplete,
  type CompletionWatcherDeps,
  type CompletionResult,
} from './watcher/completion-watcher.js';
export {
  startDetectorCron,
  type DetectorCronHandle,
} from './cron/detector-cron.js';
export {
  sealEvent,
  type AuditChainState,
  type AuditableEvent,
} from './audit/audit-emit.js';

function streamLogger(): ResilienceLogger {
  // Fallback logger used by the standalone supervisor binary when no
  // injected Pino instance is available. Streams to stdout/stderr so
  // we don't trip the project-wide `no console.*` ban.
  const emit = (stream: NodeJS.WriteStream) => (obj: unknown, msg?: string): void => {
    stream.write(`[wave-resilience-manager] ${msg ?? ''} ${JSON.stringify(obj)}\n`);
  };
  return {
    info: emit(process.stdout),
    warn: emit(process.stderr),
    error: emit(process.stderr),
  };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const logger = streamLogger();
  const progress = createInMemoryProgressRepository();
  const attempts = createInMemoryAttemptsRepository();
  // attempts repo currently unused at the supervisor layer (it is
  // exercised by the resumer + watcher when wired in production); keep
  // the local binding so the wiring is visible.
  void attempts;

  const cron = startDetectorCron({
    deps: {
      progress,
      staleHeartbeatMs: cfg.staleHeartbeatMs,
      chainState: { previousHash: null },
      logger,
    },
    intervalMs: cfg.detectorIntervalMs,
    logger,
  });

  const server = createHealthServer({
    port: cfg.port,
    serviceName: 'wave-resilience-manager',
    version: '0.1.0',
    isReady: () => true,
    reportHandler: buildReportHandler({ progress }),
  });
  await server.listen();
  logger.info(
    {
      port: cfg.port,
      degraded: cfg.degraded,
      detectorIntervalMs: cfg.detectorIntervalMs,
    },
    'wave-resilience-manager started',
  );

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info({ signal }, 'shutdown requested');
    cron.stop();
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

const invokedDirectly = (() => {
  if (typeof process === 'undefined' || !Array.isArray(process.argv)) {
    return false;
  }
  const entry = process.argv[1];
  if (typeof entry !== 'string' || entry.length === 0) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  void main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[wave-resilience-manager] fatal', err);
    process.exit(1);
  });
}
