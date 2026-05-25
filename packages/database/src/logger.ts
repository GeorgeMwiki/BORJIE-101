/**
 * Structured logger for @borjie/database.
 *
 * Thin pino wrapper exposing a `logger.{info,warn,error,debug}(message, meta?)`
 * API that matches the convention used by `services/api-gateway/src/utils/logger.ts`.
 *
 * Why this exists: the database package must not emit raw `console.*` calls
 * (see `.semgrep/borjie-rules.yml` rule `console-statement-in-production-path`
 * and `CLAUDE.md` "No `console.log` in services — Pino logger only — it handles
 * redaction"). Importing `@borjie/observability` here would pull OpenTelemetry,
 * Sentry, and PostHog into the database layer, so we keep this leaf thin and use
 * pino directly. Higher-level services can still wire their own observability stack
 * over the same pino transport via env-level configuration.
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
  base: { service: '@borjie/database' },
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
