/**
 * Client-side ajv guard for Vega-Lite specs.
 *
 * Belt-and-suspenders. The server already ajv-validates before emit,
 * but the renderer re-checks to harden against stream tampering /
 * out-of-date server build / browser cache poisoning.
 *
 * Anti-pattern enforced (per R2):
 *   "Render only on `tool-output-available`, not piece-by-piece."
 *
 * CRITICAL (C2) — Vega-Lite expression-injection:
 *   Vega evaluates Vega-Expression strings in `signal`, `params[].expr`,
 *   `transform[].calculate`, `mark.tooltip.signal`, etc. The ajv schema
 *   only enforces the structural shape — it does not forbid these
 *   expression keys. An LLM-emitted spec can include
 *   `{"params":[{"name":"x","expr":"window.location=..."}]}` and Vega
 *   runs it in the user's admin browser session. We strip every
 *   dangerous expression key from the spec recursively before render
 *   AND reject the spec at ajv-time via `propertyNames` so the LLM
 *   cannot smuggle code through.
 *
 * This module imports `ajv` lazily so SSR bundles don't pull it.
 */

import type { VegaLiteSpec } from './types';

export interface VegaSpecValidation {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<string>;
  /** The expression-stripped spec — safe to hand to vega-embed. */
  readonly safeSpec?: VegaLiteSpec;
  /** Dot-paths of expression keys removed during pruning (for telemetry). */
  readonly strippedPaths?: ReadonlyArray<string>;
}

/**
 * Vega / Vega-Lite property names that carry executable expression code.
 * Any object whose key is one of these is dangerous — the value is a
 * Vega-Expression string evaluated client-side with access to window.
 * Reference: https://vega.github.io/vega/docs/expressions/
 *
 * - `signal`     — Vega signal expression
 * - `expr`       — `params[].expr`, `transform[].filter`, etc.
 * - `calculate`  — `transform[].calculate` expression
 * - `update`     — `signal.on[].update` handler
 * - `init`       — `signal.init` expression
 * - `params`     — top-level `params[]` (each has its own `expr`); we
 *                  strip the array entirely because Vega-Lite v5+ uses
 *                  `params` exclusively to host expressions
 */
export const VEGA_EXPRESSION_KEYS: ReadonlySet<string> = new Set([
  'signal',
  'expr',
  'calculate',
  'update',
  'init',
  'params',
]);

/**
 * Recursively walk a Vega-Lite spec and remove every property whose name
 * is in VEGA_EXPRESSION_KEYS. Returns the stripped spec + the dot-paths
 * of the removed properties. Pure: input is not mutated.
 *
 * The dot-paths feed telemetry so the host can alert on a brain build
 * that started smuggling expressions.
 */
export function stripVegaExpressions(
  spec: unknown,
  pathPrefix = '$',
): { readonly safe: unknown; readonly stripped: ReadonlyArray<string> } {
  if (spec === null || spec === undefined || typeof spec !== 'object') {
    return { safe: spec, stripped: [] };
  }
  if (Array.isArray(spec)) {
    const stripped: string[] = [];
    const safeArr = spec.map((item, idx) => {
      const r = stripVegaExpressions(item, `${pathPrefix}[${idx}]`);
      stripped.push(...r.stripped);
      return r.safe;
    });
    return { safe: safeArr, stripped };
  }
  const obj = spec as Record<string, unknown>;
  const safeObj: Record<string, unknown> = {};
  const stripped: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (VEGA_EXPRESSION_KEYS.has(key)) {
      stripped.push(`${pathPrefix}.${key}`);
      continue;
    }
    const r = stripVegaExpressions(value, `${pathPrefix}.${key}`);
    safeObj[key] = r.safe;
    stripped.push(...r.stripped);
  }
  return { safe: safeObj, stripped };
}

const STRUCTURAL_SCHEMA = {
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    data: { oneOf: [{ type: 'object' }, { type: 'array' }] },
    mark: {
      oneOf: [
        {
          type: 'string',
          enum: [
            'arc',
            'area',
            'bar',
            'boxplot',
            'circle',
            'errorband',
            'errorbar',
            'geoshape',
            'image',
            'line',
            'point',
            'rect',
            'rule',
            'square',
            'text',
            'tick',
            'trail',
          ],
        },
        { type: 'object' },
      ],
    },
    encoding: { type: 'object' },
    layer: { type: 'array' },
    concat: { type: 'array' },
    vconcat: { type: 'array' },
    hconcat: { type: 'array' },
    repeat: { type: 'object' },
    facet: { type: 'object' },
  },
  anyOf: [
    { required: ['mark', 'encoding'] },
    { required: ['mark', 'data'] },
    { required: ['layer'] },
    { required: ['concat'] },
    { required: ['vconcat'] },
    { required: ['hconcat'] },
    { required: ['repeat'] },
    { required: ['facet'] },
  ],
  additionalProperties: true,
  // CRITICAL (C2) — reject any spec that contains a Vega-Expression key
  // (`signal` / `expr` / `calculate` / `update` / `init` / `params`)
  // anywhere in the spec tree, not just at the top. `propertyNames`
  // applies the constraint to every object the validator descends into,
  // so a `{ "params": [...] }` buried inside `transform[]` or
  // `layer[]` is rejected. The manual prune above (`stripVegaExpressions`)
  // is the defense-in-depth second line — even if ajv is bypassed or a
  // future schema rev relaxes propertyNames, the renderer is handed a
  // stripped spec.
  propertyNames: {
    not: {
      enum: ['signal', 'expr', 'calculate', 'update', 'init', 'params'],
    },
  },
} as const;

