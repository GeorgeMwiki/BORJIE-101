/**
 * Tab registry — the persistence port for generated tabs.
 *
 * Provides an in-memory implementation that's safe to use in tests,
 * tab-builder previews, and dev. The Drizzle-backed implementation
 * lives in `./drizzle-tab-repo.ts` and depends on the `portal_tabs`
 * table introduced by migration 0173.
 *
 * Tabs are immutable from the persistence layer's perspective — to
 * change a tab the caller saves a new version. The registry preserves
 * lineage via `parentTabId` so the UI can show "previous version"
 * diffs.
 */

import { PortalTabSchema, type PortalTab } from '../types.js';

// ────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────

export interface SaveTabInput {
  readonly tab: PortalTab;
  readonly parentTabId?: string;
}

export interface SaveTabResult {
  readonly id: string;
  readonly tabKey: string;
}

export interface ListTabsInput {
  readonly tenantId: string;
  /** When omitted, returns tenant-default tabs (`userId IS NULL`). */
  readonly userId?: string | null;
  readonly personaId?:
    | 'internal_admin'
    | 'property_manager'
    | 'estate_manager'
    | 'owner'
    | 'customer';
  /** Filter by domain. */
  readonly domain?: PortalTab['domain'];
}

export interface DeleteTabInput {
  readonly tabId: string;
  /** Requester id — used for the audit trail. */
  readonly requesterId: string;
  readonly tenantId: string;
}

export interface TabRegistry {
  save(input: SaveTabInput): Promise<SaveTabResult>;
  list(input: ListTabsInput): Promise<ReadonlyArray<PortalTab>>;
  get(id: string): Promise<PortalTab | null>;
  delete(input: DeleteTabInput): Promise<{ deleted: boolean }>;
  /** For tests / cache-warming. */
  size(): Promise<number>;
}

// ────────────────────────────────────────────────────────────────────
// In-memory implementation
// ────────────────────────────────────────────────────────────────────

export interface InMemoryRegistryOptions {
  readonly clock?: () => Date;
}

export function createInMemoryTabRegistry(
  options: InMemoryRegistryOptions = {},
): TabRegistry {
  const clock = options.clock ?? (() => new Date());
  const store = new Map<string, PortalTab>();

  return {
    async save(input) {
      const validated = PortalTabSchema.parse(input.tab);
      // Enforce one-tab-per (tenantId, userId, tabKey) — matches the
      // partial unique indexes on the SQL table.
      for (const existing of store.values()) {
        if (
          existing.tenantId === validated.tenantId &&
          existing.userId === validated.userId &&
          existing.tabKey === validated.tabKey &&
          existing.id !== validated.id
        ) {
          throw new Error(
            `tab_key_already_exists: (tenantId=${validated.tenantId}, userId=${validated.userId ?? 'null'}, tabKey=${validated.tabKey})`,
          );
        }
      }
      const stored: PortalTab = {
        ...validated,
        updatedAt: clock().toISOString(),
      };
      store.set(validated.id, stored);
      return { id: validated.id, tabKey: validated.tabKey };
    },

    async list(input) {
      const matches: PortalTab[] = [];
      for (const tab of store.values()) {
        if (tab.tenantId !== input.tenantId) continue;
        const want = input.userId ?? null;
        if (tab.userId !== want) continue;
        if (input.personaId) {
          if (!tab.permissions.visibleToPersonas.includes(input.personaId)) {
            continue;
          }
        }
        if (input.domain && tab.domain !== input.domain) continue;
        matches.push(tab);
      }
      // Stable order — keys + createdAt.
      matches.sort((a, b) => {
        if (a.tabKey === b.tabKey) {
          return a.createdAt.localeCompare(b.createdAt);
        }
        return a.tabKey.localeCompare(b.tabKey);
      });
      return matches;
    },

    async get(id) {
      const tab = store.get(id);
      return tab ?? null;
    },

    async delete(input) {
      const existing = store.get(input.tabId);
      if (!existing) return { deleted: false };
      if (existing.tenantId !== input.tenantId) {
        return { deleted: false };
      }
      store.delete(input.tabId);
      return { deleted: true };
    },

    async size() {
      return store.size;
    },
  };
}
