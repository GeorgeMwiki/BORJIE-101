/**
 * Structured logger for apollo-gauntlet-runner service.
 *
 * Thin pino wrapper exposing a `logger.{info,warn,error,debug}(message, meta?)`
 * API matching the convention used by `services/api-gateway/src/utils/logger.ts`.
 *
 * Replaces direct `console.*` calls per `.semgrep/borjie-rules.yml`
 * rule `console-statement-in-production-path` and CLAUDE.md "No raw
 * console statements in services — Pino logger only — it handles redaction."
 */
import { pino } from 'pino';

type LogMeta = Record<string, unknown>;

interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'apollo-gauntlet-runner' },
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
