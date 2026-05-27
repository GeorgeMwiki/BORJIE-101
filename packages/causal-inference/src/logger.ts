/**
 * Logger factory — SOTA-CAUSAL.
 *
 * Thin wrapper over `@borjie/observability`'s `createLogger` that
 * stamps a `TelemetryConfig` for the causal-inference package. Used
 * by the four-step pipeline (model -> identify -> estimate -> refute)
 * for diagnostic paths.
 *
 * Per project rules: NO direct `console.*` calls; NO ad-hoc pino
 * instantiation — always go through `createLogger` so redaction +
 * trace context + service identity stay consistent.
 *
 * @module @borjie/causal-inference/logger
 */

import { createLogger, type Logger } from '@borjie/observability';

export interface CausalLoggerOptions {
  readonly environment?: 'development' | 'staging' | 'production';
  readonly logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly instanceId?: string;
}

const SERVICE_NAME = '@borjie/causal-inference';
const SERVICE_VERSION = '0.1.0';

/**
 * Build a logger with a full `TelemetryConfig`. Environment defaults
 * come from `process.env.NODE_ENV` so the package works in both local
 * dev (consoleExport on) and production.
 */
export function buildCausalLogger(
  options: CausalLoggerOptions = {},
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
