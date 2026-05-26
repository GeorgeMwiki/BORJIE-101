'use client';

import { AlertTriangle } from 'lucide-react';
import { CLIFF_DATE, CLIFF_TRACKER } from '@/lib/mocks/treasury';
import { fmtTzsM, fmtUsd } from '@/lib/format';
import { useCliffStatus } from '@/lib/queries/cockpit';

const NOTIFICATION_TONE = {
  sent: 'border-success/40 bg-success-subtle/20 text-success',
  pending: 'border-warning/40 bg-warning-subtle/20 text-warning',
  overdue: 'border-destructive/40 bg-destructive/10 text-destructive',
} as const;

/**
 * Cliff banner. Pulls the post-27-Mar-2026 USD-cliff status from the
 * live `/cockpit/27mar-cliff-status` endpoint (falls back to the
 * bundled mock when offline). The detailed exposure + facility
 * notification figures stay in the mock — the gateway exposes only the
 * remediation rollup, not the per-receivable breakdown.
 */
export function CliffBanner() {
  const cliff = useCliffStatus();
  const live = cliff.data;
  const cliffDateIso = live?.cliffDateIso ?? `${CLIFF_DATE}T00:00:00Z`;
  const cliffDate = cliffDateIso.slice(0, 10);
  const daysPast = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(cliffDateIso)) / 86_400_000),
  );
  const weeksPast = Math.floor(daysPast / 7);

  const status = live?.remediationComplete
    ? 'sent'
    : CLIFF_TRACKER.facilityNotificationStatus;
  const banner = NOTIFICATION_TONE[status];

  return (
    <article className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-4 text-destructive">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5" />
        <div className="flex-1">
          <div className="text-sm font-medium">
            27-Mar-2026 BoT cliff passed by {weeksPast} weeks
          </div>
          <div className="mt-1 text-xs">
            Cliff date {cliffDate} - USD receivables exposure{' '}
            {fmtUsd(CLIFF_TRACKER.usdReceivablesExposureUsd)} - forced
            conversion {fmtTzsM(CLIFF_TRACKER.forcedConversionTzsM)} at BoT mid.
            {live?.note ? ` ${live.note}` : ''}
          </div>
          <div className={`mt-3 inline-block rounded-md border px-2 py-1 text-[11px] ${banner}`}>
            Facility notification: {status}
          </div>
          <div className="mt-3 text-xs italic text-destructive/80">
            Remediation: file BoT exemption pack, restructure outstanding USD
            invoices into TZS where possible, log every conversion for audit.
          </div>
        </div>
      </div>
    </article>
  );
}
