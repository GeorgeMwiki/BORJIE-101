/**
 * SOTA forecasting logger.
 *
 * Wave SOTA-FORECAST.
 *
 * Thin wrapper over `@borjie/observability`'s `createLogger` with a
 * full `TelemetryConfig`. The package keeps NO direct `console.*`
 * calls — everything goes through this factory so redaction +
 * trace context + service identity stay consistent across the
 * forecasting subsystem.
 *
 * Adapters accept a minimal `SotaLogger` shape (info/warn/error/debug)
 * so tests can swap in a no-op without instantiating the full
 * observability stack. Production composition root passes
 * `buildSotaLogger()` which returns the real `@borjie/observability`
 * Logger — that class satisfies the SotaLogger shape structurally.
 *
 * @module @borjie/forecasting/sota/logger
 */

import {
  createLogger,
  type Logger as ObsLogger,
  type TelemetryConfig,
} from '@borjie/observability';

/**
 * Minimal logger shape used by every SOTA module. Structurally
 * compatible with `@borjie/observability` `Logger`.
 */
export interface SotaLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(
    message: string,
    error?: Error | Record<string, unknown>,
    data?: Record<string, unknown>,
  ): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

export interface SotaLoggerOptions {
  readonly environment?: 'development' | 'staging' | 'production';
  readonly logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly instanceId?: string;
}

const SERVICE_NAME = '@borjie/forecasting/sota';
const SERVICE_VERSION = '0.1.0';

function resolveEnvironment(
  override?: SotaLoggerOptions['environment'],
): 'development' | 'staging' | 'production' {
  if (override !== undefined) return override;
  const nodeEnv = process.env['NODE_ENV'];
  if (nodeEnv === 'production') return 'production';
  if (nodeEnv === 'staging') return 'staging';
  return 'development';
}

/**
 * Build a SOTA-forecasting logger with a full TelemetryConfig. Used
 * by the composition root.
 */
export function buildSotaLogger(options: SotaLoggerOptions = {}): ObsLogger {
  const environment = resolveEnvironment(options.environment);
  const config: TelemetryConfig = {
    service: {
      name: SERVICE_NAME,
      version: SERVICE_VERSION,
      environment,
      ...(options.instanceId !== undefined
        ? { instanceId: options.instanceId }
        : {}),
    },
    enabled: true,
    logLevel: options.logLevel ?? 'info',
    traceSampleRatio: 0.1,
    metricsIntervalMs: 60_000,
    consoleExport: environment === 'development',
  };
  return createLogger(config);
}

/** A no-op SotaLogger for tests and adapters that opt out of telemetry. */
export const NOOP_SOTA_LOGGER: SotaLogger = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
});
