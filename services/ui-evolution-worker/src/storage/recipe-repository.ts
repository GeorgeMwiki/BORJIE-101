/**
 * Recipe repository — CRUD on `tab_recipes`.
 *
 * `tab_recipes` is a globally-scoped product-config table (no tenant
 * column, RLS disabled — see migration 0017). The worker:
 *
 *   - LISTs every `live` row for the nightly sweep
 *   - UPDATEs status `live` → `locked` after the §4 30-day sustained
 *     check
 *   - INSERTs the next-version `shadow` row when an owner approves an
 *     improvement proposal
 *   - UPDATEs status `live` → `deprecated` after the new version goes
 *     live (preserves audit trail; the row is never deleted)
 *
 * Wire-agnostic: the constructor takes a `RecipeDb` port. Production
 * passes a postgres-js client; tests pass an in-memory stub.
 */

import type { TabRecipeRow, TabRecipeStatus } from '../types.js';

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

/**
 * Minimal contract for the SQL surface. Returning unknown rows is a
 * deliberate choice — the repository validates them before exposing
 * them as `TabRecipeRow`.
 */
export interface RecipeDb {
  query<T = unknown>(sql: string, params?: ReadonlyArray<unknown>): Promise<ReadonlyArray<T>>;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface RecipeRepository {
  listLive(): Promise<ReadonlyArray<TabRecipeRow>>;
  findVersion(id: string, version: number): Promise<TabRecipeRow | null>;
  updateStatus(args: {
    id: string;
    version: number;
    nextStatus: TabRecipeStatus;
    promotedBy?: string;
    lockedAtIso?: string;
  }): Promise<void>;
  insertShadow(args: {
    id: string;
    version: number;
    intent: string;
    composeFnRef: string;
    authorityTier: 0 | 1 | 2;
  }): Promise<void>;
  isLocked(args: { id: string; version: number }): Promise<boolean>;
}

export function createRecipeRepository(db: RecipeDb): RecipeRepository {
  return {
    async listLive() {
      const rows = await db.query<Record<string, unknown>>(
        `SELECT id, version, status, intent, compose_fn_ref, authority_tier,
                brand, promoted_at, promoted_by, locked_at,
                created_at, updated_at
           FROM tab_recipes
          WHERE status = 'live'
          ORDER BY id ASC, version DESC`,
      );
      return rows.map(rowToRecipe);
    },
    async findVersion(id, version) {
      const rows = await db.query<Record<string, unknown>>(
        `SELECT id, version, status, intent, compose_fn_ref, authority_tier,
                brand, promoted_at, promoted_by, locked_at,
                created_at, updated_at
           FROM tab_recipes
          WHERE id = $1 AND version = $2
          LIMIT 1`,
        [id, version],
      );
      const first = rows[0];
      if (!first) return null;
      return rowToRecipe(first);
    },
    async updateStatus({ id, version, nextStatus, promotedBy, lockedAtIso }) {
      // Wider-than-needed SET clause is fine — Postgres only updates
      // columns whose new values differ, and we want a single round-trip.
      await db.query(
        `UPDATE tab_recipes
            SET status = $3,
                promoted_at = CASE WHEN $3 = 'live' THEN now() ELSE promoted_at END,
                promoted_by = CASE WHEN $3 = 'live' THEN $4 ELSE promoted_by END,
                locked_at = CASE WHEN $3 = 'locked' THEN COALESCE($5::timestamptz, now()) ELSE locked_at END,
                updated_at = now()
          WHERE id = $1 AND version = $2`,
        [id, version, nextStatus, promotedBy ?? null, lockedAtIso ?? null],
      );
    },
    async insertShadow({ id, version, intent, composeFnRef, authorityTier }) {
      await db.query(
        `INSERT INTO tab_recipes (id, version, status, intent, compose_fn_ref, authority_tier)
         VALUES ($1, $2, 'shadow', $3, $4, $5)
         ON CONFLICT (id, version) DO UPDATE SET
           status = 'shadow',
           intent = EXCLUDED.intent,
           compose_fn_ref = EXCLUDED.compose_fn_ref,
           authority_tier = EXCLUDED.authority_tier,
           updated_at = now()`,
        [id, version, intent, composeFnRef, authorityTier],
      );
    },
    async isLocked({ id, version }) {
      const rows = await db.query<{ status: string }>(
        `SELECT status FROM tab_recipes WHERE id = $1 AND version = $2 LIMIT 1`,
        [id, version],
      );
      const first = rows[0];
      return first?.status === 'locked';
    },
  };
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToRecipe(row: Record<string, unknown>): TabRecipeRow {
  return {
    id: requireString(row['id'], 'id'),
    version: requireInt(row['version'], 'version'),
    status: requireStatus(row['status']),
    intent: requireString(row['intent'], 'intent'),
    composeFnRef: requireString(row['compose_fn_ref'], 'compose_fn_ref'),
    authorityTier: requireTier(row['authority_tier']),
    brand: 'borjie',
    promotedAtIso: optionalIso(row['promoted_at']),
    promotedBy: optionalString(row['promoted_by']),
    lockedAtIso: optionalIso(row['locked_at']),
    createdAtIso: requireIso(row['created_at']),
    updatedAtIso: requireIso(row['updated_at']),
  };
}

function requireString(v: unknown, label: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`recipe-repository: column '${label}' missing or empty`);
  }
  return v;
}

function optionalString(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

function requireInt(v: unknown, label: string): number {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10);
    if (Number.isInteger(n)) return n;
  }
  throw new Error(`recipe-repository: column '${label}' not an int`);
}

function requireStatus(v: unknown): TabRecipeStatus {
  if (
    v === 'draft' ||
    v === 'shadow' ||
    v === 'live' ||
    v === 'locked' ||
    v === 'deprecated'
  ) {
    return v;
  }
  throw new Error(`recipe-repository: status '${String(v)}' is not a TabRecipeStatus`);
}

function requireTier(v: unknown): 0 | 1 | 2 {
  if (v === 0 || v === 1 || v === 2) return v;
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10);
    if (n === 0 || n === 1 || n === 2) return n;
  }
  throw new Error(`recipe-repository: authority_tier '${String(v)}' not 0|1|2`);
}

function requireIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  throw new Error('recipe-repository: timestamptz column missing');
}

function optionalIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}
