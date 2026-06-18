'use client';

import { useState, type ReactElement } from 'react';
import { CalendarClock, AlertTriangle } from 'lucide-react';
import { Card } from '@borjie/design-system';
import { formatCurrency } from '@borjie/genui';
import { useSitesList } from '@/lib/queries/sites';
import {
  useMinePlannerAdvice,
  type PlanRecommendation,
} from '@/lib/queries/mine-planner-advisor';

/**
 * Mine-planner-advisor recommendations panel (O-W-09 companion).
 *
 * Surfaces the REAL `@borjie/mine-planner-advisor` output — a 24h shift
 * plan (per-shift tonnage / hours / opex) + skill-gap recommendations
 * computed server-side from the tenant's live `ore_parcels` + `assets`
 * (see services/api-gateway/src/routes/mining/mine-planner.hono.ts). The
 * owner picks a site; the panel renders plan totals and each
 * recommendation with its evidence chain (CLAUDE.md evidence-required).
 *
 * Mounted alongside the existing FleetMaintenanceSurface — it does NOT
 * touch the page nav. Opex is rendered through `formatCurrency` with the
 * tenant's display currency (passed in by the page); never hard-coded.
 * All states (loading / empty / degraded / error) render real copy.
 */

const SEVERITY_TONE: Record<PlanRecommendation['severity'], string> = {
  info: 'border-info/40 text-info bg-info/10',
  low: 'border-info/40 text-info bg-info/10',
  medium: 'border-warning/40 text-warning bg-warning/10',
  high: 'border-destructive/40 text-destructive bg-destructive/10',
  critical: 'border-destructive/60 text-destructive bg-destructive/15',
};

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: digits })
    : '—';
}

interface MinePlannerAdvisorPanelProps {
  /**
   * Tenant display currency (ISO-4217), supplied by the page so KE/UG/NG
   * tenants render their own currency — never hard-coded here. When the
   * page has no currency source the panel renders opex as a bare
   * localized number (no invented currency symbol) rather than assuming
   * one, honoring CLAUDE.md's "never hard-code currency in code paths".
   */
  readonly currencyCode?: string;
}

function formatOpex(value: number, currencyCode?: string): string {
  const rounded = Math.round(value);
  return currencyCode
    ? formatCurrency(rounded, currencyCode)
    : rounded.toLocaleString();
}

export function MinePlannerAdvisorPanel({
  currencyCode,
}: MinePlannerAdvisorPanelProps): ReactElement {
  const sitesQ = useSitesList();
  const sites = sitesQ.data ?? [];
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const activeSiteId = siteId ?? sites[0]?.id;
  const adviceQ = useMinePlannerAdvice({ siteId: activeSiteId });

  return (
    <Card className="rounded-2xl p-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-xl border border-info/40 bg-info/10 p-2 text-info">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Shift-Plan Advisor
            </h2>
            <p className="text-xs text-neutral-400">
              24h polygon → equipment → crew plan + skill-gap advice
            </p>
          </div>
        </div>
        {sites.length > 0 && (
          <select
            value={activeSiteId ?? ''}
            onChange={(e) => setSiteId(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
            aria-label="Select site"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </header>

      {sitesQ.isLoading && <p className="text-xs text-neutral-400">Loading sites…</p>}
      {!sitesQ.isLoading && sites.length === 0 && (
        <p className="text-xs text-neutral-400">
          No sites yet — add a site to compute a shift plan.
        </p>
      )}

      {activeSiteId && adviceQ.isLoading && (
        <p className="text-xs text-neutral-400">Computing shift plan…</p>
      )}
      {activeSiteId && adviceQ.isError && (
        <p className="flex items-center gap-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Advisor unavailable. Try again shortly.
        </p>
      )}

      {adviceQ.data && (
        <div className="space-y-4">
          {adviceQ.data.plan ? (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Planned tonnes"
                value={fmt(adviceQ.data.plan.totalEstimatedTonnes, 0)}
              />
              <Stat
                label="Unmet tonnes"
                value={fmt(adviceQ.data.plan.unmetTonnes, 0)}
              />
              <Stat
                label="Assignments"
                value={fmt(adviceQ.data.plan.assignments.length, 0)}
              />
              <Stat
                label="Plan opex"
                value={formatOpex(adviceQ.data.plan.totalEstimatedOpex, currencyCode)}
              />
            </dl>
          ) : (
            <p className="text-xs text-neutral-400">
              {adviceQ.data.note ?? 'No parcels or fleet to plan for this site.'}
            </p>
          )}

          {adviceQ.data.recommendations.length > 0 && (
            <ul className="space-y-2">
              {adviceQ.data.recommendations.map((r) => (
                <li
                  key={r.id}
                  className={`rounded-xl border p-3 text-xs ${SEVERITY_TONE[r.severity]}`}
                >
                  <p className="font-semibold">{r.title}</p>
                  <p className="mt-1 text-neutral-300">{r.rationale}</p>
                  <p className="mt-2 text-[10px] uppercase tracking-wide text-neutral-500">
                    Evidence: {r.evidence.map((e) => e.id).join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {adviceQ.data.plan && adviceQ.data.recommendations.length === 0 && (
            <p className="text-xs text-success">
              Plan meets target with no skill gaps.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <dt className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}
