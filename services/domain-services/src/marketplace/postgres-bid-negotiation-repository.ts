/**
 * Postgres-backed Bid Negotiation Repository (Borjie mining marketplace).
 *
 * Captures the back-and-forth between buyers and sellers on a
 * marketplace bid. Each turn is APPEND-ONLY — no edits, no deletes.
 * The repo persists to `bid_negotiations` (migration 0005) and joins
 * loosely against `marketplace_bids` via the bid_id FK.
 *
 * Public API:
 *   appendTurn          — record offer/counter/accept/reject/withdraw.
 *   listByBid           — full chronological thread for a bid.
 *   findLatestTurn      — most-recent turn (used to compute next action).
 *   listOpenBidsByActor — bids where the actor's last turn is non-terminal.
 *
 * Tenant isolation enforced on every query. The repo refuses to
 * persist new turns after the thread is terminal (accept/reject/
 * withdraw) — that invariant is the call-site's responsibility but we
 * guard against it here too.
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  bidNegotiations,
  BID_NEGOTIATION_ACTIONS,
  isTerminalBidAction,
  type BidNegotiationAction,
} from '@borjie/database';
import type { TenantId, UserId } from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Drizzle client surface
// ---------------------------------------------------------------------------

/** Loose drizzle chain — see iot-service for the convention. */
interface BidDrizzleChain extends PromiseLike<Record<string, unknown>[]> {
  values: (..._args: unknown[]) => BidDrizzleChain;
  returning: (..._args: unknown[]) => BidDrizzleChain;
  from: (..._args: unknown[]) => BidDrizzleChain;
  where: (..._args: unknown[]) => BidDrizzleChain;
  limit: (..._args: unknown[]) => BidDrizzleChain;
  orderBy: (..._args: unknown[]) => BidDrizzleChain;
}

interface DrizzleLike {
  select: (..._args: unknown[]) => BidDrizzleChain;
  insert: (..._args: unknown[]) => BidDrizzleChain;
}

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

export interface BidNegotiationTurn {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly bidId: string;
  readonly fromUserId: UserId;
  readonly action: BidNegotiationAction;
  readonly priceTzs: number | null;
  readonly terms: Readonly<Record<string, unknown>>;
  readonly rationale: string | null;
  readonly signedFingerprintEventId: string | null;
  readonly createdAt: string;
}

