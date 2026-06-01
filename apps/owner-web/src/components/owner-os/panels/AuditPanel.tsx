'use client';

import type { ReactElement } from 'react';
import { Scale } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { PanelDataTable, type PanelColumn } from './PanelDataTable';
import type { OwnerOSPanelProps } from './types';
import { ownerOsAStrings as S } from '@/i18n/strings/owner-os-a';
import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';
import { useAuditEntries, type AuditEntryRow } from '@/lib/queries/audit-trail';
import { fmtDate } from '@/lib/format';

const AUDIT_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'audit',
  labelEn: 'Audit',
  labelSw: S.audit.descriptorLabel.sw,
  descriptionEn: 'Hash-chained audit trail scoped to this tab context.',
  descriptionSw: S.audit.descriptorDescription.sw,
  iconName: 'Scale',
  color: 'info',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'audit',
      'audit trail',
      'chain',
      'hash',
      'evidence',
      'provenance',
      'who did',
      ...S.audit.keywordsSw,
    ],
    comboBoost: [{ phrases: ['audit', 'trail'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'audit.export-csv',
      labelEn: 'Export audit CSV',
      labelSw: S.audit.exportTool.sw,
    },
  ],
  briefSlices: ['audit-trail'],
  rendererId: 'panel:audit',
};

registerTab(AUDIT_DESCRIPTOR);

export const AUDIT_PANEL_DESCRIPTOR = AUDIT_DESCRIPTOR;

function auditColumns(isSw: boolean): ReadonlyArray<PanelColumn<AuditEntryRow>> {
  return [
    {
      key: 'action',
      header: isSw ? P.audit.colAction.sw : P.audit.colAction.en,
      render: (r) => r.actionKind,
    },
    {
      key: 'actor',
      header: isSw ? P.audit.colActor.sw : P.audit.colActor.en,
      render: (r) => r.actorDisplay ?? r.actorKind,
    },
    {
      key: 'category',
      header: isSw ? P.audit.colCategory.sw : P.audit.colCategory.en,
      render: (r) => r.actionCategory,
    },
    {
      key: 'when',
      header: isSw ? P.audit.colWhen.sw : P.audit.colWhen.en,
      render: (r) => fmtDate(r.occurredAt),
    },
  ];
}

export function AuditPanel({
  locale,
  context,
}: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  // The tab's `focus` scopes the feed to a single subject when present.
  const focus = typeof context.focus === 'string' ? context.focus : undefined;
  const { data, isLoading, isError, refetch } = useAuditEntries(
    focus ? { subjectId: focus } : undefined,
  );
  const rows = data ?? [];
  const focusChip = context.focus
    ? [
        {
          labelEn: `${S.audit.scopedToPrefix.en}${context.focus}`,
          labelSw: `${S.audit.scopedToPrefix.sw}${context.focus}`,
          tone: 'neutral' as const,
        },
      ]
    : undefined;
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-audit"
    >
      <PanelHero
        icon={Scale}
        color="info"
        titleEn="Audit trail"
        titleSw={S.audit.heroTitle.sw}
        subtitleEn="Hash-chained, append-only ledger of every brain action, junior call and human approval."
        subtitleSw={S.audit.heroSubtitle.sw}
        locale={locale}
        {...(focusChip ? { metaChips: focusChip } : {})}
      />
      <PanelDataTable
        isSw={isSw}
        isLoading={isLoading}
        isError={isError}
        rows={rows}
        columns={auditColumns(isSw)}
        rowKey={(r) => r.id}
        emptyTitle={isSw ? P.audit.emptyTitle.sw : P.audit.emptyTitle.en}
        emptyBody={isSw ? P.audit.emptyBody.sw : P.audit.emptyBody.en}
        onRetry={() => void refetch()}
      />
    </section>
  );
}
