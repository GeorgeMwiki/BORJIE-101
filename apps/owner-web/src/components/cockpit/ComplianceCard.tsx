'use client';

import { Card } from '@borjie/design-system';

import { StatusPill } from '@/components/shared/StatusPill';
import { useLocale, pickByLocale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

interface ComplianceCardProps {
  readonly green: number;
  readonly amber: number;
  readonly red: number;
}

export function ComplianceCard({ green, amber, red }: ComplianceCardProps) {
  const locale = useLocale();
  const total = green + amber + red;
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">
        {pickByLocale(locale, S.compliance.title)}
      </div>
      <div className="cockpit-card-value">{total}</div>
      <div className="cockpit-card-meta">
        {pickByLocale(locale, S.compliance.obligations)}
      </div>
      <div className="mt-3 flex gap-1.5">
        <StatusPill tone="green" label={pickByLocale(locale, S.compliance.green(green))} />
        <StatusPill tone="amber" label={pickByLocale(locale, S.compliance.amber(amber))} />
        <StatusPill tone="red" label={pickByLocale(locale, S.compliance.red(red))} />
      </div>
    </Card>
  );
}
