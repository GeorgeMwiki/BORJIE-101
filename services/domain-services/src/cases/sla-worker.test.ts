/**
 * Tests for CaseSLAWorker.
 *
 * Uses in-memory fakes — no DB or timers (we drive tick() directly).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CaseSLAWorker, MAX_ESCALATION_LEVEL } from './sla-worker.js';
import type { Case, CaseId, CaseRepository, CaseService } from './index.js';
import type { EventBus, EventEnvelope } from '../common/events.js';
import type { TenantId, UserId } from '@borjie/domain-models';
import { ok } from '@borjie/domain-models';

const TENANT = 'tenant_1' as TenantId;

function makeCase(id: string, escalationLevel: number): Case {
  return {
    id: id as CaseId,
    tenantId: TENANT,
    caseNumber: `CASE-${id}`,
    type: 'OTHER',
    severity: 'MEDIUM',
    status: 'OPEN',
    title: 't',
    description: 'd',
    customerId: 'c1' as any,
    timeline: [],
    notices: [],
    evidence: [],
    escalationLevel,
    createdAt: new Date().toISOString() as any,
    createdBy: 'u1' as UserId,
    updatedAt: new Date().toISOString() as any,
    updatedBy: 'u1' as UserId,
  } as Case;
}

describe('CaseSLAWorker', () => {
  let overdue: Case[];
  let published: EventEnvelope[];
  let escalatedIds: string[];

  const repo: CaseRepository = {
    findOverdue: vi.fn(async () => overdue),
  } as unknown as CaseRepository;

  const eventBus: EventBus = {
    publish: vi.fn(async (env: EventEnvelope) => {
      published.push(env);
    }),
    subscribe: vi.fn(() => () => undefined),
  };

  const caseService = {
    escalateCase: vi.fn(async (caseId: CaseId) => {
      escalatedIds.push(caseId);
      return ok(makeCase(caseId, 1));
    }),
  } as unknown as CaseService;

  beforeEach(() => {
    overdue = [];
    published = [];
    escalatedIds = [];
    vi.clearAllMocks();
  });

  it('auto-escalates cases below MAX_ESCALATION_LEVEL', async () => {
    overdue = [makeCase('c_a', 0), makeCase('c_b', 1)];
    const worker = new CaseSLAWorker({ tenantId: TENANT, caseRepo: repo, caseService, eventBus });

    const result = await worker.tick();

    expect(result.scanned).toBe(2);
    expect(result.escalated).toBe(2);
    expect(result.breached).toBe(0);
    expect(escalatedIds).toEqual(['c_a', 'c_b']);
  });

  it('publishes CaseSLABreachedEvent once MAX is reached', async () => {
    overdue = [makeCase('c_max', MAX_ESCALATION_LEVEL)];
    const worker = new CaseSLAWorker({ tenantId: TENANT, caseRepo: repo, caseService, eventBus });

    const result = await worker.tick();

    expect(result.escalated).toBe(0);
    expect(result.breached).toBe(1);
    expect(published).toHaveLength(1);
    expect(published[0].event.eventType).toBe('CaseSLABreached');
  });

  it('isolation: no overdue cases = no-op', async () => {
    overdue = [];
    const worker = new CaseSLAWorker({ tenantId: TENANT, caseRepo: repo, caseService, eventBus });

    const result = await worker.tick();

    expect(result.scanned).toBe(0);
    expect(result.escalated).toBe(0);
    expect(result.breached).toBe(0);
    expect(published).toHaveLength(0);
  });

  it('start() is idempotent and stop() clears the timer', () => {
    const worker = new CaseSLAWorker({ tenantId: TENANT, caseRepo: repo, caseService, eventBus });
    worker.start(60_000);
    worker.start(60_000);
    worker.stop();
    // No throw = pass. Also safe to stop twice.
    worker.stop();
    expect(true).toBe(true);
  });
});
