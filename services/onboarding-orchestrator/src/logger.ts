/**
 * Structured pino logger for the onboarding-orchestrator service.
 *
 * Mirrors services/identity/src/logger.ts conventions:
 *   - structured fields via meta argument
 *   - redaction for common secret-bearing keys
 *   - LOG_LEVEL env override
 *
 * No raw console statements — see `.semgrep/borjie-rules.yml`
 * (`console-statement-in-production-path`).
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
  base: { service: 'onboarding-orchestrator' },
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
      '*.nidaId',
    ],
    censor: '[REDACTED]',
  },
});

export const logger: Logger = {
  debug: (message, meta) => pinoLogger.debug(meta ?? {}, message),
  info: (message, meta) => pinoLogger.info(meta ?? {}, message),
  warn: (message, meta) => pinoLogger.warn(meta ?? {}, message),
  error: (message, meta) => pinoLogger.error(meta ?? {}, message),
};
