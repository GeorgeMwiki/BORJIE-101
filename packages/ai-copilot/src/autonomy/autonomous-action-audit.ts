/**
 * Autonomous action audit trail.
 *
 * Every action Mr. Mwikila takes under his own authority is logged here
 * with reasoning + evidence + confidence so the head can reconstruct
 * any decision later. The `chainId` links a row into the Wave-11
 * ai_audit_chain for tamper-evident integrity — the chain hashes are
 * computed by the existing audit module; we just record the link.
 */

export type AuditDomain =
  | 'finance'
  | 'leasing'
  | 'maintenance'
  | 'compliance'
  | 'communications'
  | 'strategic';

export interface AuditEvidenceRef {
  readonly kind: string;
  readonly id: string;
}

export interface AutonomousActionRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly actorPersona: string;
  readonly action: string;
  readonly domain: AuditDomain;
  readonly targetEntityKind: string | null;
  readonly targetEntityId: string | null;
  readonly reasoning: string;
  readonly evidenceRefs: readonly AuditEvidenceRef[];
  readonly confidence: number;
  readonly policyRuleMatched: string | null;
  readonly chainId: string | null;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: string | null;
  readonly createdAt: string;
}

export interface RecordActionInput {
  readonly tenantId: string;
  readonly actorPersona: string;
  readonly action: string;
  readonly domain: AuditDomain;
  readonly targetEntityKind?: string;
  readonly targetEntityId?: string;
  readonly reasoning: string;
  readonly evidenceRefs?: readonly AuditEvidenceRef[];
  readonly confidence: number;
  readonly policyRuleMatched?: string;
  readonly chainId?: string;
}

export interface ListAuditFilters {
  readonly domain?: AuditDomain;
  readonly since?: Date;
  readonly limit?: number;
}

export interface AutonomousActionAuditRepository {
  insert(record: AutonomousActionRecord): Promise<AutonomousActionRecord>;
  list(tenantId: string, filters: ListAuditFilters): Promise<readonly AutonomousActionRecord[]>;
  countSince(tenantId: string, since: Date): Promise<number>;
}

export interface AutonomousActionAuditDeps {
  readonly repository: AutonomousActionAuditRepository;
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
  readonly chainAppender?: (record: AutonomousActionRecord) => Promise<string | null>;
}

export class AutonomousActionAudit {
  private readonly deps: AutonomousActionAuditDeps;

  constructor(deps: AutonomousActionAuditDeps) {
    this.deps = deps;
  }

  async record(input: RecordActionInput): Promise<AutonomousActionRecord> {
    const confidence = clamp01(input.confidence);
    const now = this.deps.clock?.() ?? new Date();
    const initial: AutonomousActionRecord = {
      id: this.deps.idFactory?.() ?? `auton_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: input.tenantId,
      actorPersona: input.actorPersona,
      action: input.action,
      domain: input.domain,
      targetEntityKind: input.targetEntityKind ?? null,
      targetEntityId: input.targetEntityId ?? null,
      reasoning: input.reasoning,
      evidenceRefs: input.evidenceRefs ?? [],
      confidence,
      policyRuleMatched: input.policyRuleMatched ?? null,
      chainId: input.chainId ?? null,
      reviewedByUserId: null,
      reviewedAt: null,
      createdAt: now.toISOString(),
    };
    // Persist first so the chainId can be back-filled atomically.
    const inserted = await this.deps.repository.insert(initial);
    if (!this.deps.chainAppender) return inserted;
    try {
      const chainId = await this.deps.chainAppender(inserted);
      if (!chainId) return inserted;
      const next: AutonomousActionRecord = { ...inserted, chainId };
      return this.deps.repository.insert(next);
    } catch {
      return inserted;
    }
  }

  async list(
    tenantId: string,
    filters: ListAuditFilters = {},
  ): Promise<readonly AutonomousActionRecord[]> {
    return this.deps.repository.list(tenantId, filters);
  }

  async countThisWeek(tenantId: string, now: Date = new Date()): Promise<number> {
    const sevenDays = new Date(now.getTime() - 7 * 24 * 3_600_000);
    return this.deps.repository.countSince(tenantId, sevenDays);
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** In-memory repo for tests + degraded mode. */
export class InMemoryAutonomousActionAuditRepository
  implements AutonomousActionAuditRepository
{
  private readonly store: AutonomousActionRecord[] = [];

  async insert(record: AutonomousActionRecord): Promise<AutonomousActionRecord> {
    const existingIdx = this.store.findIndex((r) => r.id === record.id);
    if (existingIdx >= 0) {
      this.store[existingIdx] = record;
    } else {
      this.store.push(record);
    }
    return record;
  }

  async list(
    tenantId: string,
    filters: ListAuditFilters,
  ): Promise<readonly AutonomousActionRecord[]> {
    const sinceIso = filters.since?.toISOString();
    const rows = this.store
      .filter((r) => r.tenantId === tenantId)
      .filter((r) => (filters.domain ? r.domain === filters.domain : true))
      .filter((r) => (sinceIso ? r.createdAt >= sinceIso : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return filters.limit ? rows.slice(0, filters.limit) : rows;
  }

  async countSince(tenantId: string, since: Date): Promise<number> {
    const iso = since.toISOString();
    return this.store.filter(
      (r) => r.tenantId === tenantId && r.createdAt >= iso,
    ).length;
  }
}
