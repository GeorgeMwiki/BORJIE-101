/**
 * Drizzle-backed repository for the site damage-settlement + mine-
 * rehabilitation tables (migration 0279).
 *
 * Encapsulates every read/write for:
 *   - contractor_damage_claims     (file / respond / settle / list / read)
 *   - site_rehabilitation_plans    (read — referenced by the action-plan
 *                                   approve flow)
 *   - rehabilitation_action_plans  (approve_plan / read)
 *
 * Tenant isolation: every statement filters `tenant_id = :ctx`. RLS on the
 * canonical `app.current_tenant_id` GUC is the canonical gate; the explicit
 * WHERE is defense in depth for the mock-DB / non-RLS path so one tenant
 * never reads another's rows.
 *
 * FK validation: `siteExists` + `contractorExists` let the route refuse a
 * file/respond/settle that points at a non-existent site or contractor with a
 * clear 404 BEFORE the FK would throw at insert time.
 *
 * NO money moves here — settlement records the agreed amount as STATE. Any
 * ledger posting is a separate LedgerService step (honest-degrade).
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  contractorDamageClaims,
  siteRehabilitationPlans,
  rehabilitationActionPlans,
  sites,
  externalParties,
} from '@borjie/database';

/**
 * Drizzle client shape — kept `any` at the constructor seam (same rationale
 * as cost-ledger-repository.ts: the fluent-builder generics cannot be
 * reproduced at the composition root and widening through the package barrel
 * trips TS2709). Every row is cast to `Record<string, unknown>` before use.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleLike = any;

type Row = Record<string, unknown>;

export interface NegotiationTurn {
  readonly actor: 'owner' | 'contractor' | 'mediator';
  readonly actorId: string;
  readonly proposedAmountMinor: number | null;
  readonly rationale: string;
  readonly createdAt: string;
}

export interface FileClaimInput {
  readonly tenantId: string;
  readonly siteId: string;
  readonly contractorPartyId: string;
  readonly sourceEngagementId: string | null;
  readonly damageCategory: string;
  readonly claimedAmountMinor: number;
  readonly currency: string;
  readonly rationale: string;
  readonly notes: string | null;
  readonly provenance: Record<string, unknown>;
  readonly actorId: string;
}

export interface RespondInput {
  readonly counterProposalMinor: number | null;
  readonly rationale: string;
  readonly provenance: Record<string, unknown>;
  readonly actorId: string;
}

export interface SettleInput {
  readonly agreedAmountMinor: number;
  readonly notes: string | null;
  readonly provenance: Record<string, unknown>;
  readonly actorId: string;
}

const OPEN_STATUSES = ['claim_filed', 'negotiating'] as const;

export class DamageClaimRepository {
  constructor(private readonly db: DrizzleLike) {}

  // ── FK validation ──────────────────────────────────────────────────

  async siteExists(siteId: string, tenantId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
      .limit(1);
    return (rows as Row[]).length > 0;
  }

  async contractorExists(
    contractorPartyId: string,
    tenantId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: externalParties.id })
      .from(externalParties)
      .where(
        and(
          eq(externalParties.id, contractorPartyId),
          eq(externalParties.tenantId, tenantId),
        ),
      )
      .limit(1);
    return (rows as Row[]).length > 0;
  }

  // ── contractor_damage_claims ───────────────────────────────────────

  async fileClaim(input: FileClaimInput): Promise<Row> {
    const now = new Date();
    const firstTurn: NegotiationTurn = {
      actor: 'owner',
      actorId: input.actorId,
      proposedAmountMinor: input.claimedAmountMinor,
      rationale: input.rationale,
      createdAt: now.toISOString(),
    };
    const [row] = await this.db
      .insert(contractorDamageClaims)
      .values({
        tenantId: input.tenantId,
        siteId: input.siteId,
        contractorPartyId: input.contractorPartyId,
        sourceEngagementId: input.sourceEngagementId,
        damageCategory: input.damageCategory,
        claimedAmountMinor: input.claimedAmountMinor,
        currency: input.currency,
        status: 'claim_filed',
        rationale: input.rationale,
        notes: input.notes,
        negotiationTurns: [firstTurn],
        provenance: input.provenance,
        auditChainIds: [],
        createdBy: input.actorId,
        updatedBy: input.actorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row as Row;
  }

  async findClaimById(id: string, tenantId: string): Promise<Row | null> {
    const rows = await this.db
      .select()
      .from(contractorDamageClaims)
      .where(
        and(
          eq(contractorDamageClaims.id, id),
          eq(contractorDamageClaims.tenantId, tenantId),
        ),
      )
      .limit(1);
    return (rows as Row[])[0] ?? null;
  }

  async listOpenClaims(tenantId: string, limit: number): Promise<readonly Row[]> {
    const rows = await this.db
      .select()
      .from(contractorDamageClaims)
      .where(
        and(
          eq(contractorDamageClaims.tenantId, tenantId),
          inArray(
            contractorDamageClaims.status,
            OPEN_STATUSES as unknown as string[],
          ),
        ),
      )
      .orderBy(desc(contractorDamageClaims.createdAt))
      .limit(limit);
    return rows as Row[];
  }

  /**
   * Record a counter-proposal / rationale on an OPEN claim. Appends a
   * negotiation turn and moves the claim to `negotiating`. Returns null when
   * the claim is missing; throws a tagged error when the status is terminal.
   */
  async respond(
    id: string,
    tenantId: string,
    input: RespondInput,
  ): Promise<Row | null> {
    const existing = await this.findClaimById(id, tenantId);
    if (!existing) return null;
    assertOpen(existing);
    const now = new Date();
    const turn: NegotiationTurn = {
      actor: 'owner',
      actorId: input.actorId,
      proposedAmountMinor: input.counterProposalMinor,
      rationale: input.rationale,
      createdAt: now.toISOString(),
    };
    const turns = appendTurn(existing.negotiationTurns, turn);
    const [row] = await this.db
      .update(contractorDamageClaims)
      .set({
        counterProposalMinor:
          input.counterProposalMinor ??
          (existing.counterProposalMinor as number | null) ??
          null,
        status: 'negotiating',
        rationale: input.rationale,
        negotiationTurns: turns,
        provenance: input.provenance,
        updatedBy: input.actorId,
        updatedAt: now,
      })
      .where(
        and(
          eq(contractorDamageClaims.id, id),
          eq(contractorDamageClaims.tenantId, tenantId),
        ),
      )
      .returning();
    return row as Row;
  }

  /**
   * Agree + finalise a claim at an agreed amount. Moves status to `agreed`
   * and pins settled_at. Records the agreed amount as STATE only — NO ledger
   * posting fires here.
   */
  async settle(
    id: string,
    tenantId: string,
    input: SettleInput,
  ): Promise<Row | null> {
    const existing = await this.findClaimById(id, tenantId);
    if (!existing) return null;
    if (existing.status === 'agreed') {
      throw new ClaimStateError('ALREADY_SETTLED', 'Claim is already settled');
    }
    if (existing.status === 'withdrawn') {
      throw new ClaimStateError(
        'CLAIM_WITHDRAWN',
        'Cannot settle a withdrawn claim',
      );
    }
    const now = new Date();
    const [row] = await this.db
      .update(contractorDamageClaims)
      .set({
        agreedAmountMinor: input.agreedAmountMinor,
        status: 'agreed',
        ...(input.notes !== null && { notes: input.notes }),
        provenance: input.provenance,
        settledAt: now,
        updatedBy: input.actorId,
        updatedAt: now,
      })
      .where(
        and(
          eq(contractorDamageClaims.id, id),
          eq(contractorDamageClaims.tenantId, tenantId),
        ),
      )
      .returning();
    return row as Row;
  }

  // ── rehabilitation plans + action plans ────────────────────────────

  async findActionPlan(
    actionPlanId: string,
    planId: string,
    tenantId: string,
  ): Promise<Row | null> {
    const rows = await this.db
      .select()
      .from(rehabilitationActionPlans)
      .where(
        and(
          eq(rehabilitationActionPlans.id, actionPlanId),
          eq(rehabilitationActionPlans.rehabilitationPlanId, planId),
          eq(rehabilitationActionPlans.tenantId, tenantId),
        ),
      )
      .limit(1);
    return (rows as Row[])[0] ?? null;
  }

  async planExists(planId: string, tenantId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: siteRehabilitationPlans.id })
      .from(siteRehabilitationPlans)
      .where(
        and(
          eq(siteRehabilitationPlans.id, planId),
          eq(siteRehabilitationPlans.tenantId, tenantId),
        ),
      )
      .limit(1);
    return (rows as Row[]).length > 0;
  }

  /**
   * Approve a proposed action plan, unblocking the downstream work-order
   * dispatch. Returns null when the action plan is missing; throws a tagged
   * error when it is not in `proposed`.
   */
  async approveActionPlan(
    actionPlanId: string,
    planId: string,
    tenantId: string,
    approvedBy: string,
    provenance: Record<string, unknown>,
  ): Promise<Row | null> {
    const existing = await this.findActionPlan(actionPlanId, planId, tenantId);
    if (!existing) return null;
    if (existing.status !== 'proposed') {
      throw new ClaimStateError(
        'INVALID_STATUS',
        `Cannot approve an action plan in status '${String(existing.status)}'`,
      );
    }
    const now = new Date();
    const [row] = await this.db
      .update(rehabilitationActionPlans)
      .set({
        status: 'approved',
        approvedBy,
        approvedAt: now,
        provenance,
        updatedAt: now,
      })
      .where(
        and(
          eq(rehabilitationActionPlans.id, actionPlanId),
          eq(rehabilitationActionPlans.tenantId, tenantId),
        ),
      )
      .returning();
    return row as Row;
  }
}

/** Tagged error so the route can map a terminal status to a 409. */
export class ClaimStateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ClaimStateError';
  }
}

function assertOpen(claim: Row): void {
  const status = String(claim.status);
  if (!(OPEN_STATUSES as unknown as string[]).includes(status)) {
    throw new ClaimStateError(
      'INVALID_STATUS',
      `Cannot respond when claim status is '${status}'`,
    );
  }
}

function appendTurn(
  existing: unknown,
  turn: NegotiationTurn,
): ReadonlyArray<NegotiationTurn> {
  const prior = Array.isArray(existing)
    ? (existing as NegotiationTurn[])
    : [];
  return [...prior, turn];
}
