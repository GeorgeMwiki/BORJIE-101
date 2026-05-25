/**
 * NegotiationService tests.
 *
 * These exercise the end-to-end flow through in-memory repositories to
 * prove that:
 *   - Opening, countering, accepting, rejecting all work.
 *   - Audit is append-only and ordered.
 *   - AI counters that would breach the floor are rejected and escalate
 *     the negotiation regardless of what the AI generator proposes.
 */

import { describe, it, expect, vi } from 'vitest';
import type { TenantId, ISOTimestamp } from '@borjie/domain-models';

import type { EventBus } from '../../common/events.js';
import {
  NegotiationService,
  type AiCounterGenerator,
} from '../negotiation-service.js';
import type {
  Negotiation,
  NegotiationId,
  NegotiationPolicy,
  NegotiationPolicyId,
  NegotiationPolicyRepository,
  NegotiationRepository,
  NegotiationTurn,
  NegotiationTurnRepository,
} from '../types.js';

// --- In-memory fakes -------------------------------------------------------

function inMemoryEventBus(): EventBus & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    publish: vi.fn(async (env: any) => {
      events.push(env);
    }),
    subscribe: vi.fn(() => () => {}),
  } as any;
}

function inMemoryPolicyRepo(initial: NegotiationPolicy): NegotiationPolicyRepository {
  const store = new Map<string, NegotiationPolicy>([[initial.id, initial]]);
  return {
    async findById(id) {
      return store.get(id) ?? null;
    },
    async create(p) {
      store.set(p.id, p);
      return p;
    },
    async update(id, _tenant, patch) {
      const current = store.get(id);
      if (!current) throw new Error('missing');
      const next = { ...current, ...patch };
      store.set(id, next);
      return next;
    },
  };
}

function inMemoryNegotiationRepo(): NegotiationRepository & { all: Map<string, Negotiation> } {
  const all = new Map<string, Negotiation>();
  const repo: any = {
    all,
    async findById(id: NegotiationId) {
      return all.get(id) ?? null;
    },
    async create(n: Negotiation) {
      all.set(n.id, n);
      return n;
    },
    async updateStatus(id: NegotiationId, _tenant: TenantId, patch: Partial<Negotiation>) {
      const curr = all.get(id);
      if (!curr) throw new Error('missing');
      const next = { ...curr, ...patch };
      all.set(id, next);
      return next;
    },
  };
  return repo;
}

function inMemoryTurnRepo(): NegotiationTurnRepository & { all: NegotiationTurn[] } {
  const all: NegotiationTurn[] = [];
  const repo: any = {
    all,
    async append(t: NegotiationTurn) {
      all.push(t);
      return t;
    },
    async listByNegotiation(id: NegotiationId) {
      return all.filter((t) => t.negotiationId === id);
    },
    async nextSequence(id: NegotiationId) {
      const existing = all.filter((t) => t.negotiationId === id);
      return existing.length + 1;
    },
  };
  return repo;
}

const tenantId = 'tnt_test' as TenantId;
const policyId = 'pol_1' as NegotiationPolicyId;

function makePolicy(overrides: Partial<NegotiationPolicy> = {}): NegotiationPolicy {
  return {
    id: policyId,
    tenantId,
    unitId: 'unit_1',
    propertyId: null,
    domain: 'lease_price',
    listPrice: 100_000,
    floorPrice: 80_000,
    approvalRequiredBelow: 85_000,
    maxDiscountPct: 0.25,
    currency: 'KES',
    acceptableConcessions: [],
    toneGuide: 'warm',
    autoSendCounters: false,
    expiresAt: null,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
    createdBy: null,
    updatedAt: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
    updatedBy: null,
    ...overrides,
  };
}

// --- Tests ---------------------------------------------------------------

