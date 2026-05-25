/**
 * Lightweight zod → JSON-Schema converter.
 *
 * We don't pull in `zod-to-json-schema` to avoid the dependency drag — the
 * subset of schemas tool inputs actually use is small (objects with
 * primitive/array/enum/optional fields). This converter handles that subset
 * deterministically and falls back to `{}` for anything exotic.
 *
 * Goals:
 *   - Stable output (same schema in → same JSON out).
 *   - No runtime errors on unknown types; just degrade to `{}`.
 *   - No mutation — every nested call returns a fresh object.
 */

import type { z } from 'zod';

interface JSONSchema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
  properties?: Record<string, JSONSchema>;
  required?: ReadonlyArray<string>;
  items?: JSONSchema;
  enum?: ReadonlyArray<string | number>;
  description?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  additionalProperties?: boolean | JSONSchema;
  anyOf?: ReadonlyArray<JSONSchema>;
  default?: unknown;
}

/**
 * Convert a zod schema to a JSON-Schema-shaped object. Best-effort —
 * unknown types collapse to `{}`. The output is always a plain object
 * suitable for embedding in an MCP `tools/list` response.
 */
export function zodToJsonSchema(schema: z.ZodType): JSONSchema {
  // zod's introspection API has changed across major versions. We use
  // duck-typing on `_def.typeName` which has been stable since v3.
  const def = (schema as unknown as { _def?: { typeName?: string } })._def;
  const typeName = def?.typeName ?? '';

  switch (typeName) {
    case 'ZodObject':
      return convertObject(schema);
    case 'ZodString':
      return convertString(schema);
    case 'ZodNumber':
      return convertNumber(schema);
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodArray':
      return convertArray(schema);
    case 'ZodEnum':
      return convertEnum(schema);
    case 'ZodNativeEnum':
      return convertEnum(schema);
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
      return convertWrapped(schema);
    case 'ZodUnion':
      return convertUnion(schema);
    case 'ZodLiteral':
      return convertLiteral(schema);
    case 'ZodAny':
    case 'ZodUnknown':
      return {};
    default:
      return {};
  }
}

interface ZodObjectDef {
  shape: () => Record<string, z.ZodType>;
}

function convertObject(schema: z.ZodType): JSONSchema {
  const def = (schema as unknown as { _def: ZodObjectDef })._def;
  const shape = typeof def.shape === 'function' ? def.shape() : {};
  const properties: Record<string, JSONSchema> = {};
  const required: Array<string> = [];

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = zodToJsonSchema(value);
    const childDef = (value as unknown as { _def?: { typeName?: string } })._def;
    const isOptional =
      childDef?.typeName === 'ZodOptional' || childDef?.typeName === 'ZodDefault';
    if (!isOptional) required.push(key);
  }

  const out: JSONSchema = {
    type: 'object',
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) out.required = required;
  return out;
}

function convertString(schema: z.ZodType): JSONSchema {
  const def = (schema as unknown as { _def: { checks?: Array<{ kind: string; value?: unknown }> } })._def;
  const out: JSONSchema = { type: 'string' };
  for (const check of def.checks ?? []) {
    if (check.kind === 'min' && typeof check.value === 'number') out.minLength = check.value;
    else if (check.kind === 'max' && typeof check.value === 'number') out.maxLength = check.value;
    else if (check.kind === 'email') out.format = 'email';
    else if (check.kind === 'url') out.format = 'uri';
    else if (check.kind === 'uuid') out.format = 'uuid';
    else if (check.kind === 'datetime') out.format = 'date-time';
  }
  return out;
}

function convertNumber(schema: z.ZodType): JSONSchema {
  const def = (schema as unknown as { _def: { checks?: Array<{ kind: string; value?: unknown; inclusive?: boolean }> } })._def;
  let isInt = false;
  const out: JSONSchema = { type: 'number' };
  for (const check of def.checks ?? []) {
    if (check.kind === 'int') isInt = true;
    else if (check.kind === 'min' && typeof check.value === 'number') out.minimum = check.value;
    else if (check.kind === 'max' && typeof check.value === 'number') out.maximum = check.value;
  }
  if (isInt) out.type = 'integer';
  return out;
}

function convertArray(schema: z.ZodType): JSONSchema {
  const def = (schema as unknown as { _def: { type: z.ZodType } })._def;
  return { type: 'array', items: zodToJsonSchema(def.type) };
}

function convertEnum(schema: z.ZodType): JSONSchema {
  const def = (schema as unknown as {
    _def: { values?: ReadonlyArray<string>; entries?: Record<string, string | number>; valuesEntries?: ReadonlyArray<string | number> };
  })._def;
  if (Array.isArray(def.values)) {
    return { type: 'string', enum: def.values };
  }
  if (def.entries) {
    return { enum: Object.values(def.entries) };
  }
  return {};
}

function convertWrapped(schema: z.ZodType): JSONSchema {
  const def = (schema as unknown as { _def: { innerType: z.ZodType; defaultValue?: () => unknown } })._def;
  const inner = zodToJsonSchema(def.innerType);
  if ('defaultValue' in def && typeof def.defaultValue === 'function') {
    return { ...inner, default: def.defaultValue() };
  }
  return inner;
}

function convertUnion(schema: z.ZodType): JSONSchema {
  const def = (schema as unknown as { _def: { options: ReadonlyArray<z.ZodType> } })._def;
  return { anyOf: def.options.map((o) => zodToJsonSchema(o)) };
}

function convertLiteral(schema: z.ZodType): JSONSchema {
  const def = (schema as unknown as { _def: { value: string | number | boolean } })._def;
  if (typeof def.value === 'string') return { type: 'string', enum: [def.value] };
  if (typeof def.value === 'number') return { type: 'number', enum: [def.value] };
  if (typeof def.value === 'boolean') return { type: 'boolean' };
  return {};
}
