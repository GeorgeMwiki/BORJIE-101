'use client';

import type { ReactElement } from 'react';
import { Building2 } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { CounterpartiesShell } from '@/components/counterparties/CounterpartiesShell';
import { PanelHero } from './PanelHero';
import type { OwnerOSPanelProps } from './types';

const COUNTERPARTIES_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'counterparties',
  labelEn: 'Counterparties',
  labelSw: 'Washirika wa Nje',
  descriptionEn:
    'Every external counterparty in the operation, with scorecard and engagement timeline.',
  descriptionSw:
    'Kila mshirika wa nje katika shughuli, pamoja na scorecard na ratiba ya engagement.',
  iconName: 'Building2',
  color: 'gold',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'counterparty',
      'partner',
      'supplier',
      'buyer',
      'processor',
      'smelter',
      'refiner',
      'assayer',
      'exporter',
      'transport',
      'off-taker',
      'mshirika',
      'wachakataji',
      'wasafirishaji',
    ],
    comboBoost: [{ phrases: ['processor', 'shipment'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'ops.external_parties.lookup',
      labelEn: 'Find counterparty',
      labelSw: 'Tafuta mshirika',
    },
    {
      toolId: 'ops.engagements.log',
      labelEn: 'Log engagement',
      labelSw: 'Andika mwingiliano',
    },
  ],
  briefSlices: ['marketplace', 'compliance'],
  rendererId: 'panel:counterparties',
};

registerTab(COUNTERPARTIES_DESCRIPTOR);

export const COUNTERPARTIES_PANEL_DESCRIPTOR = COUNTERPARTIES_DESCRIPTOR;

export function CounterpartiesPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-counterparties"
    >
      <PanelHero
        icon={Building2}
        color="gold"
        titleEn="Counterparties"
        titleSw="Washirika wa Nje"
        subtitleEn="Upstream offices, downstream processors, adjacent transport and regulators in one ledger."
        subtitleSw="Ofisi za awali, wachakataji wa baadaye, usafirishaji na wakaguzi katika rejista moja."
        locale={locale}
      />
      <CounterpartiesShell />
    </section>
  );
}
