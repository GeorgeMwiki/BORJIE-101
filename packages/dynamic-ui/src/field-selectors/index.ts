/**
 * Field selector registry — the building blocks of `composer.ts`.
 *
 * A FieldSelector is a PURE function:
 *
 *   `(ctx: TabComposeContext) => Promise<ReadonlyArray<FieldGroup>>`
 *
 * Each composer picks the field selectors it needs and concatenates
 * their outputs into a `FormSchema.groups` list. This keeps the unit
 * tests tight — every selector is independently exercisable without
 * spinning up a full TabRecipe.
 *
 * The three selectors that ship with the package map onto §2's three
 * composition concerns:
 *
 *  - `regulatory` — adds fields the regulator pack requires, with
 *    citation contracts attached so the renderer can surface the WHY.
 *  - `data-join` — adds fields whose value is pre-fillable from the
 *    `joins` accessor; pre-filled fields are stamped read-only on the
 *    output side (the renderer disables them).
 *  - `mastery-tier` — drops or regroups fields based on the operator's
 *    mastery; novice operators see fewer fields per step.
 */

import type { FieldGroup, TabComposeContext } from '../types.js';
import { regulatoryFields } from './regulatory.js';
import { applyDataJoins } from './data-join.js';
import { applyMasteryTier } from './mastery-tier.js';

/** A FieldSelector consumes context and produces field groups. */
export type FieldSelector = (
  ctx: TabComposeContext,
) => Promise<ReadonlyArray<FieldGroup>>;

/**
 * A FieldGroupTransform reshapes an already-composed list of groups.
 * Used by `data-join` and `mastery-tier` selectors which act on prior
 * output rather than producing groups from scratch.
 */
export type FieldGroupTransform = (
  groups: ReadonlyArray<FieldGroup>,
  ctx: TabComposeContext,
) => Promise<ReadonlyArray<FieldGroup>>;

/** Public selector registry — exposed via `index.ts`. */
export const FIELD_SELECTORS = {
  regulatory: regulatoryFields,
  dataJoin: applyDataJoins,
  masteryTier: applyMasteryTier,
} as const;

export { regulatoryFields } from './regulatory.js';
export { applyDataJoins } from './data-join.js';
export { applyMasteryTier } from './mastery-tier.js';
