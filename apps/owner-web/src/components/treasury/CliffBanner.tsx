'use client';

import { AlertTriangle } from 'lucide-react';
import { useCliffStatus } from '@/lib/queries/cockpit';

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
 */
export function CliffBanner() {
  const cliff = useCliffStatus();
  const live = cliff.data;

  if (!live) {
    return (
      <article className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-4 text-destructive">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5" />
          <div className="flex-1">
            <div className="text-sm font-medium">
              27-Mar-2026 BoT cliff status unavailable
            </div>
            <div className="mt-1 text-xs">
              The cliff-status endpoint is unreachable. Sign in or
              retry to load the live USD exposure rollup.
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

  return (
    <article className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-4 text-destructive">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5" />
        <div className="flex-1">
          <div className="text-sm font-medium">
            27-Mar-2026 BoT cliff passed by {weeksPast} weeks
          </div>
          <div className="mt-1 text-xs">
            Cliff date {cliffDate}. Post-cliff sales {live.postCliffSales}; USD
            denominated {live.usdDenominated}.{live.note ? ` ${live.note}` : ''}
          </div>
          <div className={`mt-3 inline-block rounded-md border px-2 py-1 text-badge ${banner}`}>
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
