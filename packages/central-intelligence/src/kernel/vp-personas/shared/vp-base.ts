/**
 * VP department-head sub-MDs — shared types.
 *
 * VPs ORCHESTRATE line-worker sub-MDs; they do NOT have their own
 * tool-belt. Each VP:
 *
 *   1. Receives owner intent (or a wake event).
 *   2. Decides which line-worker sub-MD to spawn (and with what scope
 *      + budget).
 *   3. Integrates returns from the line-workers it spawned.
 *   4. Drafts a weekly report for the owner aggregating across line-
 *      workers.
 *
 * VPs are organisational primitives, not new cognitive primitives.
 * They are deliberately constrained so the owner remains in the loop:
 *
 *   - VPs cannot mutate state directly; only line-workers do.
 *   - VPs cannot bypass the four-eye flow.
 *   - When a VP would need a line-worker that does not exist, it asks
 *     the MD to invoke the self-extension keystone
 *     (`proposeNewSubMd`), which puts the gap in front of the owner.
 *
 * Reports-to: every VP reports to the Owner. There is no VP-to-VP
 * authority in this kernel — cross-functional issues bubble up to the
 * MD orchestrator.
 */

import type { ScopeContext } from '../../../types.js';
import type { PersonaIdentity } from '../../identity.js';
import type { SubMdSpawn } from '../../orchestrator/decision.js';

// ─────────────────────────────────────────────────────────────────────
// Owner intent — the input shape to every VP's orchestrate()
// ─────────────────────────────────────────────────────────────────────

export type OwnerIntentKind =
  | 'status-check'
  | 'investigate'
  | 'remediate'
  | 'weekly-report-request'
  | 'wake-from-monitor';

