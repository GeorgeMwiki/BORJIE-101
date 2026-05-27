import { fmtTzs } from '@/lib/format';
import type {
  CashRunwaySlot,
  CliffStatusSlot,
} from '@/lib/queries/owner-brief';

interface CashRunwayCardProps {
  readonly cashRunway: CashRunwaySlot;
  readonly cliffStatus: CliffStatusSlot;
}

/**
 * Cash & USD-cliff card — sits beside the production table.
 *
 * Combines the 90-day net inflow (used as a runway proxy) with the
 * post-27-Mar USD cliff tracker so the owner sees both numbers
 * together. The cliff tile turns red when the cliff is < 30 days
 * out and remediation is still pending.
 */
export function CashRunwayCard({
  cashRunway,
  cliffStatus,
}: CashRunwayCardProps): JSX.Element {
  const dailyAvg = cashRunway.dailyAvgTzs;
  const projectedDays =
    dailyAvg > 0
      ? Math.round(Math.max(cashRunway.ninetyDayNetTzs, 0) / dailyAvg)
      : null;
  const cliff = new Date(cliffStatus.cliffDateIso);
  const cliffDays = Number.isNaN(cliff.getTime())
    ? null
    : Math.round((cliff.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

  const runwayPill =
    projectedDays === null
      ? 'pill-amber'
      : projectedDays >= 90
        ? 'pill-green'
        : projectedDays >= 45
          ? 'pill-amber'
          : 'pill-red';
  const cliffPill = cliffStatus.remediationComplete
    ? 'pill-green'
    : cliffDays !== null && cliffDays < 30
      ? 'pill-red'
      : 'pill-amber';

  return (
    <article
      className="cockpit-card flex h-full flex-col gap-3"
      data-testid="dashboard-cash-runway"
    >
      <header>
        <h2 className="cockpit-card-title">Cash &amp; USD cliff</h2>
        <p className="text-xs italic text-neutral-500">
          Hela &amp; tarehe ya USD
        </p>
      </header>

      <div>
        <div className="font-display text-2xl text-foreground">
          {fmtTzs(Math.max(cashRunway.ninetyDayNetTzs, 0))}
        </div>
        <p className="cockpit-card-meta">
          90-day net · {cashRunway.sampleCount} sales sampled
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className={`pill ${runwayPill}`}>
          {projectedDays === null
            ? 'runway unknown'
            : `${projectedDays} days runway`}
        </span>
      </div>

      <hr className="border-border/40" />

      <div>
        <div className="text-xs text-neutral-500">Post-cliff posture</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={`pill ${cliffPill}`}>
            {cliffStatus.remediationComplete
              ? 'remediation complete'
              : `${cliffStatus.usdDenominated} USD contracts`}
          </span>
          {cliffDays !== null ? (
            <span className="pill border-border text-neutral-400">
              {cliffDays >= 0
                ? `cliff in ${cliffDays}d`
                : `${Math.abs(cliffDays)}d past`}
            </span>
          ) : null}
        </div>
        <p className="cockpit-card-meta">
          {cliffStatus.postCliffSales} post-cliff sales recorded
        </p>
      </div>
    </article>
  );
}
