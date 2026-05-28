'use client';

/**
 * OwnerOSInsightsPanel — surface the live advisor slice from
 * `/api/v1/owner/brief` (Wave OWNER-OS). When the brain ladder is
 * unwired we fall back to a friendly empty state so the panel stays
 * useful.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { Sparkles, Clock } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';

interface BriefShape {
  readonly advisor: {
    readonly insight: string;
    readonly action: string;
    readonly generatedAtIso: string;
    readonly provider: string;
    readonly latencyMs: number;
  } | null;
}

export interface OwnerOSInsightsPanelProps {
  readonly languagePreference: 'sw' | 'en';
}

export function OwnerOSInsightsPanel({
  languagePreference,
}: OwnerOSInsightsPanelProps): ReactElement {
  const [brief, setBrief] = useState<BriefShape | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest<{ brief: BriefShape }>(`/api/v1/owner/brief`);
        setBrief(res.brief ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Insights unavailable');
      }
    })();
  }, []);

  return (
    <div className="flex flex-col gap-3" data-testid="owner-os-insights-panel">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-warning">
          {languagePreference === 'sw' ? 'Ushauri wa leo' : "Today's advisor note"}
        </h2>
      </header>
      {error ? (
        <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-tiny text-destructive">
          {error}
        </p>
      ) : null}
      {brief?.advisor ? (
        <article className="rounded border border-warning/40 bg-warning/5 p-3">
          <p className="flex items-center gap-1 text-tiny uppercase tracking-wide text-warning">
            <Sparkles aria-hidden="true" className="h-3 w-3" /> Insight
          </p>
          <p className="mt-1 text-sm leading-relaxed">{brief.advisor.insight}</p>
          <p className="mt-3 flex items-center gap-1 text-tiny uppercase tracking-wide text-warning">
            <Clock aria-hidden="true" className="h-3 w-3" /> Action
          </p>
          <p className="mt-1 text-sm font-semibold">{brief.advisor.action}</p>
          <p className="mt-3 text-tiny text-neutral-500">
            {brief.advisor.provider} · {brief.advisor.latencyMs}ms · {new Date(brief.advisor.generatedAtIso).toLocaleString()}
          </p>
        </article>
      ) : brief ? (
        <p className="text-tiny text-neutral-500">
          {languagePreference === 'sw'
            ? 'Akili haijapatikana sasa. Jaribu tena baadaye.'
            : 'Brain ladder unavailable right now. Try again shortly.'}
        </p>
      ) : (
        <p className="text-tiny text-neutral-500">Loading…</p>
      )}
    </div>
  );
}
