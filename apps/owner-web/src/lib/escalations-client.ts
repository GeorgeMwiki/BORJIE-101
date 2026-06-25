/**
 * Owner-web escalations client — typed gateway access to the
 * AUTHORITATIVE manager-dispatch escalation ladder (`mining_escalations`).
 *
 * The never-drop ladder (estate-mind-wiring rung-4) and the mounted
 * `/api/v1/mining/escalations` route both write `mining_escalations`, so
 * this is the only authoritative read for ladder-raised escalations. The
 * acknowledge / resolve POSTs are the CLOSING transitions that close the
 * loop — previously dark in owner-web.
 *
 * Transport is the owner-web `apiRequest` wrapper (Supabase Bearer auth +
 * same-origin CSRF cookie, gateway `{success,data}` envelope auto-unwrapped,
 * non-2xx surfaced as `ApiError`). The unwrapped payload is zod-validated
 * here so a misshapen row never reaches render.
 *
 * Re-implements the logic the (u:integrated) `src/features/central-command`
 * port worked out, but native to owner-web conventions. That port version
 * is SUPERSEDED by this file.
 *
 * @module lib/escalations-client
 */

import { z } from 'zod';
import { apiRequest } from './api-client';

/** Mounted under `/mining` in `routes/mining/index.ts`, served at `/api/v1`. */
const ESCALATIONS_BASE = '/api/v1/mining/escalations';

export const ESCALATION_SEVERITIES = ['info', 'warning', 'critical'] as const;
export const ESCALATION_STATUSES = ['open', 'acknowledged', 'resolved'] as const;

export type EscalationSeverity = (typeof ESCALATION_SEVERITIES)[number];
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

/**
 * Locale-neutral escalation body. The gateway projects every row onto a
 * `{ en, sw }` pair (English from the additive `context` jsonb side-channel,
 * Swahili from the `context_sw` column) so the WIRE carries BOTH languages and
 * the RENDER picks the active locale — no single-language prose crosses the
 * wire. `en` is null for legacy rows that predate the locale-neutral writer
 * (English was never captured); the panel renders a localized placeholder for
 * those rather than the Swahili prose (which would be language-mixing).
 */
export const escalationContextSchema = z.object({
  en: z.string().nullable(),
  sw: z.string(),
});

export type EscalationContext = z.infer<typeof escalationContextSchema>;

/**
 * Mirrors the projected wire shape from `escalations.hono.ts`
 * (`projectEscalation`): the raw `context_sw` column is replaced by a
 * locale-neutral `context: { en, sw }` pair. Timestamp columns serialize to
 * ISO strings over JSON.
 */
export const miningEscalationRowSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  raisedByUserId: z.string(),
  toUserId: z.string().nullable(),
  toRole: z.string().nullable(),
  sourceKind: z.string(),
  sourceId: z.string().nullable(),
  context: escalationContextSchema,
  severity: z.enum(ESCALATION_SEVERITIES),
  status: z.enum(ESCALATION_STATUSES),
  acknowledgedAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type MiningEscalationRow = z.infer<typeof miningEscalationRowSchema>;

const rowsSchema = z.array(miningEscalationRowSchema);

/**
 * GET the active-ladder list scoped to the request tenant (RLS GUC) and
 * the current user (raised-by or addressed-to). Resolved rows are filtered
 * out so the panel shows only work still needing a human; acknowledged stays
 * visible as a distinct in-flight state until it is resolved.
 *
 * `apiRequest` unwraps the gateway `{success,data}` envelope, so the parsed
 * payload is the rows array directly.
 */
export async function fetchOpenEscalations(
  signal?: AbortSignal,
): Promise<ReadonlyArray<MiningEscalationRow>> {
  const payload = await apiRequest<unknown>(ESCALATIONS_BASE, {
    method: 'GET',
    ...(signal ? { signal } : {}),
  });
  const rows = rowsSchema.parse(payload);
  return rows.filter((r) => r.status !== 'resolved');
}

async function postTransition(
  id: string,
  verb: 'acknowledge' | 'resolve',
): Promise<MiningEscalationRow> {
  const payload = await apiRequest<unknown>(`${ESCALATIONS_BASE}/${id}/${verb}`, {
    method: 'POST',
  });
  return miningEscalationRowSchema.parse(payload);
}

/** Addressee marks an escalation acknowledged. */
export function acknowledgeEscalation(id: string): Promise<MiningEscalationRow> {
  return postTransition(id, 'acknowledge');
}

/** Raiser or addressee closes an escalation. */
export function resolveEscalation(id: string): Promise<MiningEscalationRow> {
  return postTransition(id, 'resolve');
}
