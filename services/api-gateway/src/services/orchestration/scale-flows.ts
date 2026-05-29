/**
 * Scale-aware orchestration flows — SC-4 of wave SCALE-AWARE.
 *
 * The Top-5 chat flows (`top-flows.ts`) all encode a "full" enterprise
 * shape (e.g. LOI: compose → lock → share → send). That's the right
 * default for T3+ owners with an admin team, but a T1 artisanal owner
 * recording a first sale should see a SHORT 3-step variant, not the
 * 8-step enterprise version with stage gates the owner can't action.
 *
 * This module picks ONE flow per (intent, scaleTier) tuple. It is the
 * tier-router on top of `top-flows.ts` — no new flows live here; we
 * either reuse the top-flow as-is OR project a smaller subset of its
 * steps for the lighter tiers.
 *
 * The projection is deterministic:
 *   - T1 / T2 (artisanal / cooperative) get the "lite" projection
 *     (capture → close, no stage gates beyond confirm).
 *   - T3 (mid-tier) gets the canonical top-flow unchanged.
 *   - T4 / T5 (industrial / multi-country) get the canonical top-flow
 *     PLUS optional regulator / consolidation tail-steps (the
 *     "extended" projection).
 *
 * Pure functions only. Same intent + tier always produces the same
 * PlanDag (modulo planId timestamp).
 *
 * Companion files:
 *   - services/api-gateway/src/services/orchestration/top-flows.ts
 *   - services/api-gateway/src/services/orchestration/plan-dag.ts
 *   - packages/owner-os-tabs/src/scale-defaults.ts (tier ladder)
 */

import { coerceScaleTier, type ScaleTier } from '@borjie/owner-os-tabs';

import { applyRiskTierPolicy, type PlanDag, type PlanStep } from './plan-dag.js';
import {
  draftSignAndSendLoi,
  dispatchRfbToManagerChain,
  settleAndPayoutCoop,
  incidentToReportToBuyer,
  licenceRenewalChain,
  type DraftSignAndSendLoiIntent,
  type DispatchRfbChainIntent,
  type SettleCoopIntent,
  type IncidentToBuyerIntent,
  type LicenceRenewalIntent,
} from './top-flows.js';

// ─── Tier-bucket helpers ────────────────────────────────────────────

type TierBucket = 'lite' | 'canonical' | 'extended';

/**
 * Map a scale tier into one of three projection buckets. Pure.
 */
function bucketFor(tier: ScaleTier): TierBucket {
  switch (tier) {
    case 't1_artisanal':
    case 't2_cooperative':
      return 'lite';
    case 't3_midtier':
      return 'canonical';
    case 't4_industrial':
    case 't5_multi_country':
      return 'extended';
  }
}

/**
 * Pick a sub-list of steps by id, preserving the original order and
 * dropping any id that does not exist on the plan.
 */
function keepSteps(
  plan: PlanDag,
  keepIds: ReadonlyArray<string>,
): ReadonlyArray<PlanStep> {
  const wanted = new Set(keepIds);
  return plan.steps.filter((s) => wanted.has(s.id));
}

/**
 * Rebuild edges to chain a list of step ids linearly (1→2→3...). The
 * resulting edge set is a strictly linear DAG, which is what every
 * top-flow currently uses; if a future flow goes fan-out we'll evolve
 * this helper.
 */
function chainEdges(
  stepIds: ReadonlyArray<string>,
): ReadonlyArray<{ readonly from: string; readonly to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < stepIds.length - 1; i += 1) {
    const from = stepIds[i];
    const to = stepIds[i + 1];
    if (from && to) out.push({ from, to });
  }
  return out;
}

// ─── Lite / extended projections ────────────────────────────────────

/**
 * LOI (Letter of Intent) — lite flow for T1/T2.
 *   compose → send (no lock, no signed share-link)
 *
 * Skips the "lock" + "share" steps because an artisanal owner sending
 * an LOI to a single buyer over WhatsApp does not need a stage-gated
 * sign-and-share workflow — they need the draft and the send.
 */
function loiLite(intent: DraftSignAndSendLoiIntent): PlanDag {
  const full = draftSignAndSendLoi(intent);
  const lite = keepSteps(full, ['compose', 'send']);
  return applyRiskTierPolicy({
    planId: full.planId,
    intent: full.intent,
    steps: [...lite],
    edges: [...chainEdges(lite.map((s) => s.id))],
  });
}

/**
 * Incident → buyer — lite flow for T1/T2.
 *   report only (no escalate, no buyer notify)
 *
 * An artisanal pit either does not have a manager to escalate to OR
 * the same owner is the manager. The lite flow logs the incident; the
 * owner takes it from there.
 */
