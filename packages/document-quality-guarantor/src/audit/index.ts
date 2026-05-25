/**
 * Audit chain — the WORM-style ledger every other subsystem appends to.
 *
 * Each entry records exactly what happened: which engine ran, what
 * gate passed/failed, what retry counted, what escalation fired. The
 * chain hash links each entry to its predecessor so any tampering
 * (or missing entry) is detectable.
 *
 * The default store is in-memory and replay-safe inside a single
 * process. Production wires a `AuditChainStore` implementation
 * backed by the existing WORM table in `@borjie/document-studio/
 * signing/worm-audit`. We intentionally do NOT import that package
 * directly — the spec says "bound to existing WORM audit primitive
 * where wired; in-memory fallback otherwise."
 */

import type { AuditEntryId, EngineId, IntakeId, OutputId, TenantId } from '../types.js';
import { sha256HexSync } from './sha256.js';

export const AUDIT_EVENT_KINDS = [
  'intake_engine_attempt',
  'intake_engine_success',
  'intake_engine_failure',
  'output_engine_attempt',
  'output_engine_success',
  'output_engine_failure',
  'quality_gate_pass',
  'quality_gate_block',
  'retry_scheduled',
  'retry_dlq',
  'escalation_dispatched',
  'format_routed',
] as const;
export type AuditEventKind = (typeof AUDIT_EVENT_KINDS)[number];

export interface AuditEntry {
  readonly id: AuditEntryId;
  readonly tenantId: TenantId;
  readonly kind: AuditEventKind;
  /** Logical operation id this entry belongs to (intake/output id). */
  readonly operationId: IntakeId | OutputId | string;
  /** Engine that triggered the entry; null for non-engine events. */
  readonly engineId: EngineId | null;
  /** Free-form structured details — keep small + JSON-serializable. */
  readonly details: Readonly<Record<string, unknown>>;
  readonly recordedAtIso: string;
  readonly previousChainHash: string | null;
  readonly chainHash: string;
}

export interface AuditChainStore {
  append(input: Omit<AuditEntry, 'id' | 'previousChainHash' | 'chainHash'>): Promise<AuditEntry>;
  /** All entries for a tenant in append order. */
  list(tenantId: TenantId): Promise<ReadonlyArray<AuditEntry>>;
  /** All entries scoped to one operation (intakeId/outputId). */
  listByOperation(tenantId: TenantId, operationId: string): Promise<ReadonlyArray<AuditEntry>>;
  /** Walks chain + verifies every link. Returns brokenAt index on tamper. */
  verify(tenantId: TenantId): Promise<{ readonly ok: boolean; readonly brokenAt?: number }>;
}

