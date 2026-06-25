'use client';

import Link from 'next/link';
import {
  useDashboardKillswitch,
  type KillswitchLevel,
} from '@/lib/internal/queries/dashboard';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

// `unknown` is the fail-SAFE visual for any off-enum gateway level: a
// neutral, cautionary pill — never the green `live` styling, which would
// falsely reassure on a safety panel.
const LEVEL_PILL: Record<KillswitchLevel, string> = {
  live: 'border-success/40 bg-success-subtle/20 text-success',
  degraded: 'border-warning/40 bg-warning-subtle/20 text-warning',
  halt: 'border-destructive/40 bg-destructive/10 text-destructive',
  unknown: 'border-border bg-surface/40 text-neutral-400',
};

// Closed-enum kill-switch levels mapped to per-locale labels. The wire
// carries stable machine tokens (`live`/`degraded`/`halt`); the FE
// localizes at render so neither locale ever shows a foreign-language word.
// `unknown` covers any value the gateway emits outside the known set — the
// adapter clamps to it, and this guarantees a localized label always exists
// (so the per-row lookup can never `undefined`-deref `pickByLocale`).
const LEVEL_LABEL: Record<KillswitchLevel, { readonly en: string; readonly sw: string }> = {
  live: { en: 'live', sw: 'hai' },
  degraded: { en: 'degraded', sw: 'imepunguzwa' },
  halt: { en: 'halt', sw: 'imesimama' },
  unknown: { en: 'unknown', sw: 'haijulikani' },
};

/**
 * Resolve the per-locale label for a row level. Defense-in-depth: even if a
 * value reaches here outside the clamped enum (a future regression upstream),
 * fall back to the `unknown` label rather than passing `undefined` into
 * `pickByLocale` — which would read `.en`/`.sw` on `undefined` and throw,
 * blanking the entire kill-switch status mirror.
 */
function levelLabel(locale: Locale, level: KillswitchLevel): string {
  return pickByLocale(locale, LEVEL_LABEL[level] ?? LEVEL_LABEL.unknown);
}

const S = {
  unavailableTitle: {
    en: 'Kill-switch status unavailable',
    sw: 'Hali ya swichi-ya-kuzima haipatikani',
  },
  endpointUnreachable: { en: 'Endpoint unreachable', sw: 'Mwisho haufikiki' },
  heading: { en: 'Kill-switch', sw: 'Swichi ya kuzima' },
  nonLiveScopes: { en: 'non-live scopes', sw: 'wigo zisizo hai' },
  manage: { en: 'Manage →', sw: 'Simamia →' },
  haltPill: { en: 'halt', sw: 'imesimama' },
  degradedPill: { en: 'degraded', sw: 'imepunguzwa' },
  livePill: { en: 'live', sw: 'hai' },
  emptyRows: {
    en: 'No kill-switch state rows reported.',
    sw: 'Hakuna safu za hali ya swichi-ya-kuzima zilizoripotiwa.',
  },
} as const;

/**
 * Kill-switch status panel — top-right.
 *
 * Reads `/mining/internal/killswitch` for the current scope/level
 * matrix. Surfaces counts of halt / degraded / live scopes and the
 * three most recent transitions for context. Two-operator confirmation
 * lives at the kill-switch screen — this is a status mirror only.
 */
export function KillSwitchStatusPanel(): JSX.Element {
  const locale = useLocale();
  const query = useDashboardKillswitch();

  if (query.isLoading) {
    return (
      <div
        className="h-44 animate-pulse rounded-lg border border-border bg-surface/40"
        data-testid="admin-dashboard-killswitch-skeleton"
      />
    );
  }

  if (query.error || !query.data) {
    return (
      <article
        className="rounded-lg border border-warning/40 bg-warning-subtle/10 p-5"
        data-testid="admin-dashboard-killswitch-error"
      >
        <h2 className="text-caption uppercase tracking-widest text-warning">
          {pickByLocale(locale, S.unavailableTitle)}
        </h2>
        <p className="mt-2 text-sm text-neutral-300">
          {query.error instanceof Error
            ? query.error.message
            : pickByLocale(locale, S.endpointUnreachable)}
        </p>
      </article>
    );
  }

  const { rows, halt, degraded, live } = query.data;
  const danger = halt > 0;

  return (
    <article
      className={`rounded-lg border p-5 ${
        danger
          ? 'border-destructive/40 bg-destructive/5'
          : degraded > 0
            ? 'border-warning/40 bg-warning-subtle/5'
            : 'border-border bg-surface'
      }`}
      data-testid="admin-dashboard-killswitch"
    >
      <header className="mb-3 flex items-start justify-between">
        <div>
          <h2 className="text-caption uppercase tracking-widest text-neutral-500">
            {pickByLocale(locale, S.heading)}
          </h2>
          <p className="mt-1 font-display text-3xl text-foreground">
            {halt + degraded}
          </p>
          <p className="text-xs text-neutral-500">
            {pickByLocale(locale, S.nonLiveScopes)}
          </p>
        </div>
        <Link
          href="/internal/killswitch"
          className="text-xs text-signal-500 underline underline-offset-4"
        >
          {pickByLocale(locale, S.manage)}
        </Link>
      </header>
      <div className="mb-3 flex gap-2 text-xs">
        <span className={`pill ${LEVEL_PILL.halt}`}>
          {halt} {pickByLocale(locale, S.haltPill)}
        </span>
        <span className={`pill ${LEVEL_PILL.degraded}`}>
          {degraded} {pickByLocale(locale, S.degradedPill)}
        </span>
        <span className={`pill ${LEVEL_PILL.live}`}>
          {live} {pickByLocale(locale, S.livePill)}
        </span>
      </div>
      {rows.length === 0 ? (
        <p
          className="text-sm text-neutral-400"
          data-testid="admin-dashboard-killswitch-empty"
        >
          {pickByLocale(locale, S.emptyRows)}
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {rows.slice(0, 3).map((row, i) => (
            <li
              key={`${row.scope}-${i}`}
              className="flex items-baseline justify-between gap-3"
              data-testid="admin-dashboard-killswitch-row"
            >
              <span className="truncate text-foreground">{row.scope}</span>
              <span
                className={`pill ${LEVEL_PILL[row.level] ?? LEVEL_PILL.unknown}`}
              >
                {levelLabel(locale, row.level)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
