/**
 * High-Stakes Catalogue — Wave 28 Agent THINK.
 *
 * Canonical list of action names that unambiguously warrant deliberate
 * deep reasoning. Callers rarely want to hand-craft a `DecisionContext`
 * from scratch; they pass an `actionType` string and this module returns
 * the field defaults (irreversible, regulated, affectsHousing, etc.)
 * pre-populated so the classifier can do its job.
 *
 * The catalogue is exported as a typed constant so ops/UI can render
 * "what is Mr. Mwikila treating as high-stakes today?" without a
 * round-trip to the classifier itself.
 */

import type { AutonomyDomain } from '../autonomy/types.js';
import type { DecisionContext, DecisionStakes } from './types.js';

// ---------------------------------------------------------------------------
// Catalogue entry shape
// ---------------------------------------------------------------------------

export interface HighStakesCatalogueEntry {
  /** Stable action name. Canonical — downstream services match on this. */
  readonly actionName: string;
  readonly domain: AutonomyDomain;
  readonly description: string;
  readonly expectedStakes: DecisionStakes;
  readonly defaults: Omit<DecisionContext, 'actionType' | 'correlationId'>;
}

// ---------------------------------------------------------------------------
// Catalogue — sorted by domain for easier UI rendering.
// ---------------------------------------------------------------------------

export const HIGH_STAKES_CATALOGUE: ReadonlyArray<HighStakesCatalogueEntry> =
  Object.freeze([
    // ---------- legal_proceedings ----------
    {
      actionName: 'eviction.file_notice',
      domain: 'legal_proceedings',
      description:
        'File an eviction notice against a tenant. Tribunal-adjacent, irreversible, directly threatens housing.',
      expectedStakes: 'critical',
      defaults: {
        domain: 'legal_proceedings',
        reversible: false,
        regulated: true,
        affectsHousing: true,
        publiclyVisible: false,
        counterpartyIsVulnerable: false,
      },
    },
    {
      actionName: 'tribunal.submit_filing',
      domain: 'legal_proceedings',
      description:
        'Submit a filing to the housing tribunal. Regulated, irreversible once filed.',
      expectedStakes: 'critical',
      defaults: {
        domain: 'legal_proceedings',
        reversible: false,
        regulated: true,
        affectsHousing: true,
        publiclyVisible: true,
        counterpartyIsVulnerable: false,
      },
    },
    {
      actionName: 'tenant.blacklist',
      domain: 'legal_proceedings',
      description:
        'Add tenant to shared blacklist / negative-residence registry. Effectively cuts off future housing.',
      expectedStakes: 'critical',
      defaults: {
        domain: 'legal_proceedings',
        reversible: false,
        regulated: true,
        affectsHousing: true,
        publiclyVisible: true,
        counterpartyIsVulnerable: false,
      },
    },
    {
      actionName: 'credit_report.submit_negative',
      domain: 'legal_proceedings',
      description:
        'Report tenant to the credit bureau for arrears. Regulated, hard to reverse.',
      expectedStakes: 'high',
      defaults: {
        domain: 'legal_proceedings',
        reversible: false,
        regulated: true,
        affectsHousing: false,
        publiclyVisible: true,
        counterpartyIsVulnerable: false,
      },
    },

    // ---------- leasing ----------
    {
      actionName: 'lease.terminate',
      domain: 'leasing',
      description:
        'Terminate a lease before its scheduled end date. Irreversible; threatens housing.',
      expectedStakes: 'critical',
      defaults: {
        domain: 'leasing',
        reversible: false,
        regulated: true,
        affectsHousing: true,
        publiclyVisible: false,
        counterpartyIsVulnerable: false,
      },
    },
    {
      actionName: 'lease.rent_increase_above_policy',
      domain: 'leasing',
      description:
        'Apply a rent increase above the tenant-level autonomy policy. Regulated in many jurisdictions.',
      expectedStakes: 'high',
      defaults: {
        domain: 'leasing',
        reversible: true,
        regulated: true,
        affectsHousing: true,
        publiclyVisible: false,
        counterpartyIsVulnerable: false,
      },
    },

    // ---------- finance ----------
    {
      actionName: 'finance.refund_above_threshold',
      domain: 'finance',
      description:
        'Issue a refund above the large-refund threshold. Irreversible money movement.',
      expectedStakes: 'high',
      defaults: {
        domain: 'finance',
        reversible: false,
        regulated: false,
        affectsHousing: false,
        publiclyVisible: false,
        counterpartyIsVulnerable: false,
      },
    },
    {
      actionName: 'finance.security_deposit_writeoff',
      domain: 'finance',
      description:
        'Write off a tenant security deposit above threshold (deduct without consent signature).',
      expectedStakes: 'high',
      defaults: {
        domain: 'finance',
        reversible: false,
        regulated: true,
        affectsHousing: false,
        publiclyVisible: false,
        counterpartyIsVulnerable: false,
      },
    },

    // ---------- procurement ----------
    {
      actionName: 'procurement.vendor_payout_above_threshold',
      domain: 'procurement',
      description:
        'Release vendor payout above the vendor-payout threshold. Irreversible money movement.',
      expectedStakes: 'high',
      defaults: {
        domain: 'procurement',
        reversible: false,
        regulated: false,
        affectsHousing: false,
        publiclyVisible: false,
        counterpartyIsVulnerable: false,
      },
    },
  ]);

export const HIGH_STAKES_CATALOGUE_COUNT = HIGH_STAKES_CATALOGUE.length;

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const CATALOGUE_BY_ACTION: ReadonlyMap<string, HighStakesCatalogueEntry> =
  new Map(HIGH_STAKES_CATALOGUE.map((e) => [e.actionName, e]));

/**
 * Return a `DecisionContext` shape pre-populated from the catalogue, given
 * a stable action name. Callers merge in any case-specific fields
 * (amountMinorUnits, counterpartyIsVulnerable) before handing it to the
 * classifier.
 *
 * Returns a `Partial<DecisionContext>` so unknown action names yield just
 * `{ actionType }` — letting the caller provide sensible defaults
 * themselves rather than silently mis-classifying.
 */
export function classifyByActionName(
  actionName: string,
): Partial<DecisionContext> {
  const entry = CATALOGUE_BY_ACTION.get(actionName);
  if (!entry) {
    return { actionType: actionName };
  }
  return {
    actionType: actionName,
    ...entry.defaults,
  };
}

/** Strict variant — throws for unknown action names. Useful inside tests. */
export function requireCatalogueEntry(
  actionName: string,
): HighStakesCatalogueEntry {
  const entry = CATALOGUE_BY_ACTION.get(actionName);
  if (!entry) {
    throw new Error(
      `extended-thinking: no high-stakes catalogue entry for "${actionName}"`,
    );
  }
  return entry;
}

export function listCatalogueEntries(): ReadonlyArray<HighStakesCatalogueEntry> {
  return HIGH_STAKES_CATALOGUE;
}