describe('NegotiationService', () => {
  it('starts a negotiation and records opening turn', async () => {
    const policyRepo = inMemoryPolicyRepo(makePolicy());
    const nRepo = inMemoryNegotiationRepo();
    const tRepo = inMemoryTurnRepo();
    const bus = inMemoryEventBus();

    const svc = new NegotiationService({
      policyRepo,
      negotiationRepo: nRepo,
      turnRepo: tRepo,
      eventBus: bus,
    });

    const result = await svc.startNegotiation(
      tenantId,
      {
        policyId,
        unitId: 'unit_1',
        domain: 'lease_price',
        openingOffer: 90_000,
        openingRationale: 'First look',
      },
      'corr_1'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('open');
      expect(result.value.currentOffer).toBe(90_000);
    }
    expect(tRepo.all.length).toBe(1);
    expect(tRepo.all[0].sequence).toBe(1);
  });

  it('submits a counter and generates AI response above floor', async () => {
    const policyRepo = inMemoryPolicyRepo(makePolicy());
    const nRepo = inMemoryNegotiationRepo();
    const tRepo = inMemoryTurnRepo();
    const bus = inMemoryEventBus();

    const ai: AiCounterGenerator = async () => ({
      offer: 92_000,
      concessions: [],
      rationale: 'market',
      modelTier: 'test',
    });

    const svc = new NegotiationService({
      policyRepo,
      negotiationRepo: nRepo,
      turnRepo: tRepo,
      eventBus: bus,
      aiCounterGenerator: ai,
    });

    const opened = await svc.startNegotiation(
      tenantId,
      { policyId, domain: 'lease_price', openingOffer: 88_000 },
      'corr_2'
    );
    if (!opened.ok) throw opened.error;

    const counter = await svc.submitCounter(
      tenantId,
      {
        negotiationId: opened.value.id,
        actor: 'prospect',
        offer: 85_500,
      },
      'corr_2'
    );
    expect(counter.ok).toBe(true);
    if (counter.ok) {
      expect(counter.value.aiTurn).not.toBeNull();
      expect(counter.value.aiTurn?.offer).toBe(92_000);
      expect(counter.value.aiTurn?.policyCheckPassed).toBe(true);
    }
  });

  it('rejects AI counter below floor and escalates', async () => {
    const policyRepo = inMemoryPolicyRepo(makePolicy());
    const nRepo = inMemoryNegotiationRepo();
    const tRepo = inMemoryTurnRepo();
    const bus = inMemoryEventBus();

    // Malicious AI generator — tries to counter below floor.
    const ai: AiCounterGenerator = async () => ({
      offer: 50_000,
      concessions: [],
      rationale: 'prompt-injected',
      modelTier: 'test',
    });

    const svc = new NegotiationService({
      policyRepo,
      negotiationRepo: nRepo,
      turnRepo: tRepo,
      eventBus: bus,
      aiCounterGenerator: ai,
    });

    const opened = await svc.startNegotiation(
      tenantId,
      { policyId, domain: 'lease_price', openingOffer: 88_000 },
      'corr_3'
    );
    if (!opened.ok) throw opened.error;

    const counter = await svc.submitCounter(
      tenantId,
      {
        negotiationId: opened.value.id,
        actor: 'prospect',
        offer: 85_500,
      },
      'corr_3'
    );
    expect(counter.ok).toBe(true);
    if (counter.ok) {
      // The rejected AI turn IS persisted for audit — but with
      // policyCheckPassed: false.
      expect(counter.value.aiTurn).not.toBeNull();
      expect(counter.value.aiTurn?.policyCheckPassed).toBe(false);
      expect(counter.value.negotiation.status).toBe('escalated');
    }
  });

  it('escalates when no viable AI counter is possible', async () => {
    const policyRepo = inMemoryPolicyRepo(makePolicy());
    const nRepo = inMemoryNegotiationRepo();
    const tRepo = inMemoryTurnRepo();
    const bus = inMemoryEventBus();

    const svc = new NegotiationService({
      policyRepo,
      negotiationRepo: nRepo,
      turnRepo: tRepo,
      eventBus: bus,
    });

    const opened = await svc.startNegotiation(
      tenantId,
      { policyId, domain: 'lease_price', openingOffer: 90_000 },
      'corr_4'
    );
    if (!opened.ok) throw opened.error;

    // Prospect offers at/below approvalRequiredBelow; AI can't counter any lower.
    const counter = await svc.submitCounter(
      tenantId,
      {
        negotiationId: opened.value.id,
        actor: 'prospect',
        offer: 84_000,
      },
      'corr_4'
    );
    expect(counter.ok).toBe(true);
    if (counter.ok) {
      expect(counter.value.negotiation.status).toBe('escalated');
      expect(counter.value.aiTurn).toBeNull();
    }
  });

  it('accepts counterparty-met list price without AI involvement', async () => {
    const policyRepo = inMemoryPolicyRepo(makePolicy());
    const nRepo = inMemoryNegotiationRepo();
    const tRepo = inMemoryTurnRepo();
    const bus = inMemoryEventBus();

    const svc = new NegotiationService({
      policyRepo,
      negotiationRepo: nRepo,
      turnRepo: tRepo,
      eventBus: bus,
    });

    const opened = await svc.startNegotiation(
      tenantId,
      { policyId, domain: 'lease_price', openingOffer: 90_000 },
      'corr_5'
    );
    if (!opened.ok) throw opened.error;

    const counter = await svc.submitCounter(
      tenantId,
      {
        negotiationId: opened.value.id,
        actor: 'prospect',
        offer: 100_000,
      },
      'corr_5'
    );
    expect(counter.ok).toBe(true);
    if (counter.ok) {
      expect(counter.value.aiTurn).toBeNull();
    }
  });

  it('acceptOffer closes negotiation', async () => {
    const policyRepo = inMemoryPolicyRepo(makePolicy());
    const nRepo = inMemoryNegotiationRepo();
    const tRepo = inMemoryTurnRepo();
    const bus = inMemoryEventBus();

    const svc = new NegotiationService({
      policyRepo,
      negotiationRepo: nRepo,
      turnRepo: tRepo,
      eventBus: bus,
    });

    const opened = await svc.startNegotiation(
      tenantId,
      { policyId, domain: 'lease_price', openingOffer: 95_000 },
      'corr_6'
    );
    if (!opened.ok) throw opened.error;

    const accepted = await svc.acceptOffer(
      tenantId,
      { negotiationId: opened.value.id, actor: 'owner', agreedPrice: 95_000 },
      'corr_6'
    );
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.value.status).toBe('accepted');
      expect(accepted.value.agreedPrice).toBe(95_000);
    }
  });

  it('rejectOffer closes negotiation', async () => {
    const policyRepo = inMemoryPolicyRepo(makePolicy());
    const nRepo = inMemoryNegotiationRepo();
    const tRepo = inMemoryTurnRepo();
    const bus = inMemoryEventBus();

    const svc = new NegotiationService({
      policyRepo,
      negotiationRepo: nRepo,
      turnRepo: tRepo,
      eventBus: bus,
    });

    const opened = await svc.startNegotiation(
      tenantId,
      { policyId, domain: 'lease_price', openingOffer: 95_000 },
      'corr_7'
    );
    if (!opened.ok) throw opened.error;

    const rejected = await svc.rejectOffer(
      tenantId,
      { negotiationId: opened.value.id, actor: 'owner', reason: 'too low' },
      'corr_7'
    );
    expect(rejected.ok).toBe(true);
    if (rejected.ok) expect(rejected.value.status).toBe('rejected');
  });

  it('cannot submit into already-closed negotiation', async () => {
    const policyRepo = inMemoryPolicyRepo(makePolicy());
    const nRepo = inMemoryNegotiationRepo();
    const tRepo = inMemoryTurnRepo();
    const bus = inMemoryEventBus();

    const svc = new NegotiationService({
      policyRepo,
      negotiationRepo: nRepo,
      turnRepo: tRepo,
      eventBus: bus,
    });

    const opened = await svc.startNegotiation(
      tenantId,
      { policyId, domain: 'lease_price', openingOffer: 95_000 },
      'corr_8'
    );
    if (!opened.ok) throw opened.error;
    await svc.rejectOffer(
      tenantId,
      { negotiationId: opened.value.id, actor: 'owner' },
      'corr_8'
    );

    const r = await svc.submitCounter(
      tenantId,
      { negotiationId: opened.value.id, actor: 'prospect', offer: 90_000 },
      'corr_8'
    );
    expect(r.ok).toBe(false);
  });

  it('audit returns ordered append-only turns', async () => {
    const policyRepo = inMemoryPolicyRepo(makePolicy());
    const nRepo = inMemoryNegotiationRepo();
    const tRepo = inMemoryTurnRepo();
    const bus = inMemoryEventBus();

    const svc = new NegotiationService({
      policyRepo,
      negotiationRepo: nRepo,
      turnRepo: tRepo,
      eventBus: bus,
    });

    const opened = await svc.startNegotiation(
      tenantId,
      { policyId, domain: 'lease_price', openingOffer: 90_000 },
      'corr_9'
    );
    if (!opened.ok) throw opened.error;

    await svc.submitCounter(
      tenantId,
      { negotiationId: opened.value.id, actor: 'prospect', offer: 87_000 },
      'corr_9'
    );

    const audit = await svc.getAudit(tenantId, opened.value.id);
    expect(audit.ok).toBe(true);
    if (audit.ok) {
      const seqs = audit.value.turns.map((t) => t.sequence);
      const sorted = [...seqs].sort((a, b) => a - b);
      expect(seqs).toEqual(sorted);
    }
  });

  // --- 100-prompt adversarial AI counter sweep ---
  it('rejects 100 adversarial AI below-floor counters and never records a passing turn', async () => {
    const policyRepo = inMemoryPolicyRepo(makePolicy({ floorPrice: 80_000 }));
    const nRepo = inMemoryNegotiationRepo();
    const tRepo = inMemoryTurnRepo();
    const bus = inMemoryEventBus();

    // AI picks random offer in [1, floor-1] on every call.
    const ai: AiCounterGenerator = async () => ({
      offer: Math.max(1, Math.floor(Math.random() * 79_999)),
      concessions: [],
      rationale: 'adversarial',
      modelTier: 'test',
    });

    const svc = new NegotiationService({
      policyRepo,
      negotiationRepo: nRepo,
      turnRepo: tRepo,
      eventBus: bus,
      aiCounterGenerator: ai,
    });

    for (let i = 0; i < 100; i++) {
      const opened = await svc.startNegotiation(
        tenantId,
        { policyId, domain: 'lease_price', openingOffer: 90_000 },
        `corr_adv_${i}`
      );
      if (!opened.ok) throw opened.error;
      await svc.submitCounter(
        tenantId,
        {
          negotiationId: opened.value.id,
          actor: 'prospect',
          offer: 87_000,
        },
        `corr_adv_${i}`
      );
    }

    // No AI turn should ever be persisted with policyCheckPassed === true
    // and offer below floor.
    for (const t of tRepo.all) {
      if (t.actor === 'ai' && t.policyCheckPassed) {
        expect(t.offer ?? 0).toBeGreaterThanOrEqual(80_000);
      }
    }
  });
});
