/**
 * draft_edit inline block schema — editable form for drafts.
 *
 * Wave OWNER-OS-INLINE-FIRST. When the owner asks to customize or tweak
 * a drafted document, the brain emits a `draft_edit` block with current
 * field values pre-filled. Owner adjusts, then clicks "Save revision"
 * (creates new editable revision) or "Save and lock" (locks the revision,
 * making it immutable, warns "Locking makes this revision immutable.
 * Future edits create new revisions.").
 *
 * Default to "Save revision" unless owner explicitly says lock/finalize/commit.
 *
 * Rendered by `apps/owner-web/src/components/home-chat/inline-blocks/DraftEditBlock.tsx`
 */

import { z } from 'zod';

const bilingualLabelSchema = z.object({
  en: z.string().min(1).max(80),
  sw: z.string().min(1).max(80),
});

export const DRAFT_EDIT_FIELD_KINDS = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'currency-tzs',
  'party-picker',
  'site-picker',
  'licence-picker',
] as const;

const draftEditFieldSchema = z.object({
  key: z.string().min(1).max(40),
  label: bilingualLabelSchema,
  kind: z.enum(DRAFT_EDIT_FIELD_KINDS),
  currentValue: z.unknown().optional(),
  options: z.array(z.string().min(1).max(60)).max(50).optional(),
  required: z.boolean().default(false),
  helperText: bilingualLabelSchema.optional(),
});

export const draftEditBlockSchema = z.object({
  type: z.literal('draft_edit'),
  draftId: z.string().uuid(),
  revisionNo: z.number().int().min(1),
  fields: z.array(draftEditFieldSchema).min(1).max(20),
  primaryAction: z.object({
    kind: z.enum(['save_revision', 'save_and_lock']),
    label: bilingualLabelSchema,
  }),
  secondaryAction: z.object({
    kind: z.literal('cancel'),
    label: bilingualLabelSchema,
  }).optional(),
  warning: bilingualLabelSchema.optional(),
});

export type DraftEditBlock = z.infer<typeof draftEditBlockSchema>;
export type DraftEditField = z.infer<typeof draftEditFieldSchema>;
