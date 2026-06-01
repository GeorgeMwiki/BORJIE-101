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
import { AskMwikilaCta } from './AskMwikilaCta';
import type { OwnerOSPanelProps } from './types';
import { ownerOsAStrings as S } from '@/i18n/strings/owner-os-a';
import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';

const ACCOUNTING_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'accounting',
  labelEn: 'Accounting',
  labelSw: S.accounting.descriptorLabel.sw,
  descriptionEn: 'Accounts payable, receivable and journal entries.',
  descriptionSw: S.accounting.descriptorDescription.sw,
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
      ...S.accounting.keywordsSw,
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
      labelSw: S.accounting.openJournalTool.sw,
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
        titleSw={S.accounting.heroTitle.sw}
        subtitleEn="Live journal feed off the LedgerService double-entry ledger; AP / AR ageing buckets."
        subtitleSw={S.accounting.heroSubtitle.sw}
        locale={locale}
      />
      <EmptyPanelBody
        icon={Calculator}
        titleEn="Accounting workspace landing soon"
        titleSw={S.accounting.emptyTitle.sw}
        bodyEn="Account ageing, journal browser and reconciliation queue will surface here once the /api/v1/accounting BFF is exposed. The LedgerService entries already exist; this panel is the surface contract."
        bodySw={S.accounting.emptyBody.sw}
        contractEn="GET /api/v1/accounting/ledger?range=30d"
        contractSw="GET /api/v1/accounting/ledger?range=30d"
        locale={locale}
      />
      <div className="flex justify-center">
        <AskMwikilaCta
          label={locale === 'sw' ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
          prompt={locale === 'sw' ? P.accounting.ask.sw : P.accounting.ask.en}
        />
      </div>
    </section>
  );
}
