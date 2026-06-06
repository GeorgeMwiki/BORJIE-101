/**
 * SIC-ping reply persistence — shared by the two mount points (WF-6).
 *
 * The worker SIC-ping reply is reachable two ways:
 *   - POST /api/v1/mining/cockpit/sic-pings  (+ /:id/reply)  — canonical
 *   - POST /api/v1/mining/sic-pings           — the workforce-mobile
 *     offline-queue flush target (`endpointFor('sic_ping')` → `sic-pings`
 *     under the mining prefix, NOT the cockpit prefix).
 *
 * Both paths funnel through this one helper so the write logic + table-
 * missing FLAG live in a single place. Persists to the real
 * `mining_sic_ping_replies` table (migration 0285).
 */

import { z } from 'zod';

import { miningSicPingReplies } from '@borjie/database';
import { createLogger } from '../utils/logger';

const moduleLogger = createLogger('sic-ping-reply');

/**
 * Reply body. `loads` arrives from the mobile client as a free-text
 * string (number-pad input); we keep the raw value and parse a clean
 * integer when possible. `pingId` from the offline flush is a CLIENT ref
 * (e.g. `ping-<epoch>`), not a real ping id.
 */
export const sicPingReplyBodySchema = z.object({
  pingId: z.string().trim().min(1).max(120).optional(),
  loads: z.union([z.string().trim().max(120), z.number()]).optional(),
  blockers: z.string().trim().max(2000).optional(),
  repliedAtISO: z.string().datetime().optional(),
  repliedAt: z.string().datetime().optional(),
});

export type SicPingReplyBody = z.infer<typeof sicPingReplyBodySchema>;

/** Minimal Drizzle insert surface — avoids depending on the full client type. */
export interface SicReplyWriter {
  insert: (table: typeof miningSicPingReplies) => {
    values: (row: typeof miningSicPingReplies.$inferInsert) => {
      returning: (cols: { id: typeof miningSicPingReplies.id }) => Promise<
        ReadonlyArray<{ id: string }>
      >;
    };
  };
}

export type SicReplyResult =
  | { readonly ok: true; readonly id: string | null }
  | {
      readonly ok: false;
      readonly status: 503 | 500;
      readonly code: string;
      readonly note?: string;
    };

/** Parse the client's free-text `loads` into a clean integer + raw value. */
export function parseLoads(raw: string | number | undefined): {
  loads: number | null;
  loadsRaw: string | null;
} {
  if (raw === undefined) return { loads: null, loadsRaw: null };
  const loadsRaw = String(raw).trim();
  if (loadsRaw.length === 0) return { loads: null, loadsRaw: null };
  const n = Number(loadsRaw);
  const loads = Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : null;
  return { loads, loadsRaw };
}

/**
 * Insert one SIC-ping reply. `realPingId` is set only when the caller
 * targets a concrete `mining_sic_pings.id` (the `/:id/reply` form);
 * otherwise the body's `pingId` is stored as a client ref (no fabricated
 * FK). Returns a discriminated result the route handler maps to JSON.
 */
export async function persistSicPingReply(
  db: SicReplyWriter,
  ctx: { readonly tenantId: string; readonly userId: string },
  body: SicPingReplyBody,
  opts: { readonly realPingId: string | null },
): Promise<SicReplyResult> {
  const { loads, loadsRaw } = parseLoads(body.loads);
  const repliedAtIso = body.repliedAtISO ?? body.repliedAt;
  const repliedAt = repliedAtIso ? new Date(repliedAtIso) : new Date();
  const clientPingRef = opts.realPingId ? null : (body.pingId ?? null);

  try {
    const inserted = await db
      .insert(miningSicPingReplies)
      .values({
        tenantId: ctx.tenantId,
        pingId: opts.realPingId,
        clientPingRef,
        repliedByUserId: ctx.userId,
        loads,
        loadsRaw,
        blockers: body.blockers ?? null,
        repliedAt,
      })
      .returning({ id: miningSicPingReplies.id });
    return { ok: true, id: inserted[0]?.id ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /relation\s+"?mining_sic_ping_replies"?\s+does not exist/i.test(message) ||
      /no such table:?\s*mining_sic_ping_replies/i.test(message)
    ) {
      moduleLogger.warn(
        'mining_sic_ping_replies missing — apply migration 0285',
        { tenantId: ctx.tenantId },
      );
      return {
        ok: false,
        status: 503,
        code: 'SIC_REPLY_TABLE_MISSING',
        note: 'awaiting migration 0285_mining_sic_ping_replies',
      };
    }
    moduleLogger.error(
      { err, tenantId: ctx.tenantId },
      'sic_ping_reply_insert_failed',
    );
    return { ok: false, status: 500, code: 'SIC_REPLY_FAILED' };
  }
}