export const appendTurnSchema = z
  .object({
    id: z.string().min(1),
    bidId: z.string().min(1),
    fromUserId: z.string().min(1),
    action: z.enum(BID_NEGOTIATION_ACTIONS),
    priceTzs: z.number().nonnegative().nullable().optional(),
    terms: z.record(z.string(), z.unknown()).default({}),
    rationale: z.string().nullable().optional(),
    signedFingerprintEventId: z.string().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    // Offer + counter must carry a price; terminal actions may omit it.
    if (
      (val.action === 'offer' || val.action === 'counter') &&
      (val.priceTzs == null || val.priceTzs < 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${val.action} requires a non-negative priceTzs`,
        path: ['priceTzs'],
      });
    }
  });

export type AppendTurnInput = z.infer<typeof appendTurnSchema>;

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface BidNegotiationRepository {
  appendTurn(
    tenantId: TenantId,
    input: AppendTurnInput,
  ): Promise<BidNegotiationTurn>;
  listByBid(
    tenantId: TenantId,
    bidId: string,
  ): Promise<readonly BidNegotiationTurn[]>;
  findLatestTurn(
    tenantId: TenantId,
    bidId: string,
  ): Promise<BidNegotiationTurn | null>;
  listOpenBidsByActor(
    tenantId: TenantId,
    actorUserId: UserId,
    limit?: number,
  ): Promise<readonly BidNegotiationTurn[]>;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToTurn(row: Record<string, unknown>): BidNegotiationTurn {
  const actionRaw = String(row.action ?? 'offer');
  const action: BidNegotiationAction = (
    BID_NEGOTIATION_ACTIONS as readonly string[]
  ).includes(actionRaw)
    ? (actionRaw as BidNegotiationAction)
    : 'offer';
  return {
    id: String(row.id),
    tenantId: row.tenantId as TenantId,
    bidId: String(row.bidId),
    fromUserId: row.fromUserId as UserId,
    action,
    priceTzs: row.priceTzs == null ? null : Number(row.priceTzs),
    terms: (row.termsJsonb as Record<string, unknown>) ?? {},
    rationale: (row.rationale as string | null) ?? null,
    signedFingerprintEventId:
      (row.signedFingerprintEventId as string | null) ?? null,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt ?? new Date().toISOString()),
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class PostgresBidNegotiationRepository
  implements BidNegotiationRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async appendTurn(
    tenantId: TenantId,
    input: AppendTurnInput,
  ): Promise<BidNegotiationTurn> {
    const validated = appendTurnSchema.parse(input);

    // Guard: refuse to append after a terminal turn closed the thread.
    const latest = await this.findLatestTurn(tenantId, validated.bidId);
    if (latest && isTerminalBidAction(latest.action)) {
      throw new Error(
        `bid ${validated.bidId} is closed (latest action: ${latest.action})`,
      );
    }

    const createdAt = new Date();
    await this.db.insert(bidNegotiations).values({
      id: validated.id,
      tenantId: tenantId as unknown as string,
      bidId: validated.bidId,
      fromUserId: validated.fromUserId as unknown as string,
      action: validated.action,
      priceTzs:
        validated.priceTzs == null ? null : String(validated.priceTzs),
      termsJsonb: validated.terms,
      rationale: validated.rationale ?? null,
      signedFingerprintEventId: validated.signedFingerprintEventId ?? null,
      createdAt,
    });

    return {
      id: validated.id,
      tenantId,
      bidId: validated.bidId,
      fromUserId: validated.fromUserId as UserId,
      action: validated.action,
      priceTzs: validated.priceTzs ?? null,
      terms: validated.terms,
      rationale: validated.rationale ?? null,
      signedFingerprintEventId: validated.signedFingerprintEventId ?? null,
      createdAt: createdAt.toISOString(),
    };
  }

  async listByBid(
    tenantId: TenantId,
    bidId: string,
  ): Promise<readonly BidNegotiationTurn[]> {
    const rows = await this.db
      .select()
      .from(bidNegotiations)
      .where(
        and(
          eq(bidNegotiations.bidId, bidId),
          eq(bidNegotiations.tenantId, tenantId as unknown as string),
        ),
      )
      .orderBy(asc(bidNegotiations.createdAt));
    return (rows as Array<Record<string, unknown>>).map(rowToTurn);
  }

  async findLatestTurn(
    tenantId: TenantId,
    bidId: string,
  ): Promise<BidNegotiationTurn | null> {
    const rows = await this.db
      .select()
      .from(bidNegotiations)
      .where(
        and(
          eq(bidNegotiations.bidId, bidId),
          eq(bidNegotiations.tenantId, tenantId as unknown as string),
        ),
      )
      .orderBy(desc(bidNegotiations.createdAt))
      .limit(1);
    return rows[0] ? rowToTurn(rows[0] as Record<string, unknown>) : null;
  }

  async listOpenBidsByActor(
    tenantId: TenantId,
    actorUserId: UserId,
    limit = 50,
  ): Promise<readonly BidNegotiationTurn[]> {
    // Pull the actor's recent turns, then collapse to one row per bid
    // keeping only the latest. The TS-side reduction keeps the SQL
    // dialect-agnostic; over 50 rows is the normal upper bound for an
    // active marketplace user so the in-memory grouping is cheap.
    const rows = await this.db
      .select()
      .from(bidNegotiations)
      .where(
        and(
          eq(bidNegotiations.fromUserId, actorUserId as unknown as string),
          eq(bidNegotiations.tenantId, tenantId as unknown as string),
        ),
      )
      .orderBy(desc(bidNegotiations.createdAt))
      .limit(Math.max(limit * 4, 50));
    const mapped = (rows as Array<Record<string, unknown>>).map(rowToTurn);
    const latestByBid = new Map<string, BidNegotiationTurn>();
    for (const turn of mapped) {
      if (!latestByBid.has(turn.bidId)) {
        latestByBid.set(turn.bidId, turn);
      }
    }
    const open: BidNegotiationTurn[] = [];
    for (const turn of latestByBid.values()) {
      if (!isTerminalBidAction(turn.action)) open.push(turn);
      if (open.length >= limit) break;
    }
    return open;
  }
}
