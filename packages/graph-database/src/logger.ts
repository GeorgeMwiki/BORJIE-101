/**
 * Logger factory — `@borjie/graph-database`.
 *
 * Thin wrapper over `@borjie/observability`'s `createLogger` that
 * stamps a `TelemetryConfig` for this package. Used by drivers,
 * the registry, and the migration manager.
 *
 * Per project rules: NO direct `console.*` calls; NO ad-hoc pino
 * instantiation — always go through `createLogger`.
 *
 * @module @borjie/graph-database/logger
 */

import { createLogger, type Logger } from '@borjie/observability';

export interface GraphDatabaseLoggerOptions {
  readonly environment?: 'development' | 'staging' | 'production';
  readonly logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly instanceId?: string;
}

const SERVICE_NAME = '@borjie/graph-database';
const SERVICE_VERSION = '0.1.0';

/**
 * Build a logger with a full `TelemetryConfig`. Environment defaults
 * to `process.env.NODE_ENV`.
 */
export function buildGraphDatabaseLogger(
  options: GraphDatabaseLoggerOptions = {},
): Logger {
  const nodeEnv = process.env['NODE_ENV'];
  const env =
    options.environment ??
    ((nodeEnv === 'production'
      ? 'production'
      : nodeEnv === 'staging'
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
