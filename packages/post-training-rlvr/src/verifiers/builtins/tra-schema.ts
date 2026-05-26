/**
 * `tra-schema` verifier — Tanzania Revenue Authority filing schema
 * validation. Wave 19C ships a placeholder schema; Wave 19D will fill
 * the real schema (royalty, PAYE, VAT, capital gains).
 *
 * The verifier is wired so the runner can already use it; the schema
 * itself is a documented stub.
 */

import { z } from 'zod';
import type {
  RlvrTrace,
  Verifier,
  VerificationResult,
} from '../../types.js';

/**
 * Stub TRA filing schema. Real schema lands in Wave 19D.
 *
 * Today: a TRA filing payload must declare `tin` (10-digit TIN),
 * `filing_period_iso` (YYYY-MM), `mineral` (string), and `tonnage`
 * (positive number). Verifier passes iff parse succeeds.
 */
export const TraFilingSchema = z.object({
  tin: z.string().regex(/^\d{9,10}$/),
  filing_period_iso: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  mineral: z.string().min(1),
  tonnage: z.number().positive(),
  rate_pct: z.number().min(0).max(100).optional(),
  declared_amount: z.number().min(0).optional(),
});

export type TraFiling = z.infer<typeof TraFilingSchema>;

function extractFiling(trace: RlvrTrace): unknown {
  const meta = trace.metadata as Record<string, unknown>;
  return meta['tra_filing'];
}

export function createTraSchemaVerifier(): Verifier {
  return {
    name: 'tra-schema',
    version: '0.1.0-stub',

    applies(trace: RlvrTrace): boolean {
      return extractFiling(trace) !== undefined;
    },

    async verify(trace: RlvrTrace): Promise<VerificationResult> {
      const candidate = extractFiling(trace);
      const result = TraFilingSchema.safeParse(candidate);

      if (result.success) {
        return Object.freeze({
          verifierName: 'tra-schema',
          verdict: 'pass' as const,
          reward: 1,
          evidence: Object.freeze({
            tin: result.data.tin,
            filing_period_iso: result.data.filing_period_iso,
          }),
          confidence: 1,
        });
      }

      return Object.freeze({
        verifierName: 'tra-schema',
        verdict: 'fail' as const,
        reward: 0,
        evidence: Object.freeze({
          zodIssues: Object.freeze(
            result.error.issues.map((i) =>
              Object.freeze({
                path: i.path.join('.'),
                message: i.message,
                code: i.code,
              }),
            ),
          ),
        }),
        confidence: 1,
      });
    },
  };
}
