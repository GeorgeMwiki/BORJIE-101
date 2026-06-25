'use client';

import { RefreshCw } from 'lucide-react';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { fmtNum, fmtPct } from '@/lib/format';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import {
  procurementSurfaceStrings as S,
  budgetAlertLevelLabels,
  kycStatusLabels,
  preferredStatusLabels,
  vendorStatusUnknown,
  budgetScopeLabels,
  budgetPeriodLabels,
  budgetScopePeriodUnknown,
} from '@/i18n/strings/procurement-surface';
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
 * neutral code suffix and never a hard-coded symbol, and never sum across
 * distinct currency codes. Real loading / empty / error states throughout.
 * Every label is single-locale (zero-mix canon) via `pickByLocale`; the
 * locale is SEEDED from the server so the first paint matches the SSR chrome.
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

/**
 * Resolve a vendor KYC status (free-form string off the wire, in practice the
 * closed KYC_STATUSES enum) to a localized label — never the raw token.
 */
function kycStatusLabel(status: string, locale: Locale): string {
  const entry =
    status in kycStatusLabels
      ? kycStatusLabels[status as keyof typeof kycStatusLabels]
      : vendorStatusUnknown;
  return pickByLocale(locale, entry);
}

/**
 * Resolve a vendor preferred status (closed PREFERRED_STATUSES enum) to a
 * localized label — never the raw token.
 */
function preferredStatusLabel(status: string, locale: Locale): string {
  const entry =
    status in preferredStatusLabels
      ? preferredStatusLabels[status as keyof typeof preferredStatusLabels]
      : vendorStatusUnknown;
  return pickByLocale(locale, entry);
}

/**
 * Resolve a budget scope (closed BUDGET_SCOPES enum) to a localized label —
 * never the raw token. The `property` scope renders as a mining "Site" (see
 * the label table); the DB enum value is unchanged.
 */
function budgetScopeLabel(scope: string, locale: Locale): string {
  const entry =
    scope in budgetScopeLabels
      ? budgetScopeLabels[scope as keyof typeof budgetScopeLabels]
      : budgetScopePeriodUnknown;
  return pickByLocale(locale, entry);
}

/**
 * Resolve a budget period (closed BUDGET_PERIODS enum) to a localized
 * label — never the raw token.
 */
function budgetPeriodLabel(period: string, locale: Locale): string {
  const entry =
    period in budgetPeriodLabels
      ? budgetPeriodLabels[period as keyof typeof budgetPeriodLabels]
      : budgetScopePeriodUnknown;
  return pickByLocale(locale, entry);
}

