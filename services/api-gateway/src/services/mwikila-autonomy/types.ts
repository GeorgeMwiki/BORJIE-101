/**
 * Mr. Mwikila autonomy — service-level shared types.
 *
 * Owns the wire shapes used by the inbox recorder, the delegation
 * store, and the per-category handlers. Pure types + zod schemas; no
 * I/O.
 */

import { z } from 'zod';

import { autonomy } from '@borjie/central-intelligence';

const {
  DELEGATION_CATEGORIES,
  DELEGATION_TIERS,
  ACTION_STATUSES,
} = autonomy;

export {
  DELEGATION_CATEGORIES,
  DELEGATION_TIERS,
  ACTION_STATUSES,
};

export type DelegationCategory = autonomy.DelegationCategory;
export type DelegationTier = autonomy.DelegationTier;
export type ActionStatus = autonomy.ActionStatus;

/**
 * One row in `mwikila_actions_inbox`. Returned by every recorder write
 * + the inbox list endpoint. Immutable.
 */
export interface MwikilaInboxRow {
  readonly id: string;
  readonly tenantId: string;
  readonly actingOnUserId: string;
  readonly actionKind: string;
  readonly category: DelegationCategory;
  readonly delegationTier: DelegationTier;
  readonly status: ActionStatus;
  readonly summary: string;
  readonly summarySw: string;
  readonly rationale: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly reversalToken: string | null;
  readonly reversalUntil: string | null;
  readonly proposedAt: string;
  readonly proposalTtlAt: string | null;
  readonly executedAt: string | null;
  readonly ownerReviewedAt: string | null;
  readonly ownerReviewedBy: string | null;
  readonly reversedAt: string | null;
  readonly committedAt: string | null;
  readonly auditChainHash: string | null;
  readonly decisionId: string | null;
  readonly blockedReason: string | null;
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Recorder input for a fresh proposal / execution. The handler builds
 * this descriptor and lets the recorder pick the right status + audit
 * chain entry given the delegation tier.
 */
export interface RecordActionInput {
  readonly tenantId: string;
  readonly actingOnUserId: string;
  readonly actionKind: string;
  readonly category: DelegationCategory;
  readonly delegationTier: DelegationTier;
  readonly summary: string;
  readonly summarySw: string;
  readonly rationale: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /**
   * When the tier allows immediate execution (T2/T3) the handler
   * passes `executedAt` so the recorder writes a single inbox row
   * with status='executed' (T2) or 'executed' transitioning to
   * 'committed' (T3).
   */
  readonly executedAt?: string;
  /** Reversal window hours — only honoured for T2. */
  readonly reversalWindowHours?: number;
  /** TTL for T0/T1 proposals — defaults to 7 days. */
  readonly proposalTtlHours?: number;
  readonly provenance?: Readonly<Record<string, unknown>>;
}

export interface MwikilaRecorderError extends Error {
  readonly code:
    | 'invalid_input'
    | 'persistence_failed'
    | 'not_found'
    | 'wrong_status'
    | 'reversal_window_expired'
    | 'reversal_token_mismatch';
}

export class MwikilaError extends Error implements MwikilaRecorderError {
  readonly code: MwikilaRecorderError['code'];
  constructor(code: MwikilaRecorderError['code'], message: string) {
    super(message);
    this.name = 'MwikilaError';
    this.code = code;
  }
}

/**
 * Zod schemas — input validation at every recorder entry point.
 */
export const RecordActionInputSchema = z
  .object({
    tenantId: z.string().min(1).max(80),
    actingOnUserId: z.string().min(1).max(120),
    actionKind: z.string().min(1).max(120),
    category: z.enum(DELEGATION_CATEGORIES),
    delegationTier: z.enum(DELEGATION_TIERS),
    summary: z.string().min(3).max(400),
    summarySw: z.string().min(3).max(400),
    rationale: z.string().min(3).max(2000),
    payload: z.record(z.string(), z.unknown()),
    executedAt: z.string().datetime().optional(),
    reversalWindowHours: z.number().int().min(1).max(168).optional(),
    proposalTtlHours: z.number().int().min(1).max(720).optional(),
    provenance: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
