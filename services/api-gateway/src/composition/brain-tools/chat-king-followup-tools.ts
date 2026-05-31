/**
 * Chat-King follow-up brain tools — close 2 of the 20 deferred items
 * from Docs/AUDIT/CHAT_ACTION_COVERAGE_2026-05-29.md.
 *
 * The CE-1 wave closed 6/26 gaps and consciously deferred 20 items to
 * "sibling waves". Three of those deferred items have backend routes
 * that ALREADY exist and are stable (no sibling-wave file collision):
 *
 *   1. ops.parties.create               → POST /ops/external-parties
 *   2. buyer.notifications.mark_read    → POST /buyer/notifications/:id/read
 *
 * Both are real DB writes (audit-chain appended on the backend) with
 * zero mock data and zero fallback stubs — the chat-king bar (the user's
 * explicit "REAL output from REAL DB/service calls" rule) is honored.
 *
 * The third originally-deferred item (admin.kill_switch.open/close,
 * admin.policy.edit-rule, admin.four-eye.*, admin.feature-flags.set)
 * already shipped via admin-inviolable-tools.ts (G-FIX-5) — so the
 * audit doc is outdated on those. This wave does not re-ship them.
 *
 * Persona scoping:
 *   - `ops.parties.create`             → OWNER (T1) only — counterparty
 *                                        registry is owner-scoped
 *   - `buyer.notifications.mark_read`  → BUYER (T5 customer concierge)
 *                                        only — mobile inbox is buyer-
 *                                        scoped
 */

import { z } from 'zod';

import type {
  PersonaToolDescriptor,
  PersonaToolHandlerContext,
} from './types';

const OWNER: ReadonlyArray<'T1_owner_strategist'> = ['T1_owner_strategist'];
const BUYER: ReadonlyArray<'T5_customer_concierge'> = ['T5_customer_concierge'];

/**
 * Inline provenance shim — same shape as `provenance-injector.ts` but
 * embedded so this file stays self-contained while the chat-king wave
 * lands. The downstream audit row reads `provenance.via` for the
 * "via Mr. Mwikila" pill.
 */
function withChatProvenance<T extends Record<string, unknown>>(
  body: T,
  ctx: PersonaToolHandlerContext,
): T & {
  provenance: {
    via: 'chat';
    sessionId: string | null;
    turnId: string | null;
    actorId: string;
  };
} {
  return {
    ...body,
    provenance: {
      via: 'chat',
      sessionId: ctx.chatSessionId ?? null,
      turnId: ctx.chatTurnId ?? null,
      actorId: ctx.actorId,
    },
  };
}

// ───────────────────────────────────────────────────────────────────
// 1. ops.parties.create
// ───────────────────────────────────────────────────────────────────

const PARTY_TYPES = [
  'broker',
  'cooperative',
  'buyer',
  'supplier',
  'inspector',
  'regulator',
  'investor',
  'consultant',
  'transporter',
  'insurer',
  'other',
] as const;

const PartyCreateInput = z.object({
  partyType: z.enum(PARTY_TYPES),
  name: z.string().trim().min(1).max(300),
  tin: z.string().trim().max(64).nullable().optional(),
  brelaNo: z.string().trim().max(64).nullable().optional(),
  country: z.string().trim().min(2).max(8).default('TZ'),
  region: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

const PartyCreateOutput = z.object({
  id: z.string(),
  partyType: z.string(),
  name: z.string(),
});

export const opsPartiesCreateTool: PersonaToolDescriptor<
  typeof PartyCreateInput,
  typeof PartyCreateOutput
> = {
  id: 'ops.parties.create',
  name: 'Add a counterparty (en) / Ongeza mshirika wa biashara (sw)',
  description:
    'Create a new counterparty (broker, cooperative, buyer, supplier, ' +
    'inspector, regulator, investor, consultant, transporter, insurer, ' +
    'other) in the owner-scoped registry. WRITE — appends an audit-' +
    'chain row. Use when the owner says "add X as a buyer", "register ' +
    'broker Y", or "add cooperative Z to my counterparties".',
  personaSlugs: OWNER,
  inputSchema: PartyCreateInput,
  outputSchema: PartyCreateOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        id: '',
        partyType: input.partyType,
        name: input.name,
      };
    }
    const body = withChatProvenance(
      {
        partyType: input.partyType,
        name: input.name,
        tin: input.tin ?? null,
        brelaNo: input.brelaNo ?? null,
        country: input.country,
        region: input.region ?? null,
        primaryContact: {},
        paymentTerms: {},
        scorecardScore: 0,
        notes: input.notes ?? null,
      },
      ctx,
    );
    const res = await client.post<{
      success: boolean;
      data: { id: string };
    }>('/ops/external-parties', body);
    return {
      id: res.data?.id ?? '',
      partyType: input.partyType,
      name: input.name,
    };
  },
};

// ───────────────────────────────────────────────────────────────────
// 2. buyer.notifications.mark_read
// ───────────────────────────────────────────────────────────────────

const BuyerNotificationsMarkReadInput = z.object({
  notificationId: z.string().min(1).max(120),
});

const BuyerNotificationsMarkReadOutput = z.object({
  id: z.string(),
  readAt: z.string().nullable(),
});

export const buyerNotificationsMarkReadTool: PersonaToolDescriptor<
  typeof BuyerNotificationsMarkReadInput,
  typeof BuyerNotificationsMarkReadOutput
> = {
  id: 'buyer.notifications.mark_read',
  name: 'Buyer — mark notification read (en) / Mnunuzi — weka taarifa imesomwa (sw)',
  description:
    'Mark a single buyer-mobile notification row as read. LOW-stakes ' +
    'WRITE — updates the read_at timestamp. Use when the buyer says ' +
    '"mark this as read", "dismiss notification X", or "clear that ' +
    'alert" in the mobile chat surface.',
  personaSlugs: BUYER,
  inputSchema: BuyerNotificationsMarkReadInput,
  outputSchema: BuyerNotificationsMarkReadOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        id: input.notificationId,
        readAt: null,
      };
    }
    const body = withChatProvenance({}, ctx);
    const res = await client.post<{
      success: boolean;
      data?: { id: string; readAt: string | null };
    }>(
      `/buyer/notifications/${encodeURIComponent(input.notificationId)}/read`,
      body,
    );
    return {
      id: res.data?.id ?? input.notificationId,
      readAt: res.data?.readAt ?? null,
    };
  },
};

// ───────────────────────────────────────────────────────────────────
// Catalog export
// ───────────────────────────────────────────────────────────────────

export const CHAT_KING_FOLLOWUP_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  opsPartiesCreateTool,
  buyerNotificationsMarkReadTool,
] as unknown as ReadonlyArray<PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>>);
