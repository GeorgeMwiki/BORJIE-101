import type { BriefItem } from '@/lib/types/cockpit';

interface DailyBriefCardProps {
  readonly items: ReadonlyArray<BriefItem>;
}

const SEVERITY_PILL: Record<BriefItem['severity'], string> = {
  info: 'pill-green',
  warn: 'pill-amber',
  critical: 'pill-red',
};

export function DailyBriefCard({ items }: DailyBriefCardProps) {
  return (
    <article className="cockpit-card lg:col-span-2">
      <div className="cockpit-card-title">Daily brief</div>
      <ul className="flex flex-col gap-3">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-3">
            <span className={`pill ${SEVERITY_PILL[item.severity]} shrink-0`}>
              {item.severity}
            </span>
            <p className="text-sm leading-snug text-foreground">{item.text}</p>
          </li>
        ))}
      </ul>
    </article>
  );
}
