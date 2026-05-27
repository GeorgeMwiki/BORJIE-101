/**
 * intel_skill_traces repository — port + in-memory + SQL adapters.
 *
 * Voyager-style skill library (Wang et al., "Voyager: An Open-Ended
 * Embodied Agent with Large Language Models", arXiv 2305.16291, May
 * 2023, https://arxiv.org/abs/2305.16291). Each row counts how often
 * Mr. Mwikila's calls under the same `(tenant_id, intel_kind,
 * pattern_signature)` triple succeeded or failed. The skill library
 * lets the agent recall what worked.
 *
 * UNIQUE on the triple; the in-memory adapter mirrors this so tests do
 * not need a database.
 *
 * @module @borjie/intel-self-improve/repositories/intel-skill-traces-repository
 */

import { hashChainEntry } from '@borjie/audit-hash-chain';
import type { IntelKind, IntelSkillTrace } from '../types.js';

// ---------------------------------------------------------------------------
// Tick input — the wrapper hands the repo this on every call
// ---------------------------------------------------------------------------

export interface SkillTraceTickInput {
  readonly id: string;
  readonly tenantId: string;
  readonly intelKind: IntelKind;
  readonly patternSignature: string;
  readonly capabilityId: string;
  readonly success: boolean;
  readonly seenAt: string;
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface IntelSkillTracesRepository {
  tick(input: SkillTraceTickInput): Promise<IntelSkillTrace>;
  findByPattern(args: {
    readonly tenantId: string;
    readonly intelKind: IntelKind;
    readonly patternSignature: string;
  }): Promise<IntelSkillTrace | null>;
  listByTenantKind(args: {
    readonly tenantId: string;
    readonly intelKind: IntelKind;
    readonly limit: number;
  }): Promise<ReadonlyArray<IntelSkillTrace>>;
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

export function createInMemoryIntelSkillTracesRepository(): IntelSkillTracesRepository {
  const byPattern = new Map<string, IntelSkillTrace>();

  function keyOf(t: string, k: string, s: string): string {
    return `${t}::${k}::${s}`;
  }

  return {
    async tick(input) {
      const key = keyOf(input.tenantId, input.intelKind, input.patternSignature);
      const existing = byPattern.get(key);
      const auditHash = hashChainEntry({
        prev: existing ? existing.auditHash : '',
        payload: {
          tenantId: input.tenantId,
          intelKind: input.intelKind,
          patternSignature: input.patternSignature,
          capabilityId: input.capabilityId,
          success: input.success,
          seenAt: input.seenAt,
        },
      });
      const next: IntelSkillTrace = existing
        ? Object.freeze({
            ...existing,
            successCount: existing.successCount + (input.success ? 1 : 0),
            failureCount: existing.failureCount + (input.success ? 0 : 1),
            lastCapabilityId: input.capabilityId,
            lastSeenAt: input.seenAt,
            prevHash: existing.auditHash,
            auditHash,
          })
        : Object.freeze({
            id: input.id,
            tenantId: input.tenantId,
            intelKind: input.intelKind,
            patternSignature: input.patternSignature,
            successCount: input.success ? 1 : 0,
            failureCount: input.success ? 0 : 1,
            lastCapabilityId: input.capabilityId,
            firstSeenAt: input.seenAt,
            lastSeenAt: input.seenAt,
            prevHash: '',
            auditHash,
          });
      byPattern.set(key, next);
      return next;
    },
    async findByPattern({ tenantId, intelKind, patternSignature }) {
      return byPattern.get(keyOf(tenantId, intelKind, patternSignature)) ?? null;
    },
    async listByTenantKind({ tenantId, intelKind, limit }) {
      const out: Array<IntelSkillTrace> = [];
      for (const v of byPattern.values()) {
        if (v.tenantId === tenantId && v.intelKind === intelKind) {
          out.push(v);
          if (out.length >= limit) break;
        }
      }
      return Object.freeze(out);
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter
// ---------------------------------------------------------------------------

export interface SqlIntelSkillTracesDriver {
  query(args: {
    readonly text: string;
    readonly values: ReadonlyArray<unknown>;
  }): Promise<ReadonlyArray<Record<string, unknown>>>;
}

function toRow(r: Record<string, unknown>): IntelSkillTrace {
  const first = r['first_seen_at'];
  const last = r['last_seen_at'];
  return Object.freeze({
    id: r['id'] as string,
    tenantId: r['tenant_id'] as string,
    intelKind: r['intel_kind'] as IntelKind,
    patternSignature: r['pattern_signature'] as string,
    successCount: Number(r['success_count'] ?? 0),
    failureCount: Number(r['failure_count'] ?? 0),
    lastCapabilityId: (r['last_capability_id'] as string | null) ?? null,
    firstSeenAt: first instanceof Date ? first.toISOString() : (first as string),
    lastSeenAt: last instanceof Date ? last.toISOString() : (last as string),
    prevHash: (r['prev_hash'] as string) ?? '',
    auditHash: r['audit_hash'] as string,
  });
}

export function createSqlIntelSkillTracesRepository(args: {
  readonly driver: SqlIntelSkillTracesDriver;
}): IntelSkillTracesRepository {
  return {
    async tick(input) {
      const existing = await args.driver.query({
        text: `
          SELECT id, tenant_id, intel_kind, pattern_signature, success_count,
                 failure_count, last_capability_id, first_seen_at, last_seen_at,
                 prev_hash, audit_hash
            FROM intel_skill_traces
           WHERE tenant_id = $1
             AND intel_kind = $2
             AND pattern_signature = $3
           LIMIT 1
        `,
        values: [input.tenantId, input.intelKind, input.patternSignature],
      });
      const existingRow = existing[0] ? toRow(existing[0]) : null;
      const auditHash = hashChainEntry({
        prev: existingRow ? existingRow.auditHash : '',
        payload: {
          tenantId: input.tenantId,
          intelKind: input.intelKind,
          patternSignature: input.patternSignature,
          capabilityId: input.capabilityId,
          success: input.success,
          seenAt: input.seenAt,
        },
      });
      if (existingRow) {
        await args.driver.query({
          text: `
            UPDATE intel_skill_traces
               SET success_count = success_count + $2,
                   failure_count = failure_count + $3,
                   last_capability_id = $4,
                   last_seen_at = $5,
                   prev_hash = $6,
                   audit_hash = $7
             WHERE id = $1
          `,
          values: [
            existingRow.id,
            input.success ? 1 : 0,
            input.success ? 0 : 1,
            input.capabilityId,
            input.seenAt,
            existingRow.auditHash,
            auditHash,
          ],
        });
        return Object.freeze({
          ...existingRow,
          successCount: existingRow.successCount + (input.success ? 1 : 0),
          failureCount: existingRow.failureCount + (input.success ? 0 : 1),
          lastCapabilityId: input.capabilityId,
          lastSeenAt: input.seenAt,
          prevHash: existingRow.auditHash,
          auditHash,
        });
      }
      await args.driver.query({
        text: `
          INSERT INTO intel_skill_traces
            (id, tenant_id, intel_kind, pattern_signature, success_count,
             failure_count, last_capability_id, first_seen_at, last_seen_at,
             prev_hash, audit_hash)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        values: [
          input.id,
          input.tenantId,
          input.intelKind,
          input.patternSignature,
          input.success ? 1 : 0,
          input.success ? 0 : 1,
          input.capabilityId,
          input.seenAt,
          input.seenAt,
          '',
          auditHash,
        ],
      });
      return Object.freeze({
        id: input.id,
        tenantId: input.tenantId,
        intelKind: input.intelKind,
        patternSignature: input.patternSignature,
        successCount: input.success ? 1 : 0,
        failureCount: input.success ? 0 : 1,
        lastCapabilityId: input.capabilityId,
        firstSeenAt: input.seenAt,
        lastSeenAt: input.seenAt,
        prevHash: '',
        auditHash,
      });
    },
    async findByPattern({ tenantId, intelKind, patternSignature }) {
      const rows = await args.driver.query({
        text: `
          SELECT id, tenant_id, intel_kind, pattern_signature, success_count,
                 failure_count, last_capability_id, first_seen_at, last_seen_at,
                 prev_hash, audit_hash
            FROM intel_skill_traces
           WHERE tenant_id = $1
             AND intel_kind = $2
             AND pattern_signature = $3
           LIMIT 1
        `,
        values: [tenantId, intelKind, patternSignature],
      });
      const first = rows[0];
      return first ? toRow(first) : null;
    },
    async listByTenantKind({ tenantId, intelKind, limit }) {
      const rows = await args.driver.query({
        text: `
          SELECT id, tenant_id, intel_kind, pattern_signature, success_count,
                 failure_count, last_capability_id, first_seen_at, last_seen_at,
                 prev_hash, audit_hash
            FROM intel_skill_traces
           WHERE tenant_id = $1
             AND intel_kind = $2
           ORDER BY last_seen_at DESC
           LIMIT $3
        `,
        values: [tenantId, intelKind, limit],
      });
      return Object.freeze(rows.map(toRow));
    },
  };
}
