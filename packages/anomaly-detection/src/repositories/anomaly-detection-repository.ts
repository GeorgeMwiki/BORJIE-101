/**
 * Anomaly detection repository — Mr. Mwikila persona.
 *
 * Two adapters: in-memory (tests + the package's default composition
 * root) and an SQL adapter port. The SQL adapter is wired by the host
 * service against drizzle at the composition root; this package
 * itself stays drizzle-free so it can be imported from the edge.
 *
 * Rows are frozen on insert. Anomaly verdicts are **immutable** by
 * design — once written, only new verdicts may be appended; mutation
 * is forbidden. This mirrors the audit pattern used in
 * `dynamic_authored_recipes` (migration 0066).
 *
 * Audit-chain: every insert is `prev_hash`-linked to the previous
 * row in the same tenant's chain. The hash is computed from the
 * canonical JSON encoding of
 *   { op, tenantId, detector, target, value, score, threshold,
 *     anomalous, evidence, detectedAtIso }
 * and the previous hash.
 *
 * @module @borjie/anomaly-detection/repositories/anomaly-detection-repository
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
  AnomalyDetectionInsertInput,
  AnomalyDetectionRepository,
  AnomalyDetectionRow,
} from '../types.js';

export const GENESIS_HASH = '';

/**
 * Canonical-JSON SHA-256 hash of a verdict, chained against the prior
 * hash. Mirrors the audit pattern used elsewhere in BORJIE.
 */
