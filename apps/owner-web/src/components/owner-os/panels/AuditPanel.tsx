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

const AUDIT_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'audit',
  labelEn: 'Audit',
  labelSw: 'Ukaguzi',
  descriptionEn: 'Hash-chained audit trail scoped to this tab context.',
  descriptionSw: 'Msururu wa ukaguzi wenye hash uliopangwa kwa muktadha.',
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
      'ukaguzi',
      'ushahidi',
    ],
    comboBoost: [{ phrases: ['audit', 'trail'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'audit.export-csv',
      labelEn: 'Export audit CSV',
      labelSw: 'Hamisha CSV ya ukaguzi',
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
          labelEn: `Scoped to: ${context.focus}`,
          labelSw: `Imepangwa kwa: ${context.focus}`,
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
        titleSw="Msururu wa ukaguzi"
        subtitleEn="Hash-chained, append-only ledger of every brain action, junior call and human approval."
        subtitleSw="Leja iliyo na hash, ya kuongeza tu, ya kila hatua ya brain, mwito wa junior na idhini ya binadamu."
        locale={locale}
        {...(focusChip ? { metaChips: focusChip } : {})}
      />
      <EmptyPanelBody
        icon={Scale}
        titleEn="Tab-scoped audit feed landing soon"
        titleSw="Mlolongo wa ukaguzi unakuja hivi karibuni"
        bodyEn="The audit-hash-chain package already records every action. This panel will surface a tab-scoped slice (filtered by siteId / licenceId / employeeId / focus) once the /api/v1/audit/feed contract is exposed."
        bodySw="Pakiti ya audit-hash-chain tayari inarekodi kila kitendo. Paneli hii itaonyesha sehemu iliyopangwa (kwa siteId / licenceId / employeeId / focus) mara tu mkataba wa /api/v1/audit/feed utakapozinduliwa."
        contractEn="GET /api/v1/audit/feed?focus=...&siteId=..."
        contractSw="GET /api/v1/audit/feed?focus=...&siteId=..."
        locale={locale}
      />
    </section>
  );
}
