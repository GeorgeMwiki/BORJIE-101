/**
 * Routing-override schemas + locked-category set.
 *
 * Ported from LITFIN `routing-config.ts` (Zod-validated) but
 * implemented as plain TypeScript guard + manual validation to avoid
 * adding zod as a runtime dep to this package.
 *
 * Locked categories cannot be reassigned by an admin — the alternate
 * providers either don't ship the API or the legal-significance bar
 * is too high to leave the choice to ops.
 */

import { MODEL_FAMILIES, type ModelFamily } from '../dynamic-registry/baselines.js';

// ─────────────────────── Locked categories ─────────────────────────

/**
 * Categories that admins CANNOT override. Either:
 *   - the alternate providers don't implement the capability (voice
 *     transcribe / image generation), OR
 *   - the legal-significance bar is too high to leave to ops
 *     (lease_drafting / eviction_notice / financial_advice /
 *     legal_review). The min-tier policy already pins these to opus.
 */
export const LOCKED_CATEGORIES: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    'lease_drafting',
    'eviction_notice',
    'financial_advice',
    'legal_review',
    'voice_transcribe',
    'image_generation',
  ]),
) as ReadonlySet<string>;

// ───────────────────────── Schema types ────────────────────────────

export interface RoutingOverrideEntry {
  readonly tenantId: string;
  readonly taskCategory: string;
  readonly family: ModelFamily;
  readonly reason: string;
  readonly createdAtMs: number;
}

export interface RoutingOverridePatch {
  readonly tenantId: string;
  readonly taskCategory: string;
  readonly family: ModelFamily;
  readonly reason: string;
}

export interface SchemaResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly issues?: ReadonlyArray<string>;
}

// ───────────────────────── Validators ──────────────────────────────

function nonEmptyString(value: unknown, fieldName: string): string | null {
  if (typeof value !== 'string') return `${fieldName}: must be a string`;
  if (value.trim().length === 0) return `${fieldName}: must be non-empty`;
  return null;
}

function isKnownFamily(value: unknown): value is ModelFamily {
  return (
    typeof value === 'string' &&
    (MODEL_FAMILIES as readonly string[]).includes(value)
  );
}

/**
 * Validate a routing-override entry as it would be persisted in the
 * DB (with `createdAtMs` stamped).
 */
export const routingOverrideEntrySchema = {
  parse(input: unknown): SchemaResult<RoutingOverrideEntry> {
    if (!input || typeof input !== 'object') {
      return { success: false, issues: ['must be an object'] };
    }
    const v = input as Record<string, unknown>;
    const issues: string[] = [];
    const errTenant = nonEmptyString(v.tenantId, 'tenantId');
    if (errTenant) issues.push(errTenant);
    const errCat = nonEmptyString(v.taskCategory, 'taskCategory');
    if (errCat) issues.push(errCat);
    if (!isKnownFamily(v.family)) {
      issues.push(`family: must be one of ${MODEL_FAMILIES.join(', ')}`);
    }
    const errReason = nonEmptyString(v.reason, 'reason');
    if (errReason) issues.push(errReason);
    if (typeof v.createdAtMs !== 'number' || !Number.isFinite(v.createdAtMs)) {
      issues.push('createdAtMs: must be a finite number');
    }
    if (issues.length > 0) return { success: false, issues };
    if (LOCKED_CATEGORIES.has(v.taskCategory as string)) {
      return {
        success: false,
        issues: [`taskCategory: "${v.taskCategory}" is locked and cannot be overridden`],
      };
    }
    return {
      success: true,
      data: {
        tenantId: v.tenantId as string,
        taskCategory: v.taskCategory as string,
        family: v.family as ModelFamily,
        reason: v.reason as string,
        createdAtMs: v.createdAtMs as number,
      },
    };
  },
};

/**
 * Validate an inbound PATCH (no `createdAtMs` — server stamps it).
 */
export const routingOverridePatchSchema = {
  parse(input: unknown): SchemaResult<RoutingOverridePatch> {
    if (!input || typeof input !== 'object') {
      return { success: false, issues: ['must be an object'] };
    }
    const v = input as Record<string, unknown>;
    const issues: string[] = [];
    const errTenant = nonEmptyString(v.tenantId, 'tenantId');
    if (errTenant) issues.push(errTenant);
    const errCat = nonEmptyString(v.taskCategory, 'taskCategory');
    if (errCat) issues.push(errCat);
    if (!isKnownFamily(v.family)) {
      issues.push(`family: must be one of ${MODEL_FAMILIES.join(', ')}`);
    }
    const errReason = nonEmptyString(v.reason, 'reason');
    if (errReason) issues.push(errReason);
    if (issues.length > 0) return { success: false, issues };
    if (LOCKED_CATEGORIES.has(v.taskCategory as string)) {
      return {
        success: false,
        issues: [`taskCategory: "${v.taskCategory}" is locked and cannot be overridden`],
      };
    }
    return {
      success: true,
      data: {
        tenantId: v.tenantId as string,
        taskCategory: v.taskCategory as string,
        family: v.family as ModelFamily,
        reason: v.reason as string,
      },
    };
  },
};
