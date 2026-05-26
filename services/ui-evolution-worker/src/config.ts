/**
 * Env-schema for the ui-evolution-worker.
 *
 * The worker is a passive sweeper — when essential infrastructure is
 * not configured (DATABASE_URL especially) it MUST degrade to a no-op
 * rather than crash the supervisor. That degradation is intentional:
 * the supervisor uses this worker as one of many cron-style consumers,
 * and a single misconfigured worker should not pull the platform down.
 *
 * Validation is implemented with zod so that wrong types in `.env`
 * fail loudly at boot rather than producing subtle drift later.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const EnvSchema = z.object({
  /** Postgres URL. When unset the worker logs + exits with code 0. */
  DATABASE_URL: z.string().optional(),
  /** Optional Redis URL for idempotency / locks. */
  REDIS_URL: z.string().optional(),
  /** Cron expression for the nightly aggregator. Defaults to 02:00 UTC. */
  UI_EVO_CRON: z.string().default('0 2 * * *'),
  /** Rolling-window short tail (lock + improve thresholds). Default 14d. */
  UI_EVO_SHORT_WINDOW_DAYS: z.coerce.number().int().positive().default(14),
  /** Rolling-window long tail (sustained lock requirement). Default 60d. */
  UI_EVO_LONG_WINDOW_DAYS: z.coerce.number().int().positive().default(60),
  /**
   * How many days a recipe must remain a lock-candidate before it
   * actually flips to `locked`. Spec §4: 30 days.
   */
  UI_EVO_LOCK_SUSTAIN_DAYS: z.coerce.number().int().positive().default(30),
  /** Per-tenant concurrency in the nightly sweep. */
  UI_EVO_CONCURRENCY: z.coerce.number().int().positive().max(32).default(4),
  /** If set, run the sweep once and exit (CronJob mode). */
  UI_EVO_ONESHOT: z
    .string()
    .optional()
    .transform((s) => s === '1' || s?.toLowerCase() === 'true'),
  /** Disable the LLM call and use a stub proposal generator (CI / dev). */
  UI_EVO_DISABLE_LLM: z
    .string()
    .optional()
    .transform((s) => s === '1' || s?.toLowerCase() === 'true'),
  /**
   * HMAC secret + secretId for the audit-hash-chain rows. The audit
   * chain works without a secret but having one defends against an
   * attacker that controls Postgres but not the secret.
   */
  UI_EVO_AUDIT_SECRET_ID: z.string().optional(),
  UI_EVO_AUDIT_SECRET_VALUE: z.string().optional(),
  /** Service name surfaced into structured logs. */
  UI_EVO_SERVICE_NAME: z.string().default('ui-evolution-worker'),
});

export type WorkerConfig = z.infer<typeof EnvSchema>;

/**
 * Parse a raw env bag (defaults to `process.env`) into a typed
 * `WorkerConfig`. Throws a friendly aggregate error on misconfiguration.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`ui-evolution-worker config invalid: ${issues}`);
  }
  return parsed.data;
}

/**
 * Returns true when the worker has the minimum it needs to run a sweep
 * (i.e. DATABASE_URL is present). Caller is responsible for the
 * degrade-to-no-op path when this returns false.
 */
export function isOperational(config: WorkerConfig): boolean {
  return typeof config.DATABASE_URL === 'string' && config.DATABASE_URL.length > 0;
}
