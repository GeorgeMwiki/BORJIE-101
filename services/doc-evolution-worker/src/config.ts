/**
 * doc-evolution-worker — configuration via env, validated by zod.
 *
 * Defaults match the spec: 60-day rolling acceptance window, 90-day
 * sustained-clean window for lock, nightly cron at 03:00 UTC (one hour
 * after the ui-evolution-worker so load is spread).
 */

import { z } from 'zod';

const intFromEnv = (def: number) =>
  z
    .preprocess(
      (v) => (typeof v === 'string' && v.length > 0 ? Number(v) : undefined),
      z.number().int().nonnegative().optional(),
    )
    .transform((v) => v ?? def);

const floatFromEnv = (def: number) =>
  z
    .preprocess(
      (v) => (typeof v === 'string' && v.length > 0 ? Number(v) : undefined),
      z.number().nonnegative().optional(),
    )
    .transform((v) => v ?? def);

const boolFromEnv = (def: boolean) =>
  z
    .preprocess(
      (v) =>
        typeof v === 'string'
          ? v.toLowerCase() === 'true' || v === '1'
          : undefined,
      z.boolean().optional(),
    )
    .transform((v) => v ?? def);

/** Acceptance threshold for LOCK candidacy — spec §7. */
export const DEFAULT_LOCK_ACCEPTANCE_THRESHOLD = 0.8;
/** Revision threshold for LOCK candidacy — spec §7. */
export const DEFAULT_LOCK_REVISION_CEILING = 0.1;
/** Sustained-clean window in days before a candidate is hard-locked. */
export const DEFAULT_LOCK_SUSTAINED_DAYS = 90;
/** Acceptance threshold below which IMPROVE is triggered. */
export const DEFAULT_IMPROVE_ACCEPTANCE_CEILING = 0.5;
/** Per-section revision threshold for IMPROVE — spec §7. */
export const DEFAULT_IMPROVE_SECTION_REVISION_THRESHOLD = 0.2;
/** Rolling window in days for acceptance/revision stats. */
export const DEFAULT_ROLLING_WINDOW_DAYS = 60;
/** Regulator-flag lookback in days — spec §7. */
export const DEFAULT_REGULATOR_FLAG_LOOKBACK_DAYS = 30;
/** Cron at 03:00 UTC (1h after ui-evolution-worker at 02:00 UTC). */
export const DEFAULT_NIGHTLY_CRON_EXPR = '0 3 * * *';

export const ConfigSchema = z.object({
  ROLLING_WINDOW_DAYS: intFromEnv(DEFAULT_ROLLING_WINDOW_DAYS),
  LOCK_SUSTAINED_DAYS: intFromEnv(DEFAULT_LOCK_SUSTAINED_DAYS),
  REGULATOR_FLAG_LOOKBACK_DAYS: intFromEnv(DEFAULT_REGULATOR_FLAG_LOOKBACK_DAYS),
  LOCK_ACCEPTANCE_THRESHOLD: floatFromEnv(DEFAULT_LOCK_ACCEPTANCE_THRESHOLD),
  LOCK_REVISION_CEILING: floatFromEnv(DEFAULT_LOCK_REVISION_CEILING),
  IMPROVE_ACCEPTANCE_CEILING: floatFromEnv(DEFAULT_IMPROVE_ACCEPTANCE_CEILING),
  IMPROVE_SECTION_REVISION_THRESHOLD: floatFromEnv(
    DEFAULT_IMPROVE_SECTION_REVISION_THRESHOLD,
  ),
  NIGHTLY_CRON_EXPR: z
    .string()
    .min(9)
    .optional()
    .transform((v) => v ?? DEFAULT_NIGHTLY_CRON_EXPR),
  TIER2_QUEUE_POLL_MS: intFromEnv(60_000),
  ONE_SHOT: boolFromEnv(false),
  ENABLE_CRON: boolFromEnv(true),
  ENABLE_TIER2_QUEUE: boolFromEnv(true),
  /** Optional postgres URL — when absent, the caller must inject a db. */
  DATABASE_URL: z.string().min(8).optional(),
  /** Optional redis URL — used for distributed idempotency. */
  REDIS_URL: z.string().min(8).optional(),
  /** HMAC secret id for audit chain entries (rotation-aware). */
  AUDIT_SECRET_ID: z.string().min(1).optional(),
  AUDIT_SECRET_VALUE: z.string().min(1).optional(),
});

export type WorkerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = ConfigSchema.safeParse({
    ROLLING_WINDOW_DAYS: env['DOC_EVO_ROLLING_WINDOW_DAYS'],
    LOCK_SUSTAINED_DAYS: env['DOC_EVO_LOCK_SUSTAINED_DAYS'],
    REGULATOR_FLAG_LOOKBACK_DAYS: env['DOC_EVO_REGULATOR_FLAG_LOOKBACK_DAYS'],
    LOCK_ACCEPTANCE_THRESHOLD: env['DOC_EVO_LOCK_ACCEPTANCE_THRESHOLD'],
    LOCK_REVISION_CEILING: env['DOC_EVO_LOCK_REVISION_CEILING'],
    IMPROVE_ACCEPTANCE_CEILING: env['DOC_EVO_IMPROVE_ACCEPTANCE_CEILING'],
    IMPROVE_SECTION_REVISION_THRESHOLD:
      env['DOC_EVO_IMPROVE_SECTION_REVISION_THRESHOLD'],
    NIGHTLY_CRON_EXPR: env['DOC_EVO_NIGHTLY_CRON_EXPR'],
    TIER2_QUEUE_POLL_MS: env['DOC_EVO_TIER2_QUEUE_POLL_MS'],
    ONE_SHOT: env['DOC_EVO_ONE_SHOT'],
    ENABLE_CRON: env['DOC_EVO_ENABLE_CRON'],
    ENABLE_TIER2_QUEUE: env['DOC_EVO_ENABLE_TIER2_QUEUE'],
    DATABASE_URL: env['DATABASE_URL'],
    REDIS_URL: env['REDIS_URL'],
    AUDIT_SECRET_ID: env['DOC_EVO_AUDIT_SECRET_ID'],
    AUDIT_SECRET_VALUE: env['DOC_EVO_AUDIT_SECRET_VALUE'],
  });
  if (!parsed.success) {
    throw new Error(
      `doc-evolution-worker config invalid: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
