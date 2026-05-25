interface RiskItem {
  readonly title: string;
  readonly site: string;
  readonly severity: 'low' | 'medium' | 'high';
}

interface OpenRisksCardProps {
  readonly items: ReadonlyArray<RiskItem>;
}

const SEVERITY_PILL: Record<RiskItem['severity'], string> = {
  low: 'pill-green',
  medium: 'pill-amber',
  high: 'pill-red',
};

export function OpenRisksCard({ items }: OpenRisksCardProps) {
  return (
    <article className="cockpit-card">
      <div className="cockpit-card-title">Open risks</div>
      <ul className="flex flex-col gap-2.5">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-2">
            <span className={`pill ${SEVERITY_PILL[item.severity]} shrink-0`}>
              {item.severity}
            </span>
            <div className="flex-1">
              <div className="text-sm text-foreground">{item.title}</div>
              <div className="text-xs text-neutral-500">{item.site}</div>
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
