"use client";

/**
 * KpisTabContent — lazy-loaded KPIs projection (iter-30).
 *
 * Projects employee_kpis filtered to status='active' for the
 * caller's tenant. Realtime patches in as the MD assigns / updates
 * KPIs from chat. NO MOCK DATA — honest empty state.
 *
 * @module features/central-command/md/kpis/ui/KpisTabContent
 */

import { useTenantIdentity } from "@/features/central-command/md/shared/useTenantIdentity";
import { useTenantRealtime } from "@/features/central-command/md/shared/useTenantRealtime";

interface KpiRow {
  readonly id: string;
  readonly employee_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly metric_unit: string;
  readonly target_value: number;
  readonly current_value: number;
  readonly period: string;
  readonly period_end: string | null;
  readonly status: "active" | "paused" | "achieved" | "missed" | "cancelled";
  readonly updated_at: string;
}

function formatValue(value: number, unit: string): string {
  if (unit === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "TZS",
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (unit === "percent") return `${(value * 100).toFixed(1)}%`;
  if (unit === "ratio") return value.toFixed(2);
  return new Intl.NumberFormat("en-US").format(value);
}

function progressPct(row: KpiRow): number {
  if (row.target_value <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, (row.current_value / row.target_value) * 100),
  );
}

export default function KpisTabContent(): React.JSX.Element {
  const { identity, error: identityError } = useTenantIdentity();
  const { rows, hasData, isLoading, loadError } = useTenantRealtime<KpiRow>({
    tenantId: identity?.tenantId ?? null,
    table: "employee_kpis",
    columns:
      "id, employee_id, name, description, metric_unit, target_value, current_value, period, period_end, status, updated_at",
    initialStatusIn: ["active"],
    orderColumn: "updated_at",
    orderAscending: false,
    shouldDropOnInsert: (r) => r.status !== "active",
    shouldDropOnUpdate: (r) => r.status !== "active",
  });

  if (identityError) {
    return (
      <div
        role="alert"
        className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
      >
        {identityError}
      </div>
    );
  }
  if (!identity || isLoading) {
    return (
      <div
        role="status"
        className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
      >
        Loading KPIs…
      </div>
    );
  }
  if (loadError) {
    return (
      <div
        role="alert"
        className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        {loadError}
      </div>
    );
  }
  if (!hasData) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
        <h2 className="text-base font-medium text-slate-800">No active KPIs</h2>
        <p className="mt-2 text-sm text-slate-600">
          Open the MD chat and say something like{" "}
          <em>&ldquo;Asha&rsquo;s Q3 KPI is to close 20 deals&rdquo;</em>. The
          KPIs tab will update automatically.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="KPIs" data-testid="md-kpis-tab" className="space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-medium text-slate-800">
          Active KPIs ({rows.length})
        </h2>
        <p className="text-xs text-slate-500">Live · auto-updates from chat</p>
      </header>
      <ul className="space-y-2">
        {rows.map((row) => {
          const pct = progressPct(row);
          return (
            <li
              key={row.id}
              data-testid={`md-kpi-row-${row.id}`}
              className="rounded-lg border border-slate-200 bg-white px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">{row.name}</p>
                <p className="text-xs text-slate-500">
                  {formatValue(row.current_value, row.metric_unit)} /{" "}
                  {formatValue(row.target_value, row.metric_unit)}
                </p>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${pct}%` }}
                  aria-valuenow={Math.round(pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  role="progressbar"
                />
              </div>
              {row.description ? (
                <p className="mt-2 text-xs text-slate-600">{row.description}</p>
              ) : null}
              <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-400">
                {row.period} · {Math.round(pct)}% complete
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
