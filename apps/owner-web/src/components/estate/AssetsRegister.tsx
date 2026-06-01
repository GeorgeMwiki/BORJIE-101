'use client';

import { useMemo, useState } from 'react';
import { Boxes, Filter } from 'lucide-react';
import {
  useEstateAssets,
  type EstateAssetRow,
} from '@/lib/queries/estate';
import { SectionCard } from '@/components/shared/SectionCard';
import { MetricStrip } from '@/components/shared/MetricStrip';
import { dataAStrings as S } from '@/i18n/strings/data-a';

interface AssetsRegisterProps {
  readonly locale: 'sw' | 'en';
}

const CLASS_OPTIONS: ReadonlyArray<{
  readonly value: string;
  readonly labelEn: string;
  readonly labelSw: string;
}> = [
  { value: '', labelEn: S.assets.classOptions.all.en, labelSw: S.assets.classOptions.all.sw },
  {
    value: 'mining_licence',
    labelEn: S.assets.classOptions.miningLicence.en,
    labelSw: S.assets.classOptions.miningLicence.sw,
  },
  {
    value: 'land_parcel',
    labelEn: S.assets.classOptions.landParcel.en,
    labelSw: S.assets.classOptions.landParcel.sw,
  },
  {
    value: 'building',
    labelEn: S.assets.classOptions.building.en,
    labelSw: S.assets.classOptions.building.sw,
  },
  {
    value: 'plant_equipment',
    labelEn: S.assets.classOptions.plantEquipment.en,
    labelSw: S.assets.classOptions.plantEquipment.sw,
  },
  {
    value: 'vehicle',
    labelEn: S.assets.classOptions.vehicle.en,
    labelSw: S.assets.classOptions.vehicle.sw,
  },
  {
    value: 'inventory',
    labelEn: S.assets.classOptions.inventory.en,
    labelSw: S.assets.classOptions.inventory.sw,
  },
  {
    value: 'financial_instrument',
    labelEn: S.assets.classOptions.financialInstrument.en,
    labelSw: S.assets.classOptions.financialInstrument.sw,
  },
  {
    value: 'intellectual_property',
    labelEn: S.assets.classOptions.intellectualProperty.en,
    labelSw: S.assets.classOptions.intellectualProperty.sw,
  },
  {
    value: 'goodwill',
    labelEn: S.assets.classOptions.goodwill.en,
    labelSw: S.assets.classOptions.goodwill.sw,
  },
  {
    value: 'crypto',
    labelEn: S.assets.classOptions.crypto.en,
    labelSw: S.assets.classOptions.crypto.sw,
  },
  {
    value: 'other',
    labelEn: S.assets.classOptions.other.en,
    labelSw: S.assets.classOptions.other.sw,
  },
];

/**
 * Asset register table — filterable by class. The current-value
 * summary at the top shows total TZS and count for the active filter.
 */
export function AssetsRegister({ locale }: AssetsRegisterProps) {
  const [assetClass, setAssetClass] = useState<string>('');
  const query = useEstateAssets({
    ...(assetClass ? { assetClass } : {}),
    limit: 500,
  });
  const isSw = locale === 'sw';

  const rows: ReadonlyArray<EstateAssetRow> = query.data?.data?.assets ?? [];
  const totalValue = useMemo(
    () => rows.reduce((sum, a) => sum + Number(a.currentValueTzs ?? 0), 0),
    [rows],
  );
  const countByClass = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of rows) m.set(a.assetClass, (m.get(a.assetClass) ?? 0) + 1);
    return m;
  }, [rows]);

  if (query.isLoading) {
    return (
      <div className="rounded-lg border border-border bg-surface px-6 py-10 text-sm text-neutral-400">
        {isSw ? S.assets.loading.sw : S.assets.loading.en}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-6 text-sm text-destructive">
        {isSw ? S.assets.loadError.sw : S.assets.loadError.en}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MetricStrip
        cols={3}
        tiles={[
          {
            label: isSw ? S.assets.totalValueLabel.sw : S.assets.totalValueLabel.en,
            value: `TZS ${formatTzs(totalValue)}`,
            sub: isSw ? S.assets.totalValueSub.sw : S.assets.totalValueSub.en,
            icon: Boxes,
          },
          {
            label: isSw ? S.assets.assetCountLabel.sw : S.assets.assetCountLabel.en,
            value: rows.length.toFixed(0),
            sub: isSw
              ? S.assets.assetCountSub(countByClass.size).sw
              : S.assets.assetCountSub(countByClass.size).en,
          },
          {
            label: isSw ? S.assets.averageValueLabel.sw : S.assets.averageValueLabel.en,
            value: rows.length
              ? `TZS ${formatTzs(totalValue / rows.length)}`
              : 'TZS 0',
          },
        ]}
      />
      <SectionCard
        title={isSw ? S.assets.registerTitle.sw : S.assets.registerTitle.en}
        subtitle={
          isSw ? S.assets.registerSubtitle.sw : S.assets.registerSubtitle.en
        }
        actions={
          <div className="inline-flex items-center gap-2">
            <Filter className="h-4 w-4 text-neutral-500" />
            <select
              value={assetClass}
              onChange={(e) => setAssetClass(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground"
            >
              {CLASS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {isSw ? opt.labelSw : opt.labelEn}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-sm text-neutral-500">
            {isSw ? S.assets.emptyFilter.sw : S.assets.emptyFilter.en}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface/60 text-tiny uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-5 py-2 text-left">
                    {isSw ? S.assets.colDescriptor.sw : S.assets.colDescriptor.en}
                  </th>
                  <th className="px-5 py-2 text-left">
                    {isSw ? S.assets.colClass.sw : S.assets.colClass.en}
                  </th>
                  <th className="px-5 py-2 text-right">
                    {isSw ? S.assets.colValue.sw : S.assets.colValue.en}
                  </th>
                  <th className="px-5 py-2 text-left">
                    {isSw ? S.assets.colMethod.sw : S.assets.colMethod.en}
                  </th>
                  <th className="px-5 py-2 text-left">
                    {isSw ? S.assets.colValuedAt.sw : S.assets.colValuedAt.en}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="px-5 py-2 text-foreground">{a.descriptor}</td>
                    <td className="px-5 py-2 text-neutral-300">
                      {a.assetClass}
                    </td>
                    <td className="px-5 py-2 text-right font-medium text-foreground">
                      {formatTzs(Number(a.currentValueTzs))}
                    </td>
                    <td className="px-5 py-2 text-neutral-300">
                      {a.valuationMethod}
                    </td>
                    <td className="px-5 py-2 text-neutral-500">
                      {new Date(a.valuationAt).toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function formatTzs(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(amount / 1_000).toFixed(0)}K`;
  return amount.toFixed(0);
}
