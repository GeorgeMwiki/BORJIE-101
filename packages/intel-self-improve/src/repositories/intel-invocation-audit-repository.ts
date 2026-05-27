/**
 * intel_invocation_audit repository — port + in-memory + SQL adapters.
 *
 * The wrapper persists every measured intel call here; the outcome-
 * observer later attaches ground truth; the curator pulls rows to
 * shape RLVR training pairs. RLS-scoped per tenant via the canonical
 * `app.tenant_id` GUC pattern from migration 0003 (enforced at the SQL
 * driver, not in this adapter).
 *
 * @module @borjie/intel-self-improve/repositories/intel-invocation-audit-repository
 */

import type { ObservedOutcome, UserFollowthrough } from '@borjie/capability-catalogue';
import type {
  IntelInvocationContext,
  IntelKind,
  OutcomeObservation,
} from '../types.js';

// ---------------------------------------------------------------------------
// Persisted row — invocation context PLUS optional observation columns
// ---------------------------------------------------------------------------

export interface IntelInvocationAuditRow {
  readonly id: string;
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly intelKind: IntelKind;
  readonly inputPayload: Readonly<Record<string, unknown>>;
  readonly outputPayload: Readonly<Record<string, unknown>>;
  readonly claimedConfidence: number;
  readonly latencyMs: number;
  readonly costUsdCents: number;
  readonly observedOutcome: ObservedOutcome | null;
  readonly userFollowthrough: UserFollowthrough | null;
  readonly observationPayload: Readonly<Record<string, unknown>> | null;
  readonly invokedAt: string;
  readonly observedAt: string | null;
  readonly prevHash: string;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface IntelInvocationAuditRepository {
  insert(ctx: IntelInvocationContext): Promise<void>;
  attachObservation(observation: OutcomeObservation): Promise<void>;
  findById(id: string): Promise<IntelInvocationAuditRow | null>;
  listPendingObservations(args: {
    readonly tenantId: string;
    readonly intelKind: IntelKind;
    readonly olderThan: string;
    readonly limit: number;
  }): Promise<ReadonlyArray<IntelInvocationAuditRow>>;
  listObservedInWindow(args: {
    readonly tenantId: string;
    readonly intelKind: IntelKind;
    readonly from: string;
    readonly to: string;
  }): Promise<ReadonlyArray<IntelInvocationAuditRow>>;
  latestAuditHash(args: {
    readonly tenantId: string;
    readonly intelKind: IntelKind;
  }): Promise<string>;
}

// ---------------------------------------------------------------------------
// In-memory adapter — used by tests, fixtures, and dev composition
// ---------------------------------------------------------------------------

export function createInMemoryIntelInvocationAuditRepository(): IntelInvocationAuditRepository {
  const rows = new Map<string, IntelInvocationAuditRow>();

  return {
    async insert(ctx) {
      const row: IntelInvocationAuditRow = Object.freeze({
        id: ctx.id,
        tenantId: ctx.tenantId,
        capabilityId: ctx.capabilityId,
        intelKind: ctx.intelKind,
        inputPayload: ctx.inputPayload,
        outputPayload: ctx.outputPayload,
        claimedConfidence: ctx.claimedConfidence,
        latencyMs: ctx.latencyMs,
        costUsdCents: ctx.costUsdCents,
        observedOutcome: null,
        userFollowthrough: null,
        observationPayload: null,
        invokedAt: ctx.invokedAt,
        observedAt: null,
        prevHash: ctx.prevHash,
        auditHash: ctx.auditHash,
      });
      rows.set(ctx.id, row);
    },
    async attachObservation(observation) {
      const existing = rows.get(observation.invocationId);
      if (!existing) {
        return;
      }
      const updated: IntelInvocationAuditRow = Object.freeze({
        ...existing,
        observedOutcome: observation.observedOutcome,
        userFollowthrough: observation.userFollowthrough,
        observationPayload: observation.observationPayload,
        observedAt: observation.observedAt,
      });
      rows.set(observation.invocationId, updated);
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async listPendingObservations({ tenantId, intelKind, olderThan, limit }) {
      const out: Array<IntelInvocationAuditRow> = [];
      for (const r of rows.values()) {
        if (
          r.tenantId === tenantId &&
          r.intelKind === intelKind &&
          r.observedOutcome === null &&
          r.invokedAt <= olderThan
        ) {
          out.push(r);
          if (out.length >= limit) break;
        }
      }
      return Object.freeze(out);
    },
    async listObservedInWindow({ tenantId, intelKind, from, to }) {
      const out: Array<IntelInvocationAuditRow> = [];
      for (const r of rows.values()) {
        if (
          r.tenantId === tenantId &&
          r.intelKind === intelKind &&
          r.observedOutcome !== null &&
          r.invokedAt >= from &&
          r.invokedAt < to
        ) {
          out.push(r);
        }
      }
      return Object.freeze(out);
    },
    async latestAuditHash({ tenantId, intelKind }) {
      let latest: IntelInvocationAuditRow | null = null;
      for (const r of rows.values()) {
        if (r.tenantId === tenantId && r.intelKind === intelKind) {
          if (latest === null || r.invokedAt > latest.invokedAt) {
            latest = r;
          }
        }
      }
      return latest ? latest.auditHash : '';
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter — composed at the database boundary
// ---------------------------------------------------------------------------

export interface SqlIntelInvocationAuditDriver {
  query(args: {
    readonly text: string;
    readonly values: ReadonlyArray<unknown>;
  }): Promise<ReadonlyArray<Record<string, unknown>>>;
}

function toRow(r: Record<string, unknown>): IntelInvocationAuditRow {
  const invoked = r['invoked_at'];
  const observed = r['observed_at'];
  return Object.freeze({
    id: r['id'] as string,
    tenantId: r['tenant_id'] as string,
    capabilityId: r['capability_id'] as string,
    intelKind: r['intel_kind'] as IntelKind,
    inputPayload: (r['input_payload'] ?? {}) as Readonly<
      Record<string, unknown>
    >,
    outputPayload: (r['output_payload'] ?? {}) as Readonly<
      Record<string, unknown>
    >,
    claimedConfidence: Number(r['claimed_confidence'] ?? 0),
    latencyMs: Number(r['latency_ms'] ?? 0),
    costUsdCents: Number(r['cost_usd_cents'] ?? 0),
    observedOutcome: (r['observed_outcome'] as ObservedOutcome | null) ?? null,
    userFollowthrough:
      (r['user_followthrough'] as UserFollowthrough | null) ?? null,
    observationPayload:
      (r['observation_payload'] as Readonly<Record<string, unknown>> | null) ??
      null,
    invokedAt:
      invoked instanceof Date ? invoked.toISOString() : (invoked as string),
    observedAt:
      observed === null || observed === undefined
        ? null
        : observed instanceof Date
          ? observed.toISOString()
          : (observed as string),
    prevHash: (r['prev_hash'] as string) ?? '',
    auditHash: r['audit_hash'] as string,
  });
}

export function createSqlIntelInvocationAuditRepository(args: {
  readonly driver: SqlIntelInvocationAuditDriver;
}): IntelInvocationAuditRepository {
  return {
    async insert(ctx) {
      await args.driver.query({
        text: `
          INSERT INTO intel_invocation_audit
            (id, tenant_id, capability_id, intel_kind, input_payload,
             output_payload, claimed_confidence, latency_ms, cost_usd_cents,
             invoked_at, prev_hash, audit_hash)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
        values: [
          ctx.id,
          ctx.tenantId,
          ctx.capabilityId,
          ctx.intelKind,
          JSON.stringify(ctx.inputPayload),
          JSON.stringify(ctx.outputPayload),
          ctx.claimedConfidence,
          ctx.latencyMs,
          ctx.costUsdCents,
          ctx.invokedAt,
          ctx.prevHash,
          ctx.auditHash,
        ],
      });
    },
    async attachObservation(observation) {
      await args.driver.query({
        text: `
          UPDATE intel_invocation_audit
             SET observed_outcome = $2,
                 user_followthrough = $3,
                 observation_payload = $4,
                 observed_at = $5
           WHERE id = $1
        `,
        values: [
          observation.invocationId,
          observation.observedOutcome,
          observation.userFollowthrough,
          JSON.stringify(observation.observationPayload),
          observation.observedAt,
        ],
      });
    },
    async findById(id) {
      const rows = await args.driver.query({
        text: `
          SELECT id, tenant_id, capability_id, intel_kind, input_payload,
                 output_payload, claimed_confidence, latency_ms, cost_usd_cents,
                 observed_outcome, user_followthrough, observation_payload,
                 invoked_at, observed_at, prev_hash, audit_hash
            FROM intel_invocation_audit
           WHERE id = $1
           LIMIT 1
        `,
        values: [id],
      });
      const first = rows[0];
      return first ? toRow(first) : null;
    },
    async listPendingObservations({ tenantId, intelKind, olderThan, limit }) {
      const rows = await args.driver.query({
        text: `
          SELECT id, tenant_id, capability_id, intel_kind, input_payload,
                 output_payload, claimed_confidence, latency_ms, cost_usd_cents,
                 observed_outcome, user_followthrough, observation_payload,
                 invoked_at, observed_at, prev_hash, audit_hash
            FROM intel_invocation_audit
           WHERE tenant_id = $1
             AND intel_kind = $2
             AND observed_outcome IS NULL
             AND invoked_at <= $3
           ORDER BY invoked_at ASC
           LIMIT $4
        `,
        values: [tenantId, intelKind, olderThan, limit],
      });
      return Object.freeze(rows.map(toRow));
    },
    async listObservedInWindow({ tenantId, intelKind, from, to }) {
      const rows = await args.driver.query({
        text: `
          SELECT id, tenant_id, capability_id, intel_kind, input_payload,
                 output_payload, claimed_confidence, latency_ms, cost_usd_cents,
                 observed_outcome, user_followthrough, observation_payload,
                 invoked_at, observed_at, prev_hash, audit_hash
            FROM intel_invocation_audit
           WHERE tenant_id = $1
             AND intel_kind = $2
             AND observed_outcome IS NOT NULL
             AND invoked_at >= $3
             AND invoked_at < $4
           ORDER BY invoked_at ASC
        `,
        values: [tenantId, intelKind, from, to],
      });
      return Object.freeze(rows.map(toRow));
    },
    async latestAuditHash({ tenantId, intelKind }) {
      const rows = await args.driver.query({
        text: `
          SELECT audit_hash
            FROM intel_invocation_audit
           WHERE tenant_id = $1
             AND intel_kind = $2
           ORDER BY invoked_at DESC
           LIMIT 1
        `,
        values: [tenantId, intelKind],
      });
      const first = rows[0];
      return first ? ((first['audit_hash'] as string) ?? '') : '';
    },
  };
}
