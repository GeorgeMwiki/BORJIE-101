/**
 * Per-tab-type config validator (CT-4).
 *
 * The brain emits arbitrary JSON in `<tab_spawn config='...'>` /
 * `<tab_update config='...'>` — we validate it against a curated
 * per-type schema so:
 *
 *   1. Hallucinated fields (e.g. `mineralKind: "platinum"` on a
 *      `compliance` tab) are dropped + Pino-warned for the eval loop.
 *   2. The FE receives a guaranteed-shape config; no defensive `?.`
 *      gymnastics inside panels.
 *   3. We can extend each type's schema independently as panel teams
 *      register richer config (e.g. `groupBy`, `window`, `since`).
 *
 * The default schema (for tab types without a dedicated schema yet) is
 * a permissive record with bounded depth — protects against MB-scale
 * brain emissions while letting new tab kinds work without registry
 * changes.
 *
 * Validation policy:
 *   - Unknown top-level keys → dropped + warned (not rejected; the
 *     surviving keys still produce a valid config so the owner sees
 *     the tab open with partial scope).
 *   - Value type mismatches → dropped + warned.
 *   - Total resulting config > 4 KB JSON → rejected (the FE state
 *     blob is capped at 64 KB; per-tab budget is ~2 KB).
 */

import { z } from 'zod';

import {
  OWNER_OS_TAB_TYPES,
  type OwnerOSTabType,
} from '@borjie/owner-os-tabs';

const MAX_CONFIG_BYTES = 4 * 1024;

// ─── Per-type schemas ───────────────────────────────────────────────
//
// Each schema is INTENTIONALLY permissive on optional fields — the
// goal is to drop hallucinated keys, not to gate features behind
// over-strict validation. Add a new key here when a panel teaches the
// brain about it (see brain-teach prompt for the canonical list).

const sharedScopeFields = {
  focus: z.string().min(1).max(200).optional(),
  siteId: z.string().min(1).max(120).optional(),
  licenceId: z.string().min(1).max(120).optional(),
  employeeId: z.string().min(1).max(120).optional(),
  counterpartyId: z.string().min(1).max(120).optional(),
  documentId: z.string().min(1).max(120).optional(),
  locale: z.enum(['sw', 'en']).optional(),
  since: z.string().min(1).max(40).optional(),
  until: z.string().min(1).max(40).optional(),
  window: z.enum(['day', 'week', 'month', 'quarter', 'year', 'ytd', 'all']).optional(),
  groupBy: z
    .enum(['region', 'site', 'mineral', 'counterparty', 'employee', 'shift', 'month', 'quarter'])
    .optional(),
};

const financeConfigSchema = z
  .object({
    ...sharedScopeFields,
    mineralKind: z.enum(['gold', 'gemstone', 'industrial', 'coal', 'salt', 'all']).optional(),
    currency: z.enum(['TZS', 'USD', 'KES', 'EUR']).optional(),
  })
  .strict();

const complianceConfigSchema = z
  .object({
    ...sharedScopeFields,
    regulator: z.enum(['nemc', 'mining_commission', 'bot', 'tra', 'brela', 'tmaa', 'pccb', 'eiti']).optional(),
    deadlineHorizonDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

const workforceConfigSchema = z
  .object({
    ...sharedScopeFields,
    shiftKind: z.enum(['day', 'night', 'rotation', 'all']).optional(),
    certificationKind: z.string().min(1).max(80).optional(),
  })
  .strict();

const marketplaceConfigSchema = z
  .object({
    ...sharedScopeFields,
    parcelGrade: z.string().min(1).max(40).optional(),
    buyerSegment: z.enum(['lbma', 'ica', 'domestic', 'cooperative']).optional(),
  })
  .strict();

const treasuryConfigSchema = z
  .object({
    ...sharedScopeFields,
    hedgeKind: z.enum(['gold_window', 'fx_swap', 'futures', 'spot']).optional(),
  })
  .strict();

const sitesConfigSchema = z
  .object({
    ...sharedScopeFields,
    geoCellId: z.string().min(1).max(60).optional(),
  })
  .strict();

const riskConfigSchema = z
  .object({
    ...sharedScopeFields,
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    category: z.string().min(1).max(80).optional(),
  })
  .strict();

const auditConfigSchema = z
  .object({
    ...sharedScopeFields,
    chainKind: z.enum(['ai_audit', 'decisions', 'handoffs', 'four_eye']).optional(),
  })
  .strict();

const licencesConfigSchema = z
  .object({
    ...sharedScopeFields,
    licenceKind: z.enum(['pml', 'ml', 'sml', 'eia', 'brela', 'bot_gold', 'ica_cert']).optional(),
  })
  .strict();

const reportsConfigSchema = z
  .object({
    ...sharedScopeFields,
    reportKind: z
      .enum(['royalty', 'production', 'safety', 'esg', 'workforce', 'treasury', 'sales'])
      .optional(),
  })
  .strict();

// Default — any tab type without a curated schema. Permissive but
// bounded; rejects only obviously wrong shapes (array root, gigantic
// strings, deep nested objects).

const defaultConfigSchema = z
  .record(
    z.string().min(1).max(80),
    z.union([
      z.string().max(500),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.union([z.string().max(500), z.number(), z.boolean()])).max(20),
      z.record(z.string().max(80), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])),
    ]),
  )
  .refine(
    (v) => !Array.isArray(v),
    'config must be an object, not an array',
  );

