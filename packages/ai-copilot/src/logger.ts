/**
 * Structured logger for @borjie/ai-copilot.
 *
 * Thin pino wrapper exposing a `logger.{info,warn,error,debug}(message, meta?)`
 * API that matches the convention used by `services/api-gateway/src/utils/logger.ts`.
 *
 * Why this exists: the ai-copilot package must not emit raw `console.*` calls
 * (see `.semgrep/borjie-rules.yml` rule `console-statement-in-production-path`
 * and `CLAUDE.md` "No `console.log` in services — Pino logger only — it handles
 * redaction"). Importing `@borjie/observability` here would pull OpenTelemetry,
 * Sentry, and PostHog into the AI layer, so we keep this leaf thin and use pino
 * directly. Services that consume this package can override the log sink via
 * env-level pino configuration if needed.
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
  base: { service: '@borjie/ai-copilot' },
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
