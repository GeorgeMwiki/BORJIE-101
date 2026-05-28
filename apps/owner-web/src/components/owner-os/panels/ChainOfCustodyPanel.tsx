'use client';

import type { ReactElement } from 'react';
import { Link as LinkIcon } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ChainOfCustodyShell } from '@/components/chain-of-custody/ChainOfCustodyShell';
import { PanelHero } from './PanelHero';
import type { OwnerOSPanelProps } from './types';

const CHAIN_OF_CUSTODY_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'chain-of-custody',
  labelEn: 'Chain of custody',
  labelSw: 'Mlolongo wa Mali',
  descriptionEn:
    'Pit-to-buyer custody trail per ore parcel, hash-chain-audited so the regulator can verify it.',
  descriptionSw:
    'Mlolongo wa kifurushi kutoka shimo hadi mnunuzi, wenye ukaguzi wa hash-chain.',
  iconName: 'LinkIcon',
  color: 'success',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'chain of custody',
      'parcel',
      'custody',
      'pit to buyer',
      'shipment trail',
      'audit trail',
      'mlolongo',
      'kifurushi',
    ],
    comboBoost: [{ phrases: ['parcel', 'where'], boost: 0.25 }],
  },
  suggestedTools: [
    {
      toolId: 'ops.chain_of_custody.track',
      labelEn: 'Track parcel',
      labelSw: 'Fuatilia kifurushi',
    },
  ],
  briefSlices: ['audit-trail', 'marketplace'],
  rendererId: 'panel:chain-of-custody',
};

registerTab(CHAIN_OF_CUSTODY_DESCRIPTOR);

export const CHAIN_OF_CUSTODY_PANEL_DESCRIPTOR = CHAIN_OF_CUSTODY_DESCRIPTOR;

export function ChainOfCustodyPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-chain-of-custody"
    >
      <PanelHero
        icon={LinkIcon}
        color="success"
        titleEn="Chain of custody"
        titleSw="Mlolongo wa Mali"
        subtitleEn="Every step of a parcel from pit-stockpile to exporter, sealed by sha-256 hash."
        subtitleSw="Kila hatua ya kifurushi kutoka shimo hadi mnunuzi, imesalishwa kwa sha-256."
        locale={locale}
      />
      <ChainOfCustodyShell />
    </section>
  );
}
