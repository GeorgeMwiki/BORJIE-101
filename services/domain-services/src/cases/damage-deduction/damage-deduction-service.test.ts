/**
 * DamageDeductionService tests — happy path + isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DamageDeductionService,
  DamageDeductionError,
  type DamageDeductionRepository,
} from './damage-deduction-service.js';
import type {
  DamageDeductionCase,
  DamageDeductionCaseId,
} from './damage-deduction-case.js';
import type { TenantId, UserId } from '@borjie/domain-models';

const TENANT = 'tenant_1' as TenantId;
const ACTOR = 'u_owner' as UserId;
const TENANT_ACTOR = 'u_tenant' as UserId;

function makeMemoryRepo(): DamageDeductionRepository & {
  store: Map<string, DamageDeductionCase>;
} {
  const store = new Map<string, DamageDeductionCase>();
  return {
    store,
    async findById(id) {
      return store.get(id) ?? null;
    },
    async create(entity) {
      store.set(entity.id, entity);
      return entity;
    },
    async update(entity) {
      store.set(entity.id, entity);
      return entity;
    },
  };
}

describe('DamageDeductionService', () => {
  let repo: ReturnType<typeof makeMemoryRepo>;
  let service: DamageDeductionService;

  beforeEach(() => {
    repo = makeMemoryRepo();
    service = new DamageDeductionService(repo);
  });

  it('fileClaim creates a claim_filed case with an owner turn', async () => {
    const res = await service.fileClaim(
      TENANT,
      {
        claimedDeductionMinor: 120_000,
        currency: 'TZS',
        rationale: 'Kitchen cabinet damaged',
      },
      ACTOR
    );
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.status).toBe('claim_filed');
    expect(res.data.claimedDeductionMinor).toBe(120_000);
    expect(res.data.aiMediatorTurns).toHaveLength(1);
    expect(res.data.aiMediatorTurns[0].actor).toBe('owner');
  });

  it('fileClaim rejects non-positive amounts', async () => {
    const res = await service.fileClaim(
      TENANT,
      { claimedDeductionMinor: 0, rationale: 'x' },
      ACTOR
    );
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe(DamageDeductionError.INVALID_INPUT);
  });

  it('tenantRespond appends a tenant turn and advances status', async () => {
    const created = await service.fileClaim(
      TENANT,
      { claimedDeductionMinor: 200_000, rationale: 'Broken tiles' },
      ACTOR
    );
    if (!created.success) throw new Error('setup failed');

    const responded = await service.tenantRespond(
      created.data.id,
      TENANT,
      { counterProposalMinor: 80_000, rationale: 'Partial wear & tear' },
      TENANT_ACTOR
    );
    expect(responded.success).toBe(true);
    if (!responded.success) return;
    expect(responded.data.status).toBe('tenant_responded');
    expect(responded.data.tenantCounterProposalMinor).toBe(80_000);
    expect(responded.data.aiMediatorTurns).toHaveLength(2);
    expect(responded.data.aiMediatorTurns[1].actor).toBe('tenant');
  });

  it('agreeAndSettle sets status to agreed (ledger write is stubbed out)', async () => {
    const created = await service.fileClaim(
      TENANT,
      { claimedDeductionMinor: 100_000, rationale: 'r' },
      ACTOR
    );
    if (!created.success) throw new Error('setup failed');

    const agreed = await service.agreeAndSettle(
      created.data.id,
      TENANT,
      { agreedAmountMinor: 75_000 },
      ACTOR
    );
    expect(agreed.success).toBe(true);
    if (!agreed.success) return;
    expect(agreed.data.status).toBe('agreed');
    expect(agreed.data.proposedDeductionMinor).toBe(75_000);
  });

  it('aiMediate appends an ai_mediator turn with a proposed midpoint', async () => {
    // Injected deterministic mediator so the test does not depend on
    // ANTHROPIC_API_KEY or the dynamic-import path.
    const stubMediator = {
      async draft(input: {
        claimedDeductionMinor: number;
        tenantCounterMinor: number | null;
      }) {
        const counter = input.tenantCounterMinor ?? 0;
        const midpoint = Math.round((input.claimedDeductionMinor + counter) / 2);
        return {
          proposedDeductionMinor: midpoint,
          rationale: 'stub-midpoint',
          turnText: `propose ${midpoint}`,
          escalate: false,
        };
      },
    };
    const wired = new DamageDeductionService(repo, undefined, stubMediator);
    const created = await wired.fileClaim(
      TENANT,
      { claimedDeductionMinor: 200, rationale: 'r' },
      ACTOR
    );
    if (!created.success) throw new Error('setup failed');
    // Tenant responds so there is a counter to midpoint against.
    await wired.tenantRespond(
      created.data.id,
      TENANT,
      { counterProposalMinor: 40, rationale: 'low' },
      TENANT_ACTOR
    );
    const res = await wired.aiMediate(created.data.id, TENANT, ACTOR);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.status).toBe('negotiating');
    expect(res.data.proposedDeductionMinor).toBe(120);
    const last = res.data.aiMediatorTurns[res.data.aiMediatorTurns.length - 1];
    expect(last.actor).toBe('ai_mediator');
    expect(last.proposedAmountMinor).toBe(120);
  });

  it('aiMediate escalates when above advisor threshold', async () => {
    const stubMediator = {
      async draft() {
        return {
          proposedDeductionMinor: 99_999_999,
          rationale: 'test',
          turnText: 'x',
          escalate: true,
        };
      },
    };
    const wired = new DamageDeductionService(repo, undefined, stubMediator);
    const created = await wired.fileClaim(
      TENANT,
      { claimedDeductionMinor: 10, rationale: 'r' },
      ACTOR
    );
    if (!created.success) throw new Error('setup failed');
    const res = await wired.aiMediate(created.data.id, TENANT, ACTOR);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.status).toBe('escalated');
  });

  it('aiMediate on unknown id returns CLAIM_NOT_FOUND', async () => {
    const res = await service.aiMediate(
      'ddc_nonexistent' as DamageDeductionCaseId,
      TENANT,
      ACTOR
    );
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe(DamageDeductionError.CLAIM_NOT_FOUND);
  });

  it('isolation: tenantRespond on unknown id returns CLAIM_NOT_FOUND', async () => {
    const res = await service.tenantRespond(
      'ddc_nonexistent' as DamageDeductionCaseId,
      TENANT,
      { rationale: 'x' },
      TENANT_ACTOR
    );
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe(DamageDeductionError.CLAIM_NOT_FOUND);
  });

  it('buildEvidenceBundle is NOT_IMPLEMENTED without gateway', async () => {
    const created = await service.fileClaim(
      TENANT,
      { claimedDeductionMinor: 1, rationale: 'r' },
      ACTOR
    );
    if (!created.success) throw new Error('setup failed');
    const res = await service.buildEvidenceBundle(created.data.id, TENANT, ACTOR);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe(DamageDeductionError.NOT_IMPLEMENTED);
  });
});