function computeChainHash(input: Omit<AuditEntry, 'chainHash'>): string {
  // Deterministic JSON — object keys sorted, details serialized via
  // JSON.stringify with a key-sort replacer to avoid map iteration order
  // drift between V8 versions.
  const sortedDetails = sortKeys(input.details);
  return sha256HexSync(
    JSON.stringify({
      id: input.id,
      tenantId: input.tenantId,
      kind: input.kind,
      operationId: input.operationId,
      engineId: input.engineId,
      details: sortedDetails,
      recordedAtIso: input.recordedAtIso,
      previousChainHash: input.previousChainHash,
    }),
  );
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

export function createInMemoryAuditChainStore(): AuditChainStore {
  const byTenant = new Map<TenantId, AuditEntry[]>();
  let counter = 0;

  return {
    async append(input) {
      counter += 1;
      const tail = byTenant.get(input.tenantId) ?? [];
      const previous = tail.length > 0 ? tail[tail.length - 1]! : null;
      const id = `audit-${Date.now()}-${counter}`;
      const previousChainHash = previous?.chainHash ?? null;
      const draft: Omit<AuditEntry, 'chainHash'> = { ...input, id, previousChainHash };
      const chainHash = computeChainHash(draft);
      const entry: AuditEntry = Object.freeze({ ...draft, chainHash });
      tail.push(entry);
      byTenant.set(input.tenantId, tail);
      return entry;
    },
    async list(tenantId) {
      return Object.freeze([...(byTenant.get(tenantId) ?? [])]);
    },
    async listByOperation(tenantId, operationId) {
      const all = byTenant.get(tenantId) ?? [];
      return Object.freeze(all.filter((e) => e.operationId === operationId));
    },
    async verify(tenantId) {
      const tail = byTenant.get(tenantId) ?? [];
      let prevHash: string | null = null;
      for (let i = 0; i < tail.length; i += 1) {
        const entry = tail[i]!;
        if (entry.previousChainHash !== prevHash) {
          return { ok: false, brokenAt: i };
        }
        const recomputed = computeChainHash({
          id: entry.id,
          tenantId: entry.tenantId,
          kind: entry.kind,
          operationId: entry.operationId,
          engineId: entry.engineId,
          details: entry.details,
          recordedAtIso: entry.recordedAtIso,
          previousChainHash: entry.previousChainHash,
        });
        if (recomputed !== entry.chainHash) {
          return { ok: false, brokenAt: i };
        }
        prevHash = entry.chainHash;
      }
      return { ok: true };
    },
  };
}

/**
 * Replay-able view of a single operation's life cycle.
 *
 * Given an intakeId or outputId, reconstruct EXACTLY which engines
 * were tried, in what order, with what scores. The replay is the
 * forensic primitive that proves "we never lost a doc — we tried
 * X, Y, Z, escalated, and a human took over at this exact moment."
 */
export interface OperationReplay {
  readonly operationId: string;
  readonly attemptsByEngine: ReadonlyArray<{
    readonly engineId: EngineId;
    readonly attempts: number;
    readonly succeeded: boolean;
    readonly lastFailureReason: string | null;
  }>;
  readonly gateVerdicts: ReadonlyArray<{
    readonly gateId: string;
    readonly passed: boolean;
    readonly score: number;
  }>;
  readonly retries: number;
  readonly escalated: boolean;
}

export async function replayOperation(
  store: AuditChainStore,
  tenantId: TenantId,
  operationId: string,
): Promise<OperationReplay> {
  const entries = await store.listByOperation(tenantId, operationId);
  const engineMap = new Map<
    EngineId,
    { attempts: number; succeeded: boolean; lastFailureReason: string | null }
  >();
  const gateVerdicts: Array<{ gateId: string; passed: boolean; score: number }> = [];
  let retries = 0;
  let escalated = false;

  for (const e of entries) {
    if (
      (e.kind === 'intake_engine_attempt' || e.kind === 'output_engine_attempt') &&
      e.engineId !== null
    ) {
      const prior = engineMap.get(e.engineId) ?? {
        attempts: 0,
        succeeded: false,
        lastFailureReason: null,
      };
      engineMap.set(e.engineId, { ...prior, attempts: prior.attempts + 1 });
    }
    if (
      (e.kind === 'intake_engine_success' || e.kind === 'output_engine_success') &&
      e.engineId !== null
    ) {
      const prior = engineMap.get(e.engineId) ?? {
        attempts: 0,
        succeeded: false,
        lastFailureReason: null,
      };
      engineMap.set(e.engineId, { ...prior, succeeded: true });
    }
    if (
      (e.kind === 'intake_engine_failure' || e.kind === 'output_engine_failure') &&
      e.engineId !== null
    ) {
      const prior = engineMap.get(e.engineId) ?? {
        attempts: 0,
        succeeded: false,
        lastFailureReason: null,
      };
      const reason = typeof e.details['error'] === 'string' ? (e.details['error'] as string) : null;
      engineMap.set(e.engineId, { ...prior, lastFailureReason: reason });
    }
    if (e.kind === 'quality_gate_pass' || e.kind === 'quality_gate_block') {
      const gateId = typeof e.details['gateId'] === 'string' ? (e.details['gateId'] as string) : '';
      const score = typeof e.details['score'] === 'number' ? (e.details['score'] as number) : 0;
      gateVerdicts.push({ gateId, passed: e.kind === 'quality_gate_pass', score });
    }
    if (e.kind === 'retry_scheduled') retries += 1;
    if (e.kind === 'escalation_dispatched') escalated = true;
  }

  return Object.freeze({
    operationId,
    attemptsByEngine: Object.freeze(
      Array.from(engineMap.entries()).map(([engineId, summary]) =>
        Object.freeze({ engineId, ...summary }),
      ),
    ),
    gateVerdicts: Object.freeze(gateVerdicts),
    retries,
    escalated,
  });
}
