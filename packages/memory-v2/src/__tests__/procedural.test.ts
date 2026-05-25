import { describe, expect, it } from 'vitest';
import {
  createInMemoryProceduralStore,
  PROCEDURAL_PROMOTION_THRESHOLD,
} from '../procedural/store-inmemory.js';
import type { ProceduralSkill } from '../types.js';

const TENANT = 'tenant-1';

function skill(overrides: Partial<ProceduralSkill> = {}): ProceduralSkill {
  return {
    id: 'sk-1',
    tenantId: TENANT,
    name: 'evict.flow.v1',
    description: 'Standard eviction flow',
    triggerPattern: 'tenant says they are leaving',
    actionSequence: [{ tool: 'open_case' }, { tool: 'notify_legal' }],
    observedCount: 1,
    successRate: 1.0,
    promoted: false,
    lastSeenAt: '2026-05-25T00:00:00.000Z',
    createdAt: '2026-05-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('procedural skill store', () => {
  it('records a new skill on first observation', async () => {
    const store = createInMemoryProceduralStore();
    const out = await store.recordSkill(skill());
    expect(out.observedCount).toBe(1);
    expect(out.promoted).toBe(false);
  });

  it('promotes after PROMOTION_THRESHOLD observations', async () => {
    const store = createInMemoryProceduralStore();
    for (let i = 0; i < PROCEDURAL_PROMOTION_THRESHOLD; i++) {
      await store.recordSkill(skill());
    }
    const promoted = await store.getPromotedSkills(TENANT);
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.promoted).toBe(true);
  });

  it('blends successRate across observations', async () => {
    const store = createInMemoryProceduralStore();
    await store.recordSkill(skill({ successRate: 1.0 }));
    await store.recordSkill(skill({ successRate: 0.0 }));
    const found = await store.findByName(TENANT, 'evict.flow.v1');
    expect(found?.successRate).toBeCloseTo(0.5, 5);
  });

  it('clamps blended successRate into [0, 1]', async () => {
    const store = createInMemoryProceduralStore();
    await store.recordSkill(skill({ successRate: 1.5 }));
    await store.recordSkill(skill({ successRate: -0.5 }));
    const found = await store.findByName(TENANT, 'evict.flow.v1');
    expect(found?.successRate).toBeGreaterThanOrEqual(0);
    expect(found?.successRate).toBeLessThanOrEqual(1);
  });

  it('isolates skills by tenantId', async () => {
    const store = createInMemoryProceduralStore();
    await store.recordSkill(skill());
    await store.recordSkill(skill({ tenantId: 'tenant-other' }));
    const a = await store.findByName(TENANT, 'evict.flow.v1');
    const b = await store.findByName('tenant-other', 'evict.flow.v1');
    expect(a?.tenantId).toBe(TENANT);
    expect(b?.tenantId).toBe('tenant-other');
  });

  it('findByName returns null when missing', async () => {
    const store = createInMemoryProceduralStore();
    const found = await store.findByName(TENANT, 'nope');
    expect(found).toBeNull();
  });

  it('updates lastSeenAt + action sequence on subsequent observations', async () => {
    const store = createInMemoryProceduralStore();
    await store.recordSkill(skill());
    await store.recordSkill(
      skill({
        actionSequence: [{ tool: 'open_case' }, { tool: 'send_form_3a' }],
        lastSeenAt: '2026-06-01T00:00:00.000Z',
      }),
    );
    const found = await store.findByName(TENANT, 'evict.flow.v1');
    expect(found?.lastSeenAt).toBe('2026-06-01T00:00:00.000Z');
    expect(found?.actionSequence).toEqual([
      { tool: 'open_case' },
      { tool: 'send_form_3a' },
    ]);
  });

  it('getPromotedSkills filters non-promoted entries', async () => {
    const store = createInMemoryProceduralStore();
    await store.recordSkill(skill());
    const promoted = await store.getPromotedSkills(TENANT);
    expect(promoted).toHaveLength(0);
  });

  it('getPromotedSkills respects the limit', async () => {
    const store = createInMemoryProceduralStore();
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < PROCEDURAL_PROMOTION_THRESHOLD; j++) {
        await store.recordSkill(skill({ name: `flow-${i}` }));
      }
    }
    const promoted = await store.getPromotedSkills(TENANT, 2);
    expect(promoted).toHaveLength(2);
  });
});
