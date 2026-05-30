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
 * This module imports `ajv` lazily so SSR bundles don't pull it.
 */

import type { VegaLiteSpec } from "./types";

export interface VegaSpecValidation {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<string>;
}

const STRUCTURAL_SCHEMA = {
  type: "object",
  properties: {
    $schema: { type: "string" },
    data: { oneOf: [{ type: "object" }, { type: "array" }] },
    mark: {
      oneOf: [
        {
          type: "string",
          enum: [
            "arc",
            "area",
            "bar",
            "boxplot",
            "circle",
            "errorband",
            "errorbar",
            "geoshape",
            "image",
            "line",
            "point",
            "rect",
            "rule",
            "square",
            "text",
            "tick",
            "trail",
          ],
        },
        { type: "object" },
      ],
    },
    encoding: { type: "object" },
    layer: { type: "array" },
    concat: { type: "array" },
    vconcat: { type: "array" },
    hconcat: { type: "array" },
    repeat: { type: "object" },
    facet: { type: "object" },
  },
  anyOf: [
    { required: ["mark", "encoding"] },
    { required: ["mark", "data"] },
    { required: ["layer"] },
    { required: ["concat"] },
    { required: ["vconcat"] },
    { required: ["hconcat"] },
    { required: ["repeat"] },
    { required: ["facet"] },
  ],
  additionalProperties: true,
} as const;

let _validator:
  | (((spec: unknown) => boolean) & {
      errors?: Array<{ instancePath: string; message?: string }> | null;
    })
  | null = null;

async function getValidator(): Promise<typeof _validator> {
  if (_validator) return _validator;
  // Lazy import — keeps ajv out of the SSR critical path.
  // ajv ships dual CJS/ESM and the default-export shape varies; the
  // double-default lookup handles both transports cleanly.
  const ajvMod = await import("ajv");
  /* eslint-disable @typescript-eslint/no-explicit-any -- intentional: ajv ships dual CJS/ESM and the `.default.default` chain crosses module-shape inference; narrowed to a concrete shape on the next statement */
  const AjvCtor = ((ajvMod as any).default?.default ??
    (ajvMod as any).default ??
    ajvMod) as new (opts: Record<string, unknown>) => {
    compile: (schema: unknown) => unknown;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const ajv = new AjvCtor({
    allErrors: true,
    allowUnionTypes: true,
    strict: false,
  });
  _validator = ajv.compile(STRUCTURAL_SCHEMA) as typeof _validator;
  return _validator;
}

export async function validateVegaSpec(
  spec: VegaLiteSpec,
): Promise<VegaSpecValidation> {
  try {
    const v = await getValidator();
    if (!v) return { ok: false, errors: ["validator unavailable"] };
    const ok = v(spec);
    if (ok) return { ok: true, errors: [] };
    const errs = (v.errors ?? []).map(
      (e) => `${e.instancePath || "$"} ${e.message ?? "unknown"}`,
    );
    return {
      ok: false,
      errors: errs.length > 0 ? errs : ["unknown ajv error"],
    };
  } catch (err) {
    return {
      ok: false,
      errors: [
        `ajv failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
}

/** Synchronous best-effort fallback when caller can't await — just
 *  checks the trivial structural shape (object + mark or layer). */
export function quickVegaShapeCheck(spec: VegaLiteSpec): boolean {
  if (!spec || typeof spec !== "object") return false;
  const s = spec as Record<string, unknown>;
  if ("mark" in s) return true;
  if (Array.isArray(s.layer)) return true;
  if (Array.isArray(s.concat)) return true;
  if (Array.isArray(s.vconcat)) return true;
  if (Array.isArray(s.hconcat)) return true;
  if (s.repeat || s.facet) return true;
  return false;
}
