/**
 * Recipe: Tumemadini Monthly Return.
 *
 * Class: tumemadini_return
 * Tier: 2 — owner approval REQUIRED before submission.
 * Formats: pdf (official).
 * Citation density: extreme (per Tanzania Mining Commission regulation).
 *
 * Locked recipe in production: refuses auto-improvement signals until
 * an owner manually unlocks. We mark it `live` here; the lock policy
 * applies at the registry level via the lock/improve worker (Wave 17B).
 */

import type { DocComposeContext, DocumentRecipe, IRDoc, IRSection } from '../types.js';
import { buildArtifactFromIRDoc, pinGeneratedAt } from './_helpers.js';

export const tumemadiniReturnRecipe: DocumentRecipe = {
  id: 'tumemadini_monthly_return',
  class: 'tumemadini_return',
  version: 1,
  status: 'live',
  authority_tier: 2,
  brand: 'borjie',
  approval_required: true,
  output_formats: ['pdf'] as const,
  required_inputs: [
    { key: 'production_log', description: 'Daily production log for the month.', required: true },
    { key: 'royalty_calc', description: 'Royalty calculation worksheet.', required: true },
  ],
  required_citations: [
    {
      key: 'production_evidence',
      description: 'Each production tonnage cites a measurement.',
      minCount: 1,
    },
    {
      key: 'statute_reference',
      description: 'Regulatory section reference required.',
      minCount: 1,
    },
  ],
  compose: async (ctx: DocComposeContext) => {
    const generated_at = pinGeneratedAt(ctx);
    const sections: IRSection[] = [
      {
        id: 'header',
        title: 'Tumemadini Monthly Return',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Filing pursuant to Mining Commission regulations.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'production',
        title: 'Production Summary',
        blocks: [
          {
            kind: 'table',
            headers: ['Period', 'Tons', 'Grade', 'Recovery'],
            rows: [
              ['Month-to-date', 'see log', 'see assay', 'see plant'],
            ],
          },
          {
            kind: 'paragraph',
            text: 'Each tonnage value sourced from the on-site measurement chain.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'royalty',
        title: 'Royalty Calculation',
        blocks: [
          {
            kind: 'kpi_grid',
            kpis: [
              {
                label: 'Royalty due',
                value: 'see ledger',
                citationId: ctx.citations[0]?.id,
              },
            ],
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
      title: 'Borjie — Tumemadini Monthly Return',
      subtitle: 'Official Filing',
      sections,
      citations: ctx.citations,
      watermark: 'draft',
      generated_at,
    };

    return buildArtifactFromIRDoc({
      recipe: tumemadiniReturnRecipe,
      ctx,
      irDoc,
      format: 'pdf',
    });
  },
};
