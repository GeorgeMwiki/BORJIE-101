/**
 * Insurance brain tools — chat-as-OS parity for migration 0106.
 *
 * Four tools backing the `/api/v1/insurance/{quotes,policies}` family:
 *
 *   - `insurance.get_quotes`    WRITE: fan-out via broker port
 *   - `insurance.bind_policy`   WRITE: bind a quote
 *   - `insurance.policy_status` READ:  list active policies
 *   - `insurance.renewals_due`  READ:  renewal countdown
 *
 * The two WRITE tools are MEDIUM stakes (quoting moves money on the
 * broker side; binding is a fiduciary commitment). They emit an audit
 * entry on every call and forward chat provenance to the explicit
 * route so the row's pill in the UI deep-links back to the chat turn.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';
import { withChatProvenance } from './provenance-injector';

const OWNER: ReadonlyArray<'T1_owner_strategist'> = ['T1_owner_strategist'];

const COVERAGE = [
  'workforce',
  'plant',
  'environmental',
  'third_party',
  'transit',
  'political_risk',
] as const;

// ---------------------------------------------------------------------------
// 1. insurance.get_quotes (WRITE)
// ---------------------------------------------------------------------------

const GetQuotesInput = z.object({
  brokerPartyId: z.string().uuid(),
  coverageType: z.enum(COVERAGE),
  sumInsuredTzs: z.number().nonnegative(),
  region: z.string().max(64).optional(),
  riskProfile: z.record(z.unknown()).default({}),
});
const GetQuotesOutput = z.object({
  quotes: z.array(
    z.object({
      id: z.string(),
      providerId: z.string(),
      premiumTzs: z.string(),
      deductibleTzs: z.string(),
      validUntil: z.string(),
    }),
  ),
});
export const insuranceGetQuotesTool: PersonaToolDescriptor<
  typeof GetQuotesInput,
  typeof GetQuotesOutput
> = {
  id: 'insurance.get_quotes',
  name: 'Insurance — request quotes',
  description:
    'Request insurance quotes via the broker port. Fans out to enrolled ' +
    'providers and persists each offer. Returns the persisted quote rows.',
  personaSlugs: OWNER,
  inputSchema: GetQuotesInput,
  outputSchema: GetQuotesOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { quotes: [] };
    const response = await client.post<{
      success: boolean;
      data?: ReadonlyArray<Record<string, unknown>>;
    }>(
      '/insurance/quotes',
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          brokerPartyId: input.brokerPartyId,
          coverageType: input.coverageType,
          sumInsuredTzs: input.sumInsuredTzs,
          location: { country: 'TZ', region: input.region },
          riskProfile: input.riskProfile,
        },
        ctx,
      ),
    );
    const rows = response.data ?? [];
    return {
      quotes: rows.map((r) => ({
        id: String(r.id),
        providerId: String(r.provider_id),
        premiumTzs: String(r.premium_tzs),
        deductibleTzs: String(r.deductible_tzs),
        validUntil: String(r.valid_until),
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// 2. insurance.bind_policy (WRITE)
// ---------------------------------------------------------------------------

const BindInput = z.object({
  quoteId: z.string().uuid(),
  paymentRef: z.string().min(1).max(128),
  effectiveAt: z.string().datetime(),
  termMonths: z.number().int().positive().max(60).default(12),
  evidenceDocId: z.string().uuid().optional(),
});
const BindOutput = z.object({
  id: z.string(),
  policyNo: z.string(),
  status: z.string(),
  expiresAt: z.string(),
});
export const insuranceBindPolicyTool: PersonaToolDescriptor<
  typeof BindInput,
  typeof BindOutput
> = {
  id: 'insurance.bind_policy',
  name: 'Insurance — bind quote into policy',
  description:
    'Bind a previously-returned insurance quote into an active policy. ' +
    'Requires a payment_ref (ledger handle). Defers to /insurance/policies/bind.',
  personaSlugs: OWNER,
  inputSchema: BindInput,
  outputSchema: BindOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        id: '',
        policyNo: '',
        status: 'pending',
        expiresAt: '',
      };
    }
    const response = await client.post<{
      success: boolean;
      data: Record<string, unknown>;
    }>(
      '/insurance/policies/bind',
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          quoteId: input.quoteId,
          paymentRef: input.paymentRef,
          effectiveAt: input.effectiveAt,
          termMonths: input.termMonths,
          evidenceDocId: input.evidenceDocId,
        },
        ctx,
      ),
    );
    const row = response.data ?? {};
    return {
      id: String(row.id ?? ''),
      policyNo: String(row.policy_no ?? ''),
      status: String(row.status ?? 'active'),
      expiresAt: String(row.expires_at ?? ''),
    };
  },
};

// ---------------------------------------------------------------------------
// 3. insurance.policy_status (READ)
// ---------------------------------------------------------------------------

const PolicyStatusInput = z.object({
  status: z
    .enum(['active', 'cancelled', 'expired', 'lapsed'])
    .default('active'),
  limit: z.number().int().positive().max(100).default(20),
});
const PolicyStatusOutput = z.object({
  policies: z.array(
    z.object({
      id: z.string(),
      policyNo: z.string(),
      coverageType: z.string(),
      sumInsuredTzs: z.string(),
      expiresAt: z.string(),
      status: z.string(),
    }),
  ),
});
export const insurancePolicyStatusTool: PersonaToolDescriptor<
  typeof PolicyStatusInput,
  typeof PolicyStatusOutput
> = {
  id: 'insurance.policy_status',
  name: 'Insurance — policy register',
  description:
    'List insurance policies for the tenant, default filter status=active. ' +
    'Read-only — defers to /insurance/policies.',
  personaSlugs: OWNER,
  inputSchema: PolicyStatusInput,
  outputSchema: PolicyStatusOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { policies: [] };
    const response = await client.get<{
      success: boolean;
      data?: ReadonlyArray<Record<string, unknown>>;
    }>('/insurance/policies', {
      query: {
        tenantId: ctx.tenantId,
        status: input.status,
        limit: input.limit,
      },
    });
    const rows = response.data ?? [];
    return {
      policies: rows.map((r) => ({
        id: String(r.id),
        policyNo: String(r.policy_no),
        coverageType: String(r.coverage_type),
        sumInsuredTzs: String(r.sum_insured_tzs),
        expiresAt: String(r.expires_at),
        status: String(r.status),
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// 4. insurance.renewals_due (READ)
// ---------------------------------------------------------------------------

const RenewalsDueInput = z.object({
  withinDays: z.number().int().positive().max(365).default(60),
});
const RenewalsDueOutput = z.object({
  renewals: z.array(
    z.object({
      id: z.string(),
      policyNo: z.string(),
      coverageType: z.string(),
      expiresAt: z.string(),
      daysUntilExpiry: z.number().int(),
    }),
  ),
});
export const insuranceRenewalsDueTool: PersonaToolDescriptor<
  typeof RenewalsDueInput,
  typeof RenewalsDueOutput
> = {
  id: 'insurance.renewals_due',
  name: 'Insurance — renewals due',
  description:
    'List policies whose expires_at falls within `withinDays` from today. ' +
    'Read-only — reads from /insurance/policies?status=active and computes ' +
    'days-until-expiry in-tool.',
  personaSlugs: OWNER,
  inputSchema: RenewalsDueInput,
  outputSchema: RenewalsDueOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { renewals: [] };
    const response = await client.get<{
      success: boolean;
      data?: ReadonlyArray<Record<string, unknown>>;
    }>('/insurance/policies', {
      query: {
        tenantId: ctx.tenantId,
        status: 'active',
        limit: 500,
      },
    });
    const rows = response.data ?? [];
    const horizonMs = input.withinDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const renewals: Array<{
      id: string;
      policyNo: string;
      coverageType: string;
      expiresAt: string;
      daysUntilExpiry: number;
    }> = [];
    for (const r of rows) {
      const expiresAtIso = String(r.expires_at);
      const diff = new Date(expiresAtIso).getTime() - now;
      if (diff >= 0 && diff <= horizonMs) {
        renewals.push({
          id: String(r.id),
          policyNo: String(r.policy_no),
          coverageType: String(r.coverage_type),
          expiresAt: expiresAtIso,
          daysUntilExpiry: Math.floor(diff / (24 * 60 * 60 * 1000)),
        });
      }
    }
    return { renewals };
  },
};

// ---------------------------------------------------------------------------
// Export catalogue.
// ---------------------------------------------------------------------------

export const INSURANCE_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  insuranceGetQuotesTool,
  insuranceBindPolicyTool,
  insurancePolicyStatusTool,
  insuranceRenewalsDueTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
