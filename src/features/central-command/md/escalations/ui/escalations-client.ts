"use client";

/**
 * escalations-client — typed gateway client for the authoritative
 * manager-dispatch escalation ladder (`mining_escalations`).
 *
 * SLICE B1: the Escalations tab previously subscribed to
 * `org_escalations` via Supabase realtime, but the never-drop ladder
 * (estate-mind-wiring rung-4) and the `/api/v1/mining/escalations`
 * route both write `mining_escalations` — so ladder-raised escalations
 * were invisible to the only UI. This client repoints the read at the
 * AUTHORITATIVE table through the mounted gateway GET, and exposes the
 * acknowledge / resolve closing calls that previously had ZERO callers.
 *
 * Transport mirrors `ActionConsole` / `LearningConsole`: same-origin
 * relative `/api/v1/...` fetch carrying the `borjie-session` cookie
 * (web clients never marshal a Bearer token) plus CSRF headers. The
 * response is zod-validated so a misshapen row never reaches render.
 *
 * @module features/central-command/md/escalations/ui/escalations-client
 */

import { z } from "zod";
import { getCsrfHeaders } from "@/hooks/useCsrfToken";

/** Mounted under `/mining` in `routes/mining/index.ts`, served at `/api/v1`. */
const ESCALATIONS_BASE = "/api/v1/mining/escalations";

export const ESCALATION_SEVERITIES = ["info", "warning", "critical"] as const;
export const ESCALATION_STATUSES = ["open", "acknowledged", "resolved"] as const;

export type EscalationSeverity = (typeof ESCALATION_SEVERITIES)[number];
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

/**
 * Mirrors the camelCase keys Drizzle returns from
 * `db.select().from(miningEscalations)` in escalations.hono.ts.
 */
export const miningEscalationRowSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  raisedByUserId: z.string(),
  toUserId: z.string().nullable(),
  toRole: z.string().nullable(),
  sourceKind: z.string(),
  sourceId: z.string().nullable(),
  contextSw: z.string(),
  severity: z.enum(ESCALATION_SEVERITIES),
  status: z.enum(ESCALATION_STATUSES),
  acknowledgedAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type MiningEscalationRow = z.infer<typeof miningEscalationRowSchema>;

const listResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(miningEscalationRowSchema),
});

const mutateResponseSchema = z.object({
  success: z.literal(true),
  data: miningEscalationRowSchema,
});

/** Thrown with a locale-agnostic code; the component maps to en/sw copy. */
export class EscalationsRequestError extends Error {
  constructor(public readonly httpStatus: number) {
    super(`escalations_request_failed_${httpStatus}`);
    this.name = "EscalationsRequestError";
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * GET the active-ladder list (open + acknowledged) scoped to the
 * request tenant (RLS GUC). Resolved rows are filtered out so the tab
 * shows only work still needing a human; acknowledge stays visible as a
 * distinct in-flight state until it is resolved.
 */
export async function fetchOpenEscalations(
  signal?: AbortSignal,
): Promise<ReadonlyArray<MiningEscalationRow>> {
  const res = await fetch(ESCALATIONS_BASE, {
    method: "GET",
    headers: { Accept: "application/json", ...getCsrfHeaders() },
    credentials: "same-origin",
    signal,
  });
  if (!res.ok) throw new EscalationsRequestError(res.status);
  const rows = listResponseSchema.parse(await readJson(res)).data;
  return rows.filter((r) => r.status !== "resolved");
}

async function postTransition(
  id: string,
  verb: "acknowledge" | "resolve",
): Promise<MiningEscalationRow> {
  const res = await fetch(`${ESCALATIONS_BASE}/${id}/${verb}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getCsrfHeaders() },
    credentials: "same-origin",
  });
  if (!res.ok) throw new EscalationsRequestError(res.status);
  return mutateResponseSchema.parse(await readJson(res)).data;
}

/** Addressee marks an escalation acknowledged. */
export function acknowledgeEscalation(id: string): Promise<MiningEscalationRow> {
  return postTransition(id, "acknowledge");
}

/** Raiser or addressee closes an escalation. */
export function resolveEscalation(id: string): Promise<MiningEscalationRow> {
  return postTransition(id, "resolve");
}
