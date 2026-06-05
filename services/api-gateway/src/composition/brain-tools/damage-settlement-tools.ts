/**
 * Damage-settlement brain tools — chat-as-OS parity for migration 0279.
 *
 * Ported from the BossNyumba chat-king dispute tools
 * (owner.damage_deduction.settle / respond, owner.conditional_survey.
 * approve_plan), retargeted real-estate → mining:
 *
 *   1. site.damage_claim.settle           agree + finalise a contractor /
 *                                         site damage claim at an agreed
 *                                         amount (HIGH stakes WRITE).
 *   2. site.damage_claim.respond          owner counter-proposal / rationale
 *                                         on an open claim (HIGH stakes WRITE).
 *   3. site.rehabilitation.approve_plan   approve a proposed mine-
 *                                         rehabilitation action plan,
 *                                         unblocking work-order dispatch
 *                                         (HIGH stakes WRITE).
 *
 * All three are OWNER-only (T1_owner_strategist) HIGH-stakes WRITE tools that
 * wrap the REAL `/damage-claims/*` gateway routes via `ctx.httpClient`
 * (loopback) — the SAME auth, RLS, audit-trail, and kill-switch guards apply
 * as a browser request. No mock data; the defensive `if (!client)` branch
 * returns an honest `unavailable` shape rather than fabricating a result.
 *
 * Provenance discipline (CLAUDE.md hard rule): every WRITE body is wrapped
 * with the canonical `withChatProvenance` so the downstream audit row
 * deep-links back to the originating chat turn (the "via Mr. Mwikila" pill).
 *
 * Money: settlement records the agreed amount as STATE only — no ledger
 * posting fires from these tools. Amounts are minor-unit integers; the
 * currency is resolved upstream and passed through (never hard-coded here).
 *
 * Companion files:
 *   - services/api-gateway/src/routes/damage-claims.hono.ts
 *   - services/api-gateway/src/composition/damage-claim-repository.ts
 *   - packages/database/src/migrations/0279_site_damage_settlement.sql
 */

import { z } from 'zod';

import type { PersonaToolDescriptor } from './types';
import { withChatProvenance } from './provenance-injector';

const OWNER: ReadonlyArray<'T1_owner_strategist'> = ['T1_owner_strategist'];

// ───────────────────────────────────────────────────────────────────
// 1. site.damage_claim.settle
// ───────────────────────────────────────────────────────────────────

const DamageSettleInput = z.object({
  claimId: z.string().min(1).max(120),
  agreedAmountMinor: z.number().int().nonnegative(),
  notes: z.string().max(4000).optional(),
});

const DamageSettleOutput = z.object({
  id: z.string(),
  status: z.string(),
  agreedAmountMinor: z.number().int().nonnegative().nullable(),
  settledAt: z.string().nullable(),
});

export const siteDamageClaimSettleTool: PersonaToolDescriptor<
  typeof DamageSettleInput,
  typeof DamageSettleOutput
> = {
  id: 'site.damage_claim.settle',
  name: 'Owner — settle site damage claim (en) / Mwenye — maliza dai la uharibifu wa eneo (sw)',
  description:
    'Agree and finalise a contractor / site damage claim with a confirmed ' +
    'amount in minor currency units. HIGH stakes — moves the claim to ' +
    '`agreed` status and emits the canonical audit row. Records the agreed ' +
    'amount as STATE only; no ledger posting fires. Use when the owner ' +
    'replies "approve the contractor settlement", "settle for 50000", ' +
    '"finalise at the agreed amount" in chat.',
  personaSlugs: OWNER,
  inputSchema: DamageSettleInput,
  outputSchema: DamageSettleOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        id: '',
        status: 'unavailable',
        agreedAmountMinor: input.agreedAmountMinor,
        settledAt: null,
      };
    }
    const settleBody: { agreedAmountMinor: number; notes?: string } = {
      agreedAmountMinor: input.agreedAmountMinor,
    };
    if (input.notes !== undefined) settleBody.notes = input.notes;
    const body = withChatProvenance(settleBody, ctx);
    const res = await client.post<{
      success?: boolean;
      data?: {
        id?: string;
        status?: string;
        agreed_amount_minor?: number | null;
        settled_at?: string | null;
      };
    }>(`/damage-claims/${encodeURIComponent(input.claimId)}/settle`, body);
    const row = res.data ?? {};
    return {
      id: String(row.id ?? ''),
      status: String(row.status ?? 'agreed'),
      agreedAmountMinor:
        row.agreed_amount_minor === null || row.agreed_amount_minor === undefined
          ? input.agreedAmountMinor
          : Number(row.agreed_amount_minor),
      settledAt: row.settled_at ?? null,
    };
  },
};

