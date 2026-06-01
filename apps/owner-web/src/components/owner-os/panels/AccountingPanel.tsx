'use client';

import type { ReactElement } from 'react';
import { Calculator } from 'lucide-react';
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
import { ownerOsBffStrings as B } from '@/i18n/strings/owner-os-bff';
import { useAccountingLedger, type AccountingLedgerRow } from '@/lib/queries/accounting';

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

function accountingColumns(
  isSw: boolean,
): ReadonlyArray<PanelColumn<AccountingLedgerRow>> {
  return [
    {
      key: 'postedAt',
      header: isSw ? B.accounting.colDate.sw : B.accounting.colDate.en,
      render: (r) => r.postedAt,
    },
    {
      key: 'account',
      header: isSw ? B.accounting.colAccount.sw : B.accounting.colAccount.en,
      render: (r) => r.account,
    },
    {
      key: 'amount',
      header: isSw ? B.accounting.colAmount.sw : B.accounting.colAmount.en,
      alignRight: true,
      render: (r) => r.amount ?? '—',
    },
  ];
}

export function AccountingPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const { data, isLoading, isError, refetch } = useAccountingLedger();
  const rows = data ?? [];
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-accounting"
    >
      <PanelHero
        icon={Calculator}
        color="navy"
        titleEn={B.accounting.heroTitle.en}
        titleSw={B.accounting.heroTitle.sw}
        subtitleEn={B.accounting.heroSubtitle.en}
        subtitleSw={B.accounting.heroSubtitle.sw}
        locale={locale}
      />
      <PanelDataTable
        isSw={isSw}
        isLoading={isLoading}
        isError={isError}
        rows={rows}
        columns={accountingColumns(isSw)}
        rowKey={(r) => r.id}
        emptyTitle={isSw ? B.accounting.emptyTitle.sw : B.accounting.emptyTitle.en}
        emptyBody={isSw ? B.accounting.emptyBody.sw : B.accounting.emptyBody.en}
        emptyAction={
          <AskMwikilaCta
            label={isSw ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
            prompt={isSw ? P.accounting.ask.sw : P.accounting.ask.en}
          />
        }
        onRetry={() => void refetch()}
      />
    </section>
  );
}
