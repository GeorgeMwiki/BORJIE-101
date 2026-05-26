/**
 * Proposal repository — CRUD on `ui_evolution_proposals`.
 *
 * Per migration 0017, the table carries a tenant_id with RLS so
 * proposals are tenant-scoped. The worker writes pending proposals
 * and reads back its own writes; the owner-portal performs approve /
 * reject from a different code path.
 *
 * Idempotency: writes use ON CONFLICT on (tenant_id, tab_recipe_id,
 * current_version, proposed_at::date) so re-running the daily sweep
 * for the same day does not create dupes. (Phase 2 schema follow-up
 * may add an explicit unique index; for now the repository de-dupes
 * defensively with a pre-read.)
 */

import type {
  EvolutionProposal,
  FailingSignal,
  ProposalStatus,
  ProposedDiff,
  RolloutStrategy,
} from '../types.js';
import type { RecipeDb } from './recipe-repository.js';

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface ProposalRepository {
  insertPending(args: {
    tenantId: string;
    tabRecipeId: string;
    currentVersion: number;
    proposedVersion: number;
    diff: ProposedDiff;
    signals: ReadonlyArray<FailingSignal>;
    citations: ReadonlyArray<string>;
  }): Promise<EvolutionProposal>;
  hasPendingProposalFor(args: {
    tenantId: string;
    tabRecipeId: string;
    currentVersion: number;
  }): Promise<boolean>;
  findById(id: string): Promise<EvolutionProposal | null>;
  updateStatus(args: {
    id: string;
    nextStatus: ProposalStatus;
    reviewedBy?: string;
    reviewerReason?: string;
    rolloutStrategy?: RolloutStrategy;
    approvalAuditHash?: string;
  }): Promise<void>;
}

export function createProposalRepository(db: RecipeDb): ProposalRepository {
  return {
    async insertPending(args) {
      const rows = await db.query<Record<string, unknown>>(
        `INSERT INTO ui_evolution_proposals
           (tenant_id, tab_recipe_id, current_version, proposed_version,
            proposed_schema_diff, signals, citations, status)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::text[], 'pending')
         RETURNING id, tenant_id, tab_recipe_id, current_version,
                   proposed_version, proposed_schema_diff, signals,
                   citations, status, proposed_at`,
        [
          args.tenantId,
          args.tabRecipeId,
          args.currentVersion,
          args.proposedVersion,
          JSON.stringify(args.diff),
          JSON.stringify(args.signals),
          [...args.citations],
        ],
      );
      const row = rows[0];
      if (!row) {
        throw new Error('proposal-repository: insert returned zero rows');
      }
      return rowToProposal(row);
    },
    async hasPendingProposalFor({ tenantId, tabRecipeId, currentVersion }) {
      const rows = await db.query<{ exists?: unknown }>(
        `SELECT 1 AS exists FROM ui_evolution_proposals
          WHERE tenant_id = $1
            AND tab_recipe_id = $2
            AND current_version = $3
            AND status = 'pending'
          LIMIT 1`,
        [tenantId, tabRecipeId, currentVersion],
      );
      return rows.length > 0;
    },
    async findById(id) {
      const rows = await db.query<Record<string, unknown>>(
        `SELECT id, tenant_id, tab_recipe_id, current_version,
                proposed_version, proposed_schema_diff, signals,
                citations, status, proposed_at, reviewed_at,
                reviewed_by, reviewer_reason, rollout_strategy,
                approval_audit_hash
           FROM ui_evolution_proposals
          WHERE id = $1
          LIMIT 1`,
        [id],
      );
      const first = rows[0];
      if (!first) return null;
      return rowToProposal(first);
    },
    async updateStatus({ id, nextStatus, reviewedBy, reviewerReason, rolloutStrategy, approvalAuditHash }) {
      await db.query(
        `UPDATE ui_evolution_proposals
            SET status = $2,
                reviewed_at = CASE WHEN $2 IN ('approved','rejected','expired') THEN now() ELSE reviewed_at END,
                reviewed_by = COALESCE($3, reviewed_by),
                reviewer_reason = COALESCE($4, reviewer_reason),
                rollout_strategy = COALESCE($5, rollout_strategy),
                approval_audit_hash = COALESCE($6, approval_audit_hash)
          WHERE id = $1`,
        [
          id,
          nextStatus,
          reviewedBy ?? null,
          reviewerReason ?? null,
          rolloutStrategy ?? null,
          approvalAuditHash ?? null,
        ],
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToProposal(row: Record<string, unknown>): EvolutionProposal {
  const diff = parseJsonField<ProposedDiff>(row['proposed_schema_diff']);
  const signals = parseJsonField<ReadonlyArray<FailingSignal>>(row['signals']);
  const citations = parseStringArray(row['citations']);
  const proposedAt = requireIso(row['proposed_at']);
  const reviewedAt = optionalIso(row['reviewed_at']);
  const status = parseProposalStatus(row['status']);
  const rolloutStrategy = parseRolloutStrategy(row['rollout_strategy']);

  return {
    id: requireString(row['id']),
    tenantId: requireString(row['tenant_id']),
    tabRecipeId: requireString(row['tab_recipe_id']),
    currentVersion: requireInt(row['current_version']),
    proposedVersion: requireInt(row['proposed_version']),
    proposedSchemaDiff: diff ?? { ops: [], rationaleEn: '', rationaleSw: '' },
    signals: signals ?? [],
    citations,
    status,
    proposedAtIso: proposedAt,
    ...(reviewedAt ? { reviewedAtIso: reviewedAt } : {}),
    ...(typeof row['reviewed_by'] === 'string' && row['reviewed_by']
      ? { reviewedBy: row['reviewed_by'] }
      : {}),
    ...(typeof row['reviewer_reason'] === 'string' && row['reviewer_reason']
      ? { reviewerReason: row['reviewer_reason'] }
      : {}),
    ...(rolloutStrategy ? { rolloutStrategy } : {}),
    ...(typeof row['approval_audit_hash'] === 'string' && row['approval_audit_hash']
      ? { approvalAuditHash: row['approval_audit_hash'] }
      : {}),
  };
}

function parseJsonField<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  if (typeof v === 'object') return v as T;
  return null;
}

function parseStringArray(v: unknown): ReadonlyArray<string> {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      // fall through
    }
  }
  return [];
}

function parseProposalStatus(v: unknown): ProposalStatus {
  if (
    v === 'pending' ||
    v === 'approved' ||
    v === 'rejected' ||
    v === 'expired' ||
    v === 'auto_applied_tier_0'
  ) {
    return v;
  }
  return 'pending';
}

function parseRolloutStrategy(v: unknown): RolloutStrategy | null {
  if (v === 'gradual' || v === 'full' || v === 'a_b') return v;
  return null;
}

function requireString(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error('proposal-repository: expected non-empty string');
  }
  return v;
}

function requireInt(v: unknown): number {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10);
    if (Number.isInteger(n)) return n;
  }
  throw new Error('proposal-repository: expected integer');
}

function requireIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  throw new Error('proposal-repository: expected timestamp');
}

function optionalIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}
