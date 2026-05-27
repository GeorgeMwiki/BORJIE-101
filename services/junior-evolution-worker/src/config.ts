/**
 * Env-schema for the junior-evolution-worker.
 *
 * Mirrors `ui-evolution-worker/config.ts` — degrade to no-op when
 * essential infra is missing so a single misconfigured worker can't
 * drag the supervisor pod down.
 */

import { z } from 'zod';

const EnvSchema = z.object({
  /** Postgres URL. When unset the worker logs + exits with code 0. */
  DATABASE_URL: z.string().optional(),
  /** Cron expression for the nightly lifecycle sweep. */
  JUNIOR_EVO_CRON: z.string().default('0 4 * * *'),
  /** Rolling window for satisfaction averaging (days). */
  JUNIOR_EVO_WINDOW_DAYS: z.coerce.number().int().positive().default(14),
  /** Run once and exit (Kubernetes CronJob mode). */
  JUNIOR_EVO_ONESHOT: z
    .string()
    .optional()
    .transform((s) => s === '1' || s?.toLowerCase() === 'true'),
  /** Service name surfaced into structured logs. */
  JUNIOR_EVO_SERVICE_NAME: z.string().default('junior-evolution-worker'),
});

export type WorkerConfig = z.infer<typeof EnvSchema>;

/**
 * Parse `process.env` (or a supplied env-map) into a WorkerConfig.
 * Throws if any of the typed fields fail to parse.
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkerConfig {
  return EnvSchema.parse(env);
}

/**
 * True when the worker has enough infra to actually run. False means
 * the worker should degrade to a no-op (log + exit 0).
 */
export function isOperational(config: WorkerConfig): boolean {
  return typeof config.DATABASE_URL === 'string' && config.DATABASE_URL.length > 0;
}
