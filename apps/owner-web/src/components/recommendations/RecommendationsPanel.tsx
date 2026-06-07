'use client';

import { useState, type ReactElement } from 'react';
import { Sparkles, AlertTriangle } from 'lucide-react';
import {
  useRecommendationMatch,
  useSessionUserId,
  RECOMMENDATION_TARGETS,
  type RecommendationTarget,
} from '@/lib/queries/recommendations';

/**
 * Recommendations panel — surfaces the REAL `@borjie/recommendations` engine.
 *
 * The owner picks a match target (buyer↔mine / worker↔site / supplier↔mine);
 * the panel calls the mining BFF, which computes the ranking server-side over
 * the tenant's live marketplace listings + ratings, persists a hash-chained
 * run, and returns the top-K with the concrete evidence rows
 * (services/api-gateway/src/routes/mining/recommendations.hono.ts). Every
 * state (loading / empty / degraded / error) renders real copy; nothing is
 * fabricated. Standalone panel — does NOT touch the page nav.
 */

const TARGET_LABEL: Record<RecommendationTarget, string> = {
  buyer_mine: 'Buyers → Mines',
  worker_site: 'Workers → Sites',
  supplier_mine: 'Suppliers → Mines',
};

function fmtScore(n: number): string {
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: 3 })
    : '—';
}

export function RecommendationsPanel(): ReactElement {
  const userQ = useSessionUserId();
  const userId = userQ.data ?? undefined;
  const [target, setTarget] = useState<RecommendationTarget>('buyer_mine');
  const matchQ = useRecommendationMatch({ target, userId });

  return (
    <section className="rounded-2xl border border-border bg-surface/40 p-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-xl border border-info/40 bg-info/10 p-2 text-info">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Smart Matches
            </h2>
            <p className="text-xs text-neutral-400">
              Ranked matches from your live marketplace + reputation signal
            </p>
          </div>
        </div>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as RecommendationTarget)}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
          aria-label="Select match target"
        >
          {RECOMMENDATION_TARGETS.map((t) => (
            <option key={t} value={t}>
              {TARGET_LABEL[t]}
            </option>
          ))}
        </select>
      </header>

      {userQ.isLoading && (
        <p className="text-xs text-neutral-400">Loading session…</p>
      )}
      {!userQ.isLoading && !userId && (
        <p className="text-xs text-neutral-400">
          Sign in to compute personalised matches.
        </p>
      )}

      {userId && matchQ.isLoading && (
        <p className="text-xs text-neutral-400">Computing matches…</p>
      )}
      {userId && matchQ.isError && (
        <p className="flex items-center gap-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Matcher unavailable. Try again shortly.
        </p>
      )}

      {matchQ.data && (
        <div className="space-y-4">
          {matchQ.data.topK.length === 0 ? (
            <p className="text-xs text-neutral-400">
              {matchQ.data.note ??
                'No active marketplace candidates to match yet.'}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-wide text-neutral-500">
                {matchQ.data.algorithm && (
                  <span>Algorithm: {matchQ.data.algorithm}</span>
                )}
                {matchQ.data.runId && <span>Run: {matchQ.data.runId}</span>}
              </div>
              <ol className="space-y-2">
                {matchQ.data.topK.map((item, idx) => (
                  <li
                    key={item.itemId}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background/60 p-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">
                        #{idx + 1} · {item.itemId}
                      </p>
                      {item.reason && (
                        <p className="mt-1 truncate text-neutral-400">
                          {item.reason}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-md border border-info/30 bg-info/10 px-2 py-0.5 font-mono text-info">
                      {fmtScore(item.score)}
                    </span>
                  </li>
                ))}
              </ol>
              {matchQ.data.evidenceIds.length > 0 && (
                <p className="text-[10px] uppercase tracking-wide text-neutral-500">
                  Evidence: {matchQ.data.evidenceIds.slice(0, 8).join(', ')}
                  {matchQ.data.evidenceIds.length > 8
                    ? ` +${matchQ.data.evidenceIds.length - 8} more`
                    : ''}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
