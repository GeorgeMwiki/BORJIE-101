/**
 * Postgres-backed negotiation repositories (Drizzle).
 *
 * Three repos backed by `negotiation_policies`, `negotiations`, and the
 * append-only `negotiation_turns` table. Every query enforces row-level
 * tenant isolation via `tenant_id = :ctx` in the WHERE clause.
 *
 * Turn append + negotiation status update are orchestrated atomically by
 * the caller using `withNegotiationTransaction` (see bottom of file).
 */
import { and, asc, eq, max } from 'drizzle-orm';
import {
  negotiationPolicies,
  negotiations,
  negotiationTurns,
} from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';
import type {
  Negotiation,
  NegotiationId,
  NegotiationPolicy,
  NegotiationPolicyId,
  NegotiationPolicyRepository,
  NegotiationRepository,
  NegotiationTurn,
  NegotiationTurnRepository,
  NegotiationActor,
} from './types.js';

export interface DrizzleLike {
  transaction<T>(fn: (tx: DrizzleLike) => Promise<T>): Promise<T>;
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

// ============================================================================
// Negotiation Policy Repository
// ============================================================================

export class PostgresNegotiationPolicyRepository
  implements NegotiationPolicyRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async findById(
    id: NegotiationPolicyId,
    tenantId: TenantId
  ): Promise<NegotiationPolicy | null> {
    const rows = await this.db
      .select()
      .from(negotiationPolicies)
      .where(
        and(
          eq(negotiationPolicies.id, id as unknown as string),
          eq(negotiationPolicies.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToPolicy(row) : null;
  }

  async create(policy: NegotiationPolicy): Promise<NegotiationPolicy> {
    await this.db.insert(negotiationPolicies).values(policyToRow(policy));
    return policy;
  }

  async update(
    id: NegotiationPolicyId,
    tenantId: TenantId,
    patch: Partial<NegotiationPolicy>
  ): Promise<NegotiationPolicy> {
    const updateValues = buildPolicyUpdate(patch);
    await this.db
      .update(negotiationPolicies)
      .set(updateValues)
      .where(
        and(
          eq(negotiationPolicies.id, id as unknown as string),
          eq(negotiationPolicies.tenantId, tenantId as unknown as string)
        )
      );
    const after = await this.findById(id, tenantId);
    if (!after) throw new Error(`NegotiationPolicy not found: ${id}`);
    return after;
  }
}

// ============================================================================
// Negotiation Repository
// ============================================================================

export class PostgresNegotiationRepository implements NegotiationRepository {
  constructor(private readonly db: DrizzleLike) {}

  async findById(
    id: NegotiationId,
    tenantId: TenantId
  ): Promise<Negotiation | null> {
    const rows = await this.db
      .select()
      .from(negotiations)
      .where(
        and(
          eq(negotiations.id, id as unknown as string),
          eq(negotiations.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToNegotiation(row) : null;
  }

  async create(negotiation: Negotiation): Promise<Negotiation> {
    await this.db.insert(negotiations).values(negotiationToRow(negotiation));
    return negotiation;
  }

  async updateStatus(
    id: NegotiationId,
    tenantId: TenantId,
    patch: Partial<Negotiation>
  ): Promise<Negotiation> {
    const updateValues = buildNegotiationUpdate(patch);
    await this.db
      .update(negotiations)
      .set(updateValues)
      .where(
        and(
          eq(negotiations.id, id as unknown as string),
          eq(negotiations.tenantId, tenantId as unknown as string)
        )
      );
    const after = await this.findById(id, tenantId);
    if (!after) throw new Error(`Negotiation not found: ${id}`);
    return after;
  }
}

// ============================================================================
// Negotiation Turn Repository (APPEND-ONLY)
// ============================================================================

export class PostgresNegotiationTurnRepository
  implements NegotiationTurnRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async append(turn: NegotiationTurn): Promise<NegotiationTurn> {
    await this.db.insert(negotiationTurns).values(turnToRow(turn));
    return turn;
  }

  async listByNegotiation(
    negotiationId: NegotiationId,
    tenantId: TenantId
  ): Promise<ReadonlyArray<NegotiationTurn>> {
    const rows = await this.db
      .select()
      .from(negotiationTurns)
      .where(
        and(
          eq(
            negotiationTurns.negotiationId,
            negotiationId as unknown as string
          ),
          eq(negotiationTurns.tenantId, tenantId as unknown as string)
        )
      )
      .orderBy(asc(negotiationTurns.sequence));
    return rows.map(rowToTurn);
  }

  async nextSequence(
    negotiationId: NegotiationId,
    tenantId: TenantId
  ): Promise<number> {
    const rows = await this.db
      .select({ max: max(negotiationTurns.sequence) })
      .from(negotiationTurns)
      .where(
        and(
          eq(
            negotiationTurns.negotiationId,
            negotiationId as unknown as string
          ),
          eq(negotiationTurns.tenantId, tenantId as unknown as string)
        )
      );
    const current = (rows[0]?.max as number | null) ?? -1;
    return current + 1;
  }
}

// ============================================================================
// Row <-> Entity mapping
// ============================================================================

function policyToRow(p: NegotiationPolicy): Record<string, unknown> {
  return {
    id: p.id,
    tenantId: p.tenantId,
    unitId: p.unitId,
    propertyId: p.propertyId,
    domain: p.domain,
    listPrice: p.listPrice,
    floorPrice: p.floorPrice,
    approvalRequiredBelow: p.approvalRequiredBelow,
    maxDiscountPct: String(p.maxDiscountPct),
    currency: p.currency,
    acceptableConcessions: p.acceptableConcessions,
    toneGuide: p.toneGuide,
    autoSendCounters: p.autoSendCounters,
    expiresAt: p.expiresAt ? new Date(p.expiresAt) : null,
    active: p.active,
    createdAt: new Date(p.createdAt),
    createdBy: p.createdBy,
    updatedAt: new Date(p.updatedAt),
    updatedBy: p.updatedBy,
  };
}

function buildPolicyUpdate(
  patch: Partial<NegotiationPolicy>
): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (patch.unitId !== undefined) u.unitId = patch.unitId;
  if (patch.propertyId !== undefined) u.propertyId = patch.propertyId;
  if (patch.domain !== undefined) u.domain = patch.domain;
  if (patch.listPrice !== undefined) u.listPrice = patch.listPrice;
  if (patch.floorPrice !== undefined) u.floorPrice = patch.floorPrice;
  if (patch.approvalRequiredBelow !== undefined)
    u.approvalRequiredBelow = patch.approvalRequiredBelow;
  if (patch.maxDiscountPct !== undefined)
    u.maxDiscountPct = String(patch.maxDiscountPct);
  if (patch.currency !== undefined) u.currency = patch.currency;
  if (patch.acceptableConcessions !== undefined)
    u.acceptableConcessions = patch.acceptableConcessions;
  if (patch.toneGuide !== undefined) u.toneGuide = patch.toneGuide;
  if (patch.autoSendCounters !== undefined)
    u.autoSendCounters = patch.autoSendCounters;
  if (patch.expiresAt !== undefined)
    u.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
  if (patch.active !== undefined) u.active = patch.active;
  if (patch.updatedBy !== undefined) u.updatedBy = patch.updatedBy;
  u.updatedAt = new Date();
  return u;
}

function rowToPolicy(row: Record<string, unknown>): NegotiationPolicy {
  return {
    id: row.id as NegotiationPolicyId,
    tenantId: row.tenantId as TenantId,
    unitId: (row.unitId as string | null) ?? null,
    propertyId: (row.propertyId as string | null) ?? null,
    domain: row.domain as NegotiationPolicy['domain'],
    listPrice: row.listPrice as number,
    floorPrice: row.floorPrice as number,
    approvalRequiredBelow: row.approvalRequiredBelow as number,
    maxDiscountPct: Number(row.maxDiscountPct ?? 0),
    currency: row.currency as string,
    acceptableConcessions:
      (row.acceptableConcessions as NegotiationPolicy['acceptableConcessions']) ??
      [],
    toneGuide: row.toneGuide as NegotiationPolicy['toneGuide'],
    autoSendCounters: Boolean(row.autoSendCounters),
    expiresAt: row.expiresAt ? toIso(row.expiresAt as Date | string) : null,
    active: Boolean(row.active),
    createdAt: toIso(row.createdAt as Date | string) as NegotiationPolicy['createdAt'],
    createdBy: (row.createdBy as NegotiationPolicy['createdBy']) ?? null,
    updatedAt: toIso(row.updatedAt as Date | string) as NegotiationPolicy['updatedAt'],
    updatedBy: (row.updatedBy as NegotiationPolicy['updatedBy']) ?? null,
  };
}

function negotiationToRow(n: Negotiation): Record<string, unknown> {
  return {
    id: n.id,
    tenantId: n.tenantId,
    unitId: n.unitId,
    propertyId: n.propertyId,
    prospectCustomerId: n.prospectCustomerId,
    counterpartyId: n.counterpartyId,
    listingId: n.listingId,
    tenderId: n.tenderId,
    bidId: n.bidId,
    policyId: n.policyId,
    domain: n.domain,
    status: n.status,
    aiPersona: n.aiPersona,
    currentOffer: n.currentOffer,
    currentOfferBy: n.currentOfferBy,
    roundCount: n.roundCount,
    agreedPrice: n.agreedPrice,
    closedAt: n.closedAt ? new Date(n.closedAt) : null,
    closureReason: n.closureReason,
    escalatedAt: n.escalatedAt ? new Date(n.escalatedAt) : null,
    escalatedTo: n.escalatedTo,
    createdAt: new Date(n.createdAt),
    lastActivityAt: new Date(n.lastActivityAt),
    expiresAt: n.expiresAt ? new Date(n.expiresAt) : null,
  };
}

function buildNegotiationUpdate(
  patch: Partial<Negotiation>
): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (patch.status !== undefined) u.status = patch.status;
  if (patch.currentOffer !== undefined) u.currentOffer = patch.currentOffer;
  if (patch.currentOfferBy !== undefined) u.currentOfferBy = patch.currentOfferBy;
  if (patch.roundCount !== undefined) u.roundCount = patch.roundCount;
  if (patch.agreedPrice !== undefined) u.agreedPrice = patch.agreedPrice;
  if (patch.closedAt !== undefined)
    u.closedAt = patch.closedAt ? new Date(patch.closedAt) : null;
  if (patch.closureReason !== undefined) u.closureReason = patch.closureReason;
  if (patch.escalatedAt !== undefined)
    u.escalatedAt = patch.escalatedAt ? new Date(patch.escalatedAt) : null;
  if (patch.escalatedTo !== undefined) u.escalatedTo = patch.escalatedTo;
  if (patch.expiresAt !== undefined)
    u.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
  u.lastActivityAt = new Date();
  return u;
}

function rowToNegotiation(row: Record<string, unknown>): Negotiation {
  return {
    id: row.id as NegotiationId,
    tenantId: row.tenantId as TenantId,
    unitId: (row.unitId as string | null) ?? null,
    propertyId: (row.propertyId as string | null) ?? null,
    prospectCustomerId: (row.prospectCustomerId as string | null) ?? null,
    counterpartyId: (row.counterpartyId as string | null) ?? null,
    listingId: (row.listingId as string | null) ?? null,
    tenderId: (row.tenderId as string | null) ?? null,
    bidId: (row.bidId as string | null) ?? null,
    policyId: row.policyId as NegotiationPolicyId,
    domain: row.domain as Negotiation['domain'],
    status: row.status as Negotiation['status'],
    aiPersona: (row.aiPersona as string) ?? 'PRICE_NEGOTIATOR',
    currentOffer: (row.currentOffer as number | null) ?? null,
    currentOfferBy: (row.currentOfferBy as NegotiationActor | null) ?? null,
    roundCount: (row.roundCount as number) ?? 0,
    agreedPrice: (row.agreedPrice as number | null) ?? null,
    closedAt: row.closedAt ? (toIso(row.closedAt as Date) as Negotiation['closedAt']) : null,
    closureReason: (row.closureReason as string | null) ?? null,
    escalatedAt: row.escalatedAt
      ? (toIso(row.escalatedAt as Date) as Negotiation['escalatedAt'])
      : null,
    escalatedTo: (row.escalatedTo as string | null) ?? null,
    createdAt: toIso(row.createdAt as Date | string) as Negotiation['createdAt'],
    lastActivityAt: toIso(
      row.lastActivityAt as Date | string
    ) as Negotiation['lastActivityAt'],
    expiresAt: row.expiresAt
      ? (toIso(row.expiresAt as Date) as Negotiation['expiresAt'])
      : null,
  };
}

function turnToRow(t: NegotiationTurn): Record<string, unknown> {
  return {
    id: t.id,
    tenantId: t.tenantId,
    negotiationId: t.negotiationId,
    sequence: t.sequence,
    actor: t.actor,
    actorUserId: t.actorUserId,
    offer: t.offer,
    concessionsProposed: t.concessionsProposed,
    rationale: t.rationale,
    aiModelTier: t.aiModelTier,
    policySnapshotId: t.policySnapshotId,
    policyCheckPassed: t.policyCheckPassed,
    policyCheckViolations: t.policyCheckViolations,
    advisorConsulted: t.advisorConsulted,
    advisorDecision: t.advisorDecision,
    rawPayload: t.rawPayload,
    createdAt: new Date(t.createdAt),
  };
}

function rowToTurn(row: Record<string, unknown>): NegotiationTurn {
  return {
    id: row.id as NegotiationTurn['id'],
    tenantId: row.tenantId as TenantId,
    negotiationId: row.negotiationId as NegotiationId,
    sequence: row.sequence as number,
    actor: row.actor as NegotiationActor,
    actorUserId: (row.actorUserId as NegotiationTurn['actorUserId']) ?? null,
    offer: (row.offer as number | null) ?? null,
    concessionsProposed:
      (row.concessionsProposed as NegotiationTurn['concessionsProposed']) ?? [],
    rationale: (row.rationale as string | null) ?? null,
    aiModelTier: (row.aiModelTier as string | null) ?? null,
    policySnapshotId:
      (row.policySnapshotId as NegotiationPolicyId | null) ?? null,
    policyCheckPassed: Boolean(row.policyCheckPassed),
    policyCheckViolations:
      (row.policyCheckViolations as ReadonlyArray<string>) ?? [],
    advisorConsulted: Boolean(row.advisorConsulted),
    advisorDecision: (row.advisorDecision as string | null) ?? null,
    rawPayload: row.rawPayload,
    createdAt: toIso(row.createdAt as Date | string) as NegotiationTurn['createdAt'],
  };
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}
