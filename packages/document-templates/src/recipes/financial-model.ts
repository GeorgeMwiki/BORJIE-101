/**
 * Recipe: Financial Model.
 *
 * Class: financial_model
 * Tier: 1
 * Formats: xlsx.
 * Citation density: high — every assumption cell carries a citation
 *                   per spec §9 anti-pattern ("Generate a financial
 *                   model without citing each assumption source").
 */

import type { DocComposeContext, DocumentRecipe, IRDoc, IRSection } from '../types.js';
import { buildArtifactFromIRDoc, pinGeneratedAt } from './_helpers.js';

export const financialModelRecipe: DocumentRecipe = {
  id: 'financial_model',
  class: 'financial_model',
  version: 1,
  status: 'live',
  authority_tier: 1,
  brand: 'borjie',
  approval_required: false,
  output_formats: ['xlsx'] as const,
  required_inputs: [
    { key: 'commodity_assumptions', description: 'Commodity price scenarios.', required: true },
    { key: 'cost_assumptions', description: 'Production cost assumptions.', required: true },
  ],
  required_citations: [
    { key: 'assumption_source', description: 'Each assumption row cites a source.', minCount: 1 },
  ],
  compose: async (ctx: DocComposeContext) => {
    const generated_at = pinGeneratedAt(ctx);
    const sections: IRSection[] = [
      {
        id: 'assumptions',
        title: 'Assumptions',
        blocks: [
          {
            kind: 'kpi_grid',
            kpis: [
              {
                label: 'Commodity price (USD/oz)',
                value: 'see source',
                citationId: ctx.citations[0]?.id,
              },
              {
                label: 'Production cost (USD/oz)',
                value: 'see source',
                citationId: ctx.citations[0]?.id,
              },
              {
                label: 'FX (TZS/USD)',
                value: 'see source',
                citationId: ctx.citations[0]?.id,
              },
            ],
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'pl',
        title: 'P&L Projection',
        blocks: [
          {
            kind: 'table',
            headers: ['Period', 'Revenue', 'Costs', 'EBITDA'],
            rows: [
              ['Y1', 'see model', 'see model', 'see model'],
              ['Y2', 'see model', 'see model', 'see model'],
            ],
          },
        ],
        citationIds: [],
      },
      {
        id: 'sensitivity',
        title: 'Sensitivity',
        blocks: [
          {
            kind: 'paragraph',
            text: 'NPV sensitivity to commodity price; see Monte Carlo run.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
    ];

    const irDoc: IRDoc = {
      title: 'Borjie — Financial Model',
      subtitle: 'Scenario Workbook',
      sections,
      citations: ctx.citations,
      watermark: 'final',
      generated_at,
    };

    return buildArtifactFromIRDoc({
      recipe: financialModelRecipe,
      ctx,
      irDoc,
      format: 'xlsx',
    });
  },
};
