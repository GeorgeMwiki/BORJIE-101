/**
 * Drizzle repository for per-tenant grading weights.
 *
 * Reads from / writes to the `tenant_grading_weights` table. If the
 * tenant has no custom row, returns DEFAULT_GRADING_WEIGHTS.
 */

import { eq } from 'drizzle-orm';
import { tenantGradingWeights } from '@borjie/database';
import {
  DEFAULT_GRADING_WEIGHTS,
  type GradingWeights,
  type WeightsRepository,
} from './ports.js';

type DbClient = any;

export class DrizzleWeightsRepository implements WeightsRepository {
  constructor(private readonly db: DbClient) {}

  async getWeights(tenantId: string): Promise<GradingWeights> {
    const rows = await this.db
      .select()
      .from(tenantGradingWeights)
      .where(eq(tenantGradingWeights.tenantId, tenantId))
      .limit(1);
    const row = rows[0];
    if (!row) return DEFAULT_GRADING_WEIGHTS;
    return {
      income: Number(row.incomeWeight),
      expense: Number(row.expenseWeight),
      maintenance: Number(row.maintenanceWeight),
      occupancy: Number(row.occupancyWeight),
      compliance: Number(row.complianceWeight),
      tenant: Number(row.tenantWeight),
    };
  }

  async setWeights(
    tenantId: string,
    weights: GradingWeights,
  ): Promise<GradingWeights> {
    const now = new Date();
    await this.db
      .insert(tenantGradingWeights)
      .values({
        tenantId,
        incomeWeight: weights.income,
        expenseWeight: weights.expense,
        maintenanceWeight: weights.maintenance,
        occupancyWeight: weights.occupancy,
        complianceWeight: weights.compliance,
        tenantWeight: weights.tenant,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: tenantGradingWeights.tenantId,
        set: {
          incomeWeight: weights.income,
          expenseWeight: weights.expense,
          maintenanceWeight: weights.maintenance,
          occupancyWeight: weights.occupancy,
          complianceWeight: weights.compliance,
          tenantWeight: weights.tenant,
          updatedAt: now,
        },
      });
    return weights;
  }
}
