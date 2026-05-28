/**
 * `draft_preview` inline block — surfaces a Universal Drafter draft
 * inside the home chat with quick actions (render PDF/DOCX/PPTX, send
 * to counterparty, revise).
 *
 * Wave UNIVERSAL-DOC-DRAFTER. Sibling to the Layer 1 / Layer 2 inline
 * blocks declared in `inline-blocks.ts` and `rich-inline-blocks.ts`.
 * The schema is exported standalone so callers can extend it without
 * pulling the full barrel.
 */

import { z } from 'zod';

const RENDER_FORMATS = ['md', 'pdf', 'docx', 'pptx', 'html'] as const;

const draftActionSchema = z.object({
  kind: z.enum([
    'render',
    'send',
    'revise',
    'open_full',
    'revert',
  ]),
  label: z.string().min(1).max(60),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const draftPreviewBlockSchema = z.object({
  type: z.literal('draft_preview'),
  draftId: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  inferredKind: z.string().min(1).max(40),
  firstParagraph: z.string().min(1).max(800),
  citationsCount: z.number().int().min(0).max(500).default(0),
  revisionNo: z.number().int().min(1).default(1),
  auditHashTail: z.string().min(1).max(16).optional(),
  availableFormats: z.array(z.enum(RENDER_FORMATS)).min(1).default([
    'md',
    'pdf',
    'docx',
    'html',
  ]),
  actions: z.array(draftActionSchema).min(1).max(8),
});

export type DraftPreviewBlock = z.infer<typeof draftPreviewBlockSchema>;
