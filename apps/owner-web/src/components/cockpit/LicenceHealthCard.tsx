'use client';

import { Card } from '@borjie/design-system';

import { StatusPill } from '@/components/shared/StatusPill';
import { useLocale, pickByLocale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

interface LicenceHealthCardProps {
  readonly active: number;
  readonly renewalsDue60d: number;
  readonly dormancyFlags: number;
}

export function LicenceHealthCard({
  active,
  renewalsDue60d,
  dormancyFlags,
}: LicenceHealthCardProps) {
  const locale = useLocale();
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">
        {pickByLocale(locale, S.licence.title)}
      </div>
      <div className="cockpit-card-value">{active}</div>
      <div className="cockpit-card-meta">
        {pickByLocale(locale, S.licence.activeRights)}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <StatusPill
          tone="amber"
          label={pickByLocale(locale, S.licence.renewals(renewalsDue60d))}
        />
        {dormancyFlags > 0 ? (
          <StatusPill
            tone="red"
            label={pickByLocale(locale, S.licence.dormancy(dormancyFlags))}
          />
        ) : null}
      </div>
    </Card>
  );
}
