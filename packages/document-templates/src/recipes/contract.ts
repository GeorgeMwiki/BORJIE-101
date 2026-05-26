/**
 * Recipe: Contract.
 *
 * Class: contract
 * Tier: 2 — owner approval REQUIRED + DocuSign envelope after approve.
 * Formats: docx (+ DocuSign integration in production).
 * Citation density: extreme.
 */

import type { DocComposeContext, DocumentRecipe, IRDoc, IRSection } from '../types.js';
import { buildArtifactFromIRDoc, pinGeneratedAt } from './_helpers.js';

export const contractRecipe: DocumentRecipe = {
  id: 'contract',
  class: 'contract',
  version: 1,
  status: 'live',
  authority_tier: 2,
  brand: 'borjie',
  approval_required: true,
  output_formats: ['docx'] as const,
  required_inputs: [
    { key: 'counterparty', description: 'Counterparty identity.', required: true },
    { key: 'commercial_terms', description: 'Price / volume / duration.', required: true },
  ],
  required_citations: [
    { key: 'clause_source', description: 'Each material clause cites source template.', minCount: 1 },
    { key: 'jurisdiction', description: 'Governing law reference.', minCount: 1 },
  ],
  compose: async (ctx: DocComposeContext) => {
    const generated_at = pinGeneratedAt(ctx);
    const sections: IRSection[] = [
      {
        id: 'parties',
        title: 'Parties',
        blocks: [
          {
            kind: 'paragraph',
            text: 'This Agreement is entered into between Borjie and the Counterparty.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'commercial',
        title: 'Commercial Terms',
        blocks: [
          {
            kind: 'table',
            headers: ['Term', 'Value'],
            rows: [
              ['Volume', '—'],
              ['Price', '—'],
              ['Duration', '—'],
            ],
          },
          {
            kind: 'paragraph',
            text: 'Each commercial term traces to negotiation memo cited below.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'jurisdiction',
        title: 'Governing Law',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Governing law per cited jurisdiction reference.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'signature',
        title: 'Signatures',
        blocks: [
          { kind: 'signature_block', text: 'Borjie — Mr. Mwikila, Managing Director' },
          { kind: 'signature_block', text: 'Counterparty signatory' },
        ],
        citationIds: [],
      },
    ];

    const irDoc: IRDoc = {
      title: 'Borjie — Contract',
      subtitle: 'Draft for Counterparty Review',
      sections,
      citations: ctx.citations,
      watermark: 'draft',
      generated_at,
    };

    return buildArtifactFromIRDoc({
      recipe: contractRecipe,
      ctx,
      irDoc,
      format: 'docx',
    });
  },
};
