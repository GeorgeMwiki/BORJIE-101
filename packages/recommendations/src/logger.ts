/**
 * Structured logger for @borjie/recommendations.
 *
 * Thin pino wrapper exposing a `createLogger(name)` factory and a
 * default `logger` instance, matching the convention used by
 * `packages/forecasting/src/logger.ts` and
 * `services/api-gateway/src/utils/logger.ts`. Replaces direct
 * `console.*` calls per `.semgrep/borjie-rules.yml` rule
 * `console-statement-in-production-path` and the CLAUDE.md
 * "No `console.log` in services — Pino logger only — it handles
 * redaction." policy.
 *
 * Telemetry from this package records ONLY:
 *   - algorithm tag
 *   - input sizes (candidates count, interactions count) — never values
 *   - result summaries (top-K size, algorithm tag, audit-hash short)
 * No PII, no raw embeddings, no interaction contents.
 */

import { pino } from 'pino';

type LogMeta = Record<string, unknown>;

export interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

const pinoLogger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  base: { service: '@borjie/recommendations' },
  redact: {
    paths: [
      'password',
      'token',
      'secret',
      'apiKey',
      'authorization',
      '*.password',
      '*.token',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
});

export function createLogger(name: string): Logger {
  const child = pinoLogger.child({ component: name });
  return {
    debug: (message: string, meta?: LogMeta): void =>
      child.debug(meta ?? {}, message),
    info: (message: string, meta?: LogMeta): void =>
      child.info(meta ?? {}, message),
    warn: (message: string, meta?: LogMeta): void =>
      child.warn(meta ?? {}, message),
    error: (message: string, meta?: LogMeta): void =>
      child.error(meta ?? {}, message),
  };
}

export const logger: Logger = createLogger('root');
