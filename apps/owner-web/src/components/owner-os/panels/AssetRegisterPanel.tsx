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

const ASSET_REGISTER_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'asset-register',
  labelEn: 'Asset register',
  labelSw: 'Daftari ya Mali',
  descriptionEn: 'Inventory, valuation, insurance, and encumbrances.',
  descriptionSw: 'Orodha, thamini, bima, na mzigo wa mali.',
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
      'daftari',
      'mali',
      'thamini',
      'bima',
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
      labelSw: 'Karamu daftari ya mali',
    },
    {
      toolId: 'estate.net_worth_summary',
      labelEn: 'View net worth summary',
      labelSw: 'Angalia muhtasari wa thamini halisi',
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
        titleSw="Daftari ya Mali — orodha na thamini"
        subtitleEn="Maintain a complete register of assets, valuations, insurance, and encumbrances."
        subtitleSw="Simamia daftari kamili ya mali, thamini, bima, na mzigo wa mali."
        locale={locale}
      />
      <EmptyPanelBody
        titleEn="No assets registered yet"
        titleSw="Hakuna mali iliyosajiliwa bado"
        descriptionEn="Add your assets to create a complete register and calculate net worth."
        descriptionSw="Ongeza mali yako kutengeneza daftari kamili na kukamatia thamini halisi."
        ctaEn="Add asset"
        ctaSw="Ongeza mali"
        locale={locale}
      />
    </section>
  );
}
