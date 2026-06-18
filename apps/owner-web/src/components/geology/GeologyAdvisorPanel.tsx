'use client';

import { useState, type ReactElement } from 'react';
import { Microscope, AlertTriangle } from 'lucide-react';
import { Card } from '@borjie/design-system';
import { useSitesList } from '@/lib/queries/sites';
import {
  useGeologyAdvice,
  type GeologyRecommendation,
} from '@/lib/queries/geology-advisor';

/**
 * Geology-advisor recommendations panel (O-W-11 companion).
 *
 * Surfaces the REAL `@borjie/geology-advisor` output — orebody stats +
 * policy-driven recommendations computed server-side from the tenant's
 * live `samples` + vein-intersect layers (see
 * services/api-gateway/src/routes/mining/geology-advisor.hono.ts). The
 * owner picks a site; the panel renders contained-metal stats and each
 * recommendation with its evidence chain (CLAUDE.md evidence-required).
 *
 * This is a standalone panel mounted alongside the existing drill-holes
 * GeologyPanel — it does NOT touch the page nav. All states (loading /
 * empty / degraded / error) render real copy; nothing is fabricated.
 */

const SEVERITY_TONE: Record<GeologyRecommendation['severity'], string> = {
  info: 'border-info/40 text-info bg-info/10',
  low: 'border-info/40 text-info bg-info/10',
  medium: 'border-warning/40 text-warning bg-warning/10',
  high: 'border-destructive/40 text-destructive bg-destructive/10',
  critical: 'border-destructive/60 text-destructive bg-destructive/15',
};

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
}

export function GeologyAdvisorPanel(): ReactElement {
  const sitesQ = useSitesList();
  const sites = sitesQ.data ?? [];
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const activeSiteId = siteId ?? sites[0]?.id;
  const adviceQ = useGeologyAdvice({ siteId: activeSiteId });

  return (
    <Card className="rounded-2xl p-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-xl border border-info/40 bg-info/10 p-2 text-info">
            <Microscope className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Orebody Advisor
            </h2>
            <p className="text-xs text-neutral-400">
              Contained-metal estimate + infill / cutoff recommendations
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

      {sitesQ.isLoading && (
        <p className="text-xs text-neutral-400">Loading sites…</p>
      )}
      {!sitesQ.isLoading && sites.length === 0 && (
        <p className="text-xs text-neutral-400">
          No sites yet — add a site to compute orebody advice.
        </p>
      )}

      {activeSiteId && adviceQ.isLoading && (
        <p className="text-xs text-neutral-400">Computing orebody advice…</p>
      )}
      {activeSiteId && adviceQ.isError && (
        <p className="flex items-center gap-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Advisor unavailable. Try again shortly.
        </p>
      )}

      {adviceQ.data && (
        <div className="space-y-4">
          {adviceQ.data.analysis ? (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total tonnes" value={fmt(adviceQ.data.analysis.stats.totalTonnes, 0)} />
              <Stat label="Avg grade" value={fmt(adviceQ.data.analysis.stats.weightedAverageGrade)} />
              <Stat
                label="Contained metal (t)"
                value={fmt(adviceQ.data.analysis.stats.containedMetalTonnes, 4)}
              />
              <Stat label="Intervals" value={fmt(adviceQ.data.analysis.stats.intervalCount, 0)} />
            </dl>
          ) : (
            <p className="text-xs text-neutral-400">
              {adviceQ.data.note ?? 'No assay data for this site yet.'}
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

          {adviceQ.data.analysis &&
            adviceQ.data.recommendations.length === 0 && (
              <p className="text-xs text-success">
                No outstanding geology recommendations — model within policy.
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
