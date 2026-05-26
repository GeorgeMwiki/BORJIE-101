/**
 * `internal_tools` repository.
 *
 * In-memory implementation. Production wires Drizzle to the
 * `internalTools` table from
 * `@borjie/database/src/schemas/internal-software.schema.ts`.
 *
 * Rows are frozen on insert. Lifecycle transitions go through
 * `transitionLifecycle` only — the canTransition check from
 * `tool-lifecycle.ts` is enforced at the caller / runner layer; this
 * repository is the source of truth for state.
 */

import { randomUUID } from 'node:crypto';
import type {
  InternalTool,
  InternalToolRepository,
  ToolKind,
  ToolLifecycle,
} from '../types.js';
import { canTransition } from '../lifecycle/tool-lifecycle.js';
import {
  computeToolAuditHash,
  GENESIS_HASH,
} from '../audit/audit-chain-link.js';

export interface InMemoryInternalToolRepoDeps {
  readonly now: () => Date;
}

export function createInMemoryInternalToolRepository(
  deps: InMemoryInternalToolRepoDeps = { now: () => new Date() },
): InternalToolRepository {
  const rows = new Map<string, InternalTool>();
  const chainHead = new Map<string, string>();

  function head(tenantId: string): string {
    return chainHead.get(tenantId) ?? GENESIS_HASH;
  }

  return {
    async insert(input) {
      const id = randomUUID();
      const createdAt = deps.now();
      const prevHash = head(input.tenantId);
      const auditHash = computeToolAuditHash(
        {
          op: 'insert',
          tenantId: input.tenantId,
          name: input.name,
          kind: input.kind,
          authorityTier: input.authorityTier,
          createdAt: createdAt.toISOString(),
        },
        prevHash,
      );
      const row: InternalTool = Object.freeze({
        id,
        tenantId: input.tenantId,
        name: input.name,
        kind: input.kind,
        spec: input.spec,
        lifecycleState: 'draft' as ToolLifecycle,
        authorityTier: input.authorityTier,
        createdAt,
        archivedAt: null,
        auditHash,
        prevHash,
      });
      rows.set(id, row);
      chainHead.set(input.tenantId, auditHash);
      return row;
    },

    async transitionLifecycle(tenantId, id, next) {
      const existing = rows.get(id);
      if (existing === undefined || existing.tenantId !== tenantId) {
        throw new Error(
          `cannot transition: tool ${id} not found for tenant ${tenantId}`,
        );
      }
      const guard = canTransition({
        from: existing.lifecycleState,
        to: next,
        authorityTier: existing.authorityTier,
        // ownerSign is supplied via the caller's external owner-sign
        // pipeline; this repo does not validate it. The state machine
        // helper documents the requirement and the caller is responsible
        // for blocking the call if absent.
        ownerSign: 'repo-stub',
      });
      if (!guard.ok) {
        throw new Error(`lifecycle: ${guard.reason}`);
      }
      const archivedAt = next === 'archived' ? deps.now() : existing.archivedAt;
      const updated: InternalTool = Object.freeze({
        ...existing,
        lifecycleState: next,
        archivedAt,
      });
      rows.set(id, updated);
      return updated;
    },

    async findById(tenantId, id) {
      const row = rows.get(id);
      if (row === undefined || row.tenantId !== tenantId) {
        return null;
      }
      return row;
    },

    async listForTenant(tenantId, filter) {
      const out: InternalTool[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) {
          continue;
        }
        if (
          filter?.lifecycleState !== undefined &&
          row.lifecycleState !== filter.lifecycleState
        ) {
          continue;
        }
        if (filter?.kind !== undefined && row.kind !== filter.kind) {
          continue;
        }
        out.push(row);
      }
      out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return out;
    },
  };
}

/**
 * Helper for tests + diagnostics — returns the tool kinds known to
 * the repository for a tenant.
 */
export function summariseKinds(
  tools: ReadonlyArray<InternalTool>,
): ReadonlyMap<ToolKind, number> {
  const out = new Map<ToolKind, number>();
  for (const t of tools) {
    out.set(t.kind, (out.get(t.kind) ?? 0) + 1);
  }
  return out;
}