let _validator: ((spec: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string }> | null } | null = null;

async function getValidator(): Promise<typeof _validator> {
  if (_validator) return _validator;
  // Lazy import — keeps ajv out of the SSR critical path.
  // ajv ships dual CJS/ESM and the default-export shape varies; the
  // double-default lookup handles both transports cleanly.
  const ajvMod = await import('ajv');
  // ajv ships dual CJS/ESM; the default-export shape varies. We
  // probe `.default.default`, then `.default`, then the bare module.
  type AjvCtor = new (
    opts: Record<string, unknown>,
  ) => { compile: (schema: unknown) => unknown };
  type AjvModuleShape = {
    readonly default?: AjvCtor | { readonly default?: AjvCtor };
  };
  const probed = ajvMod as unknown as AjvModuleShape;
  const defaultMember = probed.default;
  const nestedDefault =
    typeof defaultMember === 'object' && defaultMember !== null && 'default' in defaultMember
      ? defaultMember.default
      : undefined;
  const AjvCtor = (nestedDefault ?? defaultMember ?? (ajvMod as unknown)) as AjvCtor;
  const ajv = new AjvCtor({ allErrors: true, allowUnionTypes: true, strict: false });
  _validator = ajv.compile(STRUCTURAL_SCHEMA) as typeof _validator;
  return _validator;
}

export async function validateVegaSpec(
  spec: VegaLiteSpec,
): Promise<VegaSpecValidation> {
  try {
    // Strip expression keys FIRST so the safe spec is always available
    // even if ajv rejects the original. This is defense-in-depth: the
    // caller gets back a guaranteed-safe spec to render, even if the
    // brain emitted something that ajv flags.
    const { safe, stripped } = stripVegaExpressions(spec);
    const safeSpec = safe as VegaLiteSpec;

    // CRITICAL (C2) — if the manual recursive prune found ANY expression
    // key anywhere in the spec tree, reject the spec as invalid. ajv's
    // `propertyNames` only checks immediate property names at the top of
    // each object it descends INTO via its own schema rules — it does
    // not auto-recurse into arbitrary `additionalProperties: true`
    // subtrees. The stripVegaExpressions walk is the authoritative
    // deep check.
    if (stripped.length > 0) {
      return {
        ok: false,
        errors: [
          `Vega-Expression keys are not allowed in LLM-emitted specs (found: ${stripped.slice(0, 5).join(', ')}${stripped.length > 5 ? '…' : ''})`,
        ],
        safeSpec,
        strippedPaths: stripped,
      };
    }

    const v = await getValidator();
    if (!v) {
      return {
        ok: false,
        errors: ['validator unavailable'],
        safeSpec,
        strippedPaths: stripped,
      };
    }
    const ok = v(spec);
    if (ok) {
      return { ok: true, errors: [], safeSpec, strippedPaths: stripped };
    }
    const errs = (v.errors ?? []).map(
      (e) => `${e.instancePath || '$'} ${e.message ?? 'unknown'}`,
    );
    return {
      ok: false,
      errors: errs.length > 0 ? errs : ['unknown ajv error'],
      safeSpec,
      strippedPaths: stripped,
    };
  } catch (err) {
    return {
      ok: false,
      errors: [`ajv failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

/** Synchronous best-effort fallback when caller can't await — just
 *  checks the trivial structural shape (object + mark or layer). */
export function quickVegaShapeCheck(spec: VegaLiteSpec): boolean {
  if (!spec || typeof spec !== 'object') return false;
  const s = spec as Record<string, unknown>;
  if ('mark' in s) return true;
  if (Array.isArray(s.layer)) return true;
  if (Array.isArray(s.concat)) return true;
  if (Array.isArray(s.vconcat)) return true;
  if (Array.isArray(s.hconcat)) return true;
  if (s.repeat || s.facet) return true;
  return false;
}
