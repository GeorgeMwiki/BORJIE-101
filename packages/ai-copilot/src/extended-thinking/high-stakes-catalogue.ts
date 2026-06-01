/**
 * High-Stakes Catalogue — Wave 28 Agent THINK.
 *
 * Canonical list of action names that unambiguously warrant deliberate
 * deep reasoning. Callers rarely want to hand-craft a `DecisionContext`
 * from scratch; they pass an `actionType` string and this module returns
 * the field defaults (irreversible, regulated, affectsLivelihoods, etc.)
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
      actionName: 'licence_suspension.file_notice',
      domain: 'legal_proceedings',
      description:
        'File a licence-suspension / incursion-response notice against an operator. Mining-Commission-adjacent, irreversible, directly threatens livelihoods.',
      expectedStakes: 'critical',
      defaults: {
        domain: 'legal_proceedings',
        reversible: false,
        regulated: true,
        affectsLivelihoods: true,
        publiclyVisible: false,
        counterpartyIsVulnerable: false,
      },
    },
    {
      actionName: 'tribunal.submit_filing',
      domain: 'legal_proceedings',
      description:
        'Submit a filing to the Mining Commission tribunal. Regulated, irreversible once filed.',
      expectedStakes: 'critical',
      defaults: {
        domain: 'legal_proceedings',
        reversible: false,
        regulated: true,
        affectsLivelihoods: true,
        publiclyVisible: true,
        counterpartyIsVulnerable: false,
      },
    },
    {
      actionName: 'counterparty.blacklist',
      domain: 'legal_proceedings',
      description:
        'Add counterparty to shared blacklist / negative-trade registry. Effectively cuts off future offtake.',
      expectedStakes: 'critical',
      defaults: {
        domain: 'legal_proceedings',
        reversible: false,
        regulated: true,
        affectsLivelihoods: true,
        publiclyVisible: true,
        counterpartyIsVulnerable: false,
      },
    },
    {
      actionName: 'credit_report.submit_negative',
      domain: 'legal_proceedings',
      description:
        'Report buyer to the credit bureau for outstanding royalties. Regulated, hard to reverse.',
      expectedStakes: 'high',
      defaults: {
        domain: 'legal_proceedings',
        reversible: false,
        regulated: true,
        affectsLivelihoods: false,
        publiclyVisible: true,
        counterpartyIsVulnerable: false,
      },
    },

    // ---------- offtake ----------
    {
      actionName: 'offtake.terminate',
      domain: 'offtake',
      description:
        'Terminate an offtake / supply agreement before its scheduled end date. Irreversible; threatens livelihoods.',
      expectedStakes: 'critical',
      defaults: {
        domain: 'offtake',
        reversible: false,
        regulated: true,
        affectsLivelihoods: true,
        publiclyVisible: false,
        counterpartyIsVulnerable: false,
      },
    },
    {
      actionName: 'offtake.price_increase_above_policy',
      domain: 'offtake',
      description:
        'Apply a price increase above the tenant-level autonomy policy. Regulated in many jurisdictions.',
      expectedStakes: 'high',
      defaults: {
        domain: 'offtake',
        reversible: true,
        regulated: true,
        affectsLivelihoods: true,
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
        affectsLivelihoods: false,
        publiclyVisible: false,
        counterpartyIsVulnerable: false,
      },
    },
    {
      actionName: 'finance.performance_bond_writeoff',
      domain: 'finance',
      description:
        'Write off a buyer performance bond above threshold (deduct without consent signature).',
      expectedStakes: 'high',
      defaults: {
        domain: 'finance',
        reversible: false,
        regulated: true,
        affectsLivelihoods: false,
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
        affectsLivelihoods: false,
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
