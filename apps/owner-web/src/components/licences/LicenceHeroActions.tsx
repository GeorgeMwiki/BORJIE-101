'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowRight, FileCheck, Sparkles } from 'lucide-react';
import { useLicencesList } from '@/lib/queries/licence';
import { pickByLocale } from '@/lib/locale-shared';
import type { Locale } from '@/lib/locale-shared';
import { licenceCockpitStrings as S } from '@/i18n/strings/licence-cockpit';

interface RawLicence {
  readonly id?: string;
  readonly number?: string;
  readonly expiryDate?: string;
}

interface LicenceHeroActionsProps {
  readonly locale: Locale;
}

function daysToExpiry(iso: string | undefined): number | null {
  if (!iso) return null;
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return null;
  return Math.floor((target - Date.now()) / 86_400_000);
}

/**
 * Pick the single MOST-URGENT licence the owner should renew first: the
 * one with the smallest days-to-expiry (already-expired and soon-expiring
 * sort to the front). Licences with no expiry date are deprioritised but
 * still selectable so the CTA never dead-ends when at least one licence
 * exists. Returns `null` only when the tenant holds zero licences.
 */
function firstExpiringId(raw: ReadonlyArray<RawLicence>): string | null {
  let bestId: string | null = null;
  let bestDays = Number.POSITIVE_INFINITY;
  for (const lic of raw) {
    const id = lic.id ?? lic.number;
    if (!id) continue;
    const days = daysToExpiry(lic.expiryDate);
    const rank = days ?? Number.MAX_SAFE_INTEGER;
    if (rank < bestDays) {
      bestDays = rank;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Licences-index hero actions. The "Draft renewal pack" primary CTA is
 * DATA-AWARE: it deep-links to the per-licence cockpit of the most
 * urgent (soonest-expiring) licence — never to a bare `/licence` that
 * dead-ends on "No licence selected". When the tenant holds no licences
 * the CTA is disabled with an honest localized note (dead-control law:
 * a control that cannot act must say so, not no-op).
 */
export function LicenceHeroActions({ locale }: LicenceHeroActionsProps): JSX.Element {
  const query = useLicencesList();

  const targetId = useMemo<string | null>(() => {
    const raw = (query.data ?? []) as ReadonlyArray<RawLicence>;
    return firstExpiringId(raw);
  }, [query.data]);

  // While loading, or when there is no licence to renew, the primary CTA
  // must not link into a dead-end. Disable it with an honest note.
  const canRenew = targetId !== null;

  return (
    <>
      {canRenew ? (
        <Link
          href={`/licence?id=${encodeURIComponent(targetId)}`}
          className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
        >
          <FileCheck className="h-3.5 w-3.5" />
          {pickByLocale(locale, S.hero.draftRenewalPack)}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <span
          aria-disabled="true"
          title={pickByLocale(locale, S.hero.noExpiringNote)}
          className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold text-neutral-500"
        >
          <FileCheck className="h-3.5 w-3.5" />
          {pickByLocale(locale, S.hero.draftRenewalPack)}
        </span>
      )}
      <Link
        href="/ask?prompt=licences"
        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
      >
        <Sparkles className="h-3.5 w-3.5" />
        {pickByLocale(locale, S.hero.askMasterBrain)}
      </Link>
    </>
  );
}
