/**
 * Shared response-envelope Zod schemas for the mining sub-API.
 *
 * Every Hono handler in `routes/mining/*.hono.ts` wraps its payload in
 * `{ success: true, data: ... }` on the happy path and
 * `{ success: false, error: { code, message } }` on failure. Surfacing
 * these as named OpenAPI components keeps generated specs DRY and lets
 * client codegen produce a real discriminated union instead of opaque
 * `Record<string, unknown>` blobs.
 *
 * Consumers should import these from `@hono/zod-openapi`-aware route
 * definitions via `createRoute({ responses: { 200: jsonOk(...) } })`.
 */
import { z } from '@hono/zod-openapi';

/** Wraps any payload schema in the `{ success: true, data }` envelope. */
export function successEnvelope<S extends z.ZodTypeAny>(data: S) {
  return z
    .object({
      success: z.literal(true).openapi({ example: true }),
      data,
      meta: z
        .object({
          total: z.number().int().nonnegative().optional(),
          page: z.number().int().nonnegative().optional(),
          limit: z.number().int().positive().optional(),
        })
        .partial()
        .optional(),
    })
    .openapi('ApiSuccessEnvelope');
}

/** Error envelope used by every non-2xx response. */
export const ErrorEnvelopeSchema = z
  .object({
    success: z.literal(false).openapi({ example: false }),
    error: z.object({
      code: z.string().openapi({ example: 'NOT_FOUND' }),
      message: z.string().openapi({ example: 'Resource not found' }),
      details: z.record(z.unknown()).optional(),
    }),
  })
  .openapi('ApiErrorEnvelope');

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/** Convenience for a `application/json` response with a Zod schema. */
export function jsonContent<S extends z.ZodTypeAny>(schema: S, description: string) {
  return {
    description,
    content: {
      'application/json': { schema },
    },
  };
}

/** Standard error response variants composed from `ErrorEnvelopeSchema`. */
export const errorResponses = {
  400: jsonContent(ErrorEnvelopeSchema, 'Validation or business error.'),
  401: jsonContent(ErrorEnvelopeSchema, 'Auth missing or invalid.'),
  403: jsonContent(ErrorEnvelopeSchema, 'Forbidden — role or KYC gate failed.'),
  404: jsonContent(ErrorEnvelopeSchema, 'Resource not found.'),
  500: jsonContent(ErrorEnvelopeSchema, 'Unhandled server error.'),
} as const;
