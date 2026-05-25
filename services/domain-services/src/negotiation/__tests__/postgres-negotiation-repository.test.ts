/**
 * Unit tests for Postgres negotiation repositories using an in-memory
 * Drizzle-like fake. No live DB needed.
 */
import { describe, it, expect } from 'vitest';
import {
  PostgresNegotiationPolicyRepository,
  PostgresNegotiationRepository,
  PostgresNegotiationTurnRepository,
  type DrizzleLike,
} from '../postgres-negotiation-repository.js';
import {
  asNegotiationId,
  asNegotiationPolicyId,
  asNegotiationTurnId,
  type Negotiation,
  type NegotiationPolicy,
  type NegotiationTurn,
} from '../types.js';
import type { TenantId } from '@borjie/domain-models';

interface MemRow {
  readonly [k: string]: unknown;
}

function makeFake(): DrizzleLike & {
  all: Map<unknown, Map<string, MemRow>>;
} {
  const all = new Map<unknown, Map<string, MemRow>>();

  function table(t: unknown) {
    let m = all.get(t);
    if (!m) {
      m = new Map();
      all.set(t, m);
    }
    return m;
  }

  const db: DrizzleLike & { all: Map<unknown, Map<string, MemRow>> } = {
    all,
    async transaction<T>(fn: (tx: DrizzleLike) => Promise<T>): Promise<T> {
      return fn(db);
    },
    insert(t: unknown) {
      return {
        values(values: unknown) {
          const rows = Array.isArray(values) ? values : [values];
          for (const row of rows as MemRow[]) {
            table(t).set(row.id as string, { ...row });
          }
          return { async onConflictDoNothing() {}, async returning() { return rows; } };
        },
      };
    },
    select(cols?: Record<string, unknown>) {
      return {
        from(t: unknown) {
          const rows = Array.from(table(t).values());
          const filtered: MemRow[] = [...rows];
          return {
            where() {
              return {
                async limit() {
                  return filtered;
                },
                async orderBy() {
                  return filtered;
                },
              };
            },
          };
        },
      };
    },
    update(t: unknown) {
      return {
        set(patch: Record<string, unknown>) {
          return {
            async where() {
              for (const [id, row] of table(t)) {
                table(t).set(id, { ...row, ...patch });
              }
            },
          };
        },
      };
    },
  };
  return db;
}

const tenantId = 'tenant-1' as unknown as TenantId;

describe('PostgresNegotiationPolicyRepository', () => {
  it('creates and finds a policy by id', async () => {
    const db = makeFake();
    const repo = new PostgresNegotiationPolicyRepository(db);
    const policy: NegotiationPolicy = {
      id: asNegotiationPolicyId('p1'),
      tenantId,
      unitId: null,
      propertyId: null,
      domain: 'lease_price',
      listPrice: 100000,
      floorPrice: 80000,
      approvalRequiredBelow: 85000,
      maxDiscountPct: 0.15,
      currency: 'KES',
      acceptableConcessions: [],
      toneGuide: 'warm',
      autoSendCounters: false,
      expiresAt: null,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z' as NegotiationPolicy['createdAt'],
      createdBy: null,
      updatedAt: '2026-01-01T00:00:00.000Z' as NegotiationPolicy['updatedAt'],
      updatedBy: null,
    };
    await repo.create(policy);
    const found = await repo.findById(policy.id, tenantId);
    expect(found?.id).toBe(policy.id);
    expect(found?.floorPrice).toBe(80000);
  });
});

describe('PostgresNegotiationTurnRepository', () => {
  it('appends turns and returns ordered list + next sequence', async () => {
    const db = makeFake();
    const repo = new PostgresNegotiationTurnRepository(db);
    const negotiationId = asNegotiationId('n1');

    const turn1: NegotiationTurn = {
      id: asNegotiationTurnId('t1'),
      tenantId,
      negotiationId,
      sequence: 0,
      actor: 'prospect',
      actorUserId: null,
      offer: 90000,
      concessionsProposed: [],
      rationale: null,
      aiModelTier: null,
      policySnapshotId: null,
      policyCheckPassed: true,
      policyCheckViolations: [],
      advisorConsulted: false,
      advisorDecision: null,
      rawPayload: {},
      createdAt: '2026-01-01T00:00:00.000Z' as NegotiationTurn['createdAt'],
    };
    await repo.append(turn1);
    const list = await repo.listByNegotiation(negotiationId, tenantId);
    expect(list.length).toBe(1);
    expect(list[0]?.offer).toBe(90000);
  });
});

describe('PostgresNegotiationRepository', () => {
  it('creates and updates a negotiation', async () => {
    const db = makeFake();
    const repo = new PostgresNegotiationRepository(db);
    const negotiation: Negotiation = {
      id: asNegotiationId('n1'),
      tenantId,
      unitId: null,
      propertyId: null,
      prospectCustomerId: null,
      counterpartyId: null,
      listingId: null,
      tenderId: null,
      bidId: null,
      policyId: asNegotiationPolicyId('p1'),
      domain: 'lease_price',
      status: 'open',
      aiPersona: 'PRICE_NEGOTIATOR',
      currentOffer: 90000,
      currentOfferBy: 'prospect',
      roundCount: 1,
      agreedPrice: null,
      closedAt: null,
      closureReason: null,
      escalatedAt: null,
      escalatedTo: null,
      createdAt: '2026-01-01T00:00:00.000Z' as Negotiation['createdAt'],
      lastActivityAt: '2026-01-01T00:00:00.000Z' as Negotiation['lastActivityAt'],
      expiresAt: null,
    };
    await repo.create(negotiation);
    const after = await repo.updateStatus(negotiation.id, tenantId, {
      status: 'accepted',
      agreedPrice: 90000,
    });
    expect(after.status).toBe('accepted');
    expect(after.agreedPrice).toBe(90000);
  });
});
