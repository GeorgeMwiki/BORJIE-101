/**
 * A2UI-style INCREMENTAL patch operations for a `PortalTab`.
 *
 * The MD edits a LIVE surface without regenerating the whole tab. Rather
 * than re-emitting a full `PortalTab` document (the "whole-tab generation"
 * path, which still works untouched), the MD emits a flat list of small,
 * ID-addressed patch ops — "add a column", "move this section up", "update
 * that field's label" — exactly the Google A2UI incremental-update model:
 * a flat list of components referenced by stable ID, mutated in place.
 *
 * Design rules (mirror the existing `@borjie/portal-genui` types module):
 *   - PURE / serializable — no React, no functions, no class instances.
 *   - Every op is addressed by the STABLE keys already present on the tab
 *     (`section.key`, `field.key`, `widget.key`). No array indices on the
 *     wire — indices are brittle across concurrent edits; IDs are stable.
 *   - Each op is narrow + strict() so a buggy LLM cannot smuggle in an
 *     arbitrary mutation. Unknown op kinds are rejected at parse time.
 *   - ADDITIVE — composes WITH the existing whole-tab path. The reducer
 *     (`./apply.ts`) re-validates the result against the canonical
 *     `PortalTabSchema`, so a patch can never produce a tab the host
 *     could not also have received from full generation.
 *
 * The op vocabulary is intentionally small and maps one-to-one onto the
 * structural levels of a tab:
 *
 *   section level — add-section / remove-section / move-section / update-section
 *   field level   — add-field / remove-field / update-field
 *   widget level  — add-widget / remove-widget / update-widget
 *   tab level     — update-tab-meta  (title / description / icon)
 *
 * "add-column" in the spec maps to `add-field` with an explicit `span`
 * (a labelled column inside a section) and `add-widget` for a data column;
 * "move section" maps to `move-section`. We keep the op names structural
 * rather than presentational so they round-trip cleanly with the schema.
 */

import { z } from 'zod';

import {
  PortalTabFieldSchema,
  PortalTabWidgetSchema,
  PortalTabWidgetObjectSchema,
  PortalTabSectionSchema,
} from '../types.js';

// ---------------------------------------------------------------------------
// Shared key validators — reuse the same constraints the tab schema uses.
// ---------------------------------------------------------------------------

const KeySchema = z.string().min(1).max(120);

/**
 * A section the MD adds may declare a non-empty title; everything else
 * carries over from the field/widget schemas. We accept the full
 * `PortalTabSectionSchema` for `add-section` so the same refinements
 * (at-least-one-field-or-widget) apply uniformly.
 */
export const AddSectionOpSchema = z
  .object({
    op: z.literal('add-section'),
    /** The section document to insert. Validated by the section schema. */
    section: PortalTabSectionSchema,
    /**
     * Insert position. When omitted the section is appended last. When
     * present, the new section is placed BEFORE the section whose key
     * matches `beforeSectionKey`; an unknown key is an error at apply time.
     */
    beforeSectionKey: KeySchema.optional(),
  })
  .strict();

export const RemoveSectionOpSchema = z
  .object({
    op: z.literal('remove-section'),
    sectionKey: KeySchema,
  })
  .strict();

/**
 * Reorder a section. `toIndex` is a 0-based target position in the
 * (post-removal) section list. Clamped to the valid range at apply time
 * so an out-of-range index never throws — it just lands at the end / start.
 */
export const MoveSectionOpSchema = z
  .object({
    op: z.literal('move-section'),
    sectionKey: KeySchema,
    toIndex: z.number().int().min(0).max(19),
  })
  .strict();

/**
 * Patch a section's presentational metadata (title / description /
 * collapsed). Cannot change the section key — that would orphan its
 * fields/widgets. The "at least one knob present" invariant is enforced
 * at the patch level (`PortalTabPatchSchema`) so this stays a plain
 * `ZodObject` and remains usable in the discriminated union.
 */
