'use client';

import { RefreshCw } from 'lucide-react';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { fmtNum, fmtPct } from '@/lib/format';
import {
  useProcurementVendors,
  useProcurementBudgets,
  useProcurementSpendByVendor,
  type SpendByVendor,
  type BudgetAvailability,
  type ProcurementVendor,
} from '@/lib/queries/procurement-coordination';

/**
 * Procurement-coordination surface — REAL vendor registry + budget
 * availability + spend analytics served by
 * `@borjie/procurement-coordination` (createProcurementCoordination) over the
 * live `procurement_*` tables.
 *
 * Three sections, each a live BFF read:
 *   - Spend by vendor (GET .../analytics/spend-by-vendor)
 *   - Budget availability (GET .../budgets)
 *   - Vendor registry (GET .../vendors)
 *
 * Each amount carries its own ISO-4217 currency; we render the amount with a
 * neutral "(ccy)" label and never a hard-coded symbol. Real loading / empty /
 * error states throughout.
 */

const ALERT_STYLES: Readonly<Record<BudgetAvailability['alertLevel'], string>> = {
  green: 'bg-emerald-500/10 text-emerald-600',
  amber: 'bg-amber-500/10 text-amber-600',
  red: 'bg-red-500/10 text-red-600',
  over: 'bg-red-600/15 text-red-700',
};

function fmtAmount(amount: number, currency: string): string {
  return `${fmtNum(amount)} ${currency}`;
}

function SpendByVendorTable({ rows }: { readonly rows: ReadonlyArray<SpendByVendor> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-neutral-400">
            <th className="px-3 py-2 font-medium">Vendor</th>
            <th className="px-3 py-2 text-right font-medium">POs</th>
            <th className="px-3 py-2 text-right font-medium">Avg PO</th>
            <th className="px-3 py-2 text-right font-medium">Total spend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.vendorId} className="border-b border-border/60">
              <td className="px-3 py-2 font-medium text-foreground">{r.vendorName}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.poCount)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtAmount(r.avgPoValue, r.currency)}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {fmtAmount(r.amount, r.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BudgetsTable({ rows }: { readonly rows: ReadonlyArray<BudgetAvailability> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-neutral-400">
            <th className="px-3 py-2 font-medium">Scope</th>
            <th className="px-3 py-2 font-medium">Period</th>
            <th className="px-3 py-2 text-right font-medium">Budget</th>
            <th className="px-3 py-2 text-right font-medium">Available</th>
            <th className="px-3 py-2 text-right font-medium">Utilisation</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.budget.id} className="border-b border-border/60">
              <td className="px-3 py-2 text-foreground">
                {r.budget.scope} · {r.budget.scopeKey}
              </td>
              <td className="px-3 py-2 text-neutral-500">{r.budget.period}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtAmount(r.budget.amount, r.budget.currency)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtAmount(r.available, r.budget.currency)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtPct(r.utilisationPct / 100)}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${ALERT_STYLES[r.alertLevel]}`}
                >
                  {r.alertLevel}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VendorsTable({ rows }: { readonly rows: ReadonlyArray<ProcurementVendor> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-neutral-400">
            <th className="px-3 py-2 font-medium">Vendor</th>
            <th className="px-3 py-2 font-medium">Country</th>
            <th className="px-3 py-2 font-medium">KYC</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Rating</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/60">
              <td className="px-3 py-2 font-medium text-foreground">{r.companyName}</td>
              <td className="px-3 py-2 text-neutral-500">{r.country}</td>
              <td className="px-3 py-2 text-neutral-500">{r.kycStatus}</td>
              <td className="px-3 py-2 text-neutral-500">{r.preferredStatus}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {r.rating !== null ? r.rating.toFixed(1) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProcurementCoordinationSurface() {
  const spend = useProcurementSpendByVendor();
  const budgets = useProcurementBudgets();
  const vendors = useProcurementVendors();

  return (
    <div className="space-y-6">
      <SectionCard
        title="Spend by vendor"
        subtitle="Issued + closed purchase orders aggregated per vendor."
        actions={
          <button
            type="button"
            aria-label="Refresh"
            onClick={() => void spend.refetch()}
            className="text-neutral-500 hover:text-foreground"
          >
            <RefreshCw className={`h-4 w-4 ${spend.isFetching ? 'animate-spin' : ''}`} />
          </button>
        }
      >
        {spend.isLoading ? (
          <div className="h-chart-sm animate-pulse rounded-lg border border-border bg-surface/40" />
        ) : spend.isError ? (
          <EmptyState
            title="Could not load spend analytics"
            description={(spend.error as Error)?.message ?? 'unknown error'}
            hint="GET /api/v1/mining/procurement-coordination/analytics/spend-by-vendor"
          />
        ) : (spend.data?.vendors ?? []).length === 0 ? (
          <EmptyState
            title="No spend yet"
            description="Issue purchase orders to vendors to see real spend aggregated here by vendor and category."
          />
        ) : (
          <SpendByVendorTable rows={spend.data?.vendors ?? []} />
        )}
      </SectionCard>

      <SectionCard
        title="Budget availability"
        subtitle="Amount less spent, committed and reserved — with alert level."
        actions={
          <button
            type="button"
            aria-label="Refresh"
            onClick={() => void budgets.refetch()}
            className="text-neutral-500 hover:text-foreground"
          >
            <RefreshCw className={`h-4 w-4 ${budgets.isFetching ? 'animate-spin' : ''}`} />
          </button>
        }
      >
        {budgets.isLoading ? (
          <div className="h-chart-sm animate-pulse rounded-lg border border-border bg-surface/40" />
        ) : budgets.isError ? (
          <EmptyState
            title="Could not load budgets"
            description={(budgets.error as Error)?.message ?? 'unknown error'}
            hint="GET /api/v1/mining/procurement-coordination/budgets"
          />
        ) : (budgets.data?.budgets ?? []).length === 0 ? (
          <EmptyState
            title="No budgets set"
            description="Create procurement budgets to track availability, commitments and overspend alerts."
          />
        ) : (
          <BudgetsTable rows={budgets.data?.budgets ?? []} />
        )}
      </SectionCard>

      <SectionCard
        title="Vendor registry"
        subtitle="Approved + pending vendors with KYC status and rating."
        actions={
          <button
            type="button"
            aria-label="Refresh"
            onClick={() => void vendors.refetch()}
            className="text-neutral-500 hover:text-foreground"
          >
            <RefreshCw className={`h-4 w-4 ${vendors.isFetching ? 'animate-spin' : ''}`} />
          </button>
        }
      >
        {vendors.isLoading ? (
          <div className="h-chart-sm animate-pulse rounded-lg border border-border bg-surface/40" />
        ) : vendors.isError ? (
          <EmptyState
            title="Could not load vendors"
            description={(vendors.error as Error)?.message ?? 'unknown error'}
            hint="GET /api/v1/mining/procurement-coordination/vendors"
          />
        ) : (vendors.data?.vendors ?? []).length === 0 ? (
          <EmptyState
            title="No vendors registered"
            description="Register suppliers to build the vendor registry that powers RFQs, purchase orders and spend analytics."
          />
        ) : (
          <VendorsTable rows={vendors.data?.vendors ?? []} />
        )}
      </SectionCard>
    </div>
  );
}
