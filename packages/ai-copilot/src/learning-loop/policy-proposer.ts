/**
 * Policy proposer — Wave 28.
 *
 * Converts PatternEvidence into concrete AutonomyPolicy patches. The
 * proposer is intentionally conservative: it will only suggest loosening
 * a threshold when observed success-rate is clearly above the baseline,
 * and only suggest tightening when observed failure-rate is clearly
 * above the baseline.
 *
 * Every proposal is born in `draft` status — the dry-run gate and human
 * reviewer move it through the lifecycle.
 */

import type { AutonomyPolicy, FinancePolicy, MaintenancePolicy } from '../autonomy/types.js';
import type { PatternEvidence, PolicyProposal } from './types.js';

export interface PolicyProposerOptions {
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
  /** Relative lift required before we propose loosening a threshold. */
  readonly loosenSuccessLiftPct?: number;
  /** Relative drop required before we propose tightening. */
  readonly tightenSuccessDropPct?: number;
  /**
   * How far to nudge a threshold in either direction as a fraction of
   * the current value. Default is 20%.
   */
  readonly nudgeFraction?: number;
}

const DEFAULT_LOOSEN_LIFT = 0.1; // +10pp success rate vs baseline
const DEFAULT_TIGHTEN_DROP = 0.1; // -10pp success rate vs baseline
const DEFAULT_NUDGE_FRACTION = 0.2;

function defaultIdGenerator(): string {
  return `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function buildReasoning(evidence: PatternEvidence, direction: 'loosen' | 'tighten'): string {
  const successPct = Math.round(evidence.successRate * 100);
  const basePct = Math.round(evidence.baselineSuccessRate * 100);
  if (direction === 'loosen') {
    return `${successPct}% of ${evidence.actionType} actions with ${evidence.contextFeature}=${evidence.contextValue} succeeded across ${evidence.sampleSize} samples (baseline ${basePct}%). Propose loosening the guardrail.`;
  }
  return `${successPct}% of ${evidence.actionType} actions with ${evidence.contextFeature}=${evidence.contextValue} succeeded across ${evidence.sampleSize} samples (baseline ${basePct}%). Propose tightening the guardrail.`;
}

function patchFinance(
  policy: AutonomyPolicy,
  evidence: PatternEvidence,
  direction: 'loosen' | 'tighten',
  nudge: number,
): Partial<AutonomyPolicy> | null {
  const finance = policy.finance;
  if (evidence.actionType === 'auto_approve_refund') {
    const current = finance.autoApproveRefundsMinorUnits;
    const next =
      direction === 'loosen'
        ? Math.round(current * (1 + nudge))
        : Math.max(0, Math.round(current * (1 - nudge)));
    if (next === current) return null;
    const nextFinance: FinancePolicy = {
      ...finance,
      autoApproveRefundsMinorUnits: next,
    };
    return { finance: nextFinance };
  }
  if (evidence.actionType === 'auto_approve_waiver') {
    const current = finance.autoApproveWaiversMinorUnits;
    const next =
      direction === 'loosen'
        ? Math.round(current * (1 + nudge))
        : Math.max(0, Math.round(current * (1 - nudge)));
    if (next === current) return null;
    const nextFinance: FinancePolicy = {
      ...finance,
      autoApproveWaiversMinorUnits: next,
    };
    return { finance: nextFinance };
  }
  return null;
}

function patchMaintenance(
  policy: AutonomyPolicy,
  evidence: PatternEvidence,
  direction: 'loosen' | 'tighten',
  nudge: number,
): Partial<AutonomyPolicy> | null {
  if (evidence.actionType !== 'auto_approve_workorder') return null;
  const current = policy.maintenance.autoApproveBelowMinorUnits;
  const next =
    direction === 'loosen'
      ? Math.round(current * (1 + nudge))
      : Math.max(0, Math.round(current * (1 - nudge)));
  if (next === current) return null;
  const nextMaintenance: MaintenancePolicy = {
    ...policy.maintenance,
    autoApproveBelowMinorUnits: next,
  };
  return { maintenance: nextMaintenance };
}

function buildPatch(
  policy: AutonomyPolicy,
  evidence: PatternEvidence,
  direction: 'loosen' | 'tighten',
  nudge: number,
): Partial<AutonomyPolicy> | null {
  switch (evidence.domain) {
    case 'finance':
      return patchFinance(policy, evidence, direction, nudge);
    case 'maintenance':
      return patchMaintenance(policy, evidence, direction, nudge);
    default:
      return null;
  }
}

function estimateImpact(evidence: PatternEvidence, direction: 'loosen' | 'tighten'): string {
  if (direction === 'loosen') {
    return `Expected to unlock ~${evidence.sampleSize} additional auto-approved ${evidence.actionType} actions per measurement window with sustained ~${Math.round(evidence.successRate * 100)}% success rate.`;
  }
  return `Expected to divert ~${evidence.sampleSize} ${evidence.actionType} actions to human review, preventing ~${Math.round((1 - evidence.successRate) * evidence.sampleSize)} failures per window.`;
}

export function proposeAdjustments(
  patterns: readonly PatternEvidence[],
  currentPolicy: AutonomyPolicy,
  options: PolicyProposerOptions = {},
): readonly PolicyProposal[] {
  const now = options.now ?? (() => new Date());
  const genId = options.idGenerator ?? defaultIdGenerator;
  const loosenLift = options.loosenSuccessLiftPct ?? DEFAULT_LOOSEN_LIFT;
  const tightenDrop = options.tightenSuccessDropPct ?? DEFAULT_TIGHTEN_DROP;
  const nudge = options.nudgeFraction ?? DEFAULT_NUDGE_FRACTION;

  const proposals: PolicyProposal[] = [];
  const nowIso = now().toISOString();

  for (const evidence of patterns) {
    if (!evidence.significant) continue;

    const lift = evidence.successRate - evidence.baselineSuccessRate;
    let direction: 'loosen' | 'tighten' | null = null;
    if (lift >= loosenLift) direction = 'loosen';
    else if (lift <= -tightenDrop) direction = 'tighten';
    if (!direction) continue;

    const patch = buildPatch(currentPolicy, evidence, direction, nudge);
    if (!patch) continue;

    proposals.push({
      id: genId(),
      tenantId: currentPolicy.tenantId,
      proposedPatch: patch,
      evidence: [evidence],
      estimatedImpact: estimateImpact(evidence, direction),
      reasoning: buildReasoning(evidence, direction),
      confidence: clamp01(Math.min(0.95, 0.5 + Math.abs(lift))),
      status: 'draft',
      createdAt: nowIso,
    });
  }

  return proposals;
}
