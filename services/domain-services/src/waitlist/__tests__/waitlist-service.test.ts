import { describe, it, expect, vi } from 'vitest';
import type { TenantId } from '@borjie/domain-models';

import { WaitlistService } from '../waitlist-service.js';
import {
  WaitlistVacancyHandler,
  type OutreachDispatcher,
} from '../waitlist-vacancy-handler.js';
import {
  asWaitlistId,
  type UnitWaitlistEntry,
  type WaitlistId,
  type WaitlistOutreachEvent,
  type WaitlistOutreachRepository,
  type WaitlistRepository,
} from '../types.js';

function memRepo(): WaitlistRepository & { all: Map<string, UnitWaitlistEntry> } {
  const all = new Map<string, UnitWaitlistEntry>();
  return {
    all,
    async findById(id) {
      return all.get(id) ?? null;
    },
    async findActiveForCustomerUnit(_t, unitId, customerId) {
      return (
        Array.from(all.values()).find(
          (e) =>
            e.unitId === unitId &&
            e.customerId === customerId &&
            e.status === 'active'
        ) ?? null
      );
    },
    async create(e) {
      all.set(e.id, e);
      return e;
    },
    async update(id, _t, patch) {
      const curr = all.get(id)!;
      const next = { ...curr, ...patch } as UnitWaitlistEntry;
      all.set(id, next);
      return next;
    },
    async listActiveForUnit(_t, unitId) {
      return Array.from(all.values()).filter(
        (e) => e.unitId === unitId && e.status === 'active'
      );
    },
    async listForCustomer(_t, customerId) {
      return Array.from(all.values()).filter(
        (e) => e.customerId === customerId
      );
    },
  };
}

function memOutreach(): WaitlistOutreachRepository & {
  all: WaitlistOutreachEvent[];
} {
  const all: WaitlistOutreachEvent[] = [];
  return {
    all,
    async append(e) {
      all.push(e);
      return e;
    },
    async listByWaitlist(id) {
      return all.filter((x) => x.waitlistId === id);
    },
  };
}

function bus() {
  return { publish: vi.fn(), subscribe: vi.fn(() => () => {}) } as any;
}

const tenantId = 'tnt_1' as TenantId;

describe('WaitlistService', () => {
  it('joins a customer to a unit waitlist', async () => {
    const svc = new WaitlistService({ repo: memRepo(), eventBus: bus() });
    const r = await svc.join(
      tenantId,
      { unitId: 'u1', customerId: 'c1', source: 'enquiry' },
      'corr'
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('active');
  });

  it('dedupes when same customer rejoins same unit', async () => {
    const repo = memRepo();
    const svc = new WaitlistService({ repo, eventBus: bus() });
    const a = await svc.join(
      tenantId,
      { unitId: 'u1', customerId: 'c1' },
      'c'
    );
    const b = await svc.join(
      tenantId,
      { unitId: 'u1', customerId: 'c1' },
      'c'
    );
    if (!a.ok || !b.ok) throw new Error('bad');
    expect(a.value.id).toBe(b.value.id);
    expect(repo.all.size).toBe(1);
  });

  it('leave marks opted_out, not deleted', async () => {
    const repo = memRepo();
    const svc = new WaitlistService({ repo, eventBus: bus() });
    const a = await svc.join(
      tenantId,
      { unitId: 'u1', customerId: 'c1' },
      'c'
    );
    if (!a.ok) throw new Error('bad');
    const l = await svc.leave(
      tenantId,
      { waitlistId: a.value.id, reason: 'found elsewhere' },
      'c'
    );
    expect(l.ok).toBe(true);
    if (l.ok) {
      expect(l.value.status).toBe('opted_out');
      expect(l.value.optOutReason).toBe('found elsewhere');
    }
    expect(repo.all.size).toBe(1); // still there
  });
});

describe('WaitlistVacancyHandler', () => {
  it('dispatches to top-N by priority in first wave', async () => {
    const repo = memRepo();
    const out = memOutreach();
    const svc = new WaitlistService({ repo, eventBus: bus() });
    // seed waitlist with 10 entries, priority 0..9
    for (let i = 0; i < 10; i++) {
      await svc.join(
        tenantId,
        { unitId: 'u1', customerId: `c${i}`, priority: i },
        'c'
      );
    }
    const dispatched: string[] = [];
    const dispatcher: OutreachDispatcher = {
      async dispatch(cmd) {
        dispatched.push(cmd.customerId);
        return { providerMessageId: `m_${cmd.customerId}` };
      },
    };
    const handler = new WaitlistVacancyHandler({
      repo,
      outreachRepo: out,
      eventBus: bus(),
      dispatcher,
      config: { waveSize: 5 },
    });
    const res = await handler.handleVacancy(
      tenantId,
      {
        unitId: 'u1',
        vacatedAt: new Date().toISOString() as any,
      },
      'corr'
    );
    expect(res.dispatched).toBe(5);
    expect(dispatched).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
    expect(out.all.length).toBe(5);
  });

  it('skips opted-out entries', async () => {
    const repo = memRepo();
    const out = memOutreach();
    const svc = new WaitlistService({ repo, eventBus: bus() });
    const j = await svc.join(
      tenantId,
      { unitId: 'u1', customerId: 'c1', priority: 0 },
      'c'
    );
    await svc.join(
      tenantId,
      { unitId: 'u1', customerId: 'c2', priority: 1 },
      'c'
    );
    if (!j.ok) throw j.error;
    await svc.leave(tenantId, { waitlistId: j.value.id }, 'c');

    const dispatched: string[] = [];
    const dispatcher: OutreachDispatcher = {
      async dispatch(cmd) {
        dispatched.push(cmd.customerId);
        return null;
      },
    };
    const handler = new WaitlistVacancyHandler({
      repo,
      outreachRepo: out,
      eventBus: bus(),
      dispatcher,
    });
    await handler.handleVacancy(
      tenantId,
      { unitId: 'u1', vacatedAt: new Date().toISOString() as any },
      'corr'
    );
    expect(dispatched).toEqual(['c2']);
  });

  it('records delivery_failed on dispatcher error', async () => {
    const repo = memRepo();
    const out = memOutreach();
    const svc = new WaitlistService({ repo, eventBus: bus() });
    await svc.join(
      tenantId,
      { unitId: 'u1', customerId: 'c1', priority: 0 },
      'c'
    );
    const dispatcher: OutreachDispatcher = {
      async dispatch() {
        throw new Error('provider down');
      },
    };
    const handler = new WaitlistVacancyHandler({
      repo,
      outreachRepo: out,
      eventBus: bus(),
      dispatcher,
    });
    const res = await handler.handleVacancy(
      tenantId,
      { unitId: 'u1', vacatedAt: new Date().toISOString() as any },
      'corr'
    );
    expect(res.skipped).toBe(1);
    expect(out.all[0].eventType).toBe('delivery_failed');
  });
});
