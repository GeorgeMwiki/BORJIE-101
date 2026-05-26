/**
 * Structured logger for consolidation-worker service.
 *
 * Thin pino wrapper exposing a `logger.{info,warn,error,debug}(message, meta?)`
 * API matching the convention used by `services/api-gateway/src/utils/logger.ts`.
 *
 * Replaces direct `console.*` calls per `.semgrep/borjie-rules.yml`
 * rule `console-statement-in-production-path` and CLAUDE.md "No `console.log`
 * in services — Pino logger only — it handles redaction."
 *
 * Singleton: imported by any consolidation-worker task (corpus ingest CLIs,
 * orchestrator, stages). `BORJIE_DEBUG=1` forces level to `debug` so dev
 * runs of `borjie-corpus-cli.ts` surface ingest progress without rebuilding.
 * Otherwise `LOG_LEVEL` wins (default `info`).
 */
import { pino } from 'pino';

type LogMeta = Record<string, unknown>;

interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

function resolveLevel(): string {
  if (process.env.BORJIE_DEBUG === '1') return 'debug';
  return process.env.LOG_LEVEL ?? 'info';
}

const pinoLogger = pino({
  level: resolveLevel(),
  base: { service: 'consolidation-worker' },
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  redact: {
    paths: ['password', 'token', 'secret', 'apiKey', 'authorization', '*.password', '*.token', '*.secret'],
    censor: '[REDACTED]',
  },
});

export const logger: Logger = {
  debug: (message, meta) => pinoLogger.debug(meta ?? {}, message),
  info: (message, meta) => pinoLogger.info(meta ?? {}, message),
  warn: (message, meta) => pinoLogger.warn(meta ?? {}, message),
  error: (message, meta) => pinoLogger.error(meta ?? {}, message),
};
