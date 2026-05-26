/**
 * Env config for the capability-measurement-worker.
 *
 * Mirrors the `junior-evolution-worker` shape — DATABASE_URL is
 * optional; when missing the worker logs + exits cleanly (no-op
 * degraded mode) instead of crashing the pod.
 *
 * Spec: `Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md §9`.
 *
 * @module @borjie/capability-measurement-worker/config
 */

import { z } from 'zod';

const EnvSchema = z.object({
  /** Postgres URL. When unset the worker logs + exits with code 0. */
  DATABASE_URL: z.string().optional(),
  /** HTTP health-server port. Default 4017. */
  PORT: z.coerce.number().int().min(1).max(65535).default(4017),
  /** Bind host. */
  HOST: z.string().default('0.0.0.0'),
  /** Service identity surfaced into logs / telemetry. */
  SERVICE_NAME: z.string().default('capability-measurement-worker'),
  /** development | staging | production. */
  NODE_ENV: z
    .enum(['development', 'staging', 'production', 'test'])
    .default('development'),
  /** trace | debug | info | warn | error | fatal. */
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
  /** Cron tick cadence in ms. Default 5 minutes. */
  CAPABILITY_MEASUREMENT_TICK_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60 * 1000),
  /** Run a single tick and exit (Kubernetes CronJob mode). */
  CAPABILITY_MEASUREMENT_ONESHOT: z
    .string()
    .optional()
    .transform((s) => s === '1' || s?.toLowerCase() === 'true'),
});

export type WorkerConfig = z.infer<typeof EnvSchema>;

/**
 * Parse `process.env` (or a supplied env map) into a WorkerConfig.
 * Throws if any typed field fails validation.
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkerConfig {
  return EnvSchema.parse(env);
}

/**
 * True when the worker has enough infrastructure to actually run.
 * False means the worker should degrade to a no-op (log + exit 0).
 */
export function isOperational(config: WorkerConfig): boolean {
  return typeof config.DATABASE_URL === 'string' && config.DATABASE_URL.length > 0;
}
