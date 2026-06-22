'use client';

import { Card } from '@borjie/design-system';

import { StatusPill } from '@/components/shared/StatusPill';
import { useLocale, pickByLocale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

interface SiteCardItem {
  readonly name: string;
  readonly status: 'on-track' | 'watch' | 'behind';
  readonly headline: string;
}

interface ActiveSitesCardProps {
  readonly items: ReadonlyArray<SiteCardItem>;
}

const STATUS_TONE: Record<SiteCardItem['status'], 'green' | 'amber' | 'red'> = {
  'on-track': 'green',
  watch: 'amber',
  behind: 'red',
};

const STATUS_LEAF: Record<
  SiteCardItem['status'],
  { readonly en: string; readonly sw: string }
> = {
  'on-track': S.sites.statusOnTrack,
  watch: S.sites.statusWatch,
  behind: S.sites.statusBehind,
};

export function ActiveSitesCard({ items }: ActiveSitesCardProps) {
  const locale = useLocale();
  return (
    <Card hoverable className="p-5 lg:col-span-2">
      <div className="cockpit-card-title">
        {pickByLocale(locale, S.sites.title)}
      </div>
      <ul className="flex flex-col gap-3">
        {items.map((site) => (
          <li
            key={site.name}
            className="flex items-start justify-between gap-3 border-b border-border/40 pb-2 last:border-b-0 last:pb-0"
          >
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">
                {site.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {site.headline}
              </div>
            </div>
            <span className="shrink-0">
              <StatusPill
                tone={STATUS_TONE[site.status]}
                label={pickByLocale(locale, STATUS_LEAF[site.status])}
              />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
