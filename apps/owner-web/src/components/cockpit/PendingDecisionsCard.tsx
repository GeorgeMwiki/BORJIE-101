interface DecisionItem {
  readonly title: string;
  readonly waitingDays: number;
  readonly recommender: string;
}

interface PendingDecisionsCardProps {
  readonly items: ReadonlyArray<DecisionItem>;
}

export function PendingDecisionsCard({ items }: PendingDecisionsCardProps) {
  return (
    <article className="cockpit-card">
      <div className="cockpit-card-title">Pending decisions</div>
      <ul className="flex flex-col gap-2.5">
        {items.map((item, index) => (
          <li key={index} className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="text-sm text-foreground">{item.title}</div>
              <div className="text-xs text-neutral-500">
                from {item.recommender}
              </div>
            </div>
            <span className="pill pill-amber shrink-0">{item.waitingDays}d</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
