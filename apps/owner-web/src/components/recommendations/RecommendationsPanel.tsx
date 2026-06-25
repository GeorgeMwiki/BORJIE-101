'use client';

import { useState, type ReactElement } from 'react';
import { Sparkles, AlertTriangle } from 'lucide-react';
import { useLocale, pickByLocale } from '@/lib/locale';
import { bcp47For } from '@/lib/format';
import type { Locale } from '@/lib/locale-shared';
import {
  useRecommendationMatch,
  useSessionUserId,
  RECOMMENDATION_TARGETS,
  type RecommendationTarget,
} from '@/lib/queries/recommendations';
import {
  recommendationsPanelStrings as S,
  recommendationTargetLabels,
} from '@/i18n/strings/recommendations-panel';

/**
 * Recommendations panel — surfaces the REAL `@borjie/recommendations` engine.
 *
 * The owner picks a match target (buyer↔mine / worker↔site / supplier↔mine);
 * the panel calls the mining BFF, which computes the ranking server-side over
 * the tenant's live marketplace listings + ratings, persists a hash-chained
 * run, and returns the top-K with the concrete evidence rows
 * (services/api-gateway/src/routes/mining/recommendations.hono.ts). Every
 * state (loading / empty / degraded / error) renders real per-locale copy;
 * nothing is fabricated. Standalone panel — does NOT touch the page nav. The
 * locale is SEEDED from the server-resolved session so SSR + first paint
 * render the SAME language (zero-mix canon); the score goes through
 * `bcp47For(locale)`.
 */

function fmtScore(n: number, locale: Locale): string {
  return Number.isFinite(n)
    ? n.toLocaleString(bcp47For(locale), { maximumFractionDigits: 3 })
    : '—';
}

interface RecommendationsPanelProps {
  /** Seeded by the server-resolved session so SSR + first paint agree. */
  readonly locale?: Locale;
}

export function RecommendationsPanel({
  locale: seeded,
}: RecommendationsPanelProps): ReactElement {
  const locale = useLocale(seeded);
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
              {pickByLocale(locale, S.title)}
            </h2>
            <p className="text-xs text-neutral-400">
              {pickByLocale(locale, S.subtitle)}
            </p>
          </div>
        </div>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as RecommendationTarget)}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
          aria-label={pickByLocale(locale, S.selectTarget)}
        >
          {RECOMMENDATION_TARGETS.map((t) => (
            <option key={t} value={t}>
              {pickByLocale(locale, recommendationTargetLabels[t])}
            </option>
          ))}
        </select>
      </header>

      {userQ.isLoading && (
        <p className="text-xs text-neutral-400">
          {pickByLocale(locale, S.loadingSession)}
        </p>
      )}
      {!userQ.isLoading && !userId && (
        <p className="text-xs text-neutral-400">
          {pickByLocale(locale, S.signInPrompt)}
        </p>
      )}

      {userId && matchQ.isLoading && (
        <p className="text-xs text-neutral-400">
          {pickByLocale(locale, S.computing)}
        </p>
      )}
      {userId && matchQ.isError && (
        <p className="flex items-center gap-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {pickByLocale(locale, S.matcherUnavailable)}
        </p>
      )}

      {matchQ.data && (
        <div className="space-y-4">
          {matchQ.data.topK.length === 0 ? (
            // `note` is an English backend diagnostic when present; the
            // localized parity copy renders otherwise.
            matchQ.data.note ? (
              <p lang="en" className="text-xs text-neutral-400">
                {matchQ.data.note}
              </p>
            ) : (
              <p className="text-xs text-neutral-400">
                {pickByLocale(locale, S.noCandidates)}
              </p>
            )
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-wide text-neutral-500">
                {matchQ.data.algorithm && (
                  <span>
                    {pickByLocale(locale, S.algorithm)}: {matchQ.data.algorithm}
                  </span>
                )}
                {matchQ.data.runId && (
                  <span>
                    {pickByLocale(locale, S.run)}: {matchQ.data.runId}
                  </span>
                )}
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
                        // Engine-generated reason prose is English; mark it
                        // `lang="en"` for honest attribution until the matcher
                        // pins output to the active locale (see residual).
                        <p lang="en" className="mt-1 truncate text-neutral-400">
                          {item.reason}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-md border border-info/30 bg-info/10 px-2 py-0.5 font-mono text-info">
                      {fmtScore(item.score, locale)}
                    </span>
                  </li>
                ))}
              </ol>
              {matchQ.data.evidenceIds.length > 0 && (
                <p className="text-[10px] uppercase tracking-wide text-neutral-500">
                  {pickByLocale(locale, S.evidence)}:{' '}
                  {matchQ.data.evidenceIds.slice(0, 8).join(', ')}
                  {matchQ.data.evidenceIds.length > 8
                    ? pickByLocale(
                        locale,
                        S.moreSuffix(matchQ.data.evidenceIds.length - 8),
                      )
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
