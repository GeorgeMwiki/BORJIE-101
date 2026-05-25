/**
 * validate.ts — Zod-driven validation of a candidate ModuleSpec.
 *
 * The first-stage line of defence: enforces the grammar (slug regex,
 * field-count caps, enum value patterns, FK referent existence). The
 * compiler refuses to run unless `validateSpec` returned `ok=true`.
 *
 * Cross-entity checks (FK references resolve to a declared entity;
 * UI section entities exist; workflow trigger_entity exists; no
 * duplicate slugs) are enforced here, not in the Zod schema, because
 * Zod cannot express predicates over a sibling collection.
 */

import { z } from 'zod';
import { ModuleSpecSchema, type ModuleSpec } from './types.js';

export interface ValidateResult {
  readonly ok: boolean;
  readonly spec: ModuleSpec | undefined;
  readonly errors: readonly string[];
}

/**
 * Validate a candidate JSON spec against the locked grammar.
 *
 * Returns `{ ok: false, errors: [...] }` on grammar violation or
 * `{ ok: true, spec: parsed }` on success. Pure function — no side
 * effects — safe to invoke from any layer (LLM post-processor, REST
 * endpoint, CLI, test fixture).
 */
export function validateSpec(input: unknown): ValidateResult {
  // Phase 1 — Zod grammar parse.
  const parsed = ModuleSpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      spec: undefined,
      errors: zodIssuesToStrings(parsed.error),
    };
  }
  const spec = parsed.data;

  // Phase 2 — cross-entity referential integrity checks.
  const errors: string[] = [];

  const entitySlugs = new Set<string>();
  for (const e of spec.entities) {
    if (entitySlugs.has(e.slug)) {
      errors.push(`duplicate entity slug: ${e.slug}`);
    }
    entitySlugs.add(e.slug);
  }

  // FK references must point at declared entities.
  for (const entity of spec.entities) {
    const fieldNames = new Set<string>();
    for (const f of entity.fields) {
      if (fieldNames.has(f.name)) {
        errors.push(
          `duplicate field "${f.name}" in entity "${entity.slug}"`,
        );
      }
      fieldNames.add(f.name);

      if (f.kind === 'fk' && !entitySlugs.has(f.references)) {
        errors.push(
          `entity "${entity.slug}" field "${f.name}" references unknown entity "${f.references}"`,
        );
      }
    }
  }

  // Workflow trigger_entity must exist (or be one of the built-ins).
  const workflowSlugs = new Set<string>();
  for (const w of spec.workflows) {
    if (workflowSlugs.has(w.slug)) {
      errors.push(`duplicate workflow slug: ${w.slug}`);
    }
    workflowSlugs.add(w.slug);

    if (
      !entitySlugs.has(w.trigger_entity) &&
      !BUILT_IN_TRIGGER_ENTITIES.has(w.trigger_entity)
    ) {
      errors.push(
        `workflow "${w.slug}" trigger_entity "${w.trigger_entity}" is neither a declared entity nor a built-in`,
      );
    }
  }

  // UI section entities must exist (where applicable).
  for (let i = 0; i < spec.ui_sections.length; i++) {
    const section = spec.ui_sections[i];
    if (!section) continue;
    if (section.kind === 'table') {
      if (!entitySlugs.has(section.entity)) {
        errors.push(
          `ui_sections[${i}] table references unknown entity "${section.entity}"`,
        );
      } else {
        // Columns must exist on that entity (or be canonical
        // `display_name` / `id` / `created_at`).
        const entity = spec.entities.find((e) => e.slug === section.entity);
        const declaredFields = new Set(entity?.fields.map((f) => f.name));
        for (const col of section.columns) {
          if (!declaredFields.has(col) && !CANONICAL_COLUMNS.has(col)) {
            errors.push(
              `ui_sections[${i}] column "${col}" not present on entity "${section.entity}" and not canonical`,
            );
          }
        }
      }
    } else if (section.kind === 'form') {
      if (!entitySlugs.has(section.entity)) {
        errors.push(
          `ui_sections[${i}] form references unknown entity "${section.entity}"`,
        );
      }
    }
    // kpi_tile is free-form (`query` is a slug into a canonical
    // KPI registry — checked at render time, not compile time).
  }

  if (errors.length > 0) {
    return { ok: false, spec: undefined, errors };
  }

  return { ok: true, spec, errors: [] };
}

/**
 * Slugs allowed as workflow trigger_entity even when not in spec.entities.
 * The brain registers these built-in event sources.
 */
const BUILT_IN_TRIGGER_ENTITIES = new Set([
  'time',
  'system',
  'tenant',
  'user',
]);

/**
 * Columns always available on any entity (core_entity provides them).
 */
const CANONICAL_COLUMNS = new Set([
  'id',
  'display_name',
  'lifecycle_state',
  'created_at',
  'updated_at',
]);

function zodIssuesToStrings(error: z.ZodError): readonly string[] {
  return Object.freeze(
    error.issues.map((issue) => {
      const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
      return `${path}: ${issue.message}`;
    }),
  );
}
