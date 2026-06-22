'use client';

import { Card } from '@borjie/design-system';

import { StatusPill } from '@/components/shared/StatusPill';
import { useLocale, pickByLocale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

interface DecisionItem {
  readonly title: string;
  readonly waitingDays: number;
  readonly recommender: string;
}

interface PendingDecisionsCardProps {
  readonly items: ReadonlyArray<DecisionItem>;
}

export function PendingDecisionsCard({ items }: PendingDecisionsCardProps) {
  const locale = useLocale();
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">
        {pickByLocale(locale, S.decisions.title)}
      </div>
      <ul className="flex flex-col gap-2.5">
        {items.map((item, index) => (
          <li key={index} className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="text-sm text-foreground">{item.title}</div>
              <div className="text-xs text-muted-foreground">
                {pickByLocale(locale, S.decisions.from(item.recommender))}
              </div>
            </div>
            <span className="shrink-0">
              <StatusPill
                tone="amber"
                label={pickByLocale(
                  locale,
                  S.decisions.waitingDays(item.waitingDays),
                )}
              />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
