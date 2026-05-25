/**
 * MCP `prompts/list` and `prompts/get` handlers — closes Gap B from
 * `.planning/parity-litfin/09-tools-connectors-kg.md`.
 *
 * The BORJIE MCP server already exposes `tools` and `resources`,
 * but it never declared the `prompts` capability. That means partner
 * platforms (Claude Desktop, Cursor, etc.) cannot discover BORJIE's
 * canonical workflows; every integration partner had to rewrite "how
 * do I do X" prompts themselves.
 *
 * This module ships:
 *   - 5 canonical property-management prompts:
 *       1. Reconcile-Owner-Payout
 *       2. Triage-Tenant-Arrears
 *       3. Schedule-Move-Out-Inspection
 *       4. File-KRA-MRI
 *       5. Forecast-Occupancy-30d
 *   - `listPrompts(context)` → MCP `prompts/list` payload
 *   - `getPrompt(name, args, context)` → MCP `prompts/get` payload with
 *     fully-rendered messages
 *
 * The prompts are TENANT-AWARE — they receive the caller's
 * `McpAuthContext` so renders can address the tenant by id and bind
 * tier-appropriate guidance. They are NOT model-specific — the
 * rendered messages stay model-agnostic and the host MCP client picks
 * the model.
 */

import type { McpAuthContext, McpScope, McpTier } from './types.js';

// ---------- Public types ----------

export type McpPromptRole = 'user' | 'assistant' | 'system';

export interface McpPromptArgument {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
}

export interface McpPromptDefinition {
  readonly name: string;
  readonly description: string;
  readonly minimumTier: McpTier;
  readonly requiredScopes: ReadonlyArray<McpScope>;
  readonly arguments: ReadonlyArray<McpPromptArgument>;
  /**
   * Pure renderer — takes the argument bag + auth context and produces
   * the MCP message list. Implementations MUST NOT touch the network.
   */
  render(args: Readonly<Record<string, string>>, context: McpAuthContext): ReadonlyArray<McpPromptMessage>;
}

export interface McpPromptMessage {
  readonly role: McpPromptRole;
  readonly content: { readonly type: 'text'; readonly text: string };
}

export interface McpPromptListEntry {
  readonly name: string;
  readonly description: string;
  readonly arguments: ReadonlyArray<McpPromptArgument>;
}

export interface McpPromptListResult {
  readonly prompts: ReadonlyArray<McpPromptListEntry>;
}

export interface McpPromptGetResult {
  readonly description: string;
  readonly messages: ReadonlyArray<McpPromptMessage>;
}

export type McpPromptOutcome =
  | { readonly ok: true; readonly result: McpPromptGetResult }
  | { readonly ok: false; readonly error: string; readonly errorCode: string };

// ---------- Tier ordering (mirrors tier-router) ----------

const TIER_RANK: Readonly<Record<McpTier, number>> = Object.freeze({
  standard: 0,
  pro: 1,
  enterprise: 2,
});

function tierMeetsMinimum(caller: McpTier, minimum: McpTier): boolean {
  return TIER_RANK[caller] >= TIER_RANK[minimum];
}

function hasAllScopes(context: McpAuthContext, required: ReadonlyArray<McpScope>): boolean {
  if (required.length === 0) return true;
  const have = new Set(context.scopes);
  for (const s of required) {
    if (!have.has(s)) return false;
  }
  return true;
}

// ---------- Helpers ----------

function userMsg(text: string): McpPromptMessage {
  return Object.freeze({
    role: 'user' as const,
    content: Object.freeze({ type: 'text' as const, text }),
  });
}

function systemMsg(text: string): McpPromptMessage {
  return Object.freeze({
    role: 'system' as const,
    content: Object.freeze({ type: 'text' as const, text }),
  });
}

function arg(args: Readonly<Record<string, string>>, key: string, fallback: string): string {
  const v = args[key];
  return typeof v === 'string' && v.trim().length > 0 ? v : fallback;
}

// ---------- 5 canonical property-management prompts ----------

const RECONCILE_OWNER_PAYOUT: McpPromptDefinition = Object.freeze({
  name: 'Reconcile-Owner-Payout',
  description:
    'Reconcile the monthly owner-payout statement against M-Pesa receipts, deductions, and management-fee withholdings for a given property and period.',
  minimumTier: 'standard',
  requiredScopes: Object.freeze(['read:payments', 'read:properties']) as ReadonlyArray<McpScope>,
  arguments: Object.freeze([
    { name: 'propertyId', description: 'Property ID whose owner payout we are reconciling.', required: true },
    { name: 'period', description: 'ISO month string, e.g. 2026-05.', required: true },
  ]) as ReadonlyArray<McpPromptArgument>,
  render: (args: Readonly<Record<string, string>>, context: McpAuthContext) => Object.freeze([
    systemMsg(
      `You are reconciling an owner payout for BORJIE tenant ${context.tenantId}. ` +
        'Confirm M-Pesa receipts match the rent-roll, subtract documented deductions, ' +
        'and emit a discrepancy table when the residual is non-zero.',
    ),
    userMsg(
      `Reconcile the owner payout for propertyId=${arg(args, 'propertyId', '<propertyId>')} ` +
        `for period=${arg(args, 'period', '<YYYY-MM>')}. ` +
        'Step 1: fetch all rent receipts in the period. ' +
        'Step 2: subtract platform-fee, levies, and approved repair invoices. ' +
        'Step 3: compare to the bank-credit owed and report any variance.',
    ),
  ]) as ReadonlyArray<McpPromptMessage>,
});

