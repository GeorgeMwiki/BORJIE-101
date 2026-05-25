interface SiteCardItem {
  readonly name: string;
  readonly status: 'on-track' | 'watch' | 'behind';
  readonly headline: string;
}

interface ActiveSitesCardProps {
  readonly items: ReadonlyArray<SiteCardItem>;
}

const STATUS_PILL: Record<SiteCardItem['status'], string> = {
  'on-track': 'pill-green',
  watch: 'pill-amber',
  behind: 'pill-red',
};

export function ActiveSitesCard({ items }: ActiveSitesCardProps) {
  return (
    <article className="cockpit-card lg:col-span-2">
      <div className="cockpit-card-title">Active sites</div>
      <ul className="flex flex-col gap-3">
        {items.map((site) => (
          <li
            key={site.name}
            className="flex items-start justify-between gap-3 border-b border-border/40 pb-2 last:border-b-0 last:pb-0"
          >
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">{site.name}</div>
              <div className="text-xs text-neutral-400">{site.headline}</div>
            </div>
            <span className={`pill ${STATUS_PILL[site.status]} shrink-0`}>
              {site.status}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
