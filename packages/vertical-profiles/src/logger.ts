/**
 * Logger factory — Wave VP-1.
 *
 * Thin wrapper over `@borjie/observability`'s `createLogger` that
 * stamps a full `TelemetryConfig` for the vertical-profiles package.
 * Used by the registry adapters and the seed loader's diagnostic
 * paths.
 *
 * Per project rules: NO direct `console.*` calls; NO ad-hoc pino
 * instantiation — always go through `createLogger` so redaction +
 * trace context + service identity stay consistent.
 *
 * @module @borjie/vertical-profiles/logger
 */

import { createLogger, type Logger } from '@borjie/observability';

export interface VerticalProfilesLoggerOptions {
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

const SERVICE_NAME = '@borjie/vertical-profiles';
const SERVICE_VERSION = '0.1.0';

function resolveEnvironment(
  override: VerticalProfilesLoggerOptions['environment'],
): 'development' | 'staging' | 'production' {
  if (override !== undefined) {
    return override;
  }
  const env = process.env['NODE_ENV'];
  if (env === 'production') {
    return 'production';
  }
  if (env === 'staging') {
    return 'staging';
  }
  return 'development';
}

/**
 * Build a logger with a full `TelemetryConfig`. Environment defaults
 * are read from `process.env` so the package works in both local
 * dev (consoleExport on) and prod.
 */
export function buildVerticalProfilesLogger(
  options: VerticalProfilesLoggerOptions = {},
): Logger {
  const env = resolveEnvironment(options.environment);

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