const TRIAGE_TENANT_ARREARS: McpPromptDefinition = Object.freeze({
  name: 'Triage-Tenant-Arrears',
  description:
    'Triage a tenant in arrears: classify severity, propose a remediation path (reminder, soft-collection, formal demand, eviction-prep), and draft the next-step communication.',
  minimumTier: 'standard',
  requiredScopes: Object.freeze(['read:tenants', 'read:payments', 'write:letters']) as ReadonlyArray<McpScope>,
  arguments: Object.freeze([
    { name: 'tenantProfileId', description: 'Tenant profile (lease-holder) ID.', required: true },
    { name: 'asOfDate', description: 'ISO date the arrears snapshot should be taken at.', required: false },
  ]) as ReadonlyArray<McpPromptArgument>,
  render: (args: Readonly<Record<string, string>>, context: McpAuthContext) => Object.freeze([
    systemMsg(
      `You are an arrears-triage assistant for BORJIE tenant ${context.tenantId}. ` +
        'Be empathetic but precise. Do NOT recommend eviction-prep unless arrears exceed ' +
        'three months AND the tenant has been unresponsive for at least 14 days.',
    ),
    userMsg(
      `Triage tenantProfileId=${arg(args, 'tenantProfileId', '<tenantProfileId>')} ` +
        `as of date=${arg(args, 'asOfDate', 'today')}. ` +
        'Step 1: pull arrears amount, months-overdue, and contact-attempt history. ' +
        'Step 2: classify severity. ' +
        'Step 3: propose the lightest-touch effective next step and draft the letter body.',
    ),
  ]) as ReadonlyArray<McpPromptMessage>,
});

const SCHEDULE_MOVE_OUT_INSPECTION: McpPromptDefinition = Object.freeze({
  name: 'Schedule-Move-Out-Inspection',
  description:
    'Schedule a move-out inspection for a unit: pick the slot, assign the inspector, generate the checklist, and notify the tenant + owner.',
  minimumTier: 'standard',
  requiredScopes: Object.freeze(['read:cases', 'write:cases', 'read:occupancy']) as ReadonlyArray<McpScope>,
  arguments: Object.freeze([
    { name: 'unitId', description: 'Unit ID being vacated.', required: true },
    { name: 'targetDate', description: 'Tenant-proposed move-out date (ISO).', required: true },
  ]) as ReadonlyArray<McpPromptArgument>,
  render: (args: Readonly<Record<string, string>>, context: McpAuthContext) => Object.freeze([
    systemMsg(
      `You are scheduling a move-out inspection for BORJIE tenant ${context.tenantId}. ` +
        'Inspections happen no earlier than 24h after key-return; pick the earliest available ' +
        'inspector slot after that point.',
    ),
    userMsg(
      `Schedule the move-out inspection for unitId=${arg(args, 'unitId', '<unitId>')} ` +
        `with targetDate=${arg(args, 'targetDate', '<YYYY-MM-DD>')}. ` +
        'Step 1: confirm the lease end-date. ' +
        'Step 2: query inspector availability for the target window. ' +
        'Step 3: generate the inspection checklist for the unit-type. ' +
        'Step 4: draft tenant + owner notifications.',
    ),
  ]) as ReadonlyArray<McpPromptMessage>,
});

const FILE_KRA_MRI: McpPromptDefinition = Object.freeze({
  name: 'File-KRA-MRI',
  description:
    'Prepare the Kenyan Monthly Rental Income (MRI) filing: compute the 7.5% tax due on each in-band property, aggregate, and generate the KRA-iTax CSV payload.',
  minimumTier: 'pro',
  requiredScopes: Object.freeze(['read:payments', 'read:properties', 'read:compliance']) as ReadonlyArray<McpScope>,
  arguments: Object.freeze([
    { name: 'period', description: 'ISO month, e.g. 2026-05.', required: true },
    { name: 'portfolioFilter', description: 'Optional filter (e.g. "ownerId=u-1").', required: false },
  ]) as ReadonlyArray<McpPromptArgument>,
  render: (args: Readonly<Record<string, string>>, context: McpAuthContext) => Object.freeze([
    systemMsg(
      `You are preparing the KRA MRI filing for BORJIE tenant ${context.tenantId}. ` +
        'Only properties whose annualised rent falls in the KES 288 000 - 15 000 000 band ' +
        'are subject to MRI. Apply the 7.5% rate; out-of-band properties report zero MRI.',
    ),
    userMsg(
      `Prepare the MRI filing for period=${arg(args, 'period', '<YYYY-MM>')} ` +
        `with filter=${arg(args, 'portfolioFilter', '(none)')}. ` +
        'Step 1: list every property and its gross rent in the period. ' +
        'Step 2: apply the in-band test. ' +
        'Step 3: compute MRI per property. ' +
        'Step 4: generate the iTax CSV with the per-property line items.',
    ),
  ]) as ReadonlyArray<McpPromptMessage>,
});

