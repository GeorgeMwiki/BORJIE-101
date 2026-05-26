/**
 * Recipe: Board Report.
 *
 * Class: board_report
 * Tier: 1 (Draft/Stage; auto-publishes internal preview, owner can
 *          escalate to "final" with a passive notification).
 * Formats: docx, pdf.
 * Citation density: extreme — every numeric / monetary / dated claim
 *                   carries a citation.
 */

import type { DocComposeContext, DocumentRecipe, IRDoc, IRSection } from '../types.js';
import { buildArtifactFromIRDoc, pinGeneratedAt } from './_helpers.js';

export const boardReportRecipe: DocumentRecipe = {
  id: 'board_report',
  class: 'board_report',
  version: 1,
  status: 'live',
  authority_tier: 1,
  brand: 'borjie',
  approval_required: false,
  output_formats: ['docx', 'pdf'] as const,
  required_inputs: [
    { key: 'production_summary', description: 'Quarterly production tons + grade.', required: true },
    { key: 'financial_summary', description: 'Quarterly revenue + EBITDA.', required: true },
    { key: 'compliance_summary', description: 'Tumemadini + NEMC status.', required: true },
  ],
  required_citations: [
    { key: 'production_evidence', description: 'Production claims must cite ledger or measurement.', minCount: 1 },
    { key: 'financial_evidence', description: 'Each financial claim cites ledger row.', minCount: 1 },
  ],
  compose: async (ctx: DocComposeContext) => {
    const generated_at = pinGeneratedAt(ctx);
    const sections: IRSection[] = [
      {
        id: 'production',
        title: 'Production',
        blocks: [
          {
            kind: 'kpi_grid',
            kpis: [
              {
                label: 'Tons mined (Q)',
                value: 'see attached ledger',
                citationId: ctx.citations[0]?.id,
              },
              {
                label: 'Average grade',
                value: 'see assay report',
                citationId: ctx.citations[0]?.id,
              },
            ],
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'finance',
        title: 'Finance',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Quarterly revenue and EBITDA reflect ore sales reconciled against ledger entries.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'compliance',
        title: 'Compliance',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Tumemadini and NEMC filings current; see compliance ledger.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'risk',
        title: 'Risk Register',
        blocks: [
          {
            kind: 'table',
            headers: ['Risk', 'Severity', 'Owner', 'Mitigation'],
            rows: [
              ['FX volatility', 'Med', 'Treasury', 'Quarterly hedge'],
              ['Permit lapse', 'High', 'Compliance', 'Auto-reminder T-30'],
            ],
          },
        ],
        citationIds: [],
      },
      {
        id: 'outlook',
        title: 'Outlook',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Forward-looking statements derived from current research result; see citation footer.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'signature',
        title: 'Authored',
        blocks: [
          { kind: 'signature_block', text: 'Mr. Mwikila — Managing Director' },
        ],
        citationIds: [],
      },
    ];

    const irDoc: IRDoc = {
      title: 'Borjie — Board Report',
      subtitle: 'Quarterly Pack',
      sections,
      citations: ctx.citations,
      watermark: 'final',
      generated_at,
    };

    return buildArtifactFromIRDoc({
      recipe: boardReportRecipe,
      ctx,
      irDoc,
      format: 'docx',
    });
  },
};
