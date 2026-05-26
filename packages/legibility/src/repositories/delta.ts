/**
 * In-memory `LegibilityDeltaRepository`.
 *
 * Wave M6. Pure-memory adapter for tests + dev. The database package
 * wires the real Drizzle adapter against `legibility_deltas` from
 * migration 0037.
 */

import { randomUUID } from 'node:crypto';
import { computeLegibilityAuditHash } from '../audit/audit-chain-link.js';
import type {
  LegibilityDelta,
  LegibilityDeltaKind,
  LegibilityDeltaRepository,
} from '../types.js';

export interface AppendDeltaInput {
  readonly tenantId: string;
  readonly scopeId: string;
  readonly deltaKind: LegibilityDeltaKind;
  readonly payload: Readonly<Record<string, unknown>>;
}

export function createInMemoryDeltaRepository(deps?: {
  readonly now?: () => Date;
  readonly nextId?: () => string;
}): LegibilityDeltaRepository & {
  readonly enqueue: (input: AppendDeltaInput) => Promise<LegibilityDelta>;
} {
  const now = deps?.now ?? (() => new Date());
  const nextId = deps?.nextId ?? (() => randomUUID());
  const rows: LegibilityDelta[] = [];

  return {
    async append(delta: LegibilityDelta): Promise<LegibilityDelta> {
      const frozen = Object.freeze({ ...delta });
      rows.push(frozen);
      return frozen;
    },

    async listSinceSnapshot(
      tenantId: string,
      scopeId: string,
      snapshotAt: Date,
    ): Promise<ReadonlyArray<LegibilityDelta>> {
      return rows.filter(
        (d) =>
          d.tenantId === tenantId &&
          d.scopeId === scopeId &&
          d.recordedAt.getTime() > snapshotAt.getTime(),
      );
    },

    /**
     * Convenience — build + persist a delta from a shorthand input.
     * Audit hash chains from the last delta's hash for this scope.
     */
    async enqueue(input: AppendDeltaInput): Promise<LegibilityDelta> {
      const previousForScope = rows
        .filter((d) => d.tenantId === input.tenantId && d.scopeId === input.scopeId)
        .pop();
      const prevHash =
        previousForScope === undefined ? 'GENESIS' : previousForScope.auditHash;
      const recordedAt = now();
      const auditHash = computeLegibilityAuditHash(
        {
          op: 'legibility.delta',
          tenantId: input.tenantId,
          scopeId: input.scopeId,
          deltaKind: input.deltaKind,
          recordedAtMs: recordedAt.getTime(),
        },
        prevHash,
      );
      const delta: LegibilityDelta = Object.freeze({
        id: nextId(),
        tenantId: input.tenantId,
        scopeId: input.scopeId,
        deltaKind: input.deltaKind,
        payload: input.payload,
        recordedAt,
        auditHash,
      });
      rows.push(delta);
      return delta;
    },
  };
}
