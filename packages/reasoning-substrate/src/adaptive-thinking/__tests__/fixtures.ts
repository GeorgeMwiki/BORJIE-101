/**
 * Adaptive-thinking fixtures.
 *
 * 12 (prompt, expected-thinking-shape) cases covering the most common
 * MD turns we expect Claude Opus 4.7 / Sonnet 4.6 to receive. Each
 * fixture pairs an input prompt with the wire-shape the wrapper MUST
 * produce. The actual model response is stubbed in the tests.
 */

import type { AdaptiveEffort, AdaptiveThinkingParam } from '../types.js';

export interface ThinkingFixture {
  readonly id: string;
  readonly description: string;
  readonly prompt: string;
  readonly effort?: AdaptiveEffort;
  readonly expectedThinkingParam: AdaptiveThinkingParam;
  readonly expectedModel: string;
}

export const ADAPTIVE_FIXTURES: ReadonlyArray<ThinkingFixture> = [
  {
    id: 'rent-proration-low',
    description: 'Low-effort: simple rent proration arithmetic.',
    prompt: 'Tenant moved in on day 12 of a 30-day month at KES 24,000. What is the prorated rent?',
    effort: 'low',
    expectedThinkingParam: { type: 'adaptive', effort: 'low' },
    expectedModel: 'claude-opus-4-7',
  },
  {
    id: 'late-fee-medium',
    description: 'Medium-effort: late fee computation against TZ Rental Act caps.',
    prompt: 'Compute late fee for tenant t_8821 — 17 days overdue on KES 32,500. TZ jurisdiction.',
    effort: 'medium',
    expectedThinkingParam: { type: 'adaptive', effort: 'medium' },
    expectedModel: 'claude-opus-4-7',
  },
  {
    id: 'eviction-high',
    description: 'High-effort: eviction-warranted evaluation for non-payment.',
    prompt: 'Is an eviction notice lawful for tenant t_8821 (4 missed payments, mediation_opt_in=true)?',
    effort: 'high',
    expectedThinkingParam: { type: 'adaptive', effort: 'high' },
    expectedModel: 'claude-opus-4-7',
  },
  {
    id: 'lease-renewal-default',
    description: 'Default (no effort): lease-renewal date math.',
    prompt: 'When does lease L-4422 renew? Started 2025-04-01, 12-month term.',
    expectedThinkingParam: { type: 'adaptive' },
    expectedModel: 'claude-sonnet-4-6',
  },
  {
    id: 'currency-convert-low',
    description: 'Low-effort: currency conversion request.',
    prompt: 'Convert KES 50,000 to TZS at today’s rate.',
    effort: 'low',
    expectedThinkingParam: { type: 'adaptive', effort: 'low' },
    expectedModel: 'claude-haiku-4-5',
  },
  {
    id: 'kra-mri-submit-high',
    description: 'High-effort: KRA-MRI rental income submission.',
    prompt: 'Prepare KRA-MRI submission payload for landlord L-12 for tax year 2025.',
    effort: 'high',
    expectedThinkingParam: { type: 'adaptive', effort: 'high' },
    expectedModel: 'claude-opus-4-7',
  },
  {
    id: 'mediation-offer-medium',
    description: 'Medium-effort: draft mediation offer notice.',
    prompt: 'Draft a mediation-offer notice for tenant t_8821 with arrears KES 130,000.',
    effort: 'medium',
    expectedThinkingParam: { type: 'adaptive', effort: 'medium' },
    expectedModel: 'claude-opus-4-7',
  },
  {
    id: 'tenant-qa-default',
    description: 'Default: routine tenant Q&A.',
    prompt: 'When is rent due this month?',
    expectedThinkingParam: { type: 'adaptive' },
    expectedModel: 'claude-sonnet-4-6',
  },
  {
    id: 'payment-plan-medium',
    description: 'Medium-effort: payment plan terms proposal.',
    prompt: 'Propose a 4-month payment plan for KES 200,000 arrears with 5% APR.',
    effort: 'medium',
    expectedThinkingParam: { type: 'adaptive', effort: 'medium' },
    expectedModel: 'claude-opus-4-7',
  },
  {
    id: 'dispute-escalation-high',
    description: 'High-effort: dispute escalation to tribunal evaluation.',
    prompt: 'Should we escalate the t_8821 dispute to the rent tribunal?',
    effort: 'high',
    expectedThinkingParam: { type: 'adaptive', effort: 'high' },
    expectedModel: 'claude-opus-4-7',
  },
  {
    id: 'deposit-refund-low',
    description: 'Low-effort: deposit refund computation.',
    prompt: 'Tenant vacated. Deposit KES 60,000. Damage cost KES 8,500. Refund?',
    effort: 'low',
    expectedThinkingParam: { type: 'adaptive', effort: 'low' },
    expectedModel: 'claude-sonnet-4-6',
  },
  {
    id: 'multi-tenant-report-default',
    description: 'Default: multi-property monthly statement summary.',
    prompt: 'Summarise Q1 rent collection across all 12 units of estate E-3.',
    expectedThinkingParam: { type: 'adaptive' },
    expectedModel: 'claude-sonnet-4-6',
  },
];

// ─────────────────────────────────────────────────────────────────────
// 5 tool-interleave cases — each defines a tool the assistant must
// "call" between thinking blocks, and the expected ordering of blocks
// in the response (thinking → tool_use → thinking → text or similar).
// ─────────────────────────────────────────────────────────────────────

export interface ToolInterleaveCase {
  readonly id: string;
  readonly description: string;
  readonly prompt: string;
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
  readonly expectedBlockOrder: ReadonlyArray<'thinking' | 'tool_use' | 'text'>;
}

export const TOOL_INTERLEAVE_CASES: ReadonlyArray<ToolInterleaveCase> = [
  {
    id: 'lease-lookup',
    description: 'Eviction eval pulls get_lease before deliberating further.',
    prompt: 'Decide whether to send eviction notice for t_8821.',
    toolName: 'get_lease',
    toolInput: { tenantId: 't_8821' },
    expectedBlockOrder: ['thinking', 'tool_use'],
  },
  {
    id: 'payment-history',
    description: 'Late-fee compute pulls query_rent_history first.',
    prompt: 'Late-fee for t_8821 — what is the unpaid balance?',
    toolName: 'query_rent_history',
    toolInput: { tenantId: 't_8821', months: 12 },
    expectedBlockOrder: ['thinking', 'tool_use'],
  },
  {
    id: 'mediation-status',
    description: 'Eviction blocked by mediation; thinks, checks status, thinks, answers.',
    prompt: 'Is the eviction notice lawful given mediation clause?',
    toolName: 'check_mediation_status',
    toolInput: { tenantId: 't_8821' },
    expectedBlockOrder: ['thinking', 'tool_use', 'thinking', 'text'],
  },
  {
    id: 'fx-rate',
    description: 'Currency convert pulls FX rate, thinks, answers.',
    prompt: 'Convert KES 50,000 to TZS.',
    toolName: 'get_fx_rate',
    toolInput: { from: 'KES', to: 'TZS' },
    expectedBlockOrder: ['thinking', 'tool_use', 'thinking', 'text'],
  },
  {
    id: 'jurisdiction-lookup',
    description: 'Mid-turn jurisdiction lookup interleaved with thinking.',
    prompt: 'What notice period is required in this jurisdiction?',
    toolName: 'get_jurisdiction_rules',
    toolInput: { code: 'TZ-DSM' },
    expectedBlockOrder: ['thinking', 'tool_use'],
  },
];
