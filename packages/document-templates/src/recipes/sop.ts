/**
 * Recipe: Standard Operating Procedure.
 *
 * Class: sop
 * Tier: 1
 * Formats: docx.
 * Citation density: medium — risk references + statute references.
 */

import type { DocComposeContext, DocumentRecipe, IRDoc, IRSection } from '../types.js';
import { buildArtifactFromIRDoc, pinGeneratedAt } from './_helpers.js';

export const sopRecipe: DocumentRecipe = {
  id: 'sop',
  class: 'sop',
  version: 1,
  status: 'live',
  authority_tier: 1,
  brand: 'borjie',
  approval_required: false,
  output_formats: ['docx'] as const,
  required_inputs: [
    { key: 'procedure_name', description: 'SOP title.', required: true },
    { key: 'roles', description: 'Roles involved.', required: true },
  ],
  required_citations: [
    { key: 'risk_reference', description: 'Hazard / risk citation.', minCount: 1 },
  ],
  compose: async (ctx: DocComposeContext) => {
    const generated_at = pinGeneratedAt(ctx);
    const sections: IRSection[] = [
      {
        id: 'purpose',
        title: 'Purpose',
        blocks: [
          {
            kind: 'paragraph',
            text: 'This SOP codifies the procedure the team follows.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'scope',
        title: 'Scope',
        blocks: [
          { kind: 'paragraph', text: 'Applies to all operational personnel.' },
        ],
        citationIds: [],
      },
      {
        id: 'procedure',
        title: 'Procedure',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Step-by-step procedure with controls and abort criteria.',
            citationId: ctx.citations[0]?.id,
          },
        ],
        citationIds: ctx.citations.slice(0, 1).map((c) => c.id),
      },
      {
        id: 'roles',
        title: 'Roles',
        blocks: [
          {
            kind: 'table',
            headers: ['Role', 'Responsibility'],
            rows: [
              ['MD', 'Owns the SOP'],
              ['Supervisor', 'Trains the team'],
            ],
          },
        ],
        citationIds: [],
      },
    ];

    const irDoc: IRDoc = {
      title: 'Borjie — SOP',
      subtitle: 'Internal Procedure',
      sections,
      citations: ctx.citations,
      watermark: 'final',
      generated_at,
    };

    return buildArtifactFromIRDoc({
      recipe: sopRecipe,
      ctx,
      irDoc,
      format: 'docx',
    });
  },
};
