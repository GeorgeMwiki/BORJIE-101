'use client';

import type { ReactElement } from 'react';
import { Database } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';
import { ownerOsAStrings as S } from '@/i18n/strings/owner-os-a';

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

export function AssetRegisterPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
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
      <EmptyPanelBody
        titleEn="No assets registered yet"
        titleSw={S.assetRegister.emptyTitle.sw}
        descriptionEn="Add your assets to create a complete register and calculate net worth."
        descriptionSw={S.assetRegister.emptyDescription.sw}
        ctaEn="Add asset"
        ctaSw={S.assetRegister.emptyCta.sw}
        locale={locale}
      />
    </section>
  );
}
