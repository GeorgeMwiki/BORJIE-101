import { describe, expect, it } from 'vitest';
import { GENESIS_HASH } from '@borjie/audit-hash-chain';
import { buildOrgScopeAuditEntry } from '../audit/audit-emit.js';

describe('buildOrgScopeAuditEntry', () => {
  it('builds a genesis entry when no previous hash is supplied', () => {
    const out = buildOrgScopeAuditEntry({
      tenantId: 't-borjie',
      kind: 'binding.granted',
      actorUserId: 'owner',
      subjectId: 'b-1',
      orgUnitId: 'geita',
      details: { role: 'admin' },
      occurredAt: '2026-05-26T00:00:00.000Z',
    });
    expect(out.entry.prevHash).toBe(GENESIS_HASH);
    expect(out.entry.index).toBe(0);
    expect(out.entry.rowHash).toMatch(/^[a-f0-9]{64}$/);
    expect(out.canonical['kind']).toBe('binding.granted');
  });

  it('chains to a previous hash + increments index', () => {
    const first = buildOrgScopeAuditEntry({
      tenantId: 't-borjie',
      kind: 'org_unit.created',
      actorUserId: 'owner',
      subjectId: 'geita',
      orgUnitId: null,
      details: {},
      occurredAt: '2026-05-26T00:00:00.000Z',
    });
    const second = buildOrgScopeAuditEntry({
      tenantId: 't-borjie',
      kind: 'terminology.override.upserted',
      actorUserId: 'owner',
      subjectId: 'o-1',
      orgUnitId: 'geita',
      details: { key: 'parcel' },
      occurredAt: '2026-05-26T01:00:00.000Z',
      previousHash: first.entry.rowHash,
      previousIndex: first.entry.index,
    });
    expect(second.entry.prevHash).toBe(first.entry.rowHash);
    expect(second.entry.index).toBe(1);
    expect(second.entry.rowHash).not.toBe(first.entry.rowHash);
  });
});
