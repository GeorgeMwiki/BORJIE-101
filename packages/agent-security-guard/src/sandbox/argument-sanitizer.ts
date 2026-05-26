/**
 * Zod-backed tool-argument sanitiser.
 *
 * Per SEC-4 spec §8 rule 3: tool argument values must match the tool's
 * zod schema *exactly*; any unknown field is a violation. We use
 * `strict()` semantics where supported.
 */
import { z, type ZodTypeAny, ZodObject, ZodError } from 'zod';

export type SanitizeResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly errors: ReadonlyArray<{
        readonly path: ReadonlyArray<string | number>;
        readonly message: string;
      }>;
    };

/**
 * Validate args against a zod schema. If the schema is a ZodObject,
 * `.strict()` is applied to reject unknown keys.
 */
export function sanitizeToolArgs<T>(
  schema: ZodTypeAny,
  args: unknown,
): SanitizeResult<T> {
  const effectiveSchema =
    schema instanceof ZodObject ? schema.strict() : schema;
  try {
    const parsed = effectiveSchema.parse(args) as T;
    return Object.freeze({ ok: true as const, value: parsed });
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) =>
        Object.freeze({
          path: Object.freeze([...i.path]),
          message: i.message,
        }),
      );
      return Object.freeze({
        ok: false as const,
        errors: Object.freeze(issues),
      });
    }
    return Object.freeze({
      ok: false as const,
      errors: Object.freeze([
        Object.freeze({
          path: Object.freeze([] as ReadonlyArray<string | number>),
          message: err instanceof Error ? err.message : 'unknown-error',
        }),
      ]),
    });
  }
}

/**
 * Re-export the zod runtime as a convenience for downstream callers
 * who define tool schemas inline. Kept exported so tool-definition
 * consumers don't need a separate zod import.
 */
export { z };
