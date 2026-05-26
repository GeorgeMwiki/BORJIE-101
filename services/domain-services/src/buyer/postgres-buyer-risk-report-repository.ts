/**
 * Postgres-backed Buyer Risk Report Repository (Borjie mining domain).
 *
 * Persists composite risk reports for marketplace buyers to
 * `buyer_risk_reports` (migration 0005). Reports are immutable once
 * generated; we re-create rather than UPDATE so the history is
 * preserved for dispute resolution and model rollback.
 *
 *   - createReport         — persist a new composite report.
 *   - findLatestByBuyer    — most-recent report for a buyer.
 *   - listByBuyer          — full report trail (newest first).
 *   - countByRiskLevel     — group counts for dashboard widgets.
 *
 * Each insert is paired with the originating Drizzle table so tenant
 * isolation is enforced by both the WHERE clause and RLS.
 */

import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { buyerRiskReports } from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Drizzle client surface
// ---------------------------------------------------------------------------

interface DrizzleLike {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export const BUYER_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type BuyerRiskLevel = (typeof BUYER_RISK_LEVELS)[number];

export interface BuyerRiskDimensions {
  /** KYC verdict 0-100; higher = more concern. */
  readonly kyc: number;
  /** Sanction-list hits count (0+). */
  readonly sanctions: number;
  /**
   * Refinery / sector concentration as a 0-1 ratio of buyer's exposure
   * concentrated in a single refinery. 1.0 = single-buyer dependency.
   */
  readonly refineryConcentration: number;
  /** Country risk 0-100; mirrors World Bank / FATF scoring. */
  readonly countryRisk: number;
  /** Extra dimensions reserved for future iterations. */
  readonly extras?: Readonly<Record<string, number>>;
}

export interface BuyerRiskRecommendation {
  readonly title: string;
  readonly detail: string;
  readonly priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface BuyerRiskReport {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly buyerId: string;
  readonly score0100: number;
  readonly riskLevel: BuyerRiskLevel;
  readonly dimensions: BuyerRiskDimensions;
  readonly narrative: string | null;
  readonly recommendations: readonly BuyerRiskRecommendation[];
  readonly generatedAt: string;
  readonly expiresAt: string | null;
  readonly generatedByModel: string | null;
}

// ---------------------------------------------------------------------------
// Zod validators
// ---------------------------------------------------------------------------

const dimensionsSchema = z.object({
  kyc: z.number().min(0).max(100),
  sanctions: z.number().int().nonnegative(),
  refineryConcentration: z.number().min(0).max(1),
  countryRisk: z.number().min(0).max(100),
  extras: z.record(z.string(), z.number()).optional(),
});

const recommendationSchema = z.object({
  title: z.string().min(1),
  detail: z.string().min(1),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
});

export const createBuyerRiskReportSchema = z.object({
  id: z.string().min(1),
  buyerId: z.string().min(1),
  score0100: z.number().int().min(0).max(100),
  riskLevel: z.enum(BUYER_RISK_LEVELS),
  dimensions: dimensionsSchema,
  narrative: z.string().nullable(),
  recommendations: z.array(recommendationSchema).readonly(),
  expiresAt: z.string().nullable(),
  generatedByModel: z.string().nullable(),
});

export type CreateBuyerRiskReportInput = z.infer<
  typeof createBuyerRiskReportSchema
>;

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface BuyerRiskReportRepository {
  createReport(
    tenantId: TenantId,
    input: CreateBuyerRiskReportInput,
  ): Promise<BuyerRiskReport>;
  findLatestByBuyer(
    buyerId: string,
    tenantId: TenantId,
  ): Promise<BuyerRiskReport | null>;
  listByBuyer(
    buyerId: string,
    tenantId: TenantId,
    limit?: number,
  ): Promise<readonly BuyerRiskReport[]>;
  countByRiskLevel(
    tenantId: TenantId,
  ): Promise<Readonly<Record<BuyerRiskLevel, number>>>;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToReport(row: Record<string, unknown>): BuyerRiskReport {
  const rawDims = (row.dimensions ?? {}) as Record<string, unknown>;
  const dimsParsed = dimensionsSchema.safeParse(rawDims);
  const dimensions: BuyerRiskDimensions = dimsParsed.success
    ? dimsParsed.data
    : { kyc: 0, sanctions: 0, refineryConcentration: 0, countryRisk: 0 };

  const rawRecs = Array.isArray(row.recommendations)
    ? (row.recommendations as readonly unknown[])
    : [];
  const recommendations: BuyerRiskRecommendation[] = rawRecs.flatMap((r) => {
    const parsed = recommendationSchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  });

  const riskLevelRaw = String(row.riskLevel ?? 'low');
  const riskLevel: BuyerRiskLevel = (BUYER_RISK_LEVELS as readonly string[]).includes(
    riskLevelRaw,
  )
    ? (riskLevelRaw as BuyerRiskLevel)
    : 'low';

  return {
    id: String(row.id),
    tenantId: row.tenantId as TenantId,
    buyerId: String(row.buyerId),
    score0100: Number(row.score0100 ?? 0),
    riskLevel,
    dimensions,
    narrative: (row.narrative as string | null) ?? null,
    recommendations,
    generatedAt:
      row.generatedAt instanceof Date
        ? row.generatedAt.toISOString()
        : String(row.generatedAt ?? new Date().toISOString()),
    expiresAt:
      row.expiresAt instanceof Date
        ? row.expiresAt.toISOString()
        : ((row.expiresAt as string | null) ?? null),
    generatedByModel: (row.generatedByModel as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class PostgresBuyerRiskReportRepository
  implements BuyerRiskReportRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async createReport(
    tenantId: TenantId,
    input: CreateBuyerRiskReportInput,
  ): Promise<BuyerRiskReport> {
    const validated = createBuyerRiskReportSchema.parse(input);
    const generatedAt = new Date();
    await this.db.insert(buyerRiskReports).values({
      id: validated.id,
      tenantId: tenantId as unknown as string,
      buyerId: validated.buyerId,
      score0100: validated.score0100,
      riskLevel: validated.riskLevel,
      dimensions: validated.dimensions,
      narrative: validated.narrative,
      recommendations: validated.recommendations,
      generatedAt,
      expiresAt: validated.expiresAt ? new Date(validated.expiresAt) : null,
      generatedByModel: validated.generatedByModel,
    });
    return {
      id: validated.id,
      tenantId,
      buyerId: validated.buyerId,
      score0100: validated.score0100,
      riskLevel: validated.riskLevel,
      dimensions: validated.dimensions,
      narrative: validated.narrative,
      recommendations: validated.recommendations,
      generatedAt: generatedAt.toISOString(),
      expiresAt: validated.expiresAt,
      generatedByModel: validated.generatedByModel,
    };
  }

  async findLatestByBuyer(
    buyerId: string,
    tenantId: TenantId,
  ): Promise<BuyerRiskReport | null> {
    const rows = await this.db
      .select()
      .from(buyerRiskReports)
      .where(
        and(
          eq(buyerRiskReports.buyerId, buyerId),
          eq(buyerRiskReports.tenantId, tenantId as unknown as string),
        ),
      )
      .orderBy(desc(buyerRiskReports.generatedAt))
      .limit(1);
    return rows[0] ? rowToReport(rows[0] as Record<string, unknown>) : null;
  }

  async listByBuyer(
    buyerId: string,
    tenantId: TenantId,
    limit = 50,
  ): Promise<readonly BuyerRiskReport[]> {
    const rows = await this.db
      .select()
      .from(buyerRiskReports)
      .where(
        and(
          eq(buyerRiskReports.buyerId, buyerId),
          eq(buyerRiskReports.tenantId, tenantId as unknown as string),
        ),
      )
      .orderBy(desc(buyerRiskReports.generatedAt))
      .limit(limit);
    return (rows as Array<Record<string, unknown>>).map(rowToReport);
  }

  async countByRiskLevel(
    tenantId: TenantId,
  ): Promise<Readonly<Record<BuyerRiskLevel, number>>> {
    const rows = await this.db
      .select()
      .from(buyerRiskReports)
      .where(eq(buyerRiskReports.tenantId, tenantId as unknown as string));
    const tally: Record<BuyerRiskLevel, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    for (const row of rows as Array<Record<string, unknown>>) {
      const level = String(row.riskLevel ?? 'low');
      if ((BUYER_RISK_LEVELS as readonly string[]).includes(level)) {
        tally[level as BuyerRiskLevel] = tally[level as BuyerRiskLevel] + 1;
      }
    }
    return tally;
  }
}
