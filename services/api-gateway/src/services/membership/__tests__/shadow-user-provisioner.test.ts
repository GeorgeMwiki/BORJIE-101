/**
 * Shadow-user provisioner (SC-2) — find-or-create the insider users row in a
 * TARGET tenant. Driven over an execute() stub that emulates the three
 * resolution branches (existing-by-sub/email, fresh insert, conflict
 * re-read) plus the role-label mapping.
 */

import { describe, it, expect } from 'vitest';

import {
  provisionShadowUser,
  mapMemberRoleToMiningRole,
} from '../shadow-user-provisioner';

interface Plan {
  existing?: Array<{ id: string }>;
  inserted?: Array<{ id: string }>;
  reread?: Array<{ id: string }>;
}

function stubDb(plan: Plan, captured: string[] = []) {
  return {
    execute: async (q: unknown) => {
      const sqlText =
        typeof q === 'object' && q !== null && 'queryChunks' in q
          ? JSON.stringify((q as { queryChunks: unknown }).queryChunks)
          : JSON.stringify(q);
      captured.push(sqlText);
      if (sqlText.includes('INSERT INTO users')) return plan.inserted ?? [];
      if (sqlText.includes('ORDER BY CASE')) return plan.existing ?? [];
      return plan.reread ?? [];
    },
  } as never;
}

describe('mapMemberRoleToMiningRole', () => {
  it('maps known labels, the manager alias, and falls back to supervisor', () => {
    expect(mapMemberRoleToMiningRole('geologist')).toBe('geologist');
    expect(mapMemberRoleToMiningRole('Manager')).toBe('site_manager');
    expect(mapMemberRoleToMiningRole('driller')).toBe('supervisor');
    expect(mapMemberRoleToMiningRole(null)).toBe('supervisor');
    // buyer is NEVER a shadow-user role — the provisioner is unreachable
    // for buyers, and even a mislabel degrades to the generic worker role.
    expect(mapMemberRoleToMiningRole('buyer')).toBe('supervisor');
  });
});

describe('provisionShadowUser', () => {
  const base = {
    targetTenantId: 'tenant_T',
    supabaseUserId: 'a0000000-0000-0000-0000-000000000001',
    displayName: 'Asha Mwangi',
    email: 'Asha@Example.com',
  };

  it('reuses an existing users row (sub or email match) without inserting', async () => {
    const captured: string[] = [];
    const db = stubDb({ existing: [{ id: 'usr_existing' }] }, captured);
    const id = await provisionShadowUser({ ...base, db });
    expect(id).toBe('usr_existing');
    expect(captured.some((s) => s.includes('INSERT INTO users'))).toBe(false);
  });

  it('inserts a fresh shadow row when none exists', async () => {
    const db = stubDb({ inserted: [{ id: 'usr_fresh' }] });
    const id = await provisionShadowUser({ ...base, db });
    expect(id).toBe('usr_fresh');
  });

  it('re-reads on insert conflict (concurrent provision of the same human)', async () => {
    const db = stubDb({ inserted: [], reread: [{ id: 'usr_won_race' }] });
    const id = await provisionShadowUser({ ...base, db });
    expect(id).toBe('usr_won_race');
  });

  it('throws on missing keys (defence in depth)', async () => {
    const db = stubDb({});
    await expect(
      provisionShadowUser({ ...base, db, targetTenantId: '' }),
    ).rejects.toThrow(/targetTenantId/);
  });
});
