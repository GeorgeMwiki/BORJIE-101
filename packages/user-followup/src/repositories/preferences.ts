/**
 * `FollowupPreferencesRepository` — in-memory reference impl + SQL
 * port shape. Backed by `followup_preferences` (PK tenant_id+user_id).
 */

import type {
  FollowupPreferences,
  FollowupPreferencesRepository,
} from '../types.js';

export function createInMemoryPreferencesRepository(): FollowupPreferencesRepository {
  const rows = new Map<string, FollowupPreferences>();

  const key = (tenant_id: string, user_id: string): string =>
    `${tenant_id}::${user_id}`;

  return {
    async get(tenant_id, user_id) {
      return rows.get(key(tenant_id, user_id)) ?? null;
    },
    async upsert(prefs) {
      rows.set(key(prefs.tenant_id, prefs.user_id), prefs);
    },
  };
}

export type { FollowupPreferencesRepository } from '../types.js';