function incidentLite(intent: IncidentToBuyerIntent): PlanDag {
  const full = incidentToReportToBuyer(intent);
  const lite = keepSteps(full, ['report']);
  return applyRiskTierPolicy({
    planId: full.planId,
    intent: full.intent,
    steps: [...lite],
    edges: [],
  });
}

/**
 * Licence renewal — lite flow for T1/T2.
 *   start → submit (skip the upload step; lighter PML flows attach
 *   the renewal form inline at submit time).
 */
function licenceLite(intent: LicenceRenewalIntent): PlanDag {
  const full = licenceRenewalChain(intent);
  const lite = keepSteps(full, ['start', 'submit']);
  return applyRiskTierPolicy({
    planId: full.planId,
    intent: full.intent,
    steps: [...lite],
    edges: [...chainEdges(lite.map((s) => s.id))],
  });
}

// ─── Public selectors ───────────────────────────────────────────────

export interface FlowTierContext {
  /** Free-form text — coerced to a known tier. */
  readonly scaleTier: string | null | undefined;
}

/**
 * Pick the right LOI plan for the owner's tier. T1/T2 → lite (2 steps),
 * T3+ → canonical (4 steps).
 */
export function selectLoiFlow(
  intent: DraftSignAndSendLoiIntent,
  ctx: FlowTierContext,
): PlanDag {
  const tier = coerceScaleTier(ctx.scaleTier);
  return bucketFor(tier) === 'lite' ? loiLite(intent) : draftSignAndSendLoi(intent);
}

/**
 * Pick the right RFB-dispatch plan. T1/T2 owners typically do NOT have
 * a manager to dispatch to — there's no person on the org chart. We
 * still surface the canonical 2-step flow (dispatch + journal) so the
 * owner can self-target a supervisor when one exists; the brain will
 * decline at intent-time when the org has no managers.
 */
export function selectRfbDispatchFlow(
  intent: DispatchRfbChainIntent,
  ctx: FlowTierContext,
): PlanDag {
  // `ctx` is read for symmetry with the other selectors; the canonical
  // flow is fine at every tier.
  void ctx;
  return dispatchRfbToManagerChain(intent);
}

/**
 * Pick the right cooperative-settlement plan. T1 (no cooperative) falls
 * back to the canonical flow with the lighter low-risk preview; T2+ get
 * the canonical flow unchanged (it already matches the cooperative
 * register).
 */
export function selectCoopSettlementFlow(
  intent: SettleCoopIntent,
  ctx: FlowTierContext,
): PlanDag {
  void ctx;
  return settleAndPayoutCoop(intent);
}

/**
 * Pick the right incident-to-buyer plan. T1/T2 → log only; T3+ → full
 * chain with escalation + buyer notification.
 */
export function selectIncidentFlow(
  intent: IncidentToBuyerIntent,
  ctx: FlowTierContext,
): PlanDag {
  const tier = coerceScaleTier(ctx.scaleTier);
  return bucketFor(tier) === 'lite' ? incidentLite(intent) : incidentToReportToBuyer(intent);
}

/**
 * Pick the right licence-renewal plan. T1/T2 → 2 steps; T3+ → 3 steps.
 */
export function selectLicenceRenewalFlow(
  intent: LicenceRenewalIntent,
  ctx: FlowTierContext,
): PlanDag {
  const tier = coerceScaleTier(ctx.scaleTier);
  return bucketFor(tier) === 'lite' ? licenceLite(intent) : licenceRenewalChain(intent);
}

/**
 * Registry of every scale-aware selector. Keys match the canonical
 * top-flow names so call-sites can resolve a flow by string at the
 * brain layer.
 */
export const SCALE_FLOW_SELECTORS = Object.freeze({
  draftSignAndSendLoi: selectLoiFlow,
  dispatchRfbToManagerChain: selectRfbDispatchFlow,
  settleAndPayoutCoop: selectCoopSettlementFlow,
  incidentToReportToBuyer: selectIncidentFlow,
  licenceRenewalChain: selectLicenceRenewalFlow,
} as const);

export type ScaleFlowName = keyof typeof SCALE_FLOW_SELECTORS;

/**
 * Test helper / introspection — returns which bucket a tier falls into.
 * Exported so call-sites can branch on the same logic the selectors use
 * internally (e.g. UI surface decides whether to show a "lite" badge).
 */
export function flowBucketFor(tier: string | null | undefined): TierBucket {
  return bucketFor(coerceScaleTier(tier));
}