const PER_TYPE_SCHEMAS: Partial<Record<OwnerOSTabType, z.ZodTypeAny>> = {
  finance: financeConfigSchema,
  accounting: financeConfigSchema,
  compliance: complianceConfigSchema,
  workforce: workforceConfigSchema,
  hr: workforceConfigSchema,
  marketplace: marketplaceConfigSchema,
  treasury: treasuryConfigSchema,
  sites: sitesConfigSchema,
  risk: riskConfigSchema,
  audit: auditConfigSchema,
  licences: licencesConfigSchema,
  reports: reportsConfigSchema,
};

// ─── Public validator ───────────────────────────────────────────────

export interface ValidateConfigOk {
  readonly ok: true;
  /** The validated config (unknown keys dropped, defaults applied). */
  readonly config: Record<string, unknown>;
  /** Any keys the brain emitted that we dropped — surfaced as warn. */
  readonly droppedKeys: ReadonlyArray<string>;
}

export interface ValidateConfigErr {
  readonly ok: false;
  /** Human-readable reason for the rejection (rendered to the owner). */
  readonly reasonEn: string;
  readonly reasonSw: string;
  /** Detail for the Pino warn — never shown to the owner. */
  readonly detail: string;
}

export type ValidateConfigResult = ValidateConfigOk | ValidateConfigErr;

/**
 * Validate `raw` against the schema for `tabType`. Falls back to the
 * default schema when no curated schema exists for that type.
 */
export function validateTabConfig(
  tabType: string,
  raw: unknown,
): ValidateConfigResult {
  if (!(OWNER_OS_TAB_TYPES as ReadonlyArray<string>).includes(tabType)) {
    return {
      ok: false,
      reasonEn: `Unknown tab type "${tabType}"`,
      reasonSw: `Tab type "${tabType}" haijulikani`,
      detail: `tabType not in OWNER_OS_TAB_TYPES`,
    };
  }
  // Pre-check: object shape only.
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      reasonEn: 'Config must be a JSON object',
      reasonSw: 'Config lazima iwe JSON object',
      detail: `raw shape: ${typeof raw}, isArray=${Array.isArray(raw)}`,
    };
  }
  // Size cap.
  let asJson: string;
  try {
    asJson = JSON.stringify(raw);
  } catch (err) {
    return {
      ok: false,
      reasonEn: 'Config contains values that cannot be serialised',
      reasonSw: 'Config ina thamani zisizoweza kuhifadhiwa',
      detail: err instanceof Error ? err.message : 'JSON.stringify failed',
    };
  }
  if (asJson.length > MAX_CONFIG_BYTES) {
    return {
      ok: false,
      reasonEn: `Config exceeds ${MAX_CONFIG_BYTES} byte limit`,
      reasonSw: `Config inazidi kiwango cha bytes ${MAX_CONFIG_BYTES}`,
      detail: `bytes=${asJson.length}`,
    };
  }

  const schema =
    PER_TYPE_SCHEMAS[tabType as OwnerOSTabType] ?? defaultConfigSchema;
  const parsed = schema.safeParse(raw);

  if (parsed.success) {
    return {
      ok: true,
      config: parsed.data as Record<string, unknown>,
      droppedKeys: [],
    };
  }

  // Strict schema failures usually mean unknown keys OR invalid values
  // on known keys. Salvage: strip unknown keys AND validate each known
  // key in isolation, dropping the ones with invalid values. Surface
  // every drop for the Pino warn / eval loop.
  if (schema instanceof z.ZodObject) {
    const shape = (schema.shape ?? {}) as Record<string, z.ZodTypeAny>;
    const allowedKeys = Object.keys(shape);
    const rawObj = raw as Record<string, unknown>;
    const salvaged: Record<string, unknown> = {};
    const dropped: string[] = [];
    for (const k of Object.keys(rawObj)) {
      if (!allowedKeys.includes(k)) {
        dropped.push(k);
        continue;
      }
      // Validate the value against THIS key's own schema in isolation.
      const oneSchema = shape[k];
      if (!oneSchema) {
        dropped.push(k);
        continue;
      }
      const oneResult = oneSchema.safeParse(rawObj[k]);
      if (oneResult.success) {
        salvaged[k] = oneResult.data;
      } else {
        dropped.push(k);
      }
    }
    const retry = schema.safeParse(salvaged);
    if (retry.success) {
      return {
        ok: true,
        config: retry.data as Record<string, unknown>,
        droppedKeys: dropped,
      };
    }
  }

  return {
    ok: false,
    reasonEn: 'Config does not match the expected shape for this tab type',
    reasonSw: 'Config haifanani na muundo unaohitajika kwa tab hii',
    detail: parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; '),
  };
}
