/**
 * Recipe: Daily Briefing.
 *
 * Class: daily_briefing
 * Tier: 1 (Draft/Stage — auto-publishes to owner channels with passive
 *          notification rather than blocking on approval).
 * Formats: md (in-app), pdf (archive).
 * Citation density: high — overnight events, FX, ore-parcel deltas,
 *                   regulator notices all carry citations.
 */

import type { DocComposeContext, DocumentRecipe, IRDoc, IRSection } from '../types.js';
import { buildArtifactFromIRDoc, pinGeneratedAt } from './_helpers.js';

export const dailyBriefingRecipe: DocumentRecipe = {
  id: 'daily_briefing',
  class: 'daily_briefing',
  version: 1,
  status: 'live',
  authority_tier: 1,
  brand: 'borjie',
  approval_required: false,
  output_formats: ['md', 'pdf'] as const,
  required_inputs: [
    { key: 'overnight_events', description: 'Overnight regulator / market events.', required: true },
    { key: 'fx_snapshot', description: 'FX positions and shifts since last close.', required: false },
  ],
  required_citations: [
    { key: 'event_evidence', description: 'Each event must cite source.', minCount: 1 },
  ],
  compose: async (ctx: DocComposeContext) => {
    const generated_at = pinGeneratedAt(ctx);
    const sections: IRSection[] = [
      {
        id: 'overnight',
        title: 'Overnight Events',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Overnight summary across mining operations, regulator feeds, and counterparties.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'fx',
        title: 'FX & Commodities',
        blocks: [
          {
            kind: 'kpi_grid',
            kpis: [
              {
                label: 'TZS/USD',
                value: 'snapshot pending',
                citationId: ctx.citations[0]?.id,
              },
            ],
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'actions',
        title: 'Recommended Actions',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Mr. Mwikila proposes the day-one focus items below, each grounded in an overnight event.',
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
      title: 'Borjie — Daily Briefing',
      subtitle: ctx.owner_profile.displayName,
      sections,
      citations: ctx.citations,
      watermark: 'final',
      generated_at,
    };

    return buildArtifactFromIRDoc({
      recipe: dailyBriefingRecipe,
      ctx,
      irDoc,
      format: 'md',
    });
  },
};
