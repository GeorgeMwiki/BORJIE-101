'use client';

import { useMemo, useState } from 'react';
import { Boxes, Filter } from 'lucide-react';
import {
  useEstateAssets,
  type EstateAssetRow,
} from '@/lib/queries/estate';
import { SectionCard } from '@/components/shared/SectionCard';
import { MetricStrip } from '@/components/shared/MetricStrip';

interface AssetsRegisterProps {
  readonly locale: 'sw' | 'en';
}

const CLASS_OPTIONS: ReadonlyArray<{
  readonly value: string;
  readonly labelEn: string;
  readonly labelSw: string;
}> = [
  { value: '', labelEn: 'All', labelSw: 'Zote' },
  { value: 'mining_licence', labelEn: 'Mining licence', labelSw: 'Leseni ya mgodi' },
  { value: 'land_parcel', labelEn: 'Land parcel', labelSw: 'Kiwanja' },
  { value: 'building', labelEn: 'Building', labelSw: 'Jengo' },
  { value: 'plant_equipment', labelEn: 'Plant / equipment', labelSw: 'Vifaa' },
  { value: 'vehicle', labelEn: 'Vehicle', labelSw: 'Gari' },
  { value: 'inventory', labelEn: 'Inventory', labelSw: 'Bidhaa' },
  {
    value: 'financial_instrument',
    labelEn: 'Financial instrument',
    labelSw: 'Chombo cha fedha',
  },
  {
    value: 'intellectual_property',
    labelEn: 'IP',
    labelSw: 'Haki miliki',
  },
  { value: 'goodwill', labelEn: 'Goodwill', labelSw: 'Sifa njema' },
  { value: 'crypto', labelEn: 'Crypto', labelSw: 'Sarafu za dijiti' },
  { value: 'other', labelEn: 'Other', labelSw: 'Nyingine' },
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
        {isSw ? 'Inapakia daftari la mali...' : 'Loading asset register...'}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-6 text-sm text-destructive">
        {isSw ? 'Imeshindwa kupakia mali.' : 'Could not load asset register.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MetricStrip
        cols={3}
        tiles={[
          {
            label: isSw ? 'Jumla ya thamani' : 'Total value',
            value: `TZS ${formatTzs(totalValue)}`,
            sub: isSw
              ? `Hai katika kichujio cha sasa`
              : `Active in current filter`,
            icon: Boxes,
          },
          {
            label: isSw ? 'Idadi ya mali' : 'Asset count',
            value: rows.length.toFixed(0),
            sub: isSw ? `Madarasa ${countByClass.size}` : `${countByClass.size} classes`,
          },
          {
            label: isSw ? 'Thamani wastani' : 'Average value',
            value: rows.length
              ? `TZS ${formatTzs(totalValue / rows.length)}`
              : 'TZS 0',
          },
        ]}
      />
      <SectionCard
        title={isSw ? 'Daftari la mali' : 'Asset register'}
        subtitle={
          isSw
            ? 'Chuja kwa darasa la mali, fungua safu kuona historia ya thamani.'
            : 'Filter by asset class, open a row for valuation history.'
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
            {isSw
              ? 'Hakuna mali kwenye kichujio cha sasa.'
              : 'No assets match the current filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface/60 text-tiny uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-5 py-2 text-left">
                    {isSw ? 'Maelezo' : 'Descriptor'}
                  </th>
                  <th className="px-5 py-2 text-left">
                    {isSw ? 'Darasa' : 'Class'}
                  </th>
                  <th className="px-5 py-2 text-right">
                    {isSw ? 'Thamani (TZS)' : 'Value (TZS)'}
                  </th>
                  <th className="px-5 py-2 text-left">
                    {isSw ? 'Mbinu' : 'Method'}
                  </th>
                  <th className="px-5 py-2 text-left">
                    {isSw ? 'Tathmini ya' : 'Valued at'}
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
