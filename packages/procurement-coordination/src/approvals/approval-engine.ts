/**
 * Minimal in-package approval engine.
 *
 * Searched for an existing repo-wide engine — `services/api-gateway`
 * has an `ApprovalWorkflowService` reachable through
 * `@borjie/domain-services/approvals`, but its domain model is
 * scoped to maintenance / refund / lease-exception cases. Importing
 * it would entangle this package with the api-gateway composition
 * root, so we ship a focused engine here behind the
 * `ApprovalEnginePort` interface — the composition root can swap it
 * for an external engine when one becomes universally available.
 *
 * Behaviour:
 *
 *   - `resolveChain` selects an `ApprovalPolicy` (per tenant + category,
 *     falling back to category='all') and walks the configured
 *     thresholds to pick the lowest matching tier. The resulting chain
 *     enumerates the levels that must approve in order; assignees are
 *     left `null` for the caller to resolve via its directory.
 *   - `decide` advances the chain. A rejection at any level
 *     short-circuits the whole chain to `rejected`. The chain flips
 *     to `approved` once every required level signs off.
 *   - Each call returns a NEW chain object — no mutation.
 */

import type {
  ApprovalChain,
  ApprovalChainId,
  ApprovalDecision,
  ApprovalEnginePort,
  ApprovalLevel,
  ApprovalPolicy,
  ApprovalStep,
  ApprovalThresholdRule,
  ClockPort,
  CurrencyCode,
  ProcurementDataPort,
  VendorCategory,
} from '../types.js';
import { SYSTEM_CLOCK } from '../types.js';

export const DEFAULT_THRESHOLDS: ReadonlyArray<ApprovalThresholdRule> = Object.freeze([
  {
    minAmount: 0,
    maxAmount: 50_000,
    currency: 'USD',
    requiredLevels: ['department'] as ReadonlyArray<ApprovalLevel>,
  },
  {
    minAmount: 50_000,
    maxAmount: 250_000,
    currency: 'USD',
    requiredLevels: ['department', 'finance'] as ReadonlyArray<ApprovalLevel>,
  },
  {
    minAmount: 250_000,
    maxAmount: 1_000_000,
    currency: 'USD',
    requiredLevels: ['department', 'finance', 'executive'] as ReadonlyArray<ApprovalLevel>,
  },
  {
    minAmount: 1_000_000,
    maxAmount: null,
    currency: 'USD',
    requiredLevels: ['department', 'finance', 'executive', 'board'] as ReadonlyArray<ApprovalLevel>,
  },
]);

export function defaultApprovalPolicy(
  tenantId: string,
  category: VendorCategory | 'all' = 'all',
): ApprovalPolicy {
  return {
    tenantId,
    category,
    thresholds: DEFAULT_THRESHOLDS,
  };
}

export interface ApprovalEngineDeps {
  readonly dataPort: ProcurementDataPort;
  readonly clock?: ClockPort;
  readonly idFactory?: () => string;
}

export function createApprovalEngine(deps: ApprovalEngineDeps): ApprovalEnginePort {
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const idFactory = deps.idFactory ?? defaultIdFactory;
  const port = deps.dataPort;

  return {
    async resolveChain(args) {
      const policy =
        (await port.findApprovalPolicy(args.tenantId, args.category)) ??
        defaultApprovalPolicy(args.tenantId, args.category);
      const matchedTier = pickThreshold(policy.thresholds, args.amount, args.currency);
      if (!matchedTier) {
        throw new Error(
          `No threshold matches amount ${args.amount} ${args.currency} for tenant ${args.tenantId}`,
        );
      }
      const steps: ReadonlyArray<ApprovalStep> = matchedTier.requiredLevels.map(
        (level): ApprovalStep => ({
          level,
          assignee: null,
          decision: 'pending' as ApprovalDecision,
          decidedAt: null,
          comment: null,
        }),
      );
      const chain: ApprovalChain = {
        id: `apc_${idFactory()}`,
        tenantId: args.tenantId,
        subjectKind: args.subjectKind,
        subjectId: args.subjectId,
        amount: args.amount,
        currency: args.currency,
        steps,
        status: 'in_flight',
        createdAt: clock.now().toISOString(),
        resolvedAt: null,
      };
      await port.insertApprovalChain(chain);
      return chain;
    },

    async decide(args) {
      const chain = await port.findApprovalChain(args.chainId);
      if (!chain) {
        throw new Error(`Approval chain ${args.chainId} not found`);
      }
      if (chain.status !== 'in_flight') {
        throw new Error(
          `Chain ${args.chainId} already ${chain.status}; cannot record new decision`,
        );
      }
      const stepIdx = chain.steps.findIndex(
        (s) => s.level === args.level && s.decision === 'pending',
      );
      if (stepIdx === -1) {
        throw new Error(
          `No pending step at level '${args.level}' for chain ${args.chainId}`,
        );
      }
      // Enforce sequential approval: every earlier step must be approved.
      const earlierPending = chain.steps
        .slice(0, stepIdx)
        .some((s) => s.decision !== 'approved' && s.decision !== 'skipped');
      if (earlierPending) {
        throw new Error(
          `Cannot approve at level '${args.level}' — earlier levels are still pending`,
        );
      }
      const updatedStep: ApprovalStep = {
        level: args.level,
        assignee: args.assignee,
        decision: args.decision,
        decidedAt: clock.now().toISOString(),
        comment: args.comment ?? null,
      };
      const newSteps = chain.steps.map((s, i) => (i === stepIdx ? updatedStep : s));
      const allApproved = newSteps.every(
        (s) => s.decision === 'approved' || s.decision === 'skipped',
      );
      const anyRejected = newSteps.some((s) => s.decision === 'rejected');
      const nextStatus: ApprovalChain['status'] = anyRejected
        ? 'rejected'
        : allApproved
          ? 'approved'
          : 'in_flight';
      const updatedChain: ApprovalChain = {
        ...chain,
        steps: newSteps,
        status: nextStatus,
        resolvedAt: nextStatus === 'in_flight' ? null : clock.now().toISOString(),
      };
      await port.updateApprovalChain(updatedChain);
      return updatedChain;
    },
  };
}

function pickThreshold(
  thresholds: ReadonlyArray<ApprovalThresholdRule>,
  amount: number,
  currency: CurrencyCode,
): ApprovalThresholdRule | null {
  return (
    thresholds.find(
      (t) =>
        t.currency.toUpperCase() === currency.toUpperCase() &&
        amount >= t.minAmount &&
        (t.maxAmount === null || amount < t.maxAmount),
    ) ?? null
  );
}

// Inferring approver level just to make tests legible — re-exported.
export function nextPendingLevel(chain: ApprovalChain): ApprovalLevel | null {
  return chain.steps.find((s) => s.decision === 'pending')?.level ?? null;
}

let counter = 0;
function defaultIdFactory(): string {
  counter += 1;
  return `${Date.now().toString(36)}_${counter.toString(36)}`;
}

export type { ApprovalChainId };
