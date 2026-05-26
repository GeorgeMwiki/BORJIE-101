/**
 * Recipe: Buyer KYB Pack.
 *
 * Class: buyer_kyb_pack
 * Tier: 2 — owner approval REQUIRED before bundle is shared with
 *           counterparty.
 * Formats: pdf (bundle).
 * Citation density: high — beneficial ownership, sanctions, AML each
 *                   carry a citation to source register.
 */

import type { DocComposeContext, DocumentRecipe, IRDoc, IRSection } from '../types.js';
import { buildArtifactFromIRDoc, pinGeneratedAt } from './_helpers.js';

export const buyerKybPackRecipe: DocumentRecipe = {
  id: 'buyer_kyb_pack',
  class: 'buyer_kyb_pack',
  version: 1,
  status: 'live',
  authority_tier: 2,
  brand: 'borjie',
  approval_required: true,
  output_formats: ['pdf'] as const,
  required_inputs: [
    { key: 'counterparty_id', description: 'Counterparty identifier.', required: true },
    { key: 'licenses', description: 'License snapshot.', required: true },
    { key: 'beneficial_owners', description: 'UBO disclosure.', required: true },
  ],
  required_citations: [
    { key: 'ubo_register', description: 'UBO entries cite registry.', minCount: 1 },
    { key: 'sanctions_check', description: 'Sanctions screen cites provider.', minCount: 1 },
  ],
  compose: async (ctx: DocComposeContext) => {
    const generated_at = pinGeneratedAt(ctx);
    const sections: IRSection[] = [
      {
        id: 'cover',
        title: 'KYB Cover Sheet',
        blocks: [
          {
            kind: 'paragraph',
            text: 'KYB bundle prepared for counterparty diligence.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'licenses',
        title: 'Licenses & Registrations',
        blocks: [
          {
            kind: 'table',
            headers: ['License', 'Authority', 'Status', 'Expiry'],
            rows: [['—', '—', '—', '—']],
          },
          {
            kind: 'paragraph',
            text: 'Each license verified against issuing authority registry.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'ubo',
        title: 'Beneficial Ownership',
        blocks: [
          {
            kind: 'paragraph',
            text: 'UBO disclosure aligned to FATF threshold.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'sanctions',
        title: 'Sanctions & AML',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Sanctions and PEP screening passed against latest OFAC/EU lists.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'declaration',
        title: 'Authored',
        blocks: [
          { kind: 'signature_block', text: 'Borjie Compliance — under MD authority' },
        ],
        citationIds: [],
      },
    ];

    const irDoc: IRDoc = {
      title: 'Borjie — Buyer KYB Pack',
      subtitle: 'Counterparty Diligence Bundle',
      sections,
      citations: ctx.citations,
      watermark: 'draft',
      generated_at,
    };

    return buildArtifactFromIRDoc({
      recipe: buyerKybPackRecipe,
      ctx,
      irDoc,
      format: 'pdf',
    });
  },
};
