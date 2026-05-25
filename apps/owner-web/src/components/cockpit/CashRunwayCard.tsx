interface CashRunwayCardProps {
  readonly cashTzsMillions: number;
  readonly runwayDays: number;
  readonly burnPerDayTzsMillions: number;
}

function formatTzs(millions: number): string {
  return `TZS ${millions.toFixed(1)} M`;
}

export function CashRunwayCard({
  cashTzsMillions,
  runwayDays,
  burnPerDayTzsMillions,
}: CashRunwayCardProps) {
  const runwayPill =
    runwayDays >= 90
      ? 'pill-green'
      : runwayDays >= 45
        ? 'pill-amber'
        : 'pill-red';
  return (
    <article className="cockpit-card">
      <div className="cockpit-card-title">Cash & runway</div>
      <div className="cockpit-card-value">{formatTzs(cashTzsMillions)}</div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`pill ${runwayPill}`}>{runwayDays} days runway</span>
      </div>
      <div className="cockpit-card-meta">
        Burn ~ {formatTzs(burnPerDayTzsMillions)} / day
      </div>
    </article>
  );
}
