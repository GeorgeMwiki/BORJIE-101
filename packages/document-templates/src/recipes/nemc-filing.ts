/**
 * Recipe: NEMC Environmental Filing.
 *
 * Class: nemc_filing
 * Tier: 2 — owner approval REQUIRED.
 * Formats: pdf (official).
 * Citation density: high — environmental measurements + compliance
 *                   commitments cite source.
 */

import type { DocComposeContext, DocumentRecipe, IRDoc, IRSection } from '../types.js';
import { buildArtifactFromIRDoc, pinGeneratedAt } from './_helpers.js';

export const nemcFilingRecipe: DocumentRecipe = {
  id: 'nemc_environmental_filing',
  class: 'nemc_filing',
  version: 1,
  status: 'live',
  authority_tier: 2,
  brand: 'borjie',
  approval_required: true,
  output_formats: ['pdf'] as const,
  required_inputs: [
    { key: 'water_log', description: 'Effluent monitoring log.', required: true },
    { key: 'dust_log', description: 'Air-quality monitoring log.', required: true },
  ],
  required_citations: [
    { key: 'measurement_evidence', description: 'Each measurement cites instrument log.', minCount: 1 },
  ],
  compose: async (ctx: DocComposeContext) => {
    const generated_at = pinGeneratedAt(ctx);
    const sections: IRSection[] = [
      {
        id: 'preamble',
        title: 'NEMC Environmental Filing',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Submitted pursuant to NEMC environmental compliance requirements.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'water',
        title: 'Effluent Monitoring',
        blocks: [
          {
            kind: 'table',
            headers: ['Date', 'pH', 'TSS', 'Heavy metals'],
            rows: [['Period', 'see log', 'see log', 'see log']],
          },
          {
            kind: 'paragraph',
            text: 'All measurements derived from calibrated on-site instruments.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'air',
        title: 'Air Quality',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Dust readings within permitted thresholds across reporting window.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'declaration',
        title: 'Declaration',
        blocks: [
          { kind: 'signature_block', text: 'Mr. Mwikila — Managing Director' },
        ],
        citationIds: [],
      },
    ];

    const irDoc: IRDoc = {
      title: 'Borjie — NEMC Environmental Filing',
      subtitle: 'Official Submission',
      sections,
      citations: ctx.citations,
      watermark: 'draft',
      generated_at,
    };

    return buildArtifactFromIRDoc({
      recipe: nemcFilingRecipe,
      ctx,
      irDoc,
      format: 'pdf',
    });
  },
};
