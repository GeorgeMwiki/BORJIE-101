'use client';

import type { ReactElement } from 'react';
import { Database } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { PanelDataTable, type PanelColumn } from './PanelDataTable';
import { AskMwikilaCta } from './AskMwikilaCta';
import type { OwnerOSPanelProps } from './types';
import { ownerOsAStrings as S } from '@/i18n/strings/owner-os-a';
import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';
import { useEstateAssets, type EstateAssetRow } from '@/lib/queries/estate';
import { formatMoney, LAUNCH_CURRENCY } from '@/lib/format';
import type { Locale } from '@/lib/locale-shared';

const ASSET_REGISTER_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'asset-register',
  labelEn: 'Asset register',
  labelSw: S.assetRegister.descriptorLabel.sw,
  descriptionEn: 'Inventory, valuation, insurance, and encumbrances.',
  descriptionSw: S.assetRegister.descriptorDescription.sw,
  iconName: 'Database',
  color: 'success',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'asset register',
      'inventory of assets',
      'net worth',
      'valuation',
      'insured',
      'encumbrance',
      'collateral',
      'property register',
      'asset list',
      ...S.assetRegister.keywordsSw,
    ],
    patterns: [/asset\s+register|net\s+worth|asset\s+inventory/i],
    comboBoost: [
      { phrases: ['asset', 'register'], boost: 0.2 },
      { phrases: ['net', 'worth'], boost: 0.15 },
      { phrases: ['valuation', 'insurance'], boost: 0.1 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'estate.browse_assets',
      labelEn: 'Browse asset register',
      labelSw: S.assetRegister.browseTool.sw,
    },
    {
      toolId: 'estate.net_worth_summary',
      labelEn: 'View net worth summary',
      labelSw: S.assetRegister.netWorthTool.sw,
    },
  ],
  briefSlices: [],
  rendererId: 'panel:asset-register',
};

registerTab(ASSET_REGISTER_DESCRIPTOR);

function assetValue(raw: string, locale: Locale): string {
  const n = Number(raw);
  return Number.isFinite(n) ? formatMoney(n, LAUNCH_CURRENCY, locale) : raw;
}

function assetColumns(
  isSw: boolean,
  locale: Locale,
): ReadonlyArray<PanelColumn<EstateAssetRow>> {
  return [
    {
      key: 'descriptor',
      header: isSw ? P.assetRegister.colDescriptor.sw : P.assetRegister.colDescriptor.en,
      render: (r) => r.descriptor,
    },
    {
      key: 'class',
      header: isSw ? P.assetRegister.colClass.sw : P.assetRegister.colClass.en,
      render: (r) => r.assetClass,
    },
    {
      key: 'value',
      header: isSw ? P.assetRegister.colValue.sw : P.assetRegister.colValue.en,
      alignRight: true,
      render: (r) => assetValue(r.currentValueTzs, locale),
    },
    {
      key: 'method',
      header: isSw ? P.assetRegister.colMethod.sw : P.assetRegister.colMethod.en,
      render: (r) => r.valuationMethod,
    },
  ];
}

export function AssetRegisterPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const { data, isLoading, isError, refetch } = useEstateAssets();
  const rows = data?.data.assets ?? [];
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-asset-register"
    >
      <PanelHero
        icon={Database}
        color="success"
        titleEn="Asset register — inventory and valuation"
        titleSw={S.assetRegister.heroTitle.sw}
        subtitleEn="Maintain a complete register of assets, valuations, insurance, and encumbrances."
        subtitleSw={S.assetRegister.heroSubtitle.sw}
        locale={locale}
      />
      <PanelDataTable
        isSw={isSw}
        isLoading={isLoading}
        isError={isError}
        rows={rows}
        columns={assetColumns(isSw, locale)}
        rowKey={(r) => r.id}
        emptyTitle={
          isSw ? P.assetRegister.emptyTitle.sw : P.assetRegister.emptyTitle.en
        }
        emptyBody={
          isSw ? P.assetRegister.emptyBody.sw : P.assetRegister.emptyBody.en
        }
        emptyAction={
          <AskMwikilaCta
            label={isSw ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
            prompt={isSw ? P.assetRegister.ask.sw : P.assetRegister.ask.en}
          />
        }
        onRetry={() => void refetch()}
      />
    </section>
  );
}
