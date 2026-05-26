/**
 * `KillSwitchEventsRepository` — in-memory reference impl + SQL port
 * shape.
 *
 * `isActive` returns true when any event in the last
 * `KILL_SWITCH_LOOKBACK_HOURS` matches either `scope='org'` for the
 * tenant or `scope='user'` for the user. Spec §2 + §8.
 */

import {
  KILL_SWITCH_LOOKBACK_HOURS,
  type KillSwitchEvent,
  type KillSwitchEventsRepository,
  type KillSwitchScope,
} from '../types.js';

export function createInMemoryKillSwitchEventsRepository(): KillSwitchEventsRepository {
  const rows: KillSwitchEvent[] = [];

  return {
    async insert(event) {
      rows.push(event);
    },
    async isActive(tenant_id, user_id, now) {
      const cutoffMs =
        now.getTime() - KILL_SWITCH_LOOKBACK_HOURS * 60 * 60 * 1000;
      let activeScope: KillSwitchScope | undefined;
      for (const e of rows) {
        if (e.tenant_id !== tenant_id) continue;
        const triggeredMs = new Date(e.triggered_at).getTime();
        if (triggeredMs < cutoffMs) continue;
        if (e.scope === 'org') {
          return { active: true, scope: 'org' };
        }
        if (e.scope === 'user' && e.target_user_id === user_id) {
          activeScope = 'user';
        }
      }
      if (activeScope) {
        return { active: true, scope: activeScope };
      }
      return { active: false };
    },
    async listForTenant(tenant_id) {
      return rows
        .filter((e) => e.tenant_id === tenant_id)
        .sort((a, b) => a.triggered_at.localeCompare(b.triggered_at));
    },
  };
}

export type { KillSwitchEventsRepository } from '../types.js';