export interface OwnerIntent {
  readonly kind: OwnerIntentKind;
  readonly text: string;
  readonly scope: ScopeContext;
  readonly correlationId: string;
  /** Optional payload — e.g. an event id that fired a wake. */
  readonly payload?: Readonly<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────────────
// Plan emitted by the VP. The MD orchestrator turns each `spawns` item
// into a Decision.spawn_sub_md.
// ─────────────────────────────────────────────────────────────────────

export interface VpOrchestrationPlan {
  readonly vpName: string;
  readonly intentKind: OwnerIntentKind;
  /** Free-form rationale shown to the owner alongside the plan. */
  readonly rationale: string;
  /** Line-worker spawns the VP proposes. */
  readonly spawns: ReadonlyArray<SubMdSpawn>;
  /** Capability gaps that no known line-worker handles. Each gap is a
   *  candidate for the self-extension keystone. */
  readonly gaps: ReadonlyArray<VpCapabilityGap>;
  /** When set, the VP is finished — no spawns, no gaps; the MD should
   *  surface `summary` directly to the owner. */
  readonly summary?: string;
}

export interface VpCapabilityGap {
  /** The line-worker name the VP wanted but did not find. */
  readonly missingLineWorker: string;
  /** Why the VP needed it. */
  readonly reason: string;
  /** Suggested risk tier so the keystone can pre-fill the proposal. */
  readonly suggestedRiskTier: 'read' | 'mutate' | 'external-comm';
}

// ─────────────────────────────────────────────────────────────────────
// Weekly report — the cross-line-worker aggregate the owner reads.
// ─────────────────────────────────────────────────────────────────────

export interface VpReportCard {
  readonly title: string;
  /** Headline metric — what the owner sees first. */
  readonly headline: string;
  /** Numeric value; rendered as a KPI card via genui. */
  readonly value: number | string;
  readonly unit?: string;
  /** Optional trend vs the prior week. */
  readonly delta?: number;
  /** Free-form one-liner the owner reads under the headline. */
  readonly commentary?: string;
}

export interface VpWeeklyReport {
  readonly vpName: string;
  readonly reportsTo: 'owner';
  readonly weekStartingIso: string;
  /** KPI cards rendered via genui in the owner portal. */
  readonly cards: ReadonlyArray<VpReportCard>;
  /** Per-line-worker call-out rows. */
  readonly lineWorkerRollups: ReadonlyArray<VpLineWorkerRollup>;
  /** Optional risks the VP wants the owner to see. */
  readonly riskCallouts: ReadonlyArray<string>;
  /** Optional self-extension proposal if the VP repeatedly hit a gap. */
  readonly proposedExtension?: VpCapabilityGap;
}

export interface VpLineWorkerRollup {
  readonly lineWorker: string;
  /** Outcome the line-worker produced this week. */
  readonly outcome: 'on-track' | 'attention' | 'breached';
  readonly metric: string;
  readonly value: number | string;
  readonly notes?: string;
}

// ─────────────────────────────────────────────────────────────────────
// VP contract
// ─────────────────────────────────────────────────────────────────────

export interface VpDeps {
  /** Lists which line-workers are currently registered. Used by VPs to
   *  decide whether to record a capability gap. */
  readonly lineWorkerCatalogue: VpLineWorkerCatalogue;
  /** Clock — injected so tests are deterministic. */
  readonly clock?: () => number;
}

export interface VpLineWorkerCatalogue {
  /** Returns true if the named line-worker is registered AND in scope
   *  for the supplied scope (defense-in-depth against cross-tenant
   *  leakage). */
  has(args: { readonly name: string; readonly scope: ScopeContext }): boolean;
}

export interface VpDepartmentHead {
  readonly name: string;
  readonly persona: PersonaIdentity;
  readonly reportsTo: 'owner';
  /** Line-workers this VP is allowed to spawn. */
  readonly lineWorkers: ReadonlyArray<string>;
  orchestrate(intent: OwnerIntent): Promise<VpOrchestrationPlan>;
  draftWeeklyReport(args: {
    readonly scope: ScopeContext;
    readonly weekStartingIso: string;
    readonly rollups: ReadonlyArray<VpLineWorkerRollup>;
  }): Promise<VpWeeklyReport>;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a spawn descriptor for a line-worker. Centralised so all VPs
 * emit consistent SubMdSpawn shapes (model class, effort, isolation
 * defaults).
 */
export function buildLineWorkerSpawn(args: {
  readonly subMdId: string;
  readonly scope: ScopeContext;
  readonly initialInput: Readonly<Record<string, unknown>>;
  readonly description: string;
  readonly persona?: string;
  readonly model?: 'haiku' | 'sonnet' | 'opus';
  readonly effort?: 'low' | 'medium' | 'high';
  readonly background?: boolean;
  readonly parentToolUseId?: string;
}): SubMdSpawn {
  return Object.freeze({
    subMdId: args.subMdId,
    scope: args.scope,
    initialInput: Object.freeze({ ...args.initialInput }),
    description: args.description,
    ...(args.persona ? { persona: args.persona } : {}),
    model: args.model ?? 'sonnet',
    effort: args.effort ?? 'medium',
    isolation: 'inline' as const,
    ...(args.background ? { background: true } : {}),
    ...(args.parentToolUseId ? { parentToolUseId: args.parentToolUseId } : {}),
  });
}

/** Stable comparator for line-worker rollup status, attention > on-track. */
export function rollupSeverity(status: VpLineWorkerRollup['outcome']): number {
  if (status === 'breached') return 2;
  if (status === 'attention') return 1;
  return 0;
}

/**
 * Build a VpReportCard with safe optional fields. Respects
 * `exactOptionalPropertyTypes: true` by conditionally spreading
 * optional keys rather than assigning `undefined`.
 */
export function buildVpReportCard(args: {
  readonly title: string;
  readonly headline: string;
  readonly rollup?: VpLineWorkerRollup;
  readonly numericUnit?: string;
  readonly fallbackCommentary?: string;
}): VpReportCard {
  const value = args.rollup?.value ?? 'n/a';
  const isNumeric = typeof args.rollup?.value === 'number';
  const unit = isNumeric ? args.numericUnit : undefined;
  const commentary = args.rollup?.notes ?? args.fallbackCommentary;
  return Object.freeze({
    title: args.title,
    headline: args.headline,
    value,
    ...(unit ? { unit } : {}),
    ...(commentary ? { commentary } : {}),
  });
}
