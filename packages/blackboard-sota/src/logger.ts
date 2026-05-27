/**
 * Logger factory — Wave BLACKBOARD-CORE.
 *
 * Thin wrapper over `@borjie/observability`'s `createLogger` that
 * stamps a full `TelemetryConfig` for the blackboard-sota package.
 * Used by the region manager, post publisher, control shell, and the
 * rolling-summary cron.
 *
 * Per project rules: NO direct `console.*` calls; NO ad-hoc pino
 * instantiation — always go through `createLogger` so redaction +
 * trace context + service identity stay consistent.
 *
 * @module @borjie/blackboard-sota/logger
 */

import { createLogger, type Logger } from '@borjie/observability';

export interface BlackboardLoggerOptions {
  readonly environment?: 'development' | 'staging' | 'production';
  readonly logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly instanceId?: string;
}

const SERVICE_NAME = '@borjie/blackboard-sota';
const SERVICE_VERSION = '0.1.0';

/**
 * Build a logger with a full `TelemetryConfig`. Environment defaults
 * are read from `process.env` so the package works in both local
 * dev (consoleExport on) and prod.
 */
export function buildBlackboardLogger(
  options: BlackboardLoggerOptions = {},
): Logger {
  const env =
    options.environment ??
    ((process.env['NODE_ENV'] === 'production'
      ? 'production'
      : process.env['NODE_ENV'] === 'staging'
        ? 'staging'
        : 'development') as 'development' | 'staging' | 'production');

  return createLogger({
    service: {
      name: SERVICE_NAME,
      version: SERVICE_VERSION,
      environment: env,
      ...(options.instanceId !== undefined
        ? { instanceId: options.instanceId }
        : {}),
    },
    enabled: true,
    logLevel: options.logLevel ?? 'info',
    traceSampleRatio: 0.1,
    metricsIntervalMs: 60_000,
    consoleExport: env === 'development',
  });
}
