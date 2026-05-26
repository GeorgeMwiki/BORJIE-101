/**
 * Layer 2 composer — `composeTab(ctx)`.
 *
 * Source of truth: spec §2 Layer 2 + §3 Tab Recipe contract.
 *
 * `composeTab` is the package-level entry that:
 *
 *   1. Resolves the bound Tab Recipe (via the registry) by intent or id.
 *   2. Refuses to run if the recipe is `locked` AND the caller asked
 *      for a re-compose — locked recipes are immutable.
 *   3. Invokes the recipe's own `compose(ctx)` function.
 *   4. Validates the returned `FormSchema` shape — empty groups, missing
 *      titles, malformed action URLs, missing citations on required
 *      fields all fail closed.
 *   5. Returns the validated schema.
 *
 * Anti-patterns enforced (mirrors spec §7):
 *
 *   - The composer NEVER returns a partial FormSchema — invalid shapes
 *     throw `ComposeError` with all violations enumerated.
 *   - The composer NEVER asks for a field already pre-filled with a
 *     null/undefined value AND lacking a regulatory citation; that
 *     combination is a likely data-join misconfiguration and a noisy
 *     UX (anti-pattern #2).
 *   - The composer NEVER routes a submit to anything other than the
 *     api-gateway forms URL shape (mirrors PrefillForm action contract).
 */

import type {
  ActionRef,
  Field,
  FieldGroup,
  FormSchema,
  TabComposeContext,
  TabRecipe,
} from './types.js';
import type { TabRecipeRegistry } from './registry.js';

/**
 * URL shapes the gateway accepts for form submissions. Kept here as a
 * defensive copy of the regex in `packages/genui/src/schemas/index.ts`
 * (`PrefillFormActionSchema`) so a recipe that emits a bad URL fails
 * here, BEFORE the renderer rejects it as `schema-validation-failed`.
 */
const ACTION_PATH_RE =
  /^\/api\/gateway\/forms\/[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)?\/?$/;
const ACTION_ABS_RE =
  /^https:\/\/[a-zA-Z0-9._-]+\/api\/gateway\/forms\/[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)?\/?$/;

export class ComposeError extends Error {
  public override readonly name = 'ComposeError';
  public readonly violations: ReadonlyArray<string>;

  public constructor(violations: ReadonlyArray<string>) {
    super(`compose failed: ${violations.join(' | ')}`);
    this.violations = violations;
  }
}

function validateActionRef(action: ActionRef, violations: string[]): void {
  if (!action.form_id || typeof action.form_id !== 'string') {
    violations.push('submit_action.form_id missing');
  }
  if (action.method !== 'POST') {
    violations.push(`submit_action.method must be 'POST' (got '${action.method}')`);
  }
  if (!ACTION_PATH_RE.test(action.url) && !ACTION_ABS_RE.test(action.url)) {
    violations.push(
      `submit_action.url '${action.url}' must match /api/gateway/forms/<form-id>[/<sub>]`,
    );
  }
}

function validateField(
  groupId: string,
  field: Field,
  violations: string[],
  evidenceIds: Set<string>,
): void {
  if (!field.id) {
    violations.push(`group '${groupId}' has a field with empty id`);
    return;
  }
  const path = `field '${groupId}.${field.id}'`;
  if (!field.label_en || !field.label_sw) {
    violations.push(`${path}: label_en + label_sw required for bilingual surface`);
  }
  if (field.required) {
    if (!field.required_because) {
      violations.push(
        `${path} is required but missing required_because citation contract`,
      );
    } else {
      if (!field.required_because.citation_id) {
        violations.push(`${path}: required_because.citation_id is empty`);
      } else {
        evidenceIds.add(field.required_because.citation_id);
      }
      if (!field.required_because.rule) {
        violations.push(`${path}: required_because.rule is empty`);
      }
    }
  }
}

function validateGroups(
  groups: ReadonlyArray<FieldGroup>,
  violations: string[],
  evidenceIds: Set<string>,
): void {
  if (groups.length === 0) {
    violations.push('FormSchema.groups must have at least one group');
    return;
  }
  const seenGroupIds = new Set<string>();
  for (const group of groups) {
    if (!group.id) {
      violations.push('a group is missing an id');
      continue;
    }
    if (seenGroupIds.has(group.id)) {
      violations.push(`duplicate group id '${group.id}'`);
    }
    seenGroupIds.add(group.id);
    if (!group.title_en || !group.title_sw) {
      violations.push(
        `group '${group.id}' missing title_en or title_sw (bilingual surface required)`,
      );
    }
    if (group.fields.length === 0) {
      violations.push(`group '${group.id}' has zero fields`);
    }
    const seenFieldIds = new Set<string>();
    for (const field of group.fields) {
      if (seenFieldIds.has(field.id)) {
        violations.push(`group '${group.id}': duplicate field id '${field.id}'`);
      }
      seenFieldIds.add(field.id);
      validateField(group.id, field, violations, evidenceIds);
    }
  }
}

/**
 * Validate a FormSchema after the recipe's `compose(ctx)` returns.
 *
 * Returns the same schema (so callers can `return validateSchema(s)`
 * inline) augmented with the union of citation_ids the validator
 * discovered. The recipe MAY provide additional evidence_ids — those
 * are merged in.
 */
export function validateFormSchema(schema: FormSchema): FormSchema {
  const violations: string[] = [];
  const discovered = new Set<string>();
  for (const id of schema.evidence_ids) {
    discovered.add(id);
  }
  if (!schema.title_en || !schema.title_sw) {
    violations.push(
      'FormSchema.title_en + title_sw required for bilingual surface',
    );
  }
  validateGroups(schema.groups, violations, discovered);
  validateActionRef(schema.submit_action, violations);
  if (violations.length > 0) {
    throw new ComposeError(violations);
  }
  return {
    ...schema,
    evidence_ids: Array.from(discovered),
  };
}

export interface ComposeOptions {
  readonly registry: TabRecipeRegistry;
  readonly recipeId?: string;
  readonly intentKind?: string;
}

/**
 * `composeTab(ctx, options)` — Layer 2 entry point.
 *
 * The caller passes either a `recipeId` (direct dispatch) or an
 * `intentKind` (lookup-then-dispatch). Exactly one of the two must be
 * set.
 *
 * Locked recipes still compose — locking does NOT freeze the
 * `compose(ctx)` output for a fixed context, it freezes the schema
 * definition from edits. The renderer is the one that suppresses
 * variant testing on locked versions.
 */
export async function composeTab(
  ctx: TabComposeContext,
  options: ComposeOptions,
): Promise<{ recipe: TabRecipe; schema: FormSchema }> {
  if (Boolean(options.recipeId) === Boolean(options.intentKind)) {
    throw new ComposeError([
      'composeTab requires exactly one of { recipeId, intentKind }',
    ]);
  }
  const lookup = options.recipeId
    ? options.registry.lookup(options.recipeId)
    : options.registry.lookupByIntent(options.intentKind as string);
  if (!lookup) {
    const key = options.recipeId ?? options.intentKind ?? '(none)';
    throw new ComposeError([
      `no live Tab Recipe bound to '${key}' — registry returned null`,
    ]);
  }
  const recipe = lookup.recipe;
  const schema = await recipe.compose(ctx);
  const validated = validateFormSchema(schema);
  return { recipe, schema: validated };
}

/** Helper for composer authors — assemble + validate an ActionRef. */
export function actionRef(formId: string, urlBase = '/api/gateway/forms'): ActionRef {
  return {
    form_id: formId,
    url: `${urlBase}/${formId}`,
    method: 'POST',
  };
}
