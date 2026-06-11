/**
 * Break-glass operator-access — shared types + scope/justification vocab
 * (INV-A / FIRE-1).
 *
 * The closed scope list is the set of tenant-business-data surfaces a Borjie
 * support operator can be granted time-boxed, consented, audited access to.
 * Anything NOT in this list cannot be requested — the admin console is
 * metadata-only by construction for everything else.
 */

import { z } from 'zod';

/**
 * Closed scope vocabulary. Each value names a tenant-business-data surface a
 * break-glass grant can unlock. A grant is single-tenant and scoped to a
 * subset of these.
 */
export const BREAK_GLASS_SCOPES = [
  'decision_trace_content',
  'support_ticket_content',
  'daily_brief_content',
  'warehouse_stockpiles',
  'rtbf_execution',
] as const;

export type BreakGlassScope = (typeof BREAK_GLASS_SCOPES)[number];

/**
 * Machine-readable justification classes (mirrors Google Key Access
 * Justifications). The tenant can auto-deny classes on owner-web.
 */
export const JUSTIFICATION_CODES = [
  'incident_response',
  'support_request',
  'legal_hold',
  'rtbf_execution',
  'security_investigation',
] as const;

export type JustificationCode = (typeof JUSTIFICATION_CODES)[number];

export type GrantStatus =
  | 'pending'
  | 'active'
  | 'expired'
  | 'revoked'
  | 'denied';

/** Default time-box for a break-glass grant (mirrors the 60-min impersonate copy). */
export const DEFAULT_GRANT_TTL_MINUTES = 60;
/** Hard ceiling — no grant may be minted with a longer window. */
export const MAX_GRANT_TTL_MINUTES = 240;

export const requestGrantSchema = z.object({
  tenantId: z.string().min(1),
  justificationCode: z.enum(JUSTIFICATION_CODES),
  reason: z.string().min(3).max(2000),
  scopes: z.array(z.enum(BREAK_GLASS_SCOPES)).min(1),
  ttlMinutes: z
    .number()
    .int()
    .min(1)
    .max(MAX_GRANT_TTL_MINUTES)
    .optional(),
});

export type RequestGrantInput = z.infer<typeof requestGrantSchema>;

export interface OperatorAccessGrant {
  readonly id: string;
  readonly tenantId: string;
  readonly operatorId: string;
  readonly operatorEmail: string | null;
  readonly justificationCode: string;
  readonly reason: string;
  readonly scopes: readonly string[];
  readonly status: GrantStatus;
  readonly requestedAt: string;
  readonly consentedAt: string | null;
  readonly consentedBy: string | null;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
}

export interface OperatorAccessLogEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly grantId: string;
  readonly operatorId: string;
  readonly seq: number;
  readonly route: string;
  readonly scope: string;
  readonly rowCount: number;
  readonly prevHash: string;
  readonly thisHash: string;
  readonly accessedAt: string;
}

/** Genesis hash for the first log entry of every tenant chain. */
export const GENESIS_HASH = '0'.repeat(64);
