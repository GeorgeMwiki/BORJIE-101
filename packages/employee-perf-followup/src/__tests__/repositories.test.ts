import { describe, it, expect } from 'vitest';
import { createInMemoryScorecardRepository } from '../repositories/scorecard.js';
import { createInMemoryKpiTemplateRepository } from '../repositories/kpi-template.js';
import { createInMemoryPerfNudgeRepository } from '../repositories/nudge.js';
import { buildSeedTemplate } from '../kpi/role-templates.js';
import { SEED_TENANT_ID, type EmployeeScorecard, type PerfNudge } from '../types.js';

const NOW = '2026-05-27T06:00:00.000Z';

function makeCard(
  overrides: Partial<EmployeeScorecard> = {},
): EmployeeScorecard {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    tenant_id: 't1',
    employee_user_id: 'u1',
    date: '2026-05-26',
    role: 'foreman',
    kpis: [],
    overall_score: 0.8,
    signals: { streak_days: 1, anomalies: [] },
    prev_hash: '',
    audit_hash: 'h1',
    created_at: NOW,
    ...overrides,
  };
}

describe('ScorecardRepository in-memory', () => {
  it('rejects duplicate (tenant, employee, date) inserts', async () => {
    const repo = createInMemoryScorecardRepository();
    await repo.insert(makeCard());
    await expect(repo.insert(makeCard())).rejects.toThrow(
      /Scorecard already exists/,
    );
  });

  it('findByDate returns null when no row exists, and the row when it does', async () => {
    const repo = createInMemoryScorecardRepository();
    expect(await repo.findByDate('t1', 'u1', '2026-05-26')).toBeNull();
    await repo.insert(makeCard());
    const found = await repo.findByDate('t1', 'u1', '2026-05-26');
    expect(found?.id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('latestPrior returns the most-recent prior scorecard', async () => {
    const repo = createInMemoryScorecardRepository();
    await repo.insert(makeCard({ id: 'aaaaaaaa-1111-1111-1111-111111111111', date: '2026-05-24' }));
    await repo.insert(makeCard({ id: 'bbbbbbbb-1111-1111-1111-111111111111', date: '2026-05-25' }));
    const prior = await repo.latestPrior('t1', 'u1', '2026-05-26');
    expect(prior?.date).toBe('2026-05-25');
  });

  it('listForDate filters by tenant + date', async () => {
    const repo = createInMemoryScorecardRepository();
    await repo.insert(makeCard({ employee_user_id: 'u1' }));
    await repo.insert(
      makeCard({
        id: '22222222-2222-2222-2222-222222222222',
        employee_user_id: 'u2',
      }),
    );
    await repo.insert(
      makeCard({
        id: '33333333-3333-3333-3333-333333333333',
        tenant_id: 't2',
        employee_user_id: 'u-other',
      }),
    );
    const rows = await repo.listForDate('t1', '2026-05-26');
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.employee_user_id).sort()).toEqual(['u1', 'u2']);
  });
});

describe('KpiTemplateRepository in-memory — seed fallback', () => {
  it('returns the seed template when the tenant has no override', async () => {
    const repo = createInMemoryKpiTemplateRepository();
    await repo.upsert(buildSeedTemplate('foreman', NOW));
    const t = await repo.get('any-tenant', 'foreman');
    expect(t?.tenant_id).toBe(SEED_TENANT_ID);
  });

  it('prefers the tenant override over the seed', async () => {
    const repo = createInMemoryKpiTemplateRepository();
    await repo.upsert(buildSeedTemplate('foreman', NOW));
    await repo.upsert({
      ...buildSeedTemplate('foreman', NOW),
      id: 'override-1',
      tenant_id: 't1',
    });
    const t = await repo.get('t1', 'foreman');
    expect(t?.tenant_id).toBe('t1');
    expect(t?.id).toBe('override-1');
  });
});

describe('PerfNudgeRepository in-memory', () => {
  it('inserts and lists per scorecard in tier-stable order', async () => {
    const repo = createInMemoryPerfNudgeRepository();
    const base: Omit<PerfNudge, 'id' | 'recipient_tier' | 'recipient_user_id'> = {
      tenant_id: 't1',
      scorecard_id: 'sc-1',
      content: '',
      channel: 'inapp',
      sent_at: null,
      audit_hash: 'h',
      created_at: NOW,
    };
    await repo.insert({
      ...base,
      id: 'aaaaaaaa-2222-2222-2222-222222222222',
      recipient_tier: 'owner',
      recipient_user_id: 'u-owner',
    });
    await repo.insert({
      ...base,
      id: 'bbbbbbbb-2222-2222-2222-222222222222',
      recipient_tier: 'subject',
      recipient_user_id: 'u1',
    });
    await repo.insert({
      ...base,
      id: 'cccccccc-2222-2222-2222-222222222222',
      recipient_tier: 'supervisor',
      recipient_user_id: 'u-sup',
    });
    const list = await repo.listForScorecard('sc-1');
    expect(list.length).toBe(3);
    expect(list.map((n) => n.recipient_tier)).toEqual([
      'subject',
      'supervisor',
      'owner',
    ]);
  });

  it('markSent sets sent_at on the row', async () => {
    const repo = createInMemoryPerfNudgeRepository();
    await repo.insert({
      id: 'dddddddd-2222-2222-2222-222222222222',
      tenant_id: 't1',
      scorecard_id: 'sc-1',
      recipient_user_id: 'u1',
      recipient_tier: 'subject',
      content: '',
      channel: 'inapp',
      sent_at: null,
      audit_hash: 'h',
      created_at: NOW,
    });
    const stamp = new Date('2026-05-27T08:00:00.000Z');
    await repo.markSent('dddddddd-2222-2222-2222-222222222222', stamp);
    const after = (
      await repo.listForScorecard('sc-1')
    ).find((n) => n.id === 'dddddddd-2222-2222-2222-222222222222');
    expect(after?.sent_at).toBe(stamp.toISOString());
  });
});
