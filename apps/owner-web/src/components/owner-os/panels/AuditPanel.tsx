'use client';

import type { ReactElement } from 'react';
import { Scale } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';
import { ownerOsAStrings as S } from '@/i18n/strings/owner-os-a';

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

export function AuditPanel({
  locale,
  context,
}: OwnerOSPanelProps): ReactElement {
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
      <EmptyPanelBody
        icon={Scale}
        titleEn="Tab-scoped audit feed landing soon"
        titleSw={S.audit.emptyTitle.sw}
        bodyEn="The audit-hash-chain package already records every action. This panel will surface a tab-scoped slice (filtered by siteId / licenceId / employeeId / focus) once the /api/v1/audit/feed contract is exposed."
        bodySw={S.audit.emptyBody.sw}
        contractEn="GET /api/v1/audit/feed?focus=...&siteId=..."
        contractSw="GET /api/v1/audit/feed?focus=...&siteId=..."
        locale={locale}
      />
    </section>
  );
}
