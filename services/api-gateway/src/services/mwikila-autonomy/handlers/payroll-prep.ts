/**
 * Mr. Mwikila handler — payroll prep.
 *
 * Computes monthly payroll from `mining_clock_events` (hours worked)
 * plus base pay + overtime → drafts payslips. Default tier T1 — owner
 * approves the batch.
 *
 * Pure-logic shape; ports for clock events + workforce wages are
 * injected.
 */

import type { MwikilaHandler, MwikilaHandlerProposal } from '../handler-runtime.js';

export interface PayrollWorkerRow {
  readonly userId: string;
  readonly fullName: string;
  readonly baseMonthlyTzs: number;
  readonly hourlyOvertimeTzs: number;
  readonly standardMonthlyHours: number;
  readonly hoursWorked: number;
}

export interface PayrollPorts {
  monthlyPayrollRoll(args: {
    readonly tenantId: string;
    readonly periodStartIso: string;
    readonly periodEndIso: string;
  }): Promise<ReadonlyArray<PayrollWorkerRow>>;
  hasExistingBatch(args: {
    readonly tenantId: string;
    readonly periodStartIso: string;
  }): Promise<boolean>;
}

export interface PayrollComputed {
  readonly userId: string;
  readonly fullName: string;
  readonly baseTzs: number;
  readonly overtimeTzs: number;
  readonly overtimeHours: number;
  readonly grossTzs: number;
}

export function computePayrollRow(row: PayrollWorkerRow): PayrollComputed {
  const overtimeHours = Math.max(
    0,
    row.hoursWorked - row.standardMonthlyHours,
  );
  const overtimeTzs = Math.round(
    overtimeHours * row.hourlyOvertimeTzs,
  );
  const gross = row.baseMonthlyTzs + overtimeTzs;
  return Object.freeze({
    userId: row.userId,
    fullName: row.fullName,
    baseTzs: row.baseMonthlyTzs,
    overtimeTzs,
    overtimeHours,
    grossTzs: gross,
  });
}

export function buildPayrollProposal(
  computed: ReadonlyArray<PayrollComputed>,
  periodStartIso: string,
  periodEndIso: string,
): MwikilaHandlerProposal {
  const totalGross = computed.reduce((s, c) => s + c.grossTzs, 0);
  return {
    actionKind: 'payroll.monthly_batch_prep',
    category: 'payroll-prep',
    summary: `Drafted payroll batch (${computed.length} workers, TZS ${totalGross.toLocaleString()}).`,
    summarySw: `Rasimu ya malipo ya mishahara (wafanyakazi ${computed.length}, TZS ${totalGross.toLocaleString()}).`,
    rationale:
      `Summed base pay + overtime from clock-in events for the period ` +
      `${periodStartIso.slice(0, 10)} → ${periodEndIso.slice(0, 10)}. ` +
      `Owner approves before posting via the ledger.`,
    payload: {
      periodStartIso,
      periodEndIso,
      workers: computed,
      totalGrossTzs: totalGross,
    },
    // The proposal itself does not move money — that happens after
    // owner approval, through the ledger. The envelope check still
    // applies because the total IS the cap-test value.
    amountTzs: totalGross,
    currency: 'TZS',
  };
}

export function createPayrollHandler(
  ports: PayrollPorts,
): MwikilaHandler {
  return Object.freeze({
    actionKind: 'payroll.monthly_batch_prep',
    category: 'payroll-prep',
    async propose({ tenantId, now }) {
      // Previous month period (end of last month → start of last month).
      const periodEnd = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59),
      );
      const periodStart = new Date(
        Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1),
      );
      const periodStartIso = periodStart.toISOString();
      const periodEndIso = periodEnd.toISOString();

      const exists = await ports.hasExistingBatch({
        tenantId,
        periodStartIso,
      });
      if (exists) return null;

      const rows = await ports.monthlyPayrollRoll({
        tenantId,
        periodStartIso,
        periodEndIso,
      });
      if (rows.length === 0) return null;
      const computed = rows.map(computePayrollRow);
      return buildPayrollProposal(computed, periodStartIso, periodEndIso);
    },
  });
}
