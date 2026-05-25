/**
 * Intelligence History Worker
 *
 * Daily CRON that writes per-customer intelligence snapshots into
 * `intelligence_history`. Idempotent on (tenant_id, customer_id,
 * snapshot_date). Snapshots are computed from deterministic calculators
 * only — no LLM calls — so the worker is cheap and reproducible.
 */

import type { TenantId, ISOTimestamp } from '@borjie/domain-models';
import { randomHex } from '../common/id-generator.js';

export interface IntelligenceSnapshot {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly customerId: string;
  readonly snapshotDate: string; // YYYY-MM-DD
  readonly paymentRiskScore: number | null;
  readonly paymentRiskLevel: string | null;
  readonly churnRiskScore: number | null;
  readonly churnRiskLevel: string | null;
  readonly sentimentScore: number | null;
  readonly openMaintenanceCount: number;
  readonly complaintsLast30Days: number;
  readonly paymentsLast30DaysOnTime: number;
  readonly paymentsLast30DaysLate: number;
  readonly paymentSubScores: Record<string, number> | null;
  readonly churnSubScores: Record<string, number> | null;
  readonly createdAt: ISOTimestamp;
}

export interface IntelligenceHistoryRepository {
  upsertSnapshot(snapshot: IntelligenceSnapshot): Promise<void>;
}

export interface CustomerCohortProvider {
  /** Stream all active customers per tenant (keep memory bounded). */
  listActiveCustomers(tenantId: TenantId): Promise<
    Array<{
      readonly customerId: string;
      readonly tenantId: TenantId;
    }>
  >;
  listTenants(): Promise<TenantId[]>;
}

export interface CustomerSignalsProvider {
  getSignals(
    tenantId: TenantId,
    customerId: string,
    asOf: Date,
  ): Promise<{
    readonly paymentRiskScore: number | null;
    readonly paymentRiskLevel: string | null;
    readonly churnRiskScore: number | null;
    readonly churnRiskLevel: string | null;
    readonly sentimentScore: number | null;
    readonly openMaintenanceCount: number;
    readonly complaintsLast30Days: number;
    readonly paymentsLast30DaysOnTime: number;
    readonly paymentsLast30DaysLate: number;
    readonly paymentSubScores: Record<string, number> | null;
    readonly churnSubScores: Record<string, number> | null;
  }>;
}

export interface IntelligenceHistoryWorkerDeps {
  readonly repo: IntelligenceHistoryRepository;
  readonly cohorts: CustomerCohortProvider;
  readonly signals: CustomerSignalsProvider;
  readonly clock?: { now(): Date };
}

function formatYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface IntelligenceWorkerRunResult {
  readonly tenantsProcessed: number;
  readonly customersProcessed: number;
  readonly snapshotsWritten: number;
  readonly errors: number;
}

export class IntelligenceHistoryWorker {
  private readonly clock: { now(): Date };

  constructor(private readonly deps: IntelligenceHistoryWorkerDeps) {
    this.clock = deps.clock ?? { now: () => new Date() };
  }

  async runDaily(): Promise<IntelligenceWorkerRunResult> {
    const now = this.clock.now();
    const snapshotDate = formatYmd(now);
    const tenants = await this.deps.cohorts.listTenants();

    let customersProcessed = 0;
    let snapshotsWritten = 0;
    let errors = 0;

    for (const tenantId of tenants) {
      const customers = await this.deps.cohorts.listActiveCustomers(tenantId);
      for (const c of customers) {
        customersProcessed += 1;
        try {
          const s = await this.deps.signals.getSignals(
            c.tenantId,
            c.customerId,
            now,
          );
          const snapshot: IntelligenceSnapshot = {
            id: `intelhist_${Date.now()}_${randomHex(4)}`,
            tenantId: c.tenantId,
            customerId: c.customerId,
            snapshotDate,
            ...s,
            createdAt: now.toISOString() as ISOTimestamp,
          };
          await this.deps.repo.upsertSnapshot(snapshot);
          snapshotsWritten += 1;
        } catch (error) {
          errors += 1;
          console.error(
            `intelligence-history-worker: failed customer=${c.customerId} tenant=${c.tenantId}`,
            error,
          );
        }
      }
    }

    return {
      tenantsProcessed: tenants.length,
      customersProcessed,
      snapshotsWritten,
      errors,
    };
  }
}

export function createIntelligenceHistoryWorker(
  deps: IntelligenceHistoryWorkerDeps,
): IntelligenceHistoryWorker {
  return new IntelligenceHistoryWorker(deps);
}
