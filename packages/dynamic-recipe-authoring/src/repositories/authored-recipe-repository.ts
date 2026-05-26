/**
 * `dynamic_authored_recipes` repository — Wave 18M.
 *
 * Two adapters: in-memory (tests + the orchestrator's default
 * composition root) and a SQL adapter port. The SQL adapter is wired
 * by the host service against drizzle at the composition root; this
 * package itself stays drizzle-free so it can be imported from the
 * edge.
 *
 * Rows are frozen on insert. Lifecycle transitions go through
 * `transitionLifecycle` only — the `canTransition` check from
 * `lifecycle-bridge.ts` is enforced inside the transition method so
 * the repository is the single source of truth for state.
 *
 * @module @borjie/dynamic-recipe-authoring/repositories/authored-recipe-repository
 */

import { randomUUID } from 'node:crypto';
import type {
  AuthoredRecipe,
  AuthoredRecipeRepository,
  RecipeKind,
  RecipeLifecycle,
} from '../types.js';
import { canTransition } from '../lifecycle/lifecycle-bridge.js';
import {
  computeAuthoredRecipeAuditHash,
  GENESIS_HASH,
} from '../audit/audit-chain-link.js';

// ---------------------------------------------------------------------------
// In-memory
// ---------------------------------------------------------------------------

export interface InMemoryAuthoredRecipeRepoDeps {
  readonly now: () => Date;
}