export function computeAnomalyAuditHash(
  payload: {
    readonly op: 'insert';
    readonly tenantId: string;
    readonly detector: string;
    readonly target: string;
    readonly value: number;
    readonly score: number;
    readonly threshold: number;
    readonly anomalous: boolean;
    readonly evidence: Readonly<Record<string, unknown>>;
    readonly detectedAtIso: string;
  },
  prevHash: string,
): string {
  // Sort keys deterministically for stable hashing.
  const evidenceKeys = Object.keys(payload.evidence).sort();
  const evidenceStable: Record<string, unknown> = {};
  for (const k of evidenceKeys) evidenceStable[k] = payload.evidence[k];
  const canonical = JSON.stringify({
    op: payload.op,
    tenantId: payload.tenantId,
    detector: payload.detector,
    target: payload.target,
    value: payload.value,
    score: payload.score,
    threshold: payload.threshold,
    anomalous: payload.anomalous,
    evidence: evidenceStable,
    detectedAtIso: payload.detectedAtIso,
    prevHash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// ──────────────────────────────────────────────────────────────────
// In-memory adapter.
// ──────────────────────────────────────────────────────────────────

export interface InMemoryAnomalyDetectionRepoDeps {
  readonly now: () => Date;
}

const DEFAULT_DEPS: InMemoryAnomalyDetectionRepoDeps = {
  now: () => new Date(),
};

export function createInMemoryAnomalyDetectionRepository(
  deps: InMemoryAnomalyDetectionRepoDeps = DEFAULT_DEPS,
): AnomalyDetectionRepository {
  const rows = new Map<string, AnomalyDetectionRow>();
  const chainHead = new Map<string, string>();

  function head(tenantId: string): string {
    return chainHead.get(tenantId) ?? GENESIS_HASH;
  }

  return {
    async insert(input: AnomalyDetectionInsertInput): Promise<AnomalyDetectionRow> {
      if (input.tenantId.length === 0) {
        throw new Error('insert: tenantId must be non-empty');
      }
      if (input.detector.length === 0) {
        throw new Error('insert: detector must be non-empty');
      }
      if (input.target.length === 0) {
        throw new Error('insert: target must be non-empty');
      }
      const detectedAt = deps.now();
      const detectedAtIso = detectedAt.toISOString();
      const prevHash = head(input.tenantId);
      const auditHash = computeAnomalyAuditHash(
        {
          op: 'insert' as const,
          tenantId: input.tenantId,
          detector: input.detector,
          target: input.target,
          value: input.value,
          score: input.score,
          threshold: input.threshold,
          anomalous: input.anomalous,
          evidence: input.evidence,
          detectedAtIso,
        },
        prevHash,
      );
      const id = randomUUID();
      const row: AnomalyDetectionRow = Object.freeze({
        id,
        tenantId: input.tenantId,
        detector: input.detector,
        target: input.target,
        value: input.value,
        score: input.score,
        threshold: input.threshold,
        anomalous: input.anomalous,
        evidence: Object.freeze({ ...input.evidence }),
        detectedAt,
        prevHash,
        auditHash,
      });
      rows.set(id, row);
      chainHead.set(input.tenantId, auditHash);
      return row;
    },

    async findById(id: string): Promise<AnomalyDetectionRow | null> {
      return rows.get(id) ?? null;
    },

    async listByTenant(
      tenantId: string,
      options: { readonly limit?: number; readonly anomalousOnly?: boolean } = {},
    ): Promise<ReadonlyArray<AnomalyDetectionRow>> {
      const all = [...rows.values()]
        .filter((r) => r.tenantId === tenantId)
        .filter((r) => (options.anomalousOnly ? r.anomalous : true))
        .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
      return options.limit !== undefined ? all.slice(0, options.limit) : all;
    },

    async listByTarget(
      tenantId: string,
      target: string,
      options: { readonly limit?: number } = {},
    ): Promise<ReadonlyArray<AnomalyDetectionRow>> {
      const all = [...rows.values()]
        .filter((r) => r.tenantId === tenantId && r.target === target)
        .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
      return options.limit !== undefined ? all.slice(0, options.limit) : all;
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// SQL adapter — port-style.
//
// This file does NOT depend on drizzle; the host service supplies a
// minimal executor that runs parameterised SQL. The function shape
// below is the contract the host's drizzle composition root
// implements.
// ──────────────────────────────────────────────────────────────────

export interface SqlExecutor {
  readonly insert: (params: {
    readonly tenantId: string;
    readonly detector: string;
    readonly target: string;
    readonly value: number;
    readonly score: number;
    readonly threshold: number;
    readonly anomalous: boolean;
    readonly evidence: Readonly<Record<string, unknown>>;
    readonly detectedAt: Date;
    readonly prevHash: string;
    readonly auditHash: string;
  }) => Promise<{ readonly id: string }>;
  readonly findById: (id: string) => Promise<AnomalyDetectionRow | null>;
  readonly listByTenant: (
    tenantId: string,
    limit: number,
    anomalousOnly: boolean,
  ) => Promise<ReadonlyArray<AnomalyDetectionRow>>;
  readonly listByTarget: (
    tenantId: string,
    target: string,
    limit: number,
  ) => Promise<ReadonlyArray<AnomalyDetectionRow>>;
  readonly headHash: (tenantId: string) => Promise<string>;
}

export function createSqlAnomalyDetectionRepository(
  executor: SqlExecutor,
  deps: InMemoryAnomalyDetectionRepoDeps = DEFAULT_DEPS,
): AnomalyDetectionRepository {
  return {
    async insert(input) {
      const detectedAt = deps.now();
      const detectedAtIso = detectedAt.toISOString();
      const prevHash = await executor.headHash(input.tenantId);
      const auditHash = computeAnomalyAuditHash(
        {
          op: 'insert' as const,
          tenantId: input.tenantId,
          detector: input.detector,
          target: input.target,
          value: input.value,
          score: input.score,
          threshold: input.threshold,
          anomalous: input.anomalous,
          evidence: input.evidence,
          detectedAtIso,
        },
        prevHash,
      );
      const { id } = await executor.insert({
        tenantId: input.tenantId,
        detector: input.detector,
        target: input.target,
        value: input.value,
        score: input.score,
        threshold: input.threshold,
        anomalous: input.anomalous,
        evidence: input.evidence,
        detectedAt,
        prevHash,
        auditHash,
      });
      return Object.freeze({
        id,
        tenantId: input.tenantId,
        detector: input.detector,
        target: input.target,
        value: input.value,
        score: input.score,
        threshold: input.threshold,
        anomalous: input.anomalous,
        evidence: Object.freeze({ ...input.evidence }),
        detectedAt,
        prevHash,
        auditHash,
      });
    },
    findById: (id) => executor.findById(id),
    listByTenant: (tenantId, options = {}) =>
      executor.listByTenant(
        tenantId,
        options.limit ?? 100,
        options.anomalousOnly ?? false,
      ),
    listByTarget: (tenantId, target, options = {}) =>
      executor.listByTarget(tenantId, target, options.limit ?? 100),
  };
}
