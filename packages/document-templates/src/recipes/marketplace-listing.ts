/**
 * Recipe: Marketplace Listing.
 *
 * Class: marketplace_listing
 * Tier: 1
 * Formats: html (live page), pdf (tear-sheet).
 * Citation density: high — each assay reference cites its certificate.
 */

import type { DocComposeContext, DocumentRecipe, IRDoc, IRSection } from '../types.js';
import { buildArtifactFromIRDoc, pinGeneratedAt } from './_helpers.js';

export const marketplaceListingRecipe: DocumentRecipe = {
  id: 'marketplace_listing',
  class: 'marketplace_listing',
  version: 1,
  status: 'live',
  authority_tier: 1,
  brand: 'borjie',
  approval_required: false,
  output_formats: ['html', 'pdf'] as const,
  required_inputs: [
    { key: 'parcel_id', description: 'Ore-parcel identifier.', required: true },
    { key: 'assays', description: 'Assay certificate set.', required: true },
    { key: 'tonnage', description: 'Parcel tonnage.', required: true },
  ],
  required_citations: [
    { key: 'assay_cert', description: 'Each assay claim cites a certificate.', minCount: 1 },
  ],
  compose: async (ctx: DocComposeContext) => {
    const generated_at = pinGeneratedAt(ctx);
    const sections: IRSection[] = [
      {
        id: 'overview',
        title: 'Parcel Overview',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Borjie marketplace listing for an available ore parcel.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'specs',
        title: 'Specs',
        blocks: [
          {
            kind: 'kpi_grid',
            kpis: [
              { label: 'Tonnage', value: 'see register', citationId: ctx.citations[0]?.id },
              { label: 'Grade', value: 'see assay', citationId: ctx.citations[0]?.id },
              { label: 'Origin', value: 'Borjie licensed area' },
            ],
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'assays',
        title: 'Assay Certificates',
        blocks: [
          {
            kind: 'table',
            headers: ['Certificate', 'Lab', 'Element', 'Result'],
            rows: [['—', '—', '—', '—']],
          },
          {
            kind: 'paragraph',
            text: 'Independent lab certificates referenced by id below.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'contact',
        title: 'Contact',
        blocks: [
          { kind: 'paragraph', text: 'Inquire via the Borjie marketplace portal.' },
        ],
        citationIds: [],
      },
    ];

    const irDoc: IRDoc = {
      title: 'Borjie — Marketplace Listing',
      subtitle: 'Ore Parcel For Sale',
      sections,
      citations: ctx.citations,
      watermark: 'final',
      generated_at,
    };

    return buildArtifactFromIRDoc({
      recipe: marketplaceListingRecipe,
      ctx,
      irDoc,
      format: 'html',
    });
  },
};
