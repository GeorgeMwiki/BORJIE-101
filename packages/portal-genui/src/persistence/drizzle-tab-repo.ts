/**
 * Drizzle-backed `TabRegistry` — narrow adapter for the SQL
 * `portal_tabs` table from migration 0173.
 *
 * The adapter takes a minimal `DbExecutor` port (just `query` /
 * `transaction`) so callers can satisfy it with whatever Postgres
 * client they already wire in `@borjie/database` (pg, postgres-js,
 * drizzle). We intentionally do NOT import drizzle-orm here — the
 * dependency tree of `@borjie/database` is heavier than this
 * package needs, and we want this module to typecheck on its own.
 *
 * Composition root (`services/api-gateway/src/composition/portal-genui-
 * wiring.ts`) constructs the adapter with the live `getDb()`.
 */

import { PortalTabSchema, type PortalTab } from '../types.js';
import type {
  DeleteTabInput,
  ListTabsInput,
  SaveTabInput,
  SaveTabResult,
  TabRegistry,
} from './registry.js';

/** Narrow Postgres port the adapter consumes. */
export interface DbExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<Row>>;
}

interface PortalTabRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string | null;
  readonly tab_key: string;
  readonly schema_version: number;
  readonly tab: PortalTab | string;
  readonly parent_tab_id: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

function rowToTab(row: PortalTabRow): PortalTab | null {
  const raw = typeof row.tab === 'string' ? safeJsonParse(row.tab) : row.tab;
  if (!raw || typeof raw !== 'object') return null;
  const parsed = PortalTabSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface DrizzleTabRegistryDeps {
  readonly db: DbExecutor;
  readonly clock?: () => Date;
}

export function createDrizzleTabRegistry(
  deps: DrizzleTabRegistryDeps,
): TabRegistry {
  const clock = deps.clock ?? (() => new Date());

  return {
    async save(input: SaveTabInput): Promise<SaveTabResult> {
      const tab = PortalTabSchema.parse(input.tab);
      const now = clock().toISOString();
      await deps.db.query(
        `
        INSERT INTO public.portal_tabs (
          id, tenant_id, user_id, tab_key, schema_version,
          tab, parent_tab_id, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE
          SET tab = EXCLUDED.tab,
              tab_key = EXCLUDED.tab_key,
              updated_at = EXCLUDED.updated_at
        `,
        [
          tab.id,
          tab.tenantId,
          tab.userId,
          tab.tabKey,
          tab.version,
          JSON.stringify(tab),
          input.parentTabId ?? null,
          tab.createdAt,
          now,
        ],
      );
      return { id: tab.id, tabKey: tab.tabKey };
    },

    async list(input: ListTabsInput): Promise<ReadonlyArray<PortalTab>> {
      const conditions: string[] = ['tenant_id = $1'];
      const params: unknown[] = [input.tenantId];
      if (input.userId === null || input.userId === undefined) {
        conditions.push('user_id IS NULL');
      } else {
        params.push(input.userId);
        conditions.push(`user_id = $${params.length}`);
      }
      const rows = await deps.db.query<PortalTabRow>(
        `
        SELECT id, tenant_id, user_id, tab_key, schema_version,
               tab, parent_tab_id, created_at, updated_at
        FROM public.portal_tabs
        WHERE ${conditions.join(' AND ')}
        ORDER BY tab_key ASC, created_at ASC
        `,
        params,
      );
      const tabs: PortalTab[] = [];
      for (const row of rows) {
        const tab = rowToTab(row);
        if (!tab) continue;
        if (input.personaId && !tab.permissions.visibleToPersonas.includes(input.personaId)) {
          continue;
        }
        if (input.domain && tab.domain !== input.domain) continue;
        tabs.push(tab);
      }
      return tabs;
    },

    async get(id: string): Promise<PortalTab | null> {
      const rows = await deps.db.query<PortalTabRow>(
        `
        SELECT id, tenant_id, user_id, tab_key, schema_version,
               tab, parent_tab_id, created_at, updated_at
        FROM public.portal_tabs
        WHERE id = $1
        LIMIT 1
        `,
        [id],
      );
      const row = rows[0];
      return row ? rowToTab(row) : null;
    },

    async delete(input: DeleteTabInput): Promise<{ deleted: boolean }> {
      const rows = await deps.db.query<{ id: string }>(
        `
        DELETE FROM public.portal_tabs
        WHERE id = $1 AND tenant_id = $2
        RETURNING id
        `,
        [input.tabId, input.tenantId],
      );
      return { deleted: rows.length > 0 };
    },

    async size(): Promise<number> {
      const rows = await deps.db.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM public.portal_tabs',
      );
      return rows[0]?.count ?? 0;
    },
  };
}
