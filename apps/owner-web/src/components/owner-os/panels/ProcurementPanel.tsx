'use client';

import type { ReactElement } from 'react';
import { ShoppingCart } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';

const PROCUREMENT_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'procurement',
  labelEn: 'Procurement',
  labelSw: 'Manunuzi',
  descriptionEn: 'Suppliers, open purchase orders and 3-quote workflow.',
  descriptionSw: 'Wauzaji, oda zilizo wazi na utaratibu wa nukuu tatu.',
  iconName: 'ShoppingCart',
  color: 'cream',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'procurement',
      'supplier',
      'vendor',
      'purchase order',
      'po',
      'quote',
      'rfq',
      'buy',
      'manunuzi',
      'muuzaji',
      'oda',
    ],
    comboBoost: [{ phrases: ['purchase', 'order'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'procurement.draft-rfq',
      labelEn: 'Draft RFQ',
      labelSw: 'Tayarisha RFQ',
    },
  ],
  briefSlices: ['cashflow'],
  rendererId: 'panel:procurement',
};

registerTab(PROCUREMENT_DESCRIPTOR);

export const PROCUREMENT_PANEL_DESCRIPTOR = PROCUREMENT_DESCRIPTOR;

export function ProcurementPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-procurement"
    >
      <PanelHero
        icon={ShoppingCart}
        color="cream"
        titleEn="Procurement"
        titleSw="Manunuzi"
        subtitleEn="Approved suppliers, open POs and the 3-quote workflow that backs every purchase decision."
        subtitleSw="Wauzaji walioidhinishwa, oda zilizo wazi na utaratibu wa nukuu tatu unaounga mkono manunuzi."
        locale={locale}
      />
      <EmptyPanelBody
        icon={ShoppingCart}
        titleEn="Procurement BFF coming soon"
        titleSw="BFF ya manunuzi inakuja hivi karibuni"
        bodyEn="Approved-supplier list and open-PO board will surface here once the /api/v1/procurement BFF is exposed. Until then, brain spawns will open this tab and pre-populate the focus context for the next hand-off."
        bodySw="Orodha ya wauzaji walioidhinishwa na ubao wa oda zilizo wazi vitaonekana hapa mara tu BFF ya /api/v1/procurement itakapozinduliwa. Hadi hapo, brain itafungua paneli hii na kuweka muktadha kabla ya kutuma."
        contractEn="GET /api/v1/procurement/{suppliers|pos|rfqs}"
        contractSw="GET /api/v1/procurement/{suppliers|pos|rfqs}"
        locale={locale}
      />
    </section>
  );
}
