import { describe, it, expect, beforeEach } from 'vitest';
import {
  ExceptionInbox,
  InMemoryExceptionRepository,
  scorePriority,
} from '../../autonomy/index.js';

const TENANT = 'tenant_excep_1';

describe('ExceptionInbox', () => {
  let inbox: ExceptionInbox;
  let repo: InMemoryExceptionRepository;

  beforeEach(() => {
    repo = new InMemoryExceptionRepository();
    inbox = new ExceptionInbox({ repository: repo });
  });

  it('addException persists with computed priority P3 by default', async () => {
    const excp = await inbox.addException({
      tenantId: TENANT,
      domain: 'finance',
      kind: 'refund_over_threshold',
      title: 'Small refund',
      description: 'Routine',
    });
    expect(excp.priority).toBe('P3');
    expect(excp.status).toBe('open');
  });

  it('addException scores large-amount exceptions as P1', async () => {
    const excp = await inbox.addException({
      tenantId: TENANT,
      domain: 'finance',
      kind: 'refund_big',
      title: 'Big refund',
      description: 'Large amount',
      amountMinorUnits: 15_000_000,
    });
    expect(excp.priority).toBe('P1');
  });

  it('addException scores time-sensitive items as P1', async () => {
    const soon = new Date(Date.now() + 12 * 3_600_000);
    const excp = await inbox.addException({
      tenantId: TENANT,
      domain: 'compliance',
      kind: 'licence_expiry',
      title: 'Licence due',
      description: 'Renew soon',
      dueAt: soon,
    });
    expect(excp.priority).toBe('P1');
  });

  it('listOpen filters by domain and priority', async () => {
    await inbox.addException({
      tenantId: TENANT,
      domain: 'finance',
      kind: 'a',
      title: 'A',
      description: 'd',
      amountMinorUnits: 12_000_000,
    });
    await inbox.addException({
      tenantId: TENANT,
      domain: 'maintenance',
      kind: 'b',
      title: 'B',
      description: 'd',
    });
    const financeOnly = await inbox.listOpen(TENANT, { domain: 'finance' });
    expect(financeOnly).toHaveLength(1);
    const p1Only = await inbox.listOpen(TENANT, { priority: 'P1' });
    expect(p1Only).toHaveLength(1);
  });

  it('listOpen is tenant-isolated', async () => {
    await inbox.addException({
      tenantId: TENANT,
      domain: 'finance',
      kind: 'a',
      title: 'A',
      description: 'd',
    });
    await inbox.addException({
      tenantId: 'other_tenant',
      domain: 'finance',
      kind: 'b',
      title: 'B',
      description: 'd',
    });
    const mine = await inbox.listOpen(TENANT);
    expect(mine).toHaveLength(1);
    expect(mine[0].tenantId).toBe(TENANT);
  });

  it('resolve closes the exception', async () => {
    const opened = await inbox.addException({
      tenantId: TENANT,
      domain: 'finance',
      kind: 'a',
      title: 'A',
      description: 'd',
    });
    const resolved = await inbox.resolve(TENANT, opened.id, {
      resolution: 'approved',
      resolvedByUserId: 'head_1',
    });
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedByUserId).toBe('head_1');
    const stillOpen = await inbox.listOpen(TENANT);
    expect(stillOpen).toHaveLength(0);
  });

  it('scorePriority honours strategic weight', () => {
    const now = new Date();
    expect(
      scorePriority({
        amountMinorUnits: 0,
        dueAt: null,
        strategicWeight: 9,
        now,
      }),
    ).toBe('P1');
    expect(
      scorePriority({
        amountMinorUnits: 0,
        dueAt: null,
        strategicWeight: 4,
        now,
      }),
    ).toBe('P2');
    expect(
      scorePriority({
        amountMinorUnits: 0,
        dueAt: null,
        strategicWeight: 0,
        now,
      }),
    ).toBe('P3');
  });
});
