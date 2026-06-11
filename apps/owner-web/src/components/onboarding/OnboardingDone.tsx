'use client';

import { CheckCircle2 } from 'lucide-react';
import { SectionCard } from '@/components/shared/SectionCard';
import { pickByLocale, useLocale } from '@/lib/locale';
import { routesAStrings as S } from '@/i18n/strings/routes-a';
import type { CommitTally } from '@/lib/queries/onboarding-ingest';

/**
 * Onboarding confirmation surface (LANE B1).
 *
 * Renders AFTER the wizard's `/complete` call instead of redirecting to a
 * generic `/`. Reads back the REAL committed-row tallies (the recipe `/commit`
 * results folded per entity) alongside the server's `cockpit_seed` ref counts,
 * so the owner sees exactly what landed in their cockpit. Strictly per-locale
 * (no EN/SW mixing) — all copy via `i18n/strings/routes-a`.
 */

export interface CockpitSeedSummary {
  readonly headline: string;
  readonly licencesRefs: number;
  readonly sitesRefs: number;
  readonly drillRefs: number;
  readonly kybCaptured: boolean;
}

interface OnboardingDoneProps {
  /** Real rows the recipe `/commit` inserted, by entity type. */
  readonly tallies: ReadonlyArray<CommitTally>;
  /** Server-side cockpit seed (ref counts + headline) from `/complete`. */
  readonly seed: CockpitSeedSummary | null;
  /** True when one or more files were still being OCR'd at finish. */
  readonly hasPendingExtraction: boolean;
  readonly onGoToCockpit: () => void;
}

function tallyFor(
  tallies: ReadonlyArray<CommitTally>,
  entity: CommitTally['entityType'],
): { inserted: number; skipped: number } {
  return tallies
    .filter((t) => t.entityType === entity)
    .reduce(
      (acc, t) => ({
        inserted: acc.inserted + t.rowsInserted,
        skipped: acc.skipped + t.rowsSkipped,
      }),
      { inserted: 0, skipped: 0 },
    );
}

export function OnboardingDone({
  tallies,
  seed,
  hasPendingExtraction,
  onGoToCockpit,
}: OnboardingDoneProps) {
  const locale = useLocale();
  const licences = tallyFor(tallies, 'licence');
  const sites = tallyFor(tallies, 'site');
  const totalInserted = tallies.reduce((sum, t) => sum + t.rowsInserted, 0);

  const cards: ReadonlyArray<{ label: string; inserted: number; skipped: number }> = [
    { label: pickByLocale(locale, S.onboarding.countLicences), ...licences },
    { label: pickByLocale(locale, S.onboarding.countSites), ...sites },
  ];

  return (
    <div className="space-y-4 px-8 py-6">
      <SectionCard
        title={pickByLocale(locale, S.onboarding.doneTitle)}
        subtitle={pickByLocale(locale, S.onboarding.doneSubtitle)}
      >
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="h-5 w-5" />
          <span className="text-sm font-semibold">
            {pickByLocale(locale, S.onboarding.doneTitle)}
          </span>
        </div>

        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <li
              key={card.label}
              className="rounded-md border border-border bg-background p-4"
            >
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                {card.label}
              </p>
              <p className="mt-1 text-2xl font-display text-foreground">
                {card.inserted}{' '}
                <span className="text-xs font-normal text-neutral-400">
                  {pickByLocale(locale, S.onboarding.rowsCreatedLabel)}
                </span>
              </p>
              {card.skipped > 0 ? (
                <p className="mt-0.5 text-xs text-neutral-500">
                  {card.skipped} {pickByLocale(locale, S.onboarding.rowsSkippedLabel)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        {seed?.headline ? (
          <div className="mt-4 rounded-md border border-border bg-surface p-3">
            <p className="text-xs uppercase tracking-wide text-neutral-500">
              {pickByLocale(locale, S.onboarding.headlineLabel)}
            </p>
            <p className="mt-1 text-sm text-foreground">{seed.headline}</p>
          </div>
        ) : null}

        {totalInserted === 0 ? (
          <p className="mt-4 text-xs text-warning">
            {pickByLocale(locale, S.onboarding.emptyCockpitNote)}
          </p>
        ) : null}
        {hasPendingExtraction ? (
          <p className="mt-2 text-xs text-neutral-400">
            {pickByLocale(locale, S.onboarding.pendingExtractionNote)}
          </p>
        ) : null}

        <div className="mt-5">
          <button
            type="button"
            onClick={onGoToCockpit}
            className="inline-flex items-center gap-2 rounded-md border border-warning bg-warning-subtle/30 px-4 py-2 text-sm text-warning hover:bg-warning-subtle/50"
          >
            {pickByLocale(locale, S.onboarding.goToCockpit)}
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
