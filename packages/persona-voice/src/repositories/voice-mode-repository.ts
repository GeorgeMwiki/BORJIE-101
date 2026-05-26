/**
 * `VoiceModeRepository` — in-memory reference impl + SQL port shape.
 *
 * Production wires a `@borjie/database` adapter against the
 * `persona_voice_mode` table (migration 0034). RLS is enforced via
 * the `app.tenant_id` GUC.
 */

import type {
  VoiceModeRepository,
  VoiceProfile,
} from '../types.js';

export function createInMemoryVoiceModeRepository(): VoiceModeRepository {
  const rows = new Map<string, VoiceProfile>();

  const key = (tenant_id: string, user_id: string): string =>
    `${tenant_id}::${user_id}`;

  return {
    async get(tenant_id, user_id) {
      return rows.get(key(tenant_id, user_id)) ?? null;
    },
    async upsert(profile) {
      rows.set(key(profile.tenant_id, profile.user_id), profile);
    },
  };
}

export type { VoiceModeRepository } from '../types.js';
