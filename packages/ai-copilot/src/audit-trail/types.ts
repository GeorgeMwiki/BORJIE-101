/**
 * Audit Trail v2 — Wave 27 Agent C.
 *
 * Cryptographically-verifiable audit trail spanning every AI action and every
 * human intervention/approval. The module is storage-agnostic: a repository
 * port is injected so Postgres in prod + in-memory in tests use the same
 * service logic.
 *
 * Type contract ONLY — no runtime code lives here.
 */

// ---------------------------------------------------------------------------
// Enumerations (string-literal unions, matched by the DB CHECK constraints)
// ---------------------------------------------------------------------------

/** Actor classification — human/AI/system, matching migration 0111. */
export type AuditActorKind =
  | 'ai_autonomous'
  | 'ai_proposal'
  | 'ai_execution'
  | 'human_approval'
  | 'human_override'
  | 'human_action'
  | 'system';

/** Eleven named domains + `other`, matching migration 0111. */
export type AuditActionCategory =
  | 'finance'
  | 'leasing'
  | 'maintenance'
  | 'compliance'
  | 'communications'
  | 'marketing'
  | 'hr'
  | 'procurement'
  | 'insurance'
  | 'legal'
  | 'tenant_welfare'
  | 'other';

/** The decision captured by this row. Free-form but these values dominate. */
export type AuditDecision =
  | 'allow'
  | 'deny'
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'cancelled'
  | 'noop'
  | (string & Record<never, never>);

/** A single audit-trail entry as persisted. Read-only everywhere. */
export interface AuditTrailEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly sequenceId: number;
  readonly occurredAt: string;          // ISO-8601
  readonly actorKind: AuditActorKind;
  readonly actorId: string | null;
  readonly actorDisplay: string | null;
  readonly actionKind: string;          // stable verb e.g. "arrears.case_opened"
  readonly actionCategory: AuditActionCategory;
  readonly subjectEntityType: string | null;
  readonly subjectEntityId: string | null;
  readonly resourceUri: string | null;
  readonly aiModelVersion: string | null;
  readonly promptHash: string | null;
  readonly promptTokensIn: number | null;
  readonly promptTokensOut: number | null;
  readonly costUsdMicro: number | null;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly decision: AuditDecision;
  readonly prevHash: string;
  readonly thisHash: string;
  readonly signature: string | null;
  readonly createdAt: string;
}

/** Input shape for the `record` call — the caller supplies domain fields;
 *  sequenceId, prevHash, thisHash, signature are computed by the recorder. */
export interface AuditActor {
  readonly kind: AuditActorKind;
  readonly id?: string | null;
  readonly display?: string | null;
}

export interface AuditAiEvidence {
  readonly modelVersion?: string | null;
  readonly promptHash?: string | null;
  readonly promptTokensIn?: number | null;
  readonly promptTokensOut?: number | null;
  readonly costUsdMicro?: number | null;
  /** Arbitrary attachments: sources consulted, tool calls, reasoning refs. */
  readonly attachments?: Readonly<Record<string, unknown>>;
}

export interface AuditSubject {
  readonly entityType?: string | null;
  readonly entityId?: string | null;
  readonly resourceUri?: string | null;
}

export interface RecordAuditInput {
  readonly tenantId: string;
  readonly actor: AuditActor;
  readonly actionKind: string;
  readonly actionCategory: AuditActionCategory;
  readonly subject?: AuditSubject;
  readonly ai?: AuditAiEvidence;
  readonly decision?: AuditDecision;
  readonly occurredAt?: Date;
}

// ---------------------------------------------------------------------------
// Chain-port: implementations back onto Postgres or an in-memory store.
// ---------------------------------------------------------------------------
export interface AuditTrailRepository {
  /** Insert an already-hashed, already-signed row. MUST be idempotent on id. */
  insert(entry: AuditTrailEntry): Promise<AuditTrailEntry>;

  /** Latest row for a tenant (by sequenceId) — needed to compute prev_hash. */
  getLatest(tenantId: string): Promise<AuditTrailEntry | null>;

  /** List rows in sequence order, optionally clipped to a time window. */
  list(
    tenantId: string,
    options?: {
      readonly from?: Date;
      readonly to?: Date;
      readonly category?: AuditActionCategory;
      readonly actorKind?: AuditActorKind;
      readonly limit?: number;
      readonly offset?: number;
    },
  ): Promise<readonly AuditTrailEntry[]>;

  /** Count matching rows (for pagination totals). */
  count(
    tenantId: string,
    options?: {
      readonly from?: Date;
      readonly to?: Date;
      readonly category?: AuditActionCategory;
      readonly actorKind?: AuditActorKind;
    },
  ): Promise<number>;
}

/** Port the recorder/verifier talk to. Subset of the repository is enough
 *  for the hash-chain logic — kept separate so tests can pass tiny stubs. */
export interface HashChainPort {
  getLatest(tenantId: string): Promise<AuditTrailEntry | null>;
  insert(entry: AuditTrailEntry): Promise<AuditTrailEntry>;
}

// ---------------------------------------------------------------------------
// Verifier result shape
// ---------------------------------------------------------------------------
export interface VerifyRangeResult {
  readonly valid: boolean;
  readonly entriesChecked: number;
  readonly brokenAt?: number;          // sequenceId of the first bad row
  readonly firstValidAt?: string;
  readonly lastValidAt?: string;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Exported constant — callers reference this as the genesis prev_hash.
// ---------------------------------------------------------------------------
export const GENESIS_PREV_HASH_V2 =
  'GENESIS_AUDIT_TRAIL_V2_0000000000000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// Signing-secret env var name — centralised so mis-typos are caught once.
// ---------------------------------------------------------------------------
export const AUDIT_TRAIL_SIGNING_SECRET_ENV = 'AUDIT_TRAIL_SIGNING_SECRET';
