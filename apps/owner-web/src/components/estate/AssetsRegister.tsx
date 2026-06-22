'use client';

import { useMemo, useState } from 'react';
import { Boxes, Filter } from 'lucide-react';
import {
  Skeleton,
  Alert,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@borjie/design-system';
import {
  useEstateAssets,
  type EstateAssetRow,
} from '@/lib/queries/estate';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { MetricStrip } from '@/components/shared/MetricStrip';
import { formatMoney, formatLargeMoney, LAUNCH_CURRENCY } from '@/lib/format';
import { pickByLocale } from '@/lib/locale-shared';
import type { Locale } from '@/lib/locale-shared';
import { dataAStrings as S } from '@/i18n/strings/data-a';

interface AssetsRegisterProps {
  readonly locale: Locale;
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
      <div className="space-y-6" aria-busy="true">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl border border-border" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl border border-border" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <Alert variant="error">
        {pickByLocale(locale, S.assets.loadError)}
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <MetricStrip
        cols={3}
        tiles={[
          {
            label: isSw ? S.assets.totalValueLabel.sw : S.assets.totalValueLabel.en,
            value: formatLargeMoney(totalValue, LAUNCH_CURRENCY, locale),
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
              ? formatLargeMoney(totalValue / rows.length, LAUNCH_CURRENCY, locale)
              : formatMoney(0, LAUNCH_CURRENCY, locale),
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
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select
              value={assetClass || 'all'}
              onValueChange={(v) => setAssetClass(v === 'all' ? '' : v)}
            >
              <SelectTrigger
                className="h-8 w-auto min-w-[10rem] text-xs"
                aria-label={pickByLocale(locale, S.assets.filterAria)}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLASS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value || 'all'}>
                    {isSw ? opt.labelSw : opt.labelEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        {rows.length === 0 ? (
          <ScreenEmptyState
            icon={<Boxes className="h-6 w-6" />}
            title={pickByLocale(locale, S.assets.emptyTitle)}
            description={pickByLocale(locale, S.assets.emptyFilter)}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pickByLocale(locale, S.assets.colDescriptor)}</TableHead>
                <TableHead>{pickByLocale(locale, S.assets.colClass)}</TableHead>
                <TableHead className="text-right">
                  {pickByLocale(locale, S.assets.colValue)}
                </TableHead>
                <TableHead>{pickByLocale(locale, S.assets.colMethod)}</TableHead>
                <TableHead>{pickByLocale(locale, S.assets.colValuedAt)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-foreground">{a.descriptor}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.assetClass}
                  </TableCell>
                  <TableCell className="text-right font-medium text-foreground">
                    {formatLargeMoney(Number(a.currentValueTzs), LAUNCH_CURRENCY, locale)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.valuationMethod}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(a.valuationAt).toISOString().slice(0, 10)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
