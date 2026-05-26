/**
 * Recipe: Investor Briefing.
 *
 * Class: investor_briefing
 * Tier: 1
 * Formats: pptx, pdf.
 * Citation density: extreme.
 */

import type { DocComposeContext, DocumentRecipe, IRDoc, IRSection } from '../types.js';
import { buildArtifactFromIRDoc, pinGeneratedAt } from './_helpers.js';

export const investorBriefingRecipe: DocumentRecipe = {
  id: 'investor_briefing',
  class: 'investor_briefing',
  version: 1,
  status: 'live',
  authority_tier: 1,
  brand: 'borjie',
  approval_required: false,
  output_formats: ['pptx', 'pdf'] as const,
  required_inputs: [
    { key: 'narrative', description: 'Top-line narrative for the period.', required: true },
    { key: 'reserves_update', description: 'Ore reserve update.', required: true },
    { key: 'deal_terms', description: 'Investor deal terms preview.', required: false },
  ],
  required_citations: [
    { key: 'financial_proof', description: 'Each financial figure cites ledger.', minCount: 1 },
    { key: 'reserve_proof', description: 'Reserve numbers cite geo report.', minCount: 1 },
  ],
  compose: async (ctx: DocComposeContext) => {
    const generated_at = pinGeneratedAt(ctx);
    const sections: IRSection[] = [
      {
        id: 'narrative',
        title: 'Narrative',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Period story — operations, growth, capital allocation. Sourced from research result.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'financials',
        title: 'Financials',
        blocks: [
          {
            kind: 'kpi_grid',
            kpis: [
              {
                label: 'Revenue',
                value: 'see ledger',
                citationId: ctx.citations[0]?.id,
              },
              {
                label: 'EBITDA margin',
                value: 'see ledger',
                citationId: ctx.citations[0]?.id,
              },
            ],
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'reserves',
        title: 'Ore Reserve Update',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Resource estimate refreshed against latest drill campaign.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'deal',
        title: 'Deal Terms',
        blocks: [
          { kind: 'paragraph', text: 'Indicative terms (subject to change).' },
        ],
        citationIds: [],
      },
    ];

    const irDoc: IRDoc = {
      title: 'Borjie — Investor Briefing',
      subtitle: 'Quarterly Deck',
      sections,
      citations: ctx.citations,
      watermark: 'final',
      generated_at,
    };

    return buildArtifactFromIRDoc({
      recipe: investorBriefingRecipe,
      ctx,
      irDoc,
      format: 'pptx',
    });
  },
};