function SpendByVendorTable({
  rows,
  locale,
}: {
  readonly rows: ReadonlyArray<SpendByVendor>;
  readonly locale: Locale;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-neutral-400">
            <th className="px-3 py-2 font-medium">{pickByLocale(locale, S.colVendor)}</th>
            <th className="px-3 py-2 text-right font-medium">
              {pickByLocale(locale, S.colPos)}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {pickByLocale(locale, S.colAvgPo)}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {pickByLocale(locale, S.colTotalSpend)}
            </th>
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

function BudgetsTable({
  rows,
  locale,
}: {
  readonly rows: ReadonlyArray<BudgetAvailability>;
  readonly locale: Locale;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-neutral-400">
            <th className="px-3 py-2 font-medium">{pickByLocale(locale, S.colScope)}</th>
            <th className="px-3 py-2 font-medium">{pickByLocale(locale, S.colPeriod)}</th>
            <th className="px-3 py-2 text-right font-medium">
              {pickByLocale(locale, S.colBudget)}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {pickByLocale(locale, S.colAvailable)}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {pickByLocale(locale, S.colUtilisation)}
            </th>
            <th className="px-3 py-2 font-medium">{pickByLocale(locale, S.colStatus)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.budget.id} className="border-b border-border/60">
              <td className="px-3 py-2 text-foreground">
                {budgetScopeLabel(r.budget.scope, locale)} · {r.budget.scopeKey}
              </td>
              <td className="px-3 py-2 text-neutral-500">
                {budgetPeriodLabel(r.budget.period, locale)}
              </td>
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
                  {pickByLocale(locale, budgetAlertLevelLabels[r.alertLevel])}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VendorsTable({
  rows,
  locale,
}: {
  readonly rows: ReadonlyArray<ProcurementVendor>;
  readonly locale: Locale;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-neutral-400">
            <th className="px-3 py-2 font-medium">{pickByLocale(locale, S.colVendor)}</th>
            <th className="px-3 py-2 font-medium">{pickByLocale(locale, S.colCountry)}</th>
            <th className="px-3 py-2 font-medium">{pickByLocale(locale, S.colKyc)}</th>
            <th className="px-3 py-2 font-medium">{pickByLocale(locale, S.colStatus)}</th>
            <th className="px-3 py-2 text-right font-medium">
              {pickByLocale(locale, S.colRating)}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/60">
              <td className="px-3 py-2 font-medium text-foreground">{r.companyName}</td>
              <td className="px-3 py-2 text-neutral-500">{r.country}</td>
              <td className="px-3 py-2 text-neutral-500">{kycStatusLabel(r.kycStatus, locale)}</td>
              <td className="px-3 py-2 text-neutral-500">
                {preferredStatusLabel(r.preferredStatus, locale)}
              </td>
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

export function ProcurementCoordinationSurface({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
}) {
  const locale = useLocale(initialLocale);
  const spend = useProcurementSpendByVendor();
  const budgets = useProcurementBudgets();
  const vendors = useProcurementVendors();

  return (
    <div className="space-y-6">
      <SectionCard
        title={pickByLocale(locale, S.spendTitle)}
        subtitle={pickByLocale(locale, S.spendSubtitle)}
        actions={
          <button
            type="button"
            aria-label={pickByLocale(locale, S.refresh)}
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
            title={pickByLocale(locale, S.spendLoadFailedTitle)}
            description={
              (spend.error as Error)?.message ?? pickByLocale(locale, S.unknownError)
            }
            hint="GET /api/v1/mining/procurement-coordination/analytics/spend-by-vendor"
          />
        ) : (spend.data?.vendors ?? []).length === 0 ? (
          <EmptyState
            title={pickByLocale(locale, S.spendEmptyTitle)}
            description={pickByLocale(locale, S.spendEmptyBody)}
          />
        ) : (
          <SpendByVendorTable rows={spend.data?.vendors ?? []} locale={locale} />
        )}
      </SectionCard>

      <SectionCard
        title={pickByLocale(locale, S.budgetsTitle)}
        subtitle={pickByLocale(locale, S.budgetsSubtitle)}
        actions={
          <button
            type="button"
            aria-label={pickByLocale(locale, S.refresh)}
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
            title={pickByLocale(locale, S.budgetsLoadFailedTitle)}
            description={
              (budgets.error as Error)?.message ?? pickByLocale(locale, S.unknownError)
            }
            hint="GET /api/v1/mining/procurement-coordination/budgets"
          />
        ) : (budgets.data?.budgets ?? []).length === 0 ? (
          <EmptyState
            title={pickByLocale(locale, S.budgetsEmptyTitle)}
            description={pickByLocale(locale, S.budgetsEmptyBody)}
          />
        ) : (
          <BudgetsTable rows={budgets.data?.budgets ?? []} locale={locale} />
        )}
      </SectionCard>

      <SectionCard
        title={pickByLocale(locale, S.vendorsTitle)}
        subtitle={pickByLocale(locale, S.vendorsSubtitle)}
        actions={
          <button
            type="button"
            aria-label={pickByLocale(locale, S.refresh)}
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
            title={pickByLocale(locale, S.vendorsLoadFailedTitle)}
            description={
              (vendors.error as Error)?.message ?? pickByLocale(locale, S.unknownError)
            }
            hint="GET /api/v1/mining/procurement-coordination/vendors"
          />
        ) : (vendors.data?.vendors ?? []).length === 0 ? (
          <EmptyState
            title={pickByLocale(locale, S.vendorsEmptyTitle)}
            description={pickByLocale(locale, S.vendorsEmptyBody)}
          />
        ) : (
          <VendorsTable rows={vendors.data?.vendors ?? []} locale={locale} />
        )}
      </SectionCard>
    </div>
  );
}
