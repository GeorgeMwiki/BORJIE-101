'use client';

import type { ReactElement } from 'react';
import { FileText } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { PanelDataTable, type PanelColumn } from './PanelDataTable';
import { AskMwikilaCta } from './AskMwikilaCta';
import { enumLabelSw } from './enum-label';
import type { OwnerOSPanelProps } from './types';
import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';
import { ownerOsBffStrings as B } from '@/i18n/strings/owner-os-bff';
import { useLegalContracts, type LegalContractRow } from '@/lib/queries/legal';

const LEGAL_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'legal',
  labelEn: 'Legal',
  labelSw: B.legal.descriptorLabel.sw,
  descriptionEn: 'Contracts library, draft inbox and counsel response queue.',
  descriptionSw: B.legal.descriptorDescription.sw,
  iconName: 'FileText',
  color: 'navy',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'legal',
      'contract',
      'agreement',
      'lawsuit',
      'counsel',
      'attorney',
      'dispute',
      'sheria',
      'mkataba',
      'wakili',
    ],
    comboBoost: [{ phrases: ['draft', 'contract'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'legal.draft-contract',
      labelEn: 'Draft contract',
      labelSw: B.legal.draftContractTool.sw,
    },
  ],
  briefSlices: ['audit-trail'],
  rendererId: 'panel:legal',
};

registerTab(LEGAL_DESCRIPTOR);

export const LEGAL_PANEL_DESCRIPTOR = LEGAL_DESCRIPTOR;

function legalColumns(
  isSw: boolean,
): ReadonlyArray<PanelColumn<LegalContractRow>> {
  return [
    {
      key: 'title',
      header: isSw ? B.legal.colTitle.sw : B.legal.colTitle.en,
      render: (r) => r.title,
    },
    {
      key: 'counterparty',
      header: isSw ? B.legal.colCounterparty.sw : B.legal.colCounterparty.en,
      render: (r) => r.counterparty ?? '—',
    },
    {
      key: 'status',
      header: isSw ? B.legal.colStatus.sw : B.legal.colStatus.en,
      render: (r) => enumLabelSw('legalContractStatus', r.status, isSw),
    },
  ];
}

export function LegalPanel({ locale }: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const { data, isLoading, isError, refetch } = useLegalContracts();
  const rows = data ?? [];
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-legal"
    >
      <PanelHero
        icon={FileText}
        color="navy"
        titleEn={B.legal.heroTitle.en}
        titleSw={B.legal.heroTitle.sw}
        subtitleEn={B.legal.heroSubtitle.en}
        subtitleSw={B.legal.heroSubtitle.sw}
        locale={locale}
      />
      <PanelDataTable
        isSw={isSw}
        isLoading={isLoading}
        isError={isError}
        rows={rows}
        columns={legalColumns(isSw)}
        rowKey={(r) => r.id}
        emptyTitle={isSw ? B.legal.emptyTitle.sw : B.legal.emptyTitle.en}
        emptyBody={isSw ? B.legal.emptyBody.sw : B.legal.emptyBody.en}
        emptyAction={
          <AskMwikilaCta
            label={isSw ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
            prompt={isSw ? P.legal.ask.sw : P.legal.ask.en}
          />
        }
        onRetry={() => void refetch()}
      />
    </section>
  );
}
