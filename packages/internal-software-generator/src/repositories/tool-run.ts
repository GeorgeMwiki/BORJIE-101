/**
 * `internal_tool_runs` repository.
 *
 * In-memory implementation. Insert returns the persisted row with
 * `auditHash` set. Frozen on insert.
 */

import { randomUUID } from 'node:crypto';
import type { ToolRun, ToolRunRepository } from '../types.js';
import { computeToolAuditHash } from '../audit/audit-chain-link.js';

export interface InMemoryToolRunRepoDeps {
  readonly now: () => Date;
}

export function createInMemoryToolRunRepository(
  deps: InMemoryToolRunRepoDeps = { now: () => new Date() },
): ToolRunRepository {
  const rows = new Map<string, ToolRun>();

  return {
    async insert(input) {
      const id = randomUUID();
      const ranAt = deps.now();
      const auditHash = computeToolAuditHash({
        op: 'tool_run',
        toolId: input.toolId,
        tenantId: input.tenantId,
        ranBy: input.ranBy,
        // The full inputs are NOT hashed — redacted fields would
        // leak into the hash domain. We hash a deterministic
        // fingerprint instead.
        inputKeys: Object.keys(input.inputs).sort(),
        outputKeys: Object.keys(input.outputs).sort(),
        ranAt: ranAt.toISOString(),
      });
      const row: ToolRun = Object.freeze({
        id,
        toolId: input.toolId,
        tenantId: input.tenantId,
        inputs: Object.freeze({ ...input.inputs }),
        outputs: Object.freeze({ ...input.outputs }),
        ranBy: input.ranBy,
        ranAt,
        auditHash,
      });
      rows.set(id, row);
      return row;
    },

    async listForTool(tenantId, toolId, limit) {
      const matches: ToolRun[] = [];
      for (const row of rows.values()) {
        if (row.tenantId === tenantId && row.toolId === toolId) {
          matches.push(row);
        }
      }
      matches.sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime());
      return matches.slice(0, Math.max(0, limit));
    },
  };
}
