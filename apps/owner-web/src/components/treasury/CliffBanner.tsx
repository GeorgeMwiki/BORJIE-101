'use client';

import { AlertTriangle } from 'lucide-react';
import { useCliffStatus } from '@/lib/queries/cockpit';
import type { Locale } from '@/lib/locale-shared';
import { pickByLocale } from '@/lib/locale-shared';
import { treasuryPageStrings as S } from '@/i18n/strings/treasury-page';

interface CliffBannerProps {
  readonly locale: Locale;
}

const NOTIFICATION_TONE = {
  sent: 'border-success/40 bg-success-subtle/20 text-success',
  pending: 'border-warning/40 bg-warning-subtle/20 text-warning',
  overdue: 'border-destructive/40 bg-destructive/10 text-destructive',
} as const;

/**
 * Cliff banner. Pulls the post-27-Mar-2026 USD-cliff status from the
 * live `/cockpit/27mar-cliff-status` endpoint. When the data is not
 * yet available the banner renders a generic warning without the
 * exposure / notification figures.
 *
 * This is compliance / legal copy: every string flows through the
 * treasury-page string table in the ACTIVE locale (zero mixing), and the
 * remediation guidance is rendered in full — never single-line-truncated.
 */
export function CliffBanner({ locale }: CliffBannerProps) {
  const cliff = useCliffStatus();
  const live = cliff.data;

  if (!live) {
    return (
      <article className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-4 text-destructive">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-medium">
              {pickByLocale(locale, S.cliff.unavailableTitle)}
            </div>
            <div className="mt-1 text-xs">
              {pickByLocale(locale, S.cliff.unavailableBody)}
            </div>
          </div>
        </div>
      </article>
    );
  }

  const cliffDateIso = live.cliffDateIso;
  const cliffDate = cliffDateIso.slice(0, 10);
  const daysPast = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(cliffDateIso)) / 86_400_000),
  );
  const weeksPast = Math.floor(daysPast / 7);
  const status: keyof typeof NOTIFICATION_TONE = live.remediationComplete ? 'sent' : 'pending';
  const banner = NOTIFICATION_TONE[status];
  const statusLabel = pickByLocale(
    locale,
    status === 'sent' ? S.cliff.statusSent : S.cliff.statusPending,
  );

  return (
    <article className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-4 text-destructive">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-medium">
            {S.cliff.passedTitle(weeksPast)[locale]}
          </div>
          <div className="mt-1 text-xs">
            {
              S.cliff.detail({
                cliffDate,
                postCliffSales: live.postCliffSales,
                usdDenominated: live.usdDenominated,
              })[locale]
            }
          </div>
          <div className={`mt-3 inline-block rounded-md border px-2 py-1 text-badge ${banner}`}>
            {pickByLocale(locale, S.cliff.facilityNotification)}: {statusLabel}
          </div>
          <div className="mt-3 text-xs italic text-destructive/80">
            {pickByLocale(locale, S.cliff.remediation)}
          </div>
        </div>
      </div>
    </article>
  );
}
