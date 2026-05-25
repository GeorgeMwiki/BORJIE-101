/**
 * Custom-field Zod helpers — pure functions for serialising a Zod
 * schema to a persistable shape and rehydrating a validator from a
 * `tenant_schema_extensions` row.
 *
 * Extracted from the repository so the pure logic can be unit-tested
 * without a live Postgres.
 */

import { z } from 'zod';

import type {
  TenantSchemaExtensionRow,
  TenantSchemaFieldKind,
} from '../schemas/core-entity/tenant-schema-extensions.schema.js';

export interface PersistedZodMeta {
  readonly kind: string;
  readonly description: string | null;
}

/**
 * Serialise a Zod schema to JSONB-safe shape. We persist only the
 * minimum needed to round-trip via {@link rehydrateZod}: the `kind`
 * (Zod type-name discriminator) and an optional description.
 *
 * The full Zod tree is NOT reconstructible (Zod's runtime type-tree
 * is not serialisable), but {@link rehydrateZod} uses `fieldKind` as
 * the primary source of truth for the rebuilt validator — the
 * persisted meta is a hint, not the canonical shape.
 */
export function zodToPersistedMeta(
  schema: z.ZodTypeAny,
): PersistedZodMeta {
  const def: { typeName?: string } =
    (schema._def as { typeName?: string }) ?? {};
  return {
    kind: def.typeName ?? 'unknown',
    description: schema.description ?? null,
  };
}

/**
 * Build a Zod validator from a registered TenantSchemaExtensionRow.
 * `fieldKind` is the source of truth; `validationsJsonb` carries
 * extra constraints (regex / min / max / enum values) which are
 * folded into the rebuilt validator.
 */
export function rehydrateZod(
  row: Pick<TenantSchemaExtensionRow, 'fieldKind' | 'validationsJsonb'>,
): z.ZodTypeAny {
  const kind = row.fieldKind as TenantSchemaFieldKind;
  const validations = (row.validationsJsonb as unknown as ReadonlyArray<{
    readonly rule?: string;
    readonly values?: ReadonlyArray<string>;
    readonly min?: number;
    readonly max?: number;
    readonly pattern?: string;
  }>) ?? [];

  switch (kind) {
    case 'text': {
      let schema: z.ZodString = z.string();
      for (const v of validations) {
        if (typeof v.min === 'number') schema = schema.min(v.min);
        if (typeof v.max === 'number') schema = schema.max(v.max);
        if (typeof v.pattern === 'string') {
          schema = schema.regex(new RegExp(v.pattern));
        }
      }
      return schema;
    }
    case 'number': {
      let schema: z.ZodNumber = z.number();
      for (const v of validations) {
        if (typeof v.min === 'number') schema = schema.min(v.min);
        if (typeof v.max === 'number') schema = schema.max(v.max);
      }
      return schema;
    }
    case 'money':
      // Money is always an integer in minor units (cents).
      return z.number().int();
    case 'date':
    case 'datetime':
      return z.string();
    case 'boolean':
      return z.boolean();
    case 'enum': {
      const allowed = validations.find((r) => r?.rule === 'enum')?.values;
      if (allowed && allowed.length > 0) {
        return z.enum(allowed as [string, ...string[]]);
      }
      return z.string();
    }
    case 'ref':
      return z.string();
    case 'jsonb':
      return z.any();
    case 'vector':
      return z.array(z.number());
    default:
      return z.any();
  }
}
