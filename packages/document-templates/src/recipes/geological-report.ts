/**
 * Recipe: Geological Report.
 *
 * Class: geological_report
 * Tier: 1
 * Formats: pdf (charts + text).
 * Citation density: high — drill results + interpretation cite assay /
 *                   measurement source.
 */

import type { DocComposeContext, DocumentRecipe, IRDoc, IRSection } from '../types.js';
import { buildArtifactFromIRDoc, pinGeneratedAt } from './_helpers.js';

export const geologicalReportRecipe: DocumentRecipe = {
  id: 'geological_report',
  class: 'geological_report',
  version: 1,
  status: 'live',
  authority_tier: 1,
  brand: 'borjie',
  approval_required: false,
  output_formats: ['pdf'] as const,
  required_inputs: [
    { key: 'drill_holes', description: 'Drill hole results.', required: true },
    { key: 'assay_results', description: 'Assay certificate set.', required: true },
  ],
  required_citations: [
    { key: 'assay_certificate', description: 'Each grade cites a certificate.', minCount: 1 },
  ],
  compose: async (ctx: DocComposeContext) => {
    const generated_at = pinGeneratedAt(ctx);
    const sections: IRSection[] = [
      {
        id: 'context',
        title: 'Geological Context',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Drilling campaign across the licensed area.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'results',
        title: 'Drill Results',
        blocks: [
          {
            kind: 'table',
            headers: ['Hole', 'From', 'To', 'Grade'],
            rows: [['—', '—', '—', '—']],
          },
          {
            kind: 'paragraph',
            text: 'Each grade derived from accredited assay laboratory.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'interpretation',
        title: 'Interpretation',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Mineralisation continuity supports current resource shell.',
            citationId: ctx.citations[0]?.id,
          },
          { kind: 'chart_placeholder', text: 'Long-section schematic' },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
    ];

    const irDoc: IRDoc = {
      title: 'Borjie — Geological Report',
      subtitle: 'Drill Campaign Synthesis',
      sections,
      citations: ctx.citations,
      watermark: 'final',
      generated_at,
    };

    return buildArtifactFromIRDoc({
      recipe: geologicalReportRecipe,
      ctx,
      irDoc,
      format: 'pdf',
    });
  },
};
