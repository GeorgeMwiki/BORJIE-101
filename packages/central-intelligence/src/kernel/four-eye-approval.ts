/**
 * Four-eye approval gate — sovereign-tier write actions require N
 * distinct authorised approvers from a declared set of role groups
 * before the kernel will hand the action to the executor.
 *
 * The gate has five lifecycle states:
 *
 *   - 'pending'   — proposed by the AI; awaiting first approver
 *   - 'one-eye'   — at least one approver has signed; quorum not yet reached
 *   - 'approved'  — quorum met across every declared role group
 *   - 'rejected'  — any approver vetoed
 *   - 'expired'   — TTL elapsed without quorum
 *
 * K5 parity upgrade: each proposed action carries an optional
 * `ApprovalPolicy` that declares how many approvers are required AND
 * from which role groups. Without a policy, the gate falls back to the
 * historical "any 2 distinct admins" baseline so existing callers keep
 * working.
 *
 * Role-group examples for property management:
 *   - eviction.propose:    1 compliance + 1 owner-relations + 1 property-manager
 *   - owner_payout.disburse: 1 ops + 1 compliance
 *   - kra.file_mri_return: 1 compliance + 1 owner-relations
 *
 * Each approval is bound to a specific actor user id; the SAME user
 * cannot satisfy two slots. The proposer is also disqualified unless
 * the policy explicitly opts in via `allowProposerSignature: true`.
 *
 * Pure data structure with an injectable clock + policy resolver;
 * persistence is orthogonal — the gateway wires a Drizzle-backed store
 * at the composition root.
 *
 * Phase D D2 — one-shot consumption guard (`executed` flag +
 * `markExecuted()`) + plan-artifact emission (`brain.approval.
 * plan_proposed`) layered on top without breaking pre-D2 callers.
 */

import { randomUUID } from 'crypto';
import { logger } from '../logger.js';

export type ApprovalStatus =
  | 'pending'
  | 'one-eye'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'recalled';

// ─────────────────────────────────────────────────────────────────────
// Role-group quorum (K5 parity).
// ─────────────────────────────────────────────────────────────────────

export interface ApprovalRoleGroup {
  readonly name: string;
  /** How many distinct approvers from this group are required. */
  readonly minApprovers: number;
}

