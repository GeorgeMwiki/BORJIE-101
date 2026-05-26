/**
 * `AmbientConsentsRepository` — in-memory reference impl + SQL port
 * shape.
 *
 * The in-memory impl exists for tests and ephemeral workers. The SQL
 * port is defined as a thin interface that a production host
 * implements with `@borjie/database`'s drizzle bindings against the
 * `ambient_consents` table (migration 0051).
 *
 * Locked default per Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md
 * Decision 3 — privacy tiers via session-mirror redactor on the read path.
 */

import type {
  AmbientChannel,
  AmbientConsent,
  AmbientConsentsRepository,
} from '../types.js';

function consentKey(
  tenant_id: string,
  user_id: string,
  channel: AmbientChannel,
): string {
  return `${tenant_id}::${user_id}::${channel}`;
}

export function createInMemoryAmbientConsentsRepository(): AmbientConsentsRepository {
  const rows = new Map<string, AmbientConsent>();

  return {
    async get(tenant_id, user_id, channel) {
      return rows.get(consentKey(tenant_id, user_id, channel)) ?? null;
    },
    async upsert(consent) {
      rows.set(
        consentKey(consent.tenant_id, consent.user_id, consent.channel),
        consent,
      );
    },
    async listForUser(tenant_id, user_id) {
      const matches: AmbientConsent[] = [];
      for (const c of rows.values()) {
        if (c.tenant_id === tenant_id && c.user_id === user_id) {
          matches.push(c);
        }
      }
      // Determinism — sort by channel asc.
      return matches.sort((a, b) => a.channel.localeCompare(b.channel));
    },
  };
}

/**
 * SQL-port shape — the host adapter must implement
 * `AmbientConsentsRepository` against migration 0051's
 * `ambient_consents` table. RLS is enforced via the `app.tenant_id`
 * GUC, set by the host's connection wrapper.
 */
export type { AmbientConsentsRepository } from '../types.js';
