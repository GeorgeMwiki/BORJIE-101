/**
 * Four-eye approval gate.
 *
 * Tool names matching the HIGH-risk prefixes
 *   kill_switch.* | four_eye.* | sovereign.* | policy_rollout.*
 * MUST be confirmed by the owner before they execute. The dispatcher:
 *
 *   1. Inserts a pending row in `oauth_action_approvals` (migration 0121)
 *      with the tool name, arguments, agent token id, and expiry.
 *   2. Returns `{ status: "pending_approval", approval_url, expires_in }`.
 *   3. The agent polls `actions/approval_status` with the row id.
 *   4. The owner approves on the owner-web page; the dispatcher (next
 *      poll or via long-poll) actually executes the tool and streams
 *      the result.
 *
 * This module owns the pure data shape. The api-gateway adapter handles
 * the SQL + the owner-web bridge.
 */

export const FOUR_EYE_PREFIXES: ReadonlyArray<string> = Object.freeze([
  'kill_switch',
  'four_eye',
  'sovereign',
  'policy_rollout',
]);

export function requiresFourEye(toolName: string): boolean {
  const head = toolName.split(/[._/]/, 1)[0];
  return FOUR_EYE_PREFIXES.includes(head ?? '');
}

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'consumed';

export interface ActionApproval {
  readonly id: string;
  readonly tokenId: string;
  readonly toolName: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly status: ApprovalStatus;
  readonly requestedAt: number;
  readonly expiresAt: number;
  readonly approvedAt?: number;
  readonly approvedBy?: string;
  readonly deniedAt?: number;
  readonly consumedAt?: number;
}

export interface ApprovalStore {
  create(input: {
    readonly tokenId: string;
    readonly toolName: string;
    readonly arguments: Readonly<Record<string, unknown>>;
    readonly expiresAt: number;
  }): Promise<ActionApproval>;
  get(id: string): Promise<ActionApproval | null>;
  approve(id: string, approver: string): Promise<ActionApproval>;
  deny(id: string, approver: string): Promise<ActionApproval>;
  consume(id: string): Promise<ActionApproval>;
}

/** Pure in-memory store for tests. */
export function createInMemoryApprovalStore(deps: {
  readonly now?: () => number;
  readonly newId?: () => string;
} = {}): ApprovalStore {
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => `appr_${now()}_${Math.random().toString(36).slice(2, 8)}`);
  const approvals = new Map<string, ActionApproval>();

  const store: ApprovalStore = {
    async create(input: {
      readonly tokenId: string;
      readonly toolName: string;
      readonly arguments: Readonly<Record<string, unknown>>;
      readonly expiresAt: number;
    }): Promise<ActionApproval> {
      const id = newId();
      const approval: ActionApproval = Object.freeze({
        id,
        tokenId: input.tokenId,
        toolName: input.toolName,
        arguments: Object.freeze({ ...input.arguments }),
        status: 'pending',
        requestedAt: now(),
        expiresAt: input.expiresAt,
      });
      approvals.set(id, approval);
      return approval;
    },
    async get(id: string): Promise<ActionApproval | null> {
      return approvals.get(id) ?? null;
    },
    async approve(id: string, approver: string): Promise<ActionApproval> {
      const existing = approvals.get(id);
      if (!existing) throw new Error(`unknown approval: ${id}`);
      if (existing.status !== 'pending') return existing;
      if (existing.expiresAt < now()) {
        const expired: ActionApproval = Object.freeze({ ...existing, status: 'expired' });
        approvals.set(id, expired);
        return expired;
      }
      const next: ActionApproval = Object.freeze({
        ...existing,
        status: 'approved',
        approvedAt: now(),
        approvedBy: approver,
      });
      approvals.set(id, next);
      return next;
    },
    async deny(id: string, approver: string): Promise<ActionApproval> {
      const existing = approvals.get(id);
      if (!existing) throw new Error(`unknown approval: ${id}`);
      if (existing.status !== 'pending') return existing;
      const next: ActionApproval = Object.freeze({
        ...existing,
        status: 'denied',
        deniedAt: now(),
        approvedBy: approver,
      });
      approvals.set(id, next);
      return next;
    },
    async consume(id: string): Promise<ActionApproval> {
      const existing = approvals.get(id);
      if (!existing) throw new Error(`unknown approval: ${id}`);
      if (existing.status !== 'approved') {
        throw new Error(`approval not approved: ${id} (${existing.status})`);
      }
      const next: ActionApproval = Object.freeze({
        ...existing,
        status: 'consumed',
        consumedAt: now(),
      });
      approvals.set(id, next);
      return next;
    },
  };
  return Object.freeze(store);
}

export interface PendingApprovalResponse {
  readonly status: 'pending_approval';
  readonly approvalId: string;
  readonly approvalUrl: string;
  readonly expiresInSeconds: number;
}

export function buildPendingApprovalResponse(args: {
  readonly approval: ActionApproval;
  readonly ownerWebBaseUrl: string;
  readonly now?: () => number;
}): PendingApprovalResponse {
  const n = (args.now ?? (() => Date.now()))();
  const base = args.ownerWebBaseUrl.replace(/\/+$/, '');
  return Object.freeze({
    status: 'pending_approval' as const,
    approvalId: args.approval.id,
    approvalUrl: `${base}/oauth/actions/approve?id=${encodeURIComponent(args.approval.id)}`,
    expiresInSeconds: Math.max(0, Math.floor((args.approval.expiresAt - n) / 1_000)),
  });
}
