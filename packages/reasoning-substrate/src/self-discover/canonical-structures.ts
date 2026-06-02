/**
 * Canonical reasoning structures for BORJIE task classes.
 *
 * These are the seed structures the L1 audit §7 hand-derives for the
 * licence-suspension-evaluation flow. Each is a valid ReasoningStructure
 * that could have been emitted by IMPLEMENT, and serves three roles:
 *
 *   1. Bootstrapping the TemporalKG cache before any live discovery
 *      has happened (warm start).
 *   2. Reference structures the L1 §7 hand-derives for the
 *      licence-suspension flow, included here as executable JSON
 *      instead of prose.
 *   3. Test fixtures for cache-hit / cache-invalidation tests.
 *
 * To regenerate from the audit, see comments above each structure.
 */

import {
  REASONING_STRUCTURE_SCHEMA_VERSION,
  type ReasoningStructure,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Licence suspension (TZ-DSM) — the L1 audit §7 canonical example.
// ─────────────────────────────────────────────────────────────────────

export const LICENCE_SUSPENSION_TZ_DSM_STRUCTURE: ReasoningStructure = {
  schemaVersion: REASONING_STRUCTURE_SCHEMA_VERSION,
  taskClass: 'licence-suspension',
  jurisdiction: 'TZ-DSM',
  discoveredAt: '2026-05-19T00:00:00.000Z',
  structureId: 'rs_seed_licence_suspension_tz_dsm_v1',
  selectedPrimitives: [
    'gather-relevant-facts',
    'check-payment-history',
    'identify-relevant-rules',
    'apply-tz-mining-act',
    'check-mediation-clause',
    'consider-alternatives',
    'risks-and-drawbacks',
    'propose-and-verify',
    'check-pii-boundary',
    'check-currency-chain',
    'estimate-uncertainty',
    'check-output-format',
  ],
  adaptedNarrative:
    '[gather-relevant-facts] Pull counterparty identity, offtake, and jurisdiction. ' +
    '[check-payment-history] Verify the outstanding-royalties claim against query_royalty_history. ' +
    '[identify-relevant-rules] [apply-tz-mining-act] Apply the 14-day notice requirement and any cure period. ' +
    '[check-mediation-clause] If mediation_opt_in is true, licence suspension is blocked until mediation is offered. ' +
    '[consider-alternatives] Enumerate alternatives — issue notice, offer payment plan, escalate to mediator, write-off & non-renew. ' +
    '[risks-and-drawbacks] Weigh each alternative against the owner\'s objective and the counterparty\'s vulnerability. ' +
    '[propose-and-verify] Draft the recommended action, then verify against the constraints. ' +
    '[check-pii-boundary] Ensure no PII from other tenants leaks. ' +
    '[check-currency-chain] Convert amounts into the counterparty\'s display currency. ' +
    '[estimate-uncertainty] Surface a confidence score. ' +
    '[check-output-format] Confirm the response matches the required JSON contract.',
  steps: [
    {
      stepId: 's1',
      primitive: 'gather-relevant-facts',
      dependsOn: [],
      outputSchema: {
        counterpartyId: 'string',
        offtakeId: 'string',
        jurisdiction: 'string',
        currencyPref: 'string',
      },
      narrative: 'Load counterparty identity, offtake, and currency preference from memory + tools.',
    },
    {
      stepId: 's2',
      primitive: 'check-payment-history',
      dependsOn: ['s1'],
      outputSchema: {
        missedPayments: 'number',
        unpaidAmountMinorUnits: 'number',
        lastPaidAt: 'string|null',
      },
      narrative: 'Pull the 12-month payment history to verify the outstanding-royalties claim.',
    },
    {
      stepId: 's3',
      primitive: 'identify-relevant-rules',
      dependsOn: ['s1'],
      outputSchema: {
        statute: 'string',
        noticeRequiredDays: 'number',
        curePeriodDays: 'number',
      },
      narrative: 'Identify the statute, required notice period, and any cure period.',
    },
    {
      stepId: 's4',
      primitive: 'apply-tz-mining-act',
      dependsOn: ['s2', 's3'],
      outputSchema: {
        canSuspend: 'boolean',
        rationale: 'string',
      },
      narrative: 'Apply TZ Mining Act §X — 14-day notice + cure period — to the facts.',
    },
    {
      stepId: 's5',
      primitive: 'check-mediation-clause',
      dependsOn: ['s1'],
      outputSchema: {
        mediationOptIn: 'boolean',
        mediationInitiated: 'boolean',
      },
      narrative: 'Check whether the offtake has mediation opt-in and whether it has been initiated.',
    },
    {
      stepId: 's6',
      primitive: 'consider-alternatives',
      dependsOn: ['s4', 's5'],
      outputSchema: {
        alternatives: 'string[]',
      },
      narrative: 'Enumerate alternatives — notice, payment plan, mediator, write-off.',
    },
    {
      stepId: 's7',
      primitive: 'risks-and-drawbacks',
      dependsOn: ['s6'],
      outputSchema: {
        risks: 'Record<string, string>',
      },
      narrative: 'Weigh risks of each alternative against owner objectives + counterparty vulnerability.',
    },
    {
      stepId: 's8',
      primitive: 'propose-and-verify',
      dependsOn: ['s7'],
      outputSchema: {
        recommendedAction: 'string',
        draftLetter: 'string',
      },
      narrative: 'Draft the recommended action — likely a Notice of Mediation Offer here — and verify it against constraints.',
    },
    {
      stepId: 's9',
      primitive: 'check-pii-boundary',
      dependsOn: ['s8'],
      outputSchema: {
        piiBoundaryViolations: 'string[]',
      },
      narrative: 'Confirm the draft contains no PII from other tenants.',
    },
    {
      stepId: 's10',
      primitive: 'check-currency-chain',
      dependsOn: ['s8'],
      outputSchema: {
        displayCurrency: 'string',
        amountInDisplayCurrency: 'number',
      },
      narrative: 'Convert all amounts to the counterparty\'s display currency via currency_rates.',
    },
    {
      stepId: 's11',
      primitive: 'estimate-uncertainty',
      dependsOn: ['s8', 's4', 's5'],
      outputSchema: {
        confidence: 'number',
      },
      narrative: 'Estimate the confidence in the recommendation (0–1) and surface it explicitly.',
    },
    {
      stepId: 's12',
      primitive: 'check-output-format',
      dependsOn: ['s8', 's9', 's10', 's11'],
      outputSchema: {
        finalPayload: 'object',
      },
      narrative: 'Validate the final output against the licence-suspension-decision JSON contract.',
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// Counterparty Dispute (GLOBAL) — simpler 5-step structure.
// ─────────────────────────────────────────────────────────────────────

export const COUNTERPARTY_DISPUTE_GLOBAL_STRUCTURE: ReasoningStructure = {
  schemaVersion: REASONING_STRUCTURE_SCHEMA_VERSION,
  taskClass: 'counterparty-dispute',
  jurisdiction: 'GLOBAL',
  discoveredAt: '2026-05-19T00:00:00.000Z',
  structureId: 'rs_seed_counterparty_dispute_v1',
  selectedPrimitives: [
    'gather-relevant-facts',
    'identify-core-issue',
    'consider-alternatives',
    'propose-and-verify',
    'check-pii-boundary',
  ],
  adaptedNarrative:
    '[gather-relevant-facts] Pull the dispute facts and prior messages. ' +
    '[identify-core-issue] Identify what the counterparty is actually disputing. ' +
    '[consider-alternatives] Propose 2-3 resolution paths. ' +
    '[propose-and-verify] Draft the response and verify it stays neutral. ' +
    '[check-pii-boundary] Confirm no PII from other tenants leaks.',
  steps: [
    {
      stepId: 's1',
      primitive: 'gather-relevant-facts',
      dependsOn: [],
      outputSchema: { context: 'string' },
      narrative: 'Pull the dispute facts and prior conversation messages.',
    },
    {
      stepId: 's2',
      primitive: 'identify-core-issue',
      dependsOn: ['s1'],
      outputSchema: { coreIssue: 'string' },
      narrative: 'Identify what the counterparty is actually disputing.',
    },
    {
      stepId: 's3',
      primitive: 'consider-alternatives',
      dependsOn: ['s2'],
      outputSchema: { alternatives: 'string[]' },
      narrative: 'Propose 2-3 resolution paths.',
    },
    {
      stepId: 's4',
      primitive: 'propose-and-verify',
      dependsOn: ['s3'],
      outputSchema: { recommendation: 'string', draft: 'string' },
      narrative: 'Draft the recommended response and verify it stays neutral.',
    },
    {
      stepId: 's5',
      primitive: 'check-pii-boundary',
      dependsOn: ['s4'],
      outputSchema: { piiBoundaryViolations: 'string[]' },
      narrative: 'Confirm no PII from other tenants leaks.',
    },
  ],
};

export const SEED_STRUCTURES: ReadonlyArray<ReasoningStructure> = Object.freeze([
  LICENCE_SUSPENSION_TZ_DSM_STRUCTURE,
  COUNTERPARTY_DISPUTE_GLOBAL_STRUCTURE,
]);