export const UpdateSectionOpSchema = z
  .object({
    op: z.literal('update-section'),
    sectionKey: KeySchema,
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(500).optional(),
    defaultCollapsed: z.boolean().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Field-level ops — "add-column" lives here (a labelled column = a field).
// ---------------------------------------------------------------------------

export const AddFieldOpSchema = z
  .object({
    op: z.literal('add-field'),
    sectionKey: KeySchema,
    field: PortalTabFieldSchema,
    /** Insert BEFORE this field key; appended last when omitted. */
    beforeFieldKey: KeySchema.optional(),
  })
  .strict();

export const RemoveFieldOpSchema = z
  .object({
    op: z.literal('remove-field'),
    sectionKey: KeySchema,
    fieldKey: KeySchema,
  })
  .strict();

/**
 * Partial update of an existing field. The field is re-validated as a
 * whole after the merge, so kind-specific invariants (e.g. dropdown needs
 * options) still hold. `key` and `kind` are immutable through this op —
 * changing a field's kind is a remove + add so the record store can react.
 */
export const UpdateFieldOpSchema = z
  .object({
    op: z.literal('update-field'),
    sectionKey: KeySchema,
    fieldKey: KeySchema,
    /**
     * The patch — a partial of the field document MINUS `key` and `kind`.
     * Merged shallowly over the existing field, then re-validated.
     */
    patch: PortalTabFieldSchema.omit({ key: true, kind: true })
      .partial()
      .strict(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Widget-level ops.
// ---------------------------------------------------------------------------

export const AddWidgetOpSchema = z
  .object({
    op: z.literal('add-widget'),
    sectionKey: KeySchema,
    widget: PortalTabWidgetSchema,
    beforeWidgetKey: KeySchema.optional(),
  })
  .strict();

export const RemoveWidgetOpSchema = z
  .object({
    op: z.literal('remove-widget'),
    sectionKey: KeySchema,
    widgetKey: KeySchema,
  })
  .strict();

/**
 * Partial update of a widget. `key` and `kind` are immutable; everything
 * else (title, subtitle, span, config, genuiKind) is patchable. The merged
 * widget is re-validated, preserving the `genui_part` ⇒ requires
 * `genuiKind` refinement.
 */
export const UpdateWidgetOpSchema = z
  .object({
    op: z.literal('update-widget'),
    sectionKey: KeySchema,
    widgetKey: KeySchema,
    // Uses the plain object schema (the refined `PortalTabWidgetSchema` is a
    // ZodEffects without `.omit`). The merged widget is re-validated by the
    // reducer against the full schema, so the genui_part invariant still holds.
    patch: PortalTabWidgetObjectSchema.omit({ key: true, kind: true })
      .partial()
      .strict(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Tab-level metadata op.
// ---------------------------------------------------------------------------

export const UpdateTabMetaOpSchema = z
  .object({
    op: z.literal('update-tab-meta'),
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(500).optional(),
    icon: z.string().max(60).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// The discriminated union — one op.
// ---------------------------------------------------------------------------

export const PortalTabPatchOpSchema = z.discriminatedUnion('op', [
  AddSectionOpSchema,
  RemoveSectionOpSchema,
  MoveSectionOpSchema,
  UpdateSectionOpSchema,
  AddFieldOpSchema,
  RemoveFieldOpSchema,
  UpdateFieldOpSchema,
  AddWidgetOpSchema,
  RemoveWidgetOpSchema,
  UpdateWidgetOpSchema,
  UpdateTabMetaOpSchema,
]);

export type PortalTabPatchOp = z.infer<typeof PortalTabPatchOpSchema>;

/** Stable list of op kind names — useful for telemetry + tests. */
export const PORTAL_TAB_PATCH_OP_KINDS = [
  'add-section',
  'remove-section',
  'move-section',
  'update-section',
  'add-field',
  'remove-field',
  'update-field',
  'add-widget',
  'remove-widget',
  'update-widget',
  'update-tab-meta',
] as const;

export type PortalTabPatchOpKind = (typeof PORTAL_TAB_PATCH_OP_KINDS)[number];

/**
 * A flat patch — the A2UI incremental-update payload. A list of ID-addressed
 * ops applied in order. Capped so a single patch cannot rewrite a tab beyond
 * what whole-tab generation could produce.
 */
export const PortalTabPatchSchema = z
  .object({
    /** Schema version for forward-compat. */
    version: z.literal(1),
    /** The target tab — must match the tab the reducer is applied to. */
    tabId: z.string().min(1).max(120),
    /** Ordered list of ops. Empty patch is rejected — use whole-tab path. */
    ops: z.array(PortalTabPatchOpSchema).min(1).max(50),
    /**
     * Optional provenance — the chat turn that produced this patch. Folded
     * into the tab's audit ring-buffer by the reducer.
     */
    sourceConversationId: z.string().max(200).optional(),
  })
  .strict()
  .superRefine((patch, ctx) => {
    // No-op ops are rejected — an `update-*` that changes nothing is a bug.
    patch.ops.forEach((op, index) => {
      if (
        op.op === 'update-section' &&
        op.title === undefined &&
        op.description === undefined &&
        op.defaultCollapsed === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'update-section requires at least one of title / description / defaultCollapsed',
          path: ['ops', index],
        });
      }
      if (
        op.op === 'update-tab-meta' &&
        op.title === undefined &&
        op.description === undefined &&
        op.icon === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'update-tab-meta requires at least one of title / description / icon',
          path: ['ops', index],
        });
      }
    });
  });

export type PortalTabPatch = z.infer<typeof PortalTabPatchSchema>;

/** Defensive validate — returns the parsed patch or throws. */
export function parsePortalTabPatch(input: unknown): PortalTabPatch {
  return PortalTabPatchSchema.parse(input);
}

/** Non-throwing variant — returns `null` on schema failure. */
export function safeParsePortalTabPatch(input: unknown): PortalTabPatch | null {
  const result = PortalTabPatchSchema.safeParse(input);
  return result.success ? result.data : null;
}
