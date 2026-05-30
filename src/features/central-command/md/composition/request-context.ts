/**
 * Request-scoped context shared by every MD subagent adapter.
 *
 * The MD orchestrator's `MdSubagents` contract is intentionally narrow:
 * its method signatures carry the minimum the orchestrator's domain logic
 * needs. The underlying subagent services, however, require richer context
 * (tier, session/correlation ids, tenant id, user id) for audit + RLS.
 *
 * `RequestContext` is the single bag of that "ambient" context. It's
 * built once per request at the composition root and injected into every
 * adapter via closure. Adapters never mutate it.
 *
 * @module features/central-command/md/composition/request-context
 */

import { z } from "zod";

import type { BorjieAITier } from "@/core/governance/tier-policy";

/** Wave 5: jurisdiction context attached per-request so adapters that
 *  render copy + cite regulators read the org's primary jurisdiction
 *  instead of defaulting to TZ. Optional — when absent, callers fall
 *  back to `getJurisdictionConfig()`'s default. */
export const jurisdictionContextSchema = z.object({
  code: z.string().min(2).max(8),
  name: z.string().min(1).max(80),
  currency: z.string().min(3).max(3),
  aprCap: z.number().min(0).max(1).nullable(),
});

export const requestContextSchema = z.object({
  tier: z.enum([
    "borrower",
    "officer",
    "org-admin",
    "borjie-admin",
    "sovereign",
  ]),
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  correlationId: z.string().min(1),
  userId: z.string().min(1),
  jurisdiction: jurisdictionContextSchema.optional(),
});

export interface JurisdictionContext {
  readonly code: string;
  readonly name: string;
  readonly currency: string;
  readonly aprCap: number | null;
}

export interface RequestContext {
  readonly tier: BorjieAITier;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly userId: string;
  readonly jurisdiction?: JurisdictionContext;
}

/**
 * Parse + validate a request context. Returns a deep-frozen copy so the
 * caller cannot mutate it after handoff.
 */
export function parseRequestContext(input: unknown): RequestContext {
  const parsed = requestContextSchema.parse(input);
  return Object.freeze({
    tier: parsed.tier as BorjieAITier,
    tenantId: parsed.tenantId,
    sessionId: parsed.sessionId,
    correlationId: parsed.correlationId,
    userId: parsed.userId,
    jurisdiction: parsed.jurisdiction
      ? Object.freeze({
          code: parsed.jurisdiction.code,
          name: parsed.jurisdiction.name,
          currency: parsed.jurisdiction.currency,
          aprCap: parsed.jurisdiction.aprCap,
        })
      : undefined,
  });
}