export interface ApprovalPolicy {
  /** Sum of roleGroups[*].minApprovers — denormalised for fast checks. */
  readonly minTotalApprovers: number;
  /** Per-group quorum. Non-empty. */
  readonly roleGroups: ReadonlyArray<ApprovalRoleGroup>;
  /** Approval window in minutes. Used to derive expiresAt. */
  readonly maxStaleMinutes: number;
  /** Recall window in minutes (0 = not recallable). */
  readonly recallWindowMinutes: number;
  /** Whether approvers must re-authenticate before signing. */
  readonly reAuthRequired: boolean;
  /** Max age in seconds for the re-auth proof. */
  readonly reAuthMaxAgeSeconds: number;
  /** When true the proposer can count as one of the approvers. */
  readonly allowProposerSignature: boolean;
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = Object.freeze({
  minTotalApprovers: 2,
  roleGroups: [{ name: 'admin', minApprovers: 2 }],
  maxStaleMinutes: 24 * 60,
  recallWindowMinutes: 0,
  reAuthRequired: false,
  reAuthMaxAgeSeconds: 300,
  allowProposerSignature: false,
});

export interface ApprovalPolicyResolver {
  resolve(args: {
    readonly tenantId: string | null;
    readonly toolName: string;
  }): Promise<ApprovalPolicy>;
}

// ─────────────────────────────────────────────────────────────────────
// Action + signature shapes
// ─────────────────────────────────────────────────────────────────────

export interface ProposedAction {
  readonly id: string;
  readonly proposerUserId: string;
  readonly thoughtId: string;
  /** Human-readable summary the approver sees. */
  readonly summary: string;
  /** Tool/operation that will run on approval. */
  readonly toolName: string;
  /** Opaque payload — schema-validated by the executor at run-time. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly stakes: 'medium' | 'high' | 'critical';
  readonly proposedAt: string;
  readonly expiresAt: string;
  /** Tenant scope of the action; null for platform-level actions. */
  readonly tenantId?: string | null;
  /** Policy snapshot captured at propose-time — immutable. */
  readonly policy: ApprovalPolicy;
  /**
   * Structured plan artifact (Phase D D2). When the caller supplies a
   * plan it is persisted alongside the prose summary and emitted as
   * `brain.approval.plan_proposed` so approver UIs can render a
   * reviewable plan. When the caller omits it, a minimal default plan
   * is synthesised from `summary` + `stakes` (see `resolvePlan()`).
   */
  readonly plan: ApprovalPlan;
}

/**
 * Plan artifact emitted alongside an approval proposal (Phase D D2).
 *
 *   - `tier`         — risk tier the planner assigned.
 *   - `steps`        — ordered list of human-readable steps that will
 *                      be executed on approval. Must be non-empty.
 *   - `risks`        — known/expected adverse outcomes the approver
 *                      should weigh. Empty array allowed.
 *   - `reversalPlan` — short reversal/rollback prose. Empty string is
 *                      allowed (some actions are not reversible) but
 *                      a missing field is rejected at propose-time.
 */
export interface ApprovalPlan {
  readonly tier: 'medium' | 'high' | 'critical';
  readonly steps: ReadonlyArray<string>;
  readonly risks: ReadonlyArray<string>;
  readonly reversalPlan: string;
}

export interface ApprovalSignature {
  readonly approverUserId: string;
  /** Role group the approver is signing AS. Must appear in policy.roleGroups. */
  readonly roleGroup: string;
  readonly verdict: 'approve' | 'reject';
  readonly comment: string | null;
  readonly signedAt: string;
  /** When the policy requires re-auth, the proof's ISO timestamp. */
  readonly reAuthAt?: string;
}

/**
 * Recall ledger entry — Phase D / D12.9. Captured on the record when a
 * proposer pulls back their proposal so an external auditor can
 * reconstruct who recalled, when, and why.
 */
export interface ApprovalRecallEntry {
  readonly initiatorUserId: string;
  readonly recalledAt: string;
  readonly reason: string;
}

export interface ApprovalRecord {
  readonly action: ProposedAction;
  readonly status: ApprovalStatus;
  readonly signatures: ReadonlyArray<ApprovalSignature>;
  readonly executed: boolean;
  /** Phase D / D12.9 — populated when `status === 'recalled'`. */
  readonly recallEntry?: ApprovalRecallEntry;
}

// ─────────────────────────────────────────────────────────────────────
// Gate API
// ─────────────────────────────────────────────────────────────────────

export interface ProposeArgs {
  readonly proposerUserId: string;
  readonly thoughtId: string;
  readonly summary: string;
  readonly toolName: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly stakes: 'medium' | 'high' | 'critical';
  /** Tenant scope; null for platform-level actions. */
  readonly tenantId?: string | null;
  /**
   * Optional explicit policy snapshot. When provided, the resolver is
   * bypassed — useful for tests and for callers that have already loaded
   * the policy. When omitted, deps.policyResolver is consulted; if
   * neither is wired, DEFAULT_APPROVAL_POLICY is used.
   */
  readonly policy?: ApprovalPolicy;
  /**
   * Structured plan artifact (Phase D D2). When provided, persisted
   * alongside the summary and emitted as
   * `brain.approval.plan_proposed`. When omitted, a minimal default
   * plan is synthesised from the proposal's `summary` + `stakes` so
   * legacy callers keep working. Explicitly-malformed plans (empty
   * `steps`, missing `tier`, non-string `reversalPlan`, etc.) are
   * rejected with the `plan-required` error code regardless of
   * caller origin.
   */
  readonly plan?: ApprovalPlan;
}

/**
 * Structured event emitted on every `propose()` (Phase D D2). The
 * gate uses `deps.eventSink.publish()` when wired so the platform's
 * cross-portal bus can fan the plan out to approver UIs without
 * coupling this module to a specific bus implementation.
 */
export interface ApprovalEventSink {
  publish(event: {
    readonly type: 'brain.approval.plan_proposed';
    readonly actionId: string;
    readonly tenantId: string | null;
    readonly toolName: string;
    readonly plan: ApprovalPlan;
    readonly summary: string;
    readonly proposedAt: string;
  }): Promise<void> | void;
}

export interface SignArgs {
  readonly actionId: string;
  readonly approverUserId: string;
  /**
   * Role group the approver is signing as. Must match one of
   * `action.policy.roleGroups[*].name`. Defaults to 'admin' for backwards
   * compatibility with the pre-K5 baseline policy.
   */
  readonly roleGroup?: string;
  readonly verdict: 'approve' | 'reject';
  readonly comment?: string;
  /**
   * Optional re-authentication proof. When `policy.reAuthRequired` is
   * true the proof MUST be present AND fresh (within
   * `policy.reAuthMaxAgeSeconds`). Carrier-agnostic shape — the gateway
   * verifies TOTP / WebAuthn upstream and passes the timestamp through.
   */
  readonly reAuth?: { readonly verifiedAt: string };
}

/**
 * Recall API arguments — Phase D / D12.9.
 */
export interface RecallArgs {
  readonly actionId: string;
  readonly initiatorUserId: string;
  readonly reason: string;
}

export interface ApprovalGate {
  propose(args: ProposeArgs): Promise<ApprovalRecord>;
  sign(args: SignArgs): Promise<ApprovalRecord>;
  get(actionId: string): Promise<ApprovalRecord | null>;
  list(filter?: { status?: ApprovalStatus }): Promise<ReadonlyArray<ApprovalRecord>>;
  /**
   * One-shot consumption guard (Phase D D2). Marks an `approved`
   * record as `executed=true`. First invocation succeeds and returns
   * the updated record. Subsequent invocations throw
   * `'already-executed'` so a replayed action-id cannot re-trigger
   * the side-effect. Throws `'unknown action'` for missing IDs and
   * `'not-approved'` when the record is not in the `approved` state.
   */
  markExecuted(actionId: string): Promise<ApprovalRecord>;
  /**
   * Recall a still-pending action — Phase D / D12.9. Only the proposer
   * may call this. Requires the policy's `recallWindowMinutes > 0` AND
   * a non-empty reason. Throws on any violation.
   */
  recall(args: RecallArgs): Promise<ApprovalRecord>;
}

export interface ApprovalStore {
  put(record: ApprovalRecord): Promise<void>;
  get(actionId: string): Promise<ApprovalRecord | null>;
  list(filter?: { status?: ApprovalStatus }): Promise<ReadonlyArray<ApprovalRecord>>;
  /**
   * A2b-2 wire #5 — atomic compare-and-set on the `executed` flag.
   *
   * `UPDATE sovereign_approvals SET executed=true WHERE id=$1 AND
   * executed=false RETURNING *` semantics. Returns the updated record
   * on success, null when the CAS lost (already executed, unknown, or
   * not-approved). Optional for back-compat; production Postgres
   * stores MUST provide a real implementation so concurrent executors
   * cannot both flip the flag (TOCTOU).
   */
  casMarkExecuted?(actionId: string): Promise<ApprovalRecord | null>;
}

export interface ApprovalGateDeps {
  readonly store: ApprovalStore;
  readonly clock?: () => Date;
  /**
   * Legacy ttl knob — applied only when neither `args.policy` nor
   * `deps.policyResolver` produces a policy. Prefer the policy's
   * `maxStaleMinutes` for fresh code.
   */
  readonly defaultTtlMs?: number;
  /** Optional policy resolver consulted at propose-time. */
  readonly policyResolver?: ApprovalPolicyResolver;
  /**
   * Optional event sink for `brain.approval.plan_proposed` fanout
   * (Phase D D2). Failures are swallowed — the plan event is best-
   * effort observability, never load-bearing for the propose path.
   */
  readonly eventSink?: ApprovalEventSink;
  /**
   * Optional structured logger for replay-attempt logging on the
   * markExecuted() path (Phase D D2). Each rejected re-execution
   * attempt produces a `warn` record carrying the actionId.
   */
  readonly logger?: {
    readonly warn?: (meta: object, msg: string) => void;
  };
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────
// Quorum check — pure
// ─────────────────────────────────────────────────────────────────────

interface QuorumCheckResult {
  readonly satisfied: boolean;
  readonly perGroup: ReadonlyArray<{
    readonly name: string;
    readonly have: number;
    readonly need: number;
  }>;
}

function checkQuorum(
  policy: ApprovalPolicy,
  signatures: ReadonlyArray<ApprovalSignature>,
): QuorumCheckResult {
  const approvals = signatures.filter((s) => s.verdict === 'approve');
  const perGroup = policy.roleGroups.map((g) => ({
    name: g.name,
    have: approvals.filter((s) => s.roleGroup === g.name).length,
    need: g.minApprovers,
  }));
  const satisfied =
    approvals.length >= policy.minTotalApprovers &&
    perGroup.every((p) => p.have >= p.need);
  return { satisfied, perGroup };
}

function findGroup(
  policy: ApprovalPolicy,
  name: string | undefined,
): ApprovalRoleGroup | null {
  const target = name && name.trim().length > 0 ? name : 'admin';
  for (const g of policy.roleGroups) {
    if (g.name === target) return g;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createApprovalGate(deps: ApprovalGateDeps): ApprovalGate {
  const clock = deps.clock ?? (() => new Date());
  const legacyTtlMs = deps.defaultTtlMs ?? DEFAULT_TTL_MS;

  interface ResolvedPolicyContext {
    readonly policy: ApprovalPolicy;
    readonly source: 'explicit' | 'resolver' | 'legacy-default';
  }

  async function resolvePolicy(args: ProposeArgs): Promise<ResolvedPolicyContext> {
    if (args.policy) return { policy: args.policy, source: 'explicit' };
    if (deps.policyResolver) {
      try {
        const resolved = await deps.policyResolver.resolve({
          tenantId: args.tenantId ?? null,
          toolName: args.toolName,
        });
        return { policy: resolved, source: 'resolver' };
      } catch (error) {
        logger.error('approval-gate: policyResolver failed, using default', { error: error });
      }
    }
    return { policy: DEFAULT_APPROVAL_POLICY, source: 'legacy-default' };
  }

  return {
    async propose(args) {
      // Phase D D2 — plan artifact: validate when explicit, synthesise
      // a minimal default from summary + stakes when omitted.
      const plan = resolvePlan(args);
      const { policy, source } = await resolvePolicy(args);
      const now = clock();
      // For backward-compatible callers that pass `defaultTtlMs` to a gate
      // built without a policyResolver, honour the legacy millisecond TTL
      // exactly. Otherwise derive the TTL from the policy's
      // `maxStaleMinutes` field.
      const ttlMs =
        source === 'legacy-default'
          ? legacyTtlMs
          : policy.maxStaleMinutes * 60_000;
      const action: ProposedAction = {
        proposerUserId: args.proposerUserId,
        thoughtId: args.thoughtId,
        summary: args.summary,
        toolName: args.toolName,
        payload: args.payload,
        stakes: args.stakes,
        tenantId: args.tenantId ?? null,
        id: randomUUID(),
        proposedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        policy,
        plan,
      };
      const record: ApprovalRecord = {
        action,
        status: 'pending',
        signatures: [],
        executed: false,
      };
      await deps.store.put(record);
      // Phase D D2 — emit the plan-proposed event. Best-effort: a
      // failure never breaks the propose path. Observability only;
      // the canonical record lives in the store.
      if (deps.eventSink) {
        try {
          await deps.eventSink.publish({
            type: 'brain.approval.plan_proposed',
            actionId: action.id,
            tenantId: action.tenantId ?? null,
            toolName: action.toolName,
            plan: action.plan,
            summary: action.summary,
            proposedAt: action.proposedAt,
          });
        } catch (error) {
          if (deps.logger?.warn) {
            deps.logger.warn(
              {
                actionId: action.id,
                error: error instanceof Error ? error.message : String(error),
              },
              'approval-gate: plan_proposed event publish failed',
            );
          }
        }
      }
      return record;
    },

    async sign(args) {
      const existing = await deps.store.get(args.actionId);
      if (!existing) throw new Error(`unknown action: ${args.actionId}`);

      const now = clock();
      const refreshed = refreshStatus(existing, now);
      if (
        refreshed.status === 'approved' ||
        refreshed.status === 'rejected' ||
        refreshed.status === 'expired' ||
        refreshed.status === 'recalled'
      ) {
        return refreshed;
      }

      const policy = refreshed.action.policy;

      // Self-approval — refused unless the policy opts in.
      if (
        args.approverUserId === refreshed.action.proposerUserId &&
        !policy.allowProposerSignature
      ) {
        throw new Error('proposer cannot self-approve');
      }

      // Duplicate signature by the same user.
      if (refreshed.signatures.some((s) => s.approverUserId === args.approverUserId)) {
        throw new Error('approver has already signed');
      }

      // Resolve the role group the approver is signing as.
      const group = findGroup(policy, args.roleGroup);
      if (!group) {
        throw new Error(
          `role-group "${args.roleGroup ?? 'admin'}" is not declared on this action's policy`,
        );
      }

      // For approvals (not rejections) the group must still have an open slot.
      if (args.verdict === 'approve') {
        const haveInGroup = refreshed.signatures.filter(
          (s) => s.verdict === 'approve' && s.roleGroup === group.name,
        ).length;
        if (haveInGroup >= group.minApprovers) {
          throw new Error(
            `role-group "${group.name}" already has its required ${group.minApprovers} approvals`,
          );
        }
      }

      // Re-auth enforcement.
      let reAuthAt: string | undefined;
      if (policy.reAuthRequired) {
        if (!args.reAuth || !args.reAuth.verifiedAt) {
          throw new Error('policy requires re-authentication before signing');
        }
        const verifiedAtMs = Date.parse(args.reAuth.verifiedAt);
        if (!Number.isFinite(verifiedAtMs)) {
          throw new Error('re-auth verifiedAt is not a valid ISO timestamp');
        }
        const ageSec = (now.getTime() - verifiedAtMs) / 1000;
        if (ageSec < 0 || ageSec > policy.reAuthMaxAgeSeconds) {
          throw new Error(
            `re-auth proof is stale (age=${Math.max(0, Math.round(ageSec))}s, max=${policy.reAuthMaxAgeSeconds}s)`,
          );
        }
        reAuthAt = args.reAuth.verifiedAt;
      }

      const signature: ApprovalSignature = {
        approverUserId: args.approverUserId,
        roleGroup: group.name,
        verdict: args.verdict,
        comment: args.comment ?? null,
        signedAt: now.toISOString(),
        ...(reAuthAt ? { reAuthAt } : {}),
      };

      const nextSignatures = [...refreshed.signatures, signature];

      let nextStatus: ApprovalStatus;
      if (args.verdict === 'reject') {
        nextStatus = 'rejected';
      } else {
        const quorum = checkQuorum(policy, nextSignatures);
        nextStatus = quorum.satisfied ? 'approved' : 'one-eye';
      }

      const next: ApprovalRecord = {
        action: refreshed.action,
        status: nextStatus,
        signatures: nextSignatures,
        executed: refreshed.executed ?? false,
      };
      await deps.store.put(next);
      return next;
    },

    async get(actionId) {
      const record = await deps.store.get(actionId);
      if (!record) return null;
      const normalised = ensureExecutedField(record);
      const refreshed = refreshStatus(normalised, clock());
      if (refreshed !== normalised) await deps.store.put(refreshed);
      return refreshed;
    },

    async list(filter) {
      const all = await deps.store.list(filter);
      return all.map(ensureExecutedField);
    },

    async markExecuted(actionId) {
      // A2b-2 wire #5 — prefer atomic CAS path. Wired against
      // `UPDATE sovereign_approvals SET executed=true WHERE id=$1
      // AND executed=false RETURNING *` so two concurrent executors
      // cannot both succeed. CAS-null disambiguates downstream by
      // re-reading the row.
      if (deps.store.casMarkExecuted) {
        const updated = await deps.store.casMarkExecuted(actionId);
        if (updated) return ensureExecutedField(updated);
        const existing = await deps.store.get(actionId);
        if (!existing) throw new Error(`unknown action: ${actionId}`);
        const normalised = ensureExecutedField(existing);
        if (normalised.status !== 'approved') {
          throw new Error(
            `not-approved: action ${actionId} status=${normalised.status}`,
          );
        }
        if (deps.logger?.warn) {
          deps.logger.warn(
            { actionId, tenantId: normalised.action.tenantId ?? null },
            'approval-gate: already-executed replay attempt rejected (atomic CAS)',
          );
        }
        throw new Error(`already-executed: action ${actionId}`);
      }
      // Legacy non-atomic fallback for in-memory test fakes only.
      const existing = await deps.store.get(actionId);
      if (!existing) throw new Error(`unknown action: ${actionId}`);
      const normalised = ensureExecutedField(existing);
      const refreshed = refreshStatus(normalised, clock());
      if (refreshed.status !== 'approved') {
        throw new Error(
          `not-approved: action ${actionId} status=${refreshed.status}`,
        );
      }
      if (refreshed.executed) {
        if (deps.logger?.warn) {
          deps.logger.warn(
            { actionId, tenantId: refreshed.action.tenantId ?? null },
            'approval-gate: already-executed replay attempt rejected',
          );
        }
        throw new Error(`already-executed: action ${actionId}`);
      }
      const next: ApprovalRecord = { ...refreshed, executed: true };
      await deps.store.put(next);
      return next;
    },

    async recall(args) {
      // Phase D / D12.9 — proposer-initiated recall.
      const existing = await deps.store.get(args.actionId);
      if (!existing) throw new Error(`unknown action: ${args.actionId}`);
      if (args.initiatorUserId !== existing.action.proposerUserId) {
        throw new Error('only the original proposer may recall this action');
      }
      const now = clock();
      const refreshed = refreshStatus(ensureExecutedField(existing), now);
      if (refreshed.status === 'approved') {
        throw new Error('cannot recall — action already approved');
      }
      if (refreshed.status === 'rejected') {
        throw new Error('cannot recall — action already rejected');
      }
      if (refreshed.status === 'expired') {
        throw new Error('cannot recall — action has expired');
      }
      if (refreshed.status === 'recalled') {
        throw new Error('cannot recall — action already recalled');
      }
      const policy = refreshed.action.policy;
      if (policy.recallWindowMinutes <= 0) {
        throw new Error('policy does not permit recall');
      }
      const proposedAtMs = Date.parse(refreshed.action.proposedAt);
      const ageMin = (now.getTime() - proposedAtMs) / 60_000;
      if (ageMin > policy.recallWindowMinutes) {
        throw new Error(
          `recall window expired (age=${Math.round(ageMin)}min, max=${policy.recallWindowMinutes}min)`,
        );
      }
      const trimmed = (args.reason ?? '').trim();
      if (trimmed.length === 0) {
        throw new Error('recall reason must not be empty');
      }
      const next: ApprovalRecord = {
        ...refreshed,
        status: 'recalled',
        recallEntry: {
          initiatorUserId: args.initiatorUserId,
          recalledAt: now.toISOString(),
          reason: trimmed.slice(0, 280),
        },
      };
      await deps.store.put(next);
      return next;
    },
  };
}

function refreshStatus(record: ApprovalRecord, now: Date): ApprovalRecord {
  if (
    record.status === 'approved' ||
    record.status === 'rejected' ||
    record.status === 'recalled'
  ) {
    return record;
  }
  if (Date.parse(record.action.expiresAt) <= now.getTime()) {
    return { ...record, status: 'expired' };
  }
  return record;
}

/**
 * Legacy records persisted before Phase D D2 may not carry the
 * `executed` field. Treat missing as `false` (unconsumed) so the
 * one-shot guard remains permissive until the column backfills.
 */
function ensureExecutedField(record: ApprovalRecord): ApprovalRecord {
  if (typeof record.executed === 'boolean') return record;
  return { ...record, executed: false };
}

/**
 * Plan-artifact resolver (Phase D D2). When the caller supplies a
 * plan we validate it strictly — explicit malformed plans are
 * rejected with `plan-required`. When the caller omits the plan we
 * synthesise a minimal one from the proposal's `summary` + `stakes`
 * so pre-D2 call-sites keep working.
 */
function resolvePlan(args: ProposeArgs): ApprovalPlan {
  if (args.plan === undefined) {
    return synthesizeDefaultPlan(args);
  }
  validatePlan(args.plan);
  return args.plan;
}

function synthesizeDefaultPlan(args: ProposeArgs): ApprovalPlan {
  const stepText =
    args.summary && args.summary.length > 0
      ? args.summary
      : `Execute tool ${args.toolName}`;
  return {
    tier: args.stakes,
    steps: [stepText],
    risks: [],
    reversalPlan: '',
  };
}

function validatePlan(plan: ApprovalPlan | null): void {
  if (!plan || typeof plan !== 'object') {
    throw new Error(
      'plan-required: propose() requires a structured plan artifact',
    );
  }
  if (
    plan.tier !== 'medium' &&
    plan.tier !== 'high' &&
    plan.tier !== 'critical'
  ) {
    throw new Error('plan-required: plan.tier must be medium|high|critical');
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new Error('plan-required: plan.steps must be a non-empty array');
  }
  if (!Array.isArray(plan.risks)) {
    throw new Error('plan-required: plan.risks must be an array');
  }
  if (typeof plan.reversalPlan !== 'string') {
    throw new Error('plan-required: plan.reversalPlan must be a string');
  }
}

/** In-memory store for tests / dev. */
export function createInMemoryApprovalStore(): ApprovalStore {
  const map = new Map<string, ApprovalRecord>();
  return {
    async put(record) {
      map.set(record.action.id, record);
    },
    async get(actionId) {
      return map.get(actionId) ?? null;
    },
    async list(filter) {
      const all = [...map.values()];
      if (!filter?.status) return all;
      return all.filter((r) => r.status === filter.status);
    },
    // A2b-2 wire #5 — atomic CAS surface for tests. The Node event
    // loop already serialises the get→put pair in a single process.
    // Production Postgres stores back this with `UPDATE ... WHERE
    // executed=false RETURNING *` (see `sovereign_approvals`
    // repository — wired by A2b-1).
    async casMarkExecuted(actionId) {
      const existing = map.get(actionId);
      if (!existing) return null;
      if (existing.status !== 'approved') return null;
      if (existing.executed) return null;
      const next: ApprovalRecord = { ...existing, executed: true };
      map.set(actionId, next);
      return next;
    },
  };
}

/**
 * Convenience builder for an ApprovalPolicy. Validates the per-group sum
 * matches `minTotalApprovers` at construction; throws on mismatch.
 */
export function buildApprovalPolicy(input: {
  readonly roleGroups: ReadonlyArray<ApprovalRoleGroup>;
  readonly maxStaleMinutes?: number;
  readonly recallWindowMinutes?: number;
  readonly reAuthRequired?: boolean;
  readonly reAuthMaxAgeSeconds?: number;
  readonly allowProposerSignature?: boolean;
}): ApprovalPolicy {
  if (!Array.isArray(input.roleGroups) || input.roleGroups.length === 0) {
    throw new Error('approval-policy: roleGroups must be a non-empty array');
  }
  const seen = new Set<string>();
  let minTotal = 0;
  for (const g of input.roleGroups) {
    if (!g.name || g.name.trim().length === 0) {
      throw new Error('approval-policy: roleGroup.name must be non-empty');
    }
    if (seen.has(g.name)) {
      throw new Error(`approval-policy: duplicate roleGroup.name "${g.name}"`);
    }
    seen.add(g.name);
    if (!Number.isInteger(g.minApprovers) || g.minApprovers < 1) {
      throw new Error(
        `approval-policy: roleGroup "${g.name}" minApprovers must be a positive integer`,
      );
    }
    minTotal += g.minApprovers;
  }
  if (minTotal > 5) {
    throw new Error('approval-policy: sum of minApprovers capped at 5');
  }
  return {
    minTotalApprovers: minTotal,
    roleGroups: input.roleGroups,
    maxStaleMinutes: input.maxStaleMinutes ?? 24 * 60,
    recallWindowMinutes: input.recallWindowMinutes ?? 0,
    reAuthRequired: input.reAuthRequired ?? false,
    reAuthMaxAgeSeconds: input.reAuthMaxAgeSeconds ?? 300,
    allowProposerSignature: input.allowProposerSignature ?? false,
  };
}
