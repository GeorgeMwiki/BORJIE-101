/**
 * Structural type for the Wave 28 universal autonomy guard.
 *
 * Declared here so domain services can accept an optional `autonomyGuard`
 * dependency WITHOUT taking a hard runtime import on `@borjie/ai-copilot`
 * (which would create a cycle because ai-copilot's composition already
 * imports domain-services types during orchestrator wiring).
 *
 * The real implementation lives in
 * `packages/ai-copilot/src/autonomy/guard.ts` — this interface is a
 * subset of what that factory returns, verified at composition time in
 * `services/api-gateway/src/composition/autonomy-guard-wiring.ts`.
 */

/**
 * The 11 autonomy domains matching the AutonomyPolicy schema.
 * Duplicated structurally here to avoid the hard import.
 */
export type AutonomyGuardDomain =
  | 'finance'
  | 'leasing'
  | 'maintenance'
  | 'compliance'
  | 'communications'
  | 'marketing'
  | 'hr'
  | 'procurement'
  | 'insurance'
  | 'legal_proceedings'
  | 'tenant_welfare';

/**
 * Minimal context shape. The guard accepts a lot more fields — this
 * duplicates only the ones the domain-services need. Extra fields pass
 * through via `unknown` so services can attach domain-specific evidence
 * without widening this file.
 */
export interface AutonomyGuardContextLike {
  readonly tenantId: string;
  readonly domain: AutonomyGuardDomain;
  readonly actionKey: string;
  readonly auditActionKind: string;
  readonly policyContext?: Readonly<Record<string, unknown>>;
  readonly grantRequest?: {
    readonly targetEntityType?: string;
    readonly targetEntityId?: string;
    readonly amountMinorUnits?: number;
    readonly actor?: string;
    readonly meta?: Readonly<Record<string, unknown>>;
  };
  readonly subject?: {
    readonly entityType?: string | null;
    readonly entityId?: string | null;
    readonly resourceUri?: string | null;
  };
  readonly correlationId?: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
  readonly skipGrantCheck?: boolean;
  readonly actor?: {
    readonly kind?: string;
    readonly id?: string | null;
    readonly display?: string | null;
  };
}

/**
 * Mirrors `GuardResult<T>` from `@borjie/ai-copilot/autonomy/guard`.
 */
export interface AutonomyGuardResult<T = unknown> {
  readonly executed: boolean;
  readonly result?: T;
  readonly queuedApprovalId: string | null;
  readonly auditEntryId: string;
  readonly reason: string;
  readonly decision: {
    readonly authorized: boolean;
    readonly requiresApproval: boolean;
    readonly reason: string;
  };
}

/**
 * Higher-order guard fn. Callers pass the policy/grant/audit context +
 * a thunk; the guard awaits the policy → grant → audit chain and then
 * either runs the thunk or queues an approval request.
 */
export type AutonomyGuardFnLike = <T>(
  ctx: AutonomyGuardContextLike,
  action: () => Promise<T> | T,
) => Promise<AutonomyGuardResult<T>>;
