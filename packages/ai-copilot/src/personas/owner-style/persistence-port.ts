/**
 * Persistence Port — the storage contract for OwnerStyleProfile rows.
 *
 * The ai-copilot package owns only the PORT (an interface) plus an in-memory
 * implementation for tests and the default-factory fallback. The Drizzle-backed
 * Postgres adapter that satisfies this port lives in
 * `@borjie/database` (`repositories/owner-style.repository.ts`,
 * `createPgOwnerStyleProfileStore`), so the AI layer never depends on the
 * database package. The shapes are kept in sync; a compatibility test catches
 * drift.
 *
 * Honest-degrade (CLAUDE.md): callers MUST treat a thrown/absent store as
 * "no profile learned yet" — never fabricate a profile.
 */

import { logger } from '../../logger.js';
import {
  OwnerStyleProfileSchema,
  makeDefaultProfile,
  type OwnerStyleProfile,
} from './style-dimensions.js';

// ---------------------------------------------------------------------------
// Storage contract — injectable so tests don't need a live database.
// ---------------------------------------------------------------------------

export interface OwnerStyleProfileStore {
  fetch(args: { readonly tenantId: string }): Promise<OwnerStyleProfile | null>;
  upsert(profile: OwnerStyleProfile): Promise<OwnerStyleProfile>;
}

// ---------------------------------------------------------------------------
// In-memory store — for tests and the default factory fallback.
// ---------------------------------------------------------------------------

export function createInMemoryProfileStore(): OwnerStyleProfileStore {
  const map = new Map<string, OwnerStyleProfile>();

  return {
    async fetch({ tenantId }) {
      return map.get(tenantId) ?? null;
    },
    async upsert(profile) {
      const parsed = OwnerStyleProfileSchema.safeParse(profile);
      if (!parsed.success) {
        logger.warn('owner-style.store.invalid-profile', {
          error: parsed.error.message,
        });
        throw new Error('invalid OwnerStyleProfile');
      }
      // `profile` is the validated, fully-typed snapshot; `parsed` only gates
      // runtime validity. Snapshot from the typed input to keep all fields.
      const snapshot: OwnerStyleProfile = { ...profile };
      map.set(profile.tenantId, snapshot);
      return snapshot;
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience: fetch-or-default.
// ---------------------------------------------------------------------------

export async function fetchOrDefault(
  store: OwnerStyleProfileStore,
  args: { readonly tenantId: string }
): Promise<OwnerStyleProfile> {
  const existing = await store.fetch(args);
  if (existing) return existing;
  return makeDefaultProfile(args);
}