export function createInMemoryAuthoredRecipeRepository(
  deps: InMemoryAuthoredRecipeRepoDeps = { now: () => new Date() },
): AuthoredRecipeRepository {
  const rows = new Map<string, AuthoredRecipe>();
  const chainHead = new Map<string, string>();
  const uniqueIndex = new Set<string>();

  function uniqueKey(args: {
    readonly tenantId: string;
    readonly kind: RecipeKind;
    readonly name: string;
    readonly version: string;
  }): string {
    return `${args.tenantId}::${args.kind}::${args.name}::${args.version}`;
  }

  function head(tenantId: string): string {
    return chainHead.get(tenantId) ?? GENESIS_HASH;
  }

  return {
    async insert(input) {
      const key = uniqueKey(input);
      if (uniqueIndex.has(key)) {
        throw new Error(
          `duplicate authored recipe: (${input.tenantId}, ${input.kind}, ${input.name}, ${input.version}) already exists`,
        );
      }
      const id = randomUUID();
      const authoredAt = deps.now();
      const prevHash = head(input.tenantId);
      const auditHash = computeAuthoredRecipeAuditHash(
        {
          op: 'insert',
          tenantId: input.tenantId,
          kind: input.kind,
          name: input.name,
          version: input.version,
          authoredBy: input.authoredBy,
          authoredAt: authoredAt.toISOString(),
        },
        prevHash,
      );
      const row: AuthoredRecipe = Object.freeze({
        id,
        tenantId: input.tenantId,
        kind: input.kind,
        name: input.name,
        version: input.version,
        spec: input.spec,
        lifecycleState: 'draft' as RecipeLifecycle,
        authoredAt,
        authoredBy: input.authoredBy,
        prevHash,
        auditHash,
      });
      rows.set(id, row);
      chainHead.set(input.tenantId, auditHash);
      uniqueIndex.add(key);
      return row;
    },

    async findById(tenantId, id) {
      const row = rows.get(id);
      if (row === undefined || row.tenantId !== tenantId) {
        return null;
      }
      return row;
    },

    async listForTenant(tenantId, filter) {
      const out: AuthoredRecipe[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        if (filter?.kind !== undefined && row.kind !== filter.kind) continue;
        if (
          filter?.lifecycleState !== undefined &&
          row.lifecycleState !== filter.lifecycleState
        ) {
          continue;
        }
        out.push(row);
      }
      out.sort((a, b) => b.authoredAt.getTime() - a.authoredAt.getTime());
      return out;
    },

    async transitionLifecycle(tenantId, id, next) {
      const existing = rows.get(id);
      if (existing === undefined || existing.tenantId !== tenantId) {
        throw new Error(
          `cannot transition: authored recipe ${id} not found for tenant ${tenantId}`,
        );
      }
      const guard = canTransition({
        from: existing.lifecycleState,
        to: next,
      });
      if (!guard.ok) {
        throw new Error(`lifecycle: ${guard.reason}`);
      }
      const updated: AuthoredRecipe = Object.freeze({
        ...existing,
        lifecycleState: next,
      });
      rows.set(id, updated);
      return updated;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter — wired by the host service at composition root
// ---------------------------------------------------------------------------

/**
 * Minimal SQL port shape — the host injects a driver that fulfils
 * this interface. We keep it untyped at the package boundary so the
 * package itself does not depend on drizzle.
 */
export interface SqlAuthoredRecipeDriver {
  query(args: {
    readonly text: string;
    readonly values: ReadonlyArray<unknown>;
  }): Promise<ReadonlyArray<Record<string, unknown>>>;
}

function rowToAuthoredRecipe(r: Record<string, unknown>): AuthoredRecipe {
  const authoredAtRaw = r['authored_at'];
  const authoredAt =
    authoredAtRaw instanceof Date
      ? authoredAtRaw
      : new Date(String(authoredAtRaw));
  return Object.freeze({
    id: String(r['id']),
    tenantId: String(r['tenant_id']),
    kind: r['kind'] as RecipeKind,
    name: String(r['name']),
    version: String(r['version']),
    spec: Object.freeze(
      (r['spec'] as Record<string, unknown>) ?? {},
    ),
    lifecycleState: r['lifecycle_state'] as RecipeLifecycle,
    authoredAt,
    authoredBy: String(r['authored_by']),
    prevHash: String(r['prev_hash'] ?? ''),
    auditHash: String(r['audit_hash']),
  });
}

export interface SqlAuthoredRecipeRepoDeps {
  readonly driver: SqlAuthoredRecipeDriver;
  readonly now?: () => Date;
}

/**
 * SQL adapter. Production composition root binds this with a drizzle-
 * backed driver. Tests can stub the driver directly.
 */
export function createSqlAuthoredRecipeRepository(
  deps: SqlAuthoredRecipeRepoDeps,
): AuthoredRecipeRepository {
  const now = deps.now ?? ((): Date => new Date());
  return {
    async insert(input) {
      // Look up the per-tenant audit-chain head.
      const headRows = await deps.driver.query({
        text: `
          SELECT audit_hash
            FROM dynamic_authored_recipes
           WHERE tenant_id = $1
           ORDER BY authored_at DESC
           LIMIT 1
        `,
        values: [input.tenantId],
      });
      const prevHash =
        (headRows[0]?.['audit_hash'] as string | undefined) ?? GENESIS_HASH;
      const authoredAt = now();
      const id = randomUUID();
      const auditHash = computeAuthoredRecipeAuditHash(
        {
          op: 'insert',
          tenantId: input.tenantId,
          kind: input.kind,
          name: input.name,
          version: input.version,
          authoredBy: input.authoredBy,
          authoredAt: authoredAt.toISOString(),
        },
        prevHash,
      );
      const rows = await deps.driver.query({
        text: `
          INSERT INTO dynamic_authored_recipes
            (id, tenant_id, kind, name, version, spec, lifecycle_state,
             authored_at, authored_by, prev_hash, audit_hash)
          VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9, $10)
          RETURNING id, tenant_id, kind, name, version, spec,
                    lifecycle_state, authored_at, authored_by,
                    prev_hash, audit_hash
        `,
        values: [
          id,
          input.tenantId,
          input.kind,
          input.name,
          input.version,
          input.spec,
          authoredAt,
          input.authoredBy,
          prevHash,
          auditHash,
        ],
      });
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert failed: no row returned');
      }
      return rowToAuthoredRecipe(row);
    },

    async findById(tenantId, id) {
      const rows = await deps.driver.query({
        text: `
          SELECT id, tenant_id, kind, name, version, spec,
                 lifecycle_state, authored_at, authored_by,
                 prev_hash, audit_hash
            FROM dynamic_authored_recipes
           WHERE tenant_id = $1 AND id = $2
           LIMIT 1
        `,
        values: [tenantId, id],
      });
      const row = rows[0];
      return row === undefined ? null : rowToAuthoredRecipe(row);
    },

    async listForTenant(tenantId, filter) {
      const where: string[] = ['tenant_id = $1'];
      const values: unknown[] = [tenantId];
      if (filter?.kind !== undefined) {
        values.push(filter.kind);
        where.push(`kind = $${values.length}`);
      }
      if (filter?.lifecycleState !== undefined) {
        values.push(filter.lifecycleState);
        where.push(`lifecycle_state = $${values.length}`);
      }
      const rows = await deps.driver.query({
        text: `
          SELECT id, tenant_id, kind, name, version, spec,
                 lifecycle_state, authored_at, authored_by,
                 prev_hash, audit_hash
            FROM dynamic_authored_recipes
           WHERE ${where.join(' AND ')}
           ORDER BY authored_at DESC
        `,
        values,
      });
      return Object.freeze(rows.map(rowToAuthoredRecipe));
    },

    async transitionLifecycle(tenantId, id, next) {
      const existingRows = await deps.driver.query({
        text: `
          SELECT id, tenant_id, kind, name, version, spec,
                 lifecycle_state, authored_at, authored_by,
                 prev_hash, audit_hash
            FROM dynamic_authored_recipes
           WHERE tenant_id = $1 AND id = $2
           LIMIT 1
        `,
        values: [tenantId, id],
      });
      const existing = existingRows[0];
      if (existing === undefined) {
        throw new Error(
          `cannot transition: authored recipe ${id} not found for tenant ${tenantId}`,
        );
      }
      const existingRow = rowToAuthoredRecipe(existing);
      const guard = canTransition({
        from: existingRow.lifecycleState,
        to: next,
      });
      if (!guard.ok) {
        throw new Error(`lifecycle: ${guard.reason}`);
      }
      const updatedRows = await deps.driver.query({
        text: `
          UPDATE dynamic_authored_recipes
             SET lifecycle_state = $3
           WHERE tenant_id = $1 AND id = $2
           RETURNING id, tenant_id, kind, name, version, spec,
                     lifecycle_state, authored_at, authored_by,
                     prev_hash, audit_hash
        `,
        values: [tenantId, id, next],
      });
      const updated = updatedRows[0];
      if (updated === undefined) {
        throw new Error('transition failed: no row returned');
      }
      return rowToAuthoredRecipe(updated);
    },
  };
}
