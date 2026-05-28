'use client';

import type { ReactElement } from 'react';
import { Calculator } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';

const ACCOUNTING_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'accounting',
  labelEn: 'Accounting',
  labelSw: 'Uhasibu',
  descriptionEn: 'Accounts payable, receivable and journal entries.',
  descriptionSw: 'Hesabu za kulipa, kupokea na maandiko ya leja.',
  iconName: 'Calculator',
  color: 'navy',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'accounting',
      'ledger',
      'journal',
      'invoice',
      'receivable',
      'payable',
      'ap',
      'ar',
      'reconcile',
      'uhasibu',
      'leja',
    ],
    comboBoost: [
      { phrases: ['accounts', 'payable'], boost: 0.2 },
      { phrases: ['accounts', 'receivable'], boost: 0.2 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'accounting.open-journal',
      labelEn: 'Open journal',
      labelSw: 'Fungua leja',
    },
  ],
  briefSlices: ['cashflow', 'audit-trail'],
  rendererId: 'panel:accounting',
};

registerTab(ACCOUNTING_DESCRIPTOR);

export const ACCOUNTING_PANEL_DESCRIPTOR = ACCOUNTING_DESCRIPTOR;

export function AccountingPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-accounting"
    >
      <PanelHero
        icon={Calculator}
        color="navy"
        titleEn="Accounting"
        titleSw="Uhasibu"
        subtitleEn="Live journal feed off the LedgerService double-entry ledger; AP / AR ageing buckets."
        subtitleSw="Mlolongo wa moja kwa moja wa leja toka LedgerService; vipindi vya AP / AR vya umri."
        locale={locale}
      />
      <EmptyPanelBody
        icon={Calculator}
        titleEn="Accounting workspace landing soon"
        titleSw="Eneo la uhasibu linakuja hivi karibuni"
        bodyEn="Account ageing, journal browser and reconciliation queue will surface here once the /api/v1/accounting BFF is exposed. The LedgerService entries already exist; this panel is the surface contract."
        bodySw="Vipindi vya hesabu, kivinjari cha leja na orodha ya ulinganishaji vitaonekana hapa mara tu BFF ya /api/v1/accounting itakapozinduliwa. Maandiko ya LedgerService tayari yapo; paneli hii ni mkataba wa muonekano."
        contractEn="GET /api/v1/accounting/ledger?range=30d"
        contractSw="GET /api/v1/accounting/ledger?range=30d"
        locale={locale}
      />
    </section>
  );
}
