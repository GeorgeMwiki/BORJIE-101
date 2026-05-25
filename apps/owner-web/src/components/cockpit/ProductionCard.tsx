interface ProductionCardProps {
  readonly grammesToday: number;
  readonly grammesTargetToday: number;
  readonly grammesMtd: number;
  readonly grammesTargetMtd: number;
}

function pct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round((value / target) * 100);
}

export function ProductionCard({
  grammesToday,
  grammesTargetToday,
  grammesMtd,
  grammesTargetMtd,
}: ProductionCardProps) {
  const dayPct = pct(grammesToday, grammesTargetToday);
  const mtdPct = pct(grammesMtd, grammesTargetMtd);
  const dayPill = dayPct >= 100 ? 'pill-green' : dayPct >= 85 ? 'pill-amber' : 'pill-red';
  return (
    <article className="cockpit-card">
      <div className="cockpit-card-title">Production vs target</div>
      <div className="cockpit-card-value">
        {grammesToday.toLocaleString()} g
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`pill ${dayPill}`}>{dayPct}% of day target</span>
      </div>
      <div className="cockpit-card-meta">
        MTD {grammesMtd.toLocaleString()} g of {grammesTargetMtd.toLocaleString()} g ({mtdPct}%)
      </div>
    </article>
  );
}
