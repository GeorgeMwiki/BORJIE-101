'use client';

import { useState } from 'react';
import { useReportAudio, useGeneratedReports } from '@/lib/queries/reports';
import { useLocale, type Locale } from '@/lib/locale';
import { fmtDateForLocale } from '@/lib/format';
import { ReportPlayer } from './ReportPlayer';
import { REPORT_PLAYER_STRINGS } from './strings';

interface ReportPlayerPanelProps {
  readonly initialLocale?: Locale;
}

/**
 * Client wrapper that owns the "active report id" state and renders
 * the ReportPlayer above the reports list (O-W-18). Keeps the page-
 * level server component thin and side-effect free.
 *
 * Selection model: the tenant's recently-generated report versions
 * (GET /api/v1/mining/reports) render as a chip strip; clicking one
 * swaps the active id and react-query refetches
 * `/api/v1/mining/reports/:id/audio`. No id is auto-selected — until the
 * owner picks a chip the player shows a localized prompt, and when the
 * tenant has no reports yet it shows an honest localized empty state
 * (never a fake/hardcoded fixture id that 404s against the gateway).
 *
 * Locale follows the user: seeded from the server-resolved value via
 * `initialLocale` so SSR and the first client paint agree (zero-mix
 * canon — no EN-under-SW first-paint split).
 */
export function ReportPlayerPanel({ initialLocale }: ReportPlayerPanelProps) {
  const locale = useLocale(initialLocale);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);

  const recent = useGeneratedReports({ limit: 8 });
  const rows = recent.data ?? [];

  const { data, isLoading, error } = useReportAudio(activeReportId);
  const t = REPORT_PLAYER_STRINGS[locale];

  return (
    <section
      aria-label={t.recentHeading}
      className="rounded-lg border border-border bg-background p-4"
    >
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t.recentHeading}
      </p>
      {recent.isPending ? (
        <p className="text-sm text-muted-foreground">{t.recentLoading}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noRecent}</p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-2">
          {rows.map((report) => {
            const active = report.reportInstanceId === activeReportId;
            const label = `${report.renderKind} · ${fmtDateForLocale(
              report.generatedAt,
              locale,
            )}`;
            return (
              <button
                key={report.id}
                type="button"
                onClick={() => setActiveReportId(report.reportInstanceId)}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? 'border-warning bg-warning-subtle/30 text-warning'
                    : 'border-border bg-surface text-muted-foreground hover:bg-warning-subtle/10'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {activeReportId === null ? (
        rows.length > 0 ? (
          <p className="text-sm text-muted-foreground">{t.noSelection}</p>
        ) : null
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t.loading}</p>
      ) : error || !data ? (
        <p className="text-sm text-muted-foreground">{t.noAudio}</p>
      ) : (
        <ReportPlayer report={data} lang={locale} />
      )}
    </section>
  );
}
