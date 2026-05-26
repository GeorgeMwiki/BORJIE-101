/**
 * Logger factory — Wave 18M.
 *
 * Thin wrapper over `@borjie/observability`'s `createLogger` that
 * stamps a `TelemetryConfig` for the dynamic-recipe-authoring
 * package. Used by the author orchestrator for diagnostic paths.
 *
 * Per project rules: NO direct `console.*` calls; NO ad-hoc pino
 * instantiation — always go through `createLogger` so redaction +
 * trace context + service identity stay consistent.
 *
 * @module @borjie/dynamic-recipe-authoring/logger
 */

import { createLogger, type Logger } from '@borjie/observability';

export interface AuthoringLoggerOptions {
  readonly environment?: 'development' | 'staging' | 'production';
  readonly logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly instanceId?: string;
}

const SERVICE_NAME = '@borjie/dynamic-recipe-authoring';
const SERVICE_VERSION = '0.1.0';

/**
 * Build a logger with a full `TelemetryConfig`. Environment defaults
 * come from `process.env.NODE_ENV` so the package works in both local
 * dev (consoleExport on) and prod.
 */
export function buildAuthoringLogger(
  options: AuthoringLoggerOptions = {},
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
