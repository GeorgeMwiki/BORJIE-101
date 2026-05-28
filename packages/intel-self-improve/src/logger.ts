/**
 * Logger factory — Wave INTEL-SELF-IMPROVE.
 *
 * Thin wrapper over `@borjie/observability`'s `createLogger` that
 * stamps a full `TelemetryConfig` for the intel-self-improve
 * package. Used by `wrapAsMeasured`'s telemetry path and the
 * outcome-observer cron.
 *
 * Per project rules: NO direct `console.*` calls; NO ad-hoc pino
 * instantiation — always go through `createLogger` so redaction +
 * trace context + service identity stay consistent.
 *
 * @module @borjie/intel-self-improve/logger
 */

import { createLogger, type Logger } from '@borjie/observability';

export interface IntelSelfImproveLoggerOptions {
  readonly environment?: 'development' | 'staging' | 'production';
  readonly logLevel?:
    | 'trace'
    | 'debug'
    | 'info'
    | 'warn'
    | 'error'
    | 'fatal';
  readonly instanceId?: string;
}

const SERVICE_NAME = '@borjie/intel-self-improve';
const SERVICE_VERSION = '0.1.0';

/**
 * Build a logger with a full `TelemetryConfig`. Environment defaults
 * read from `process.env` so the package works in both local dev
 * (consoleExport on) and prod.
 */
export function buildIntelLogger(
  options: IntelSelfImproveLoggerOptions = {},
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