// ───────────────────────────────────────────────────────────────────
// 2. site.damage_claim.respond
// ───────────────────────────────────────────────────────────────────

const DamageRespondInput = z.object({
  claimId: z.string().min(1).max(120),
  counterProposalMinor: z.number().int().nonnegative().optional(),
  rationale: z.string().min(1).max(4000),
});

const DamageRespondOutput = z.object({
  id: z.string(),
  status: z.string(),
  counterProposalMinor: z.number().int().nullable(),
});

export const siteDamageClaimRespondTool: PersonaToolDescriptor<
  typeof DamageRespondInput,
  typeof DamageRespondOutput
> = {
  id: 'site.damage_claim.respond',
  name: 'Owner — respond to site damage claim (en) / Mwenye — jibu dai la uharibifu wa eneo (sw)',
  description:
    'Record a counter-proposal or rationale on an open contractor / site ' +
    'damage claim. Use when the owner wants to push back ("reject — request ' +
    'site photos", "counter at 25000 — see the inspection report"). ' +
    'Rationale is required. HIGH stakes — moves the claim to `negotiating`.',
  personaSlugs: OWNER,
  inputSchema: DamageRespondInput,
  outputSchema: DamageRespondOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        id: '',
        status: 'unavailable',
        counterProposalMinor: input.counterProposalMinor ?? null,
      };
    }
    const body = withChatProvenance(
      {
        counterProposalMinor: input.counterProposalMinor ?? null,
        rationale: input.rationale,
      },
      ctx,
    );
    const res = await client.post<{
      success?: boolean;
      data?: {
        id?: string;
        status?: string;
        counter_proposal_minor?: number | null;
      };
    }>(`/damage-claims/${encodeURIComponent(input.claimId)}/respond`, body);
    const row = res.data ?? {};
    return {
      id: String(row.id ?? ''),
      status: String(row.status ?? 'negotiating'),
      counterProposalMinor:
        row.counter_proposal_minor === null ||
        row.counter_proposal_minor === undefined
          ? (input.counterProposalMinor ?? null)
          : Number(row.counter_proposal_minor),
    };
  },
};

// ───────────────────────────────────────────────────────────────────
// 3. site.rehabilitation.approve_plan
// ───────────────────────────────────────────────────────────────────

const RehabApprovePlanInput = z.object({
  rehabilitationPlanId: z.string().min(1).max(120),
  actionPlanId: z.string().min(1).max(120),
});

const RehabApprovePlanOutput = z.object({
  id: z.string(),
  status: z.string(),
  approvedAt: z.string().nullable(),
});

export const siteRehabilitationApprovePlanTool: PersonaToolDescriptor<
  typeof RehabApprovePlanInput,
  typeof RehabApprovePlanOutput
> = {
  id: 'site.rehabilitation.approve_plan',
  name: 'Owner — approve rehabilitation action plan (en) / Mwenye — idhinisha mpango wa ukarabati (sw)',
  description:
    'Approve a proposed mine-rehabilitation action plan tied to a site ' +
    'rehabilitation plan. HIGH stakes — moves the action plan to `approved` ' +
    'and unblocks the downstream work-order dispatch. Use when the owner ' +
    'says "approve the rehabilitation plan", "green-light the backfill ' +
    'proposal", "okay to proceed with the re-vegetation plan".',
  personaSlugs: OWNER,
  inputSchema: RehabApprovePlanInput,
  outputSchema: RehabApprovePlanOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { id: '', status: 'unavailable', approvedAt: null };
    }
    const body = withChatProvenance({}, ctx);
    const res = await client.post<{
      success?: boolean;
      data?: { id?: string; status?: string; approved_at?: string | null };
    }>(
      `/damage-claims/rehabilitation-plans/` +
        `${encodeURIComponent(input.rehabilitationPlanId)}/action-plans/` +
        `${encodeURIComponent(input.actionPlanId)}/approve`,
      body,
    );
    const row = res.data ?? {};
    return {
      id: String(row.id ?? ''),
      status: String(row.status ?? 'approved'),
      approvedAt: row.approved_at ?? null,
    };
  },
};

// ───────────────────────────────────────────────────────────────────
// Catalog export
// ───────────────────────────────────────────────────────────────────

export const DAMAGE_SETTLEMENT_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  siteDamageClaimSettleTool,
  siteDamageClaimRespondTool,
  siteRehabilitationApprovePlanTool,
] as unknown as ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
>);
