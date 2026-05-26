'use client';

import { useState } from 'react';
import { useReportAudio } from '@/lib/queries/reports';
import { ReportPlayer } from './ReportPlayer';
import { REPORT_PLAYER_STRINGS, type Lang } from './strings';

interface ReportPlayerPanelProps {
  readonly initialReportId?: string;
  readonly lang?: Lang;
}

/**
 * Client wrapper that owns the "active report id" state and renders
 * the ReportPlayer above the reports list (O-W-18). Keeps the page-
 * level server component thin and side-effect free.
 *
 * Selection model: a short list of recently-generated reports is
 * shown alongside the player; clicking one swaps the active id and
 * react-query refetches `/api/v1/mining/reports/:id/audio`.
 */
export function ReportPlayerPanel({
  initialReportId = 'daily-2025-01-15',
  lang = 'sw',
}: ReportPlayerPanelProps) {
  const [activeReportId, setActiveReportId] = useState<string | null>(initialReportId);
  const { data, isLoading, error } = useReportAudio(activeReportId);
  const t = REPORT_PLAYER_STRINGS[lang];

  return (
    <section
      aria-label={t.chapters}
      className="rounded-lg border border-border bg-background p-4"
    >
      <div className="mb-3 flex flex-wrap gap-2">
        {RECENT_REPORTS.map((report) => {
          const active = report.id === activeReportId;
          return (
            <button
              key={report.id}
              type="button"
              onClick={() => setActiveReportId(report.id)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? 'border-warning bg-warning-subtle/30 text-warning'
                  : 'border-border bg-surface text-neutral-300 hover:bg-warning-subtle/10'
              }`}
            >
              {report.title}
            </button>
          );
        })}
      </div>
      {isLoading ? (
        <p className="text-sm text-neutral-500">{t.loading}</p>
      ) : error || !data ? (
        <p className="text-sm text-neutral-500">{t.noAudio}</p>
      ) : (
        <ReportPlayer report={data} lang={lang} />
      )}
    </section>
  );
}

/**
 * Lightweight recent-reports list. Replaced by a real `useRecentReports`
 * query in a follow-up — the audio endpoint is the load-bearing part of
 * this surface; the list is just a chip strip to drive selection.
 */
const RECENT_REPORTS: ReadonlyArray<{ readonly id: string; readonly title: string }> = [
  { id: 'daily-2025-01-15', title: 'Daily — Jan 15' },
  { id: 'weekly-2025-w02', title: 'Weekly — W02' },
  { id: 'monthly-2024-12', title: 'Monthly — Dec' },
  { id: 'investor-2024-q4', title: 'Investor — Q4' },
];
