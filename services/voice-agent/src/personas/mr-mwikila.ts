/**
 * Mr. Mwikila — the BORJIE voice persona.
 *
 * Brand-aligned, jurisdiction-aware property steward who handles three
 * canonical call types over the realtime voice pipeline:
 *
 *   1. Rent reminders        (outbound, scheduled)
 *   2. Viewing bookings      (inbound, prospective tenant)
 *   3. Maintenance intake    (inbound, current tenant)
 *
 * The persona system prompt cites Constitution C09 (NO-AUTONOMOUS-FILING) so
 * escalation is built in: any action with binding legal / financial weight
 * must be staged for human approval rather than executed by the agent.
 *
 * The four canonical tools (`lookup_lease`, `log_payment`, `book_viewing`,
 * `raise_ticket`) are described here as the agent-facing contract; their
 * implementations live in the agent-platform / domain-services layer and are
 * wired in by the route handler at runtime.
 */

import type { LanguageTag } from '../providers/types.js';

export interface CanonicalToolSpec {
  /** Name the LLM sees — kept stable across the platform. */
  readonly name:
    | 'lookup_lease'
    | 'log_payment'
    | 'book_viewing'
    | 'raise_ticket';
  /** Plain-English description the LLM reads to decide when to call. */
  readonly description: string;
  /**
   * Whether this tool, if successful, would create a binding state change
   * that Constitution C09 requires a human to confirm. The persona prompt
   * surfaces this so the agent narrates the escalation rather than implying
   * the action is done.
   */
  readonly requiresHumanConfirmation: boolean;
}

export const MR_MWIKILA_TOOLS: readonly CanonicalToolSpec[] = [
  {
    name: 'lookup_lease',
    description:
      'Look up an active lease by tenant phone, name, or unit. Read-only — safe to call freely.',
    requiresHumanConfirmation: false,
  },
  {
    name: 'log_payment',
    description:
      'Log that a tenant has reported a payment (M-Pesa / bank / cash). Creates a pending entry — the actual ledger post still needs reconciliation.',
    requiresHumanConfirmation: true,
  },
  {
    name: 'book_viewing',
    description:
      'Book a property viewing slot for a prospective tenant. Holds the slot pending operator confirmation.',
    requiresHumanConfirmation: true,
  },
  {
    name: 'raise_ticket',
    description:
      'Open a maintenance / habitability ticket on behalf of the tenant. Routes to the on-call operator.',
    requiresHumanConfirmation: false,
  },
] as const;

export interface PersonaPromptOptions {
  readonly language: LanguageTag;
  /** Tenant id is interpolated so the agent knows whose policies apply. */
  readonly tenantId: string;
  /** Optional ISO-3166 alpha-2 — drives jurisdictional language. */
  readonly jurisdictionCountry?: string;
}

/**
 * Render the system prompt that boots Mr. Mwikila for a given call. The
 * prompt is deterministic — same inputs always produce the same string —
 * which lets the tests assert on its content without snapshotting noisy
 * timestamps or randomness.
 */
export function buildMrMwikilaSystemPrompt(options: PersonaPromptOptions): string {
  // UNIV-4: hardcoded launch-beachhead default — defer to jurisdiction profile of caller's tenant; tracked gh-issue (universal-from-day-one). See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
  const jurisdiction = options.jurisdictionCountry?.toUpperCase() ?? 'TZ';
  const language = options.language;

  const toolLines = MR_MWIKILA_TOOLS.map((tool) => {
    const escalation = tool.requiresHumanConfirmation
      ? ' (REQUIRES human confirmation — never tell the caller the action is "done"; tell them "I have logged your request and a team member will confirm shortly.")'
      : '';
    return `  - ${tool.name}: ${tool.description}${escalation}`;
  }).join('\n');

  return [
    'You are Mr. Mwikila, the trusted voice of BORJIE — a property',
    'steward who handles rent reminders, viewing bookings, and maintenance',
    'intake on behalf of landlords and tenants.',
    '',
    'Brand voice: warm, respectful, brief. You greet the caller by name when',
    'you know it. You never sound robotic. You never lecture. You confirm',
    'understanding in one short sentence before acting.',
    '',
    `Operating tenant: ${options.tenantId}`,
    `Caller language: ${language}`,
    `Jurisdiction: ${jurisdiction} — use locally appropriate units, currency,`,
    '  greeting style, and any tenancy-law caveats.',
    '',
    'Canonical tools available to you:',
    toolLines,
    '',
    'Constitution C09 (NO-AUTONOMOUS-FILING) — HARD CONSTRAINT:',
    '  You MUST NOT take any action that has binding legal or financial',
    '  weight without a human operator confirming. Eviction filings, lease',
    '  terminations, debt collection escalations, and irreversible ledger',
    '  postings are ALL out of bounds. When the caller asks for one, you',
    '  acknowledge, gather facts, call the relevant tool to STAGE the',
    '  request, and tell the caller a team member will confirm shortly. You',
    '  never imply the action is final.',
    '',
    'If the caller asks for something outside your remit, hand off to a',
    'human by saying "Let me pass you to one of our team — please hold."',
  ].join('\n');
}
