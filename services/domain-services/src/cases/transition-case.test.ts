/**
 * Tests for CaseService.transitionCase (additive method).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CaseService,
  CaseServiceError,
  type Case,
  type CaseId,
  type CaseRepository,
} from './index.js';
import type { EventBus, EventEnvelope } from '../common/events.js';
import type { TenantId, UserId } from '@borjie/domain-models';

const TENANT = 'tenant_1' as TenantId;
const ACTOR = 'u_actor' as UserId;

function makeCase(id: string, status: Case['status']): Case {
  return {
    id: id as CaseId,
    tenantId: TENANT,
    caseNumber: `CASE-${id}`,
    type: 'OTHER',
    severity: 'MEDIUM',
    status,
    title: 't',
    description: 'd',
    customerId: 'c1' as any,
    timeline: [],
    notices: [],
    evidence: [],
    escalationLevel: 0,
    createdAt: new Date().toISOString() as any,
    createdBy: ACTOR,
    updatedAt: new Date().toISOString() as any,
    updatedBy: ACTOR,
  } as Case;
}

describe('CaseService.transitionCase', () => {
  let stored: Case | null;
  let published: EventEnvelope[];

  const repo: CaseRepository = {
    findById: vi.fn(async () => stored),
    update: vi.fn(async (c: Case) => {
      stored = c;
      return c;
    }),
  } as unknown as CaseRepository;

  const eventBus: EventBus = {
    publish: vi.fn(async (env: EventEnvelope) => {
      published.push(env);
    }),
    subscribe: vi.fn(() => () => undefined),
  };

  let service: CaseService;

  beforeEach(() => {
    stored = null;
    published = [];
    vi.clearAllMocks();
    service = new CaseService(repo, eventBus);
  });

  it('allows OPEN -> IN_PROGRESS and publishes CaseStatusChanged', async () => {
    stored = makeCase('c1', 'OPEN');
    const res = await service.transitionCase(
      stored.id,
      TENANT,
      'IN_PROGRESS',
      'picking up the case',
      ACTOR,
      'corr_1'
    );
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.status).toBe('IN_PROGRESS');
    expect(res.data.timeline).toHaveLength(1);
    expect(published).toHaveLength(1);
    expect(published[0].event.eventType).toBe('CaseStatusChanged');
  });

  it('rejects illegal transition OPEN -> RESOLVED', async () => {
    stored = makeCase('c2', 'OPEN');
    const res = await service.transitionCase(stored.id, TENANT, 'RESOLVED', 'skip', ACTOR);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe(CaseServiceError.INVALID_STATUS_TRANSITION);
  });

  it('returns CASE_NOT_FOUND when case missing', async () => {
    stored = null;
    const res = await service.transitionCase(
      'c_missing' as CaseId,
      TENANT,
      'IN_PROGRESS',
      'r',
      ACTOR
    );
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe(CaseServiceError.CASE_NOT_FOUND);
  });

  it('rejects transition from CLOSED (terminal)', async () => {
    stored = makeCase('c3', 'CLOSED');
    const res = await service.transitionCase(stored.id, TENANT, 'RESOLVED', 'r', ACTOR);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe(CaseServiceError.INVALID_STATUS_TRANSITION);
  });
});
