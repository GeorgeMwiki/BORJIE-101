/**
 * Cap policy DSL — Zod-validated factory for TenantAutonomyCap.
 *
 * Keep the DSL thin: a single typed schema with sane defaults. All raises
 * funnel through `parseCapPolicy` so a malformed cap can never enter the
 * runtime (the kernel must never raise its own ceiling).
 */

import { z } from 'zod';
import type { RiskTier, TenantAutonomyCap } from '../types.js';

const RISK_TIERS = [
  'read',
  'mutate',
  'communicate',
  'billing',
  'destroy',
  'sovereign',
] as const satisfies readonly RiskTier[];

const perToolTierCapsSchema = z
  .record(z.enum(RISK_TIERS), z.union([z.number().int().min(0), z.null()]))
  .default({});

const perSubMdCapsSchema = z
  .record(
    z.string().min(1),
    z.object({
      maxMutationsPerDay: z.number().int().min(0),
      maxCostUsdCentsPerDay: z.number().int().min(0),
    }),
  )
  .default({});

/**
 * H8 — IANA timezone name (Area/Location form). We do not enumerate all
 * 350+ entries; we accept any string matching the IANA Area/Location
 * pattern. Continents include Africa, America, Asia, Australia, Europe,
 * Pacific, Indian, Atlantic. The regex is intentionally permissive so a
 * Nigerian tenant can set `Africa/Lagos`, a Tanzanian `Africa/Dar_es_Salaam`,
 * a Kenyan `Africa/Nairobi`, etc.
 */
const ianaTimezoneSchema = z
  .string()
  .regex(
    /^[A-Z][A-Za-z_]+\/[A-Z][A-Za-z_/-]+$/,
    'must be an IANA timezone name like Africa/Nairobi',
  );

/**
 * Public schema. Used by the cap-policy CLI / admin UI to validate writes
 * before they hit the `tenant_autonomy_caps` row.
 */
export const capPolicySchema = z
  .object({
    tenantId: z.string().uuid(),
    maxAutonomousMutationsPerDay: z.number().int().min(0).default(50),
    maxAutonomousCostUsdCentsPerDay: z.number().int().min(0).default(5_000_00),
    perToolTierCaps: perToolTierCapsSchema,
    perSubMdCaps: perSubMdCapsSchema,
    slowdownAt: z.number().gt(0).lte(1).default(0.8),
    hardStopAt: z.number().gt(0).lte(1).default(1.0),
    /**
     * H8 — IANA timezone for the rolling-state adapter's "today" boundary.
     * Optional for backwards compatibility; new tenants SHOULD specify it.
     * See cap-evaluator.ts JSDoc for the full timezone contract.
     */
    timezone: ianaTimezoneSchema.optional(),
    updatedAt: z.string().datetime().default(() => new Date().toISOString()),
    updatedBy: z.string().min(1),
  })
  .refine((value) => value.slowdownAt <= value.hardStopAt, {
    message: 'slowdownAt must be <= hardStopAt',
    path: ['slowdownAt'],
  });

export type CapPolicyInput = z.input<typeof capPolicySchema>;

/**
 * Validate a cap-policy input and return a frozen TenantAutonomyCap.
 * Throws ZodError if the input is malformed.
 */
export function parseCapPolicy(input: CapPolicyInput): TenantAutonomyCap {
  const parsed = capPolicySchema.parse(input);
  // Freeze nested records to enforce the immutability contract on returned
  // value (no mutation downstream).
  const cap: TenantAutonomyCap = {
    tenantId: parsed.tenantId,
    maxAutonomousMutationsPerDay: parsed.maxAutonomousMutationsPerDay,
    maxAutonomousCostUsdCentsPerDay: parsed.maxAutonomousCostUsdCentsPerDay,
    perToolTierCaps: Object.freeze({ ...parsed.perToolTierCaps }),
    perSubMdCaps: Object.freeze({ ...parsed.perSubMdCaps }),
    slowdownAt: parsed.slowdownAt,
    hardStopAt: parsed.hardStopAt,
    ...(parsed.timezone !== undefined ? { timezone: parsed.timezone } : {}),
    updatedAt: parsed.updatedAt,
    updatedBy: parsed.updatedBy,
  };
  return Object.freeze(cap);
}

/**
 * Platform-default cap for tenants who have not customised. Conservative
 * by intent: better to slow down a happy tenant than fund a runaway.
 */
export function defaultCap(
  tenantId: string,
  updatedBy = 'platform-default',
): TenantAutonomyCap {
  return parseCapPolicy({
    tenantId,
    maxAutonomousMutationsPerDay: 50,
    maxAutonomousCostUsdCentsPerDay: 5_000_00,
    perToolTierCaps: { destroy: 0, sovereign: 0, billing: 5 },
    perSubMdCaps: {},
    slowdownAt: 0.8,
    hardStopAt: 1.0,
    updatedBy,
  });
}