const FORECAST_OCCUPANCY_30D: McpPromptDefinition = Object.freeze({
  name: 'Forecast-Occupancy-30d',
  description:
    'Forecast the 30-day occupancy trajectory for a property or portfolio: pulls vacancy clusters, lease roll-offs, and current pipeline; emits a daily occupancy series.',
  minimumTier: 'pro',
  requiredScopes: Object.freeze(['read:occupancy', 'read:graph']) as ReadonlyArray<McpScope>,
  arguments: Object.freeze([
    { name: 'propertyId', description: 'Property ID (omit for portfolio-wide forecast).', required: false },
    { name: 'asOfDate', description: 'ISO date the forecast anchors on (default: today).', required: false },
  ]) as ReadonlyArray<McpPromptArgument>,
  render: (args: Readonly<Record<string, string>>, context: McpAuthContext) => Object.freeze([
    systemMsg(
      `You are forecasting occupancy for BORJIE tenant ${context.tenantId}. ` +
        'Combine lease-rolloff dates, current vacancies, and the pipeline of signed-but-not-yet-moved-in ' +
        'leases. Surface assumptions and confidence band alongside the daily series.',
    ),
    userMsg(
      `Forecast 30-day occupancy for propertyId=${arg(args, 'propertyId', '<all>')} ` +
        `as of date=${arg(args, 'asOfDate', 'today')}. ` +
        'Step 1: pull current unit-status distribution. ' +
        'Step 2: enumerate lease-end dates in the next 30 days. ' +
        'Step 3: enumerate pipeline move-ins in the next 30 days. ' +
        'Step 4: produce a daily occupancy-rate series + a confidence band.',
    ),
  ]) as ReadonlyArray<McpPromptMessage>,
});

export const BORJIE_PROMPTS: ReadonlyArray<McpPromptDefinition> = Object.freeze([
  RECONCILE_OWNER_PAYOUT,
  TRIAGE_TENANT_ARREARS,
  SCHEDULE_MOVE_OUT_INSPECTION,
  FILE_KRA_MRI,
  FORECAST_OCCUPANCY_30D,
]);

// ---------- Handlers ----------

/**
 * MCP `prompts/list` — return only the prompts the caller can actually
 * use given their tier + scopes. Hiding inaccessible prompts is best
 * practice for MCP discovery (mirrors LITFIN's behaviour).
 */
export function listPrompts(context: McpAuthContext): McpPromptListResult {
  const filtered = BORJIE_PROMPTS.filter(
    (p) => tierMeetsMinimum(context.tier, p.minimumTier) && hasAllScopes(context, p.requiredScopes),
  );
  return Object.freeze({
    prompts: Object.freeze(
      filtered.map((p) =>
        Object.freeze({
          name: p.name,
          description: p.description,
          arguments: p.arguments,
        }),
      ),
    ),
  });
}

export function findPromptDefinition(name: string): McpPromptDefinition | undefined {
  return BORJIE_PROMPTS.find((p) => p.name === name);
}

/**
 * MCP `prompts/get` — render the prompt with the caller's args. Refuses
 * when the prompt is missing, tier-locked, scope-locked, or required
 * arguments are missing.
 */
export function getPrompt(
  name: string,
  args: Readonly<Record<string, string>>,
  context: McpAuthContext,
): McpPromptOutcome {
  const def = findPromptDefinition(name);
  if (!def) {
    return { ok: false, error: `Unknown prompt: ${name}`, errorCode: 'PROMPT_NOT_FOUND' };
  }
  if (!tierMeetsMinimum(context.tier, def.minimumTier)) {
    return {
      ok: false,
      error: `Prompt "${name}" requires tier "${def.minimumTier}" but caller is "${context.tier}".`,
      errorCode: 'TIER_INSUFFICIENT',
    };
  }
  if (!hasAllScopes(context, def.requiredScopes)) {
    return {
      ok: false,
      error: `Prompt "${name}" requires scopes [${def.requiredScopes.join(', ')}] that the caller does not hold.`,
      errorCode: 'SCOPE_INSUFFICIENT',
    };
  }
  for (const a of def.arguments) {
    if (!a.required) continue;
    const v = args[a.name];
    if (typeof v !== 'string' || v.trim().length === 0) {
      return {
        ok: false,
        error: `Required argument "${a.name}" missing for prompt "${name}".`,
        errorCode: 'ARGUMENT_MISSING',
      };
    }
  }
  const messages = def.render(args, context);
  return {
    ok: true,
    result: Object.freeze({
      description: def.description,
      messages,
    }),
  };
}

/** Names of the 5 canonical prompts — useful for tests + dashboards. */
export const CANONICAL_PROMPT_NAMES: ReadonlyArray<string> = Object.freeze([
  'Reconcile-Owner-Payout',
  'Triage-Tenant-Arrears',
  'Schedule-Move-Out-Inspection',
  'File-KRA-MRI',
  'Forecast-Occupancy-30d',
]);
