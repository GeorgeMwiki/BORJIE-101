/**
 * ApprovalRouterPort — the engine asks "who must approve this run?"
 * and the router answers based on the tenant's elastic-config
 * thresholds.
 *
 * The reference implementation reads
 *   tenants.settings.elasticConfig.approvalThresholds
 * (see packages/database/src/seeds/trc-elastic-config.ts) plus the
 * matching `approval_policies` row for the conditional-branch logic.
 *
 * For dev + tests the in-memory implementation below mimics the same
 * shape so tests can drive end-to-end paths without a Postgres
 * dependency.
 */

import type { WorkflowDefinition, WorkflowRun } from '../types.js';

export interface ApprovalRouterDecision {
  /** Whether a human approver is needed at all. */
  readonly humanApprovalRequired: boolean;
  /** Role label for the approver — looked up in approval policies. */
  readonly approverRole: string;
  /** Specific user — null when the engine should pick from the role pool. */
  readonly approverUserId: string | null;
  /** Why this route was chosen — surfaced in the UI. */
  readonly rationale: string;
}

export interface ApprovalRouterPort {
  route(input: {
    readonly tenantId: string;
    readonly run: WorkflowRun;
    readonly definition: WorkflowDefinition;
  }): Promise<ApprovalRouterDecision>;
}

// ─────────────────────────────────────────────────────────────────────────
// Reference in-memory router — looks up thresholds from the same shape
// as the production composition root reads
// `tenants.settings.elasticConfig.approvalThresholds`.
// ─────────────────────────────────────────────────────────────────────────

export interface ElasticThresholds {
  readonly bareland_dg_threshold_tzs?: number;
  readonly developed_dg_threshold_tzs?: number;
  readonly low_threshold_skip_dg?: boolean;
  readonly [key: string]: number | boolean | undefined;
}

export interface InMemoryApprovalRouterDeps {
  /** tenantId → elasticConfig.approvalThresholds */
  readonly readThresholds: (
    tenantId: string,
  ) => Promise<ElasticThresholds | null>;
  /** Fallback approver role when no specific user is wired. */
  readonly defaultApproverRole?: string;
}

export function createInMemoryApprovalRouter(
  deps: InMemoryApprovalRouterDeps,
): ApprovalRouterPort {
  const fallback = deps.defaultApproverRole ?? 'ESTATE_MANAGER';

  return {
    async route({ run, definition, tenantId }) {
      // Definition opt-out — no human approval required.
      if (!definition.humanApprovalRequired) {
        return Object.freeze({
          humanApprovalRequired: false,
          approverRole: 'NONE',
          approverUserId: null,
          rationale: 'definition_does_not_require_human_approval',
        });
      }
      // Without an elasticPolicyKey there's nothing to threshold — fall
      // back to the assignment's approver or the tenant default.
      if (!definition.elasticPolicyKey) {
        return Object.freeze({
          humanApprovalRequired: true,
          approverRole: fallback,
          approverUserId: run.assignedApproverUserId,
          rationale: 'definition_has_no_elastic_policy_key',
        });
      }
      const thresholds = await deps.readThresholds(tenantId);
      if (!thresholds) {
        return Object.freeze({
          humanApprovalRequired: true,
          approverRole: fallback,
          approverUserId: run.assignedApproverUserId,
          rationale: 'no_elastic_thresholds_configured',
        });
      }
      // Look up the run's "amount" / "asset_type" input. This mirrors
      // the TRC seed's IF/ELIF semantics from Section 1 of the
      // questionnaire.
      const amount = readNumber(run.input, 'amountMinor');
      const assetType = readString(run.input, 'assetType');
      const bare = thresholds.bareland_dg_threshold_tzs ?? Infinity;
      const dev = thresholds.developed_dg_threshold_tzs ?? Infinity;
      const skipLow = thresholds.low_threshold_skip_dg === true;
      // Below skip-DG threshold → estate manager.
      if (skipLow && amount !== null && amount <= Math.min(bare, dev)) {
        return Object.freeze({
          humanApprovalRequired: true,
          approverRole: 'ESTATE_MANAGER',
          approverUserId: run.assignedApproverUserId,
          rationale: 'below_dg_threshold_estate_manager_only',
        });
      }
      // Above threshold + bareland → DCEI then DG.
      if (assetType === 'bareland' && amount !== null && amount > bare) {
        return Object.freeze({
          humanApprovalRequired: true,
          approverRole: 'DIRECTOR_GENERAL',
          approverUserId: null,
          rationale: 'bareland_above_threshold_dg_required',
        });
      }
      // Above threshold + developed → DG direct.
      if (assetType === 'developed' && amount !== null && amount > dev) {
        return Object.freeze({
          humanApprovalRequired: true,
          approverRole: 'DIRECTOR_GENERAL',
          approverUserId: null,
          rationale: 'developed_above_threshold_dg_required',
        });
      }
      // Default — estate manager.
      return Object.freeze({
        humanApprovalRequired: true,
        approverRole: 'ESTATE_MANAGER',
        approverUserId: run.assignedApproverUserId,
        rationale: 'default_estate_manager',
      });
    },
  };
}

function readNumber(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function readString(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === 'string' ? v : null;
}
