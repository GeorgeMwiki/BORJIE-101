/**
 * @borjie/central-intelligence — Owner-tier tool barrel.
 *
 * Exports the 5 `owner.*` BrainTools that make up the per-owner
 * companion-of-agency write vocabulary, plus the `seedOwnerBrainTools`
 * function that adapts each `OwnerToolSpec` onto the existing
 * `BrainToolRegistry`.
 *
 * Owner tools differ from HQ tools in two structural ways:
 *
 *   1. They are bound to a SINGLE tenant — the executor refuses cross-
 *      tenant calls before ever hitting the underlying service. The
 *      `ownerCanReachTenant` helper is the trust boundary.
 *   2. They carry only `read` or `mutate` risk tier; owner tools NEVER
 *      destroy, bill, or send external comms — escalation to the
 *      `platform.*` HQ-tier is the only path for those.
 *
 * The adapter maps owner-tier into the existing `BrainToolTier` so the
 * gateway's tier-gating treats `read` owners as `free` and `mutate`
 * owners as `pro` — identical to HQ for those two tiers.
 */

import type {
  BrainToolRegistry,
  BrainToolSpec,
  BrainToolTier,
} from '../../tool-spec.js';
import type { HqToolContext, HqToolExecutionResult } from '../../risk-tier.js';
import type { OwnerToolName, OwnerToolSpec } from './types.js';

import {
  createListOutstandingTool,
  type ListOutstandingDeps,
} from './owner.list_outstanding.js';
import {
  createDraftSuspensionNoticeTool,
  type DraftSuspensionNoticeDeps,
} from './owner.draft_suspension_notice.js';
import {
  createShowAssetAllocationTool,
  type ShowAssetAllocationDeps,
} from './owner.show_asset_allocation.js';
import {
  createNextActionsTool,
  type NextActionsDeps,
} from './owner.next_actions.js';
import {
  createFinancialSummaryTool,
  type FinancialSummaryDeps,
} from './owner.financial_summary.js';

// ─────────────────────────────────────────────────────────────────────
// Re-exports
// ─────────────────────────────────────────────────────────────────────

export {
  createListOutstandingTool,
  ListOutstandingInputSchema,
  ListOutstandingOutputSchema,
  ListOutstandingRowSchema,
  type OutstandingServicePort,
  type ListOutstandingDeps,
  type ListOutstandingInput,
  type ListOutstandingOutput,
  type ListOutstandingRow,
} from './owner.list_outstanding.js';
export {
  createDraftSuspensionNoticeTool,
  DraftSuspensionNoticeInputSchema,
  DraftSuspensionNoticeOutputSchema,
  type DraftSuspensionNoticeDeps,
  type DraftSuspensionNoticeInput,
  type DraftSuspensionNoticeOutput,
  type SuspensionNoticeDraftPort,
} from './owner.draft_suspension_notice.js';
export {
  createShowAssetAllocationTool,
  ShowAssetAllocationInputSchema,
  ShowAssetAllocationOutputSchema,
  type AssetAllocationServicePort,
  type ShowAssetAllocationDeps,
  type ShowAssetAllocationInput,
  type ShowAssetAllocationOutput,
} from './owner.show_asset_allocation.js';
export {
  createNextActionsTool,
  NextActionsInputSchema,
  NextActionsOutputSchema,
  NextActionRowSchema,
  NextActionUrgencySchema,
  type NextActionRow,
  type NextActionUrgency,
  type NextActionsDeps,
  type NextActionsInput,
  type NextActionsOutput,
  type NextActionsServicePort,
} from './owner.next_actions.js';
export {
  createFinancialSummaryTool,
  FinancialSummaryInputSchema,
  FinancialSummaryOutputSchema,
  type FinancialSummaryDeps,
  type FinancialSummaryInput,
  type FinancialSummaryOutput,
  type FinancialSummaryServicePort,
  type OwnerCurrencyResolverPort,
} from './owner.financial_summary.js';
export { ownerCanReachTenant, ownerRefusal, withOwnerTelemetry } from './shared.js';
export type {
  OwnerRefusalReasonCode,
  OwnerRiskTier,
  OwnerToolName,
  OwnerToolSpec,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Tool-name registry
// ─────────────────────────────────────────────────────────────────────

export const OWNER_TOOL_NAMES: ReadonlyArray<OwnerToolName> = Object.freeze([
  'owner.list_outstanding',
  'owner.draft_suspension_notice',
  'owner.show_asset_allocation',
  'owner.next_actions',
  'owner.financial_summary',
]);

export const OWNER_TOOL_TIERS: Readonly<Record<OwnerToolName, 'read' | 'mutate'>> =
  Object.freeze({
    'owner.list_outstanding': 'read',
    'owner.draft_suspension_notice': 'mutate',
    'owner.show_asset_allocation': 'read',
    'owner.next_actions': 'read',
    'owner.financial_summary': 'read',
  });

// ─────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────

/**
 * The composition root supplies this factory for every owner-tool call
 * — captures `callerId`, RBAC scopes, and the OTel recorder.
 *
 * Owner tools NEVER persist to the sovereign-action ledger so the
 * `sovereignLedger` slot on the context is always passed through as
 * `null` here. The composition root may still set it on the context
 * if the same context is reused by an HQ-tier call elsewhere.
 */
export interface OwnerToolContextFactory {
  (toolName: OwnerToolName): HqToolContext;
}

/**
 * Map an owner-tier `OwnerRiskTier` onto the `BrainToolTier` cost-class
 * so the existing registry's tier-gate keeps working:
 *
 *   - read   → 'free'
 *   - mutate → 'pro'
 */
export function brainTierForOwnerTier(tier: 'read' | 'mutate'): BrainToolTier {
  return tier === 'read' ? 'free' : 'pro';
}

/**
 * Adapt a single `OwnerToolSpec` onto a `BrainToolSpec` registered
 * with the kernel registry.
 *
 * Validates that:
 *   - name starts with `owner.`
 *   - riskTier is `read` or `mutate` only
 *   - mutate-tier specs ship a rollback handler
 */
export function adaptOwnerToolSpec<I, O>(
  spec: OwnerToolSpec<I, O>,
  contextFactory: OwnerToolContextFactory,
): BrainToolSpec<I, O> {
  assertOwnerToolSpecValid(spec);
  return {
    name: spec.name,
    description: spec.description,
    schemaIn: spec.inputSchema,
    schemaOut: spec.outputSchema,
    tier: brainTierForOwnerTier(spec.riskTier),
    requiresApproval: false,
    executor: async (input: I): Promise<O> => {
      const ctx = contextFactory(spec.name);
      const result: HqToolExecutionResult<O> = await spec.execute(input, ctx);
      if (result.kind === 'ok') return result.output;
      if (result.kind === 'refused') {
        throw new Error(
          `owner-tool-refused:${result.reasonCode}:${result.message}`,
        );
      }
      throw new Error(`owner-tool-failed:${result.message}`);
    },
  };
}

/**
 * Construction-time invariants. Throws if a spec misuses the owner-
 * tier contract — composition root crashes at boot rather than silently
 * shipping a mis-configured tool.
 */
export function assertOwnerToolSpecValid<I, O>(spec: OwnerToolSpec<I, O>): void {
  if (!spec.name.startsWith('owner.')) {
    throw new Error(
      `owner-tool: spec name "${spec.name}" must start with "owner."`,
    );
  }
  if (spec.riskTier !== 'read' && spec.riskTier !== 'mutate') {
    throw new Error(
      `owner-tool: spec "${spec.name}" has invalid riskTier "${String(
        (spec as { riskTier: unknown }).riskTier,
      )}" (owner-tier only allows read | mutate)`,
    );
  }
  if (spec.riskTier === 'mutate' && !spec.rollback) {
    throw new Error(
      `owner-tool: spec "${spec.name}" (mutate) MUST define a rollback handler`,
    );
  }
  if (spec.approvalRequired) {
    throw new Error(
      `owner-tool: spec "${spec.name}" must not require approval; escalate to platform.* HQ-tier instead`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Seed function
// ─────────────────────────────────────────────────────────────────────

export interface SeedOwnerBrainToolsDeps {
  readonly outstanding: ListOutstandingDeps['outstanding'];
  readonly notices: DraftSuspensionNoticeDeps['notices'];
  readonly assetAllocation: ShowAssetAllocationDeps['assetAllocation'];
  readonly proposer: NextActionsDeps['proposer'];
  readonly financials: FinancialSummaryDeps['financials'];
  /**
   * Optional per-tenant currency resolver. When supplied, the
   * financial-summary tool defaults to the tenant's preferred currency
   * (from `currency_preferences`) rather than the legacy `'TZS'`
   * literal. Composition root wires this from
   * `CurrencyPreferencesService.resolve({ tenantId })`.
   */
  readonly currencyResolver?: FinancialSummaryDeps['currencyResolver'];
  readonly contextFactory: OwnerToolContextFactory;
}

/**
 * Build all 5 owner-tier tools and register them on `registry`.
 *
 * Returns the registered tool names so the composition root can assert
 * the catalog matches `OWNER_TOOL_NAMES` at boot — protects against a
 * stale registry after a refactor.
 */
export function seedOwnerBrainTools(
  registry: BrainToolRegistry,
  deps: SeedOwnerBrainToolsDeps,
): ReadonlyArray<OwnerToolName> {
  const specs: ReadonlyArray<OwnerToolSpec> = [
    createListOutstandingTool({ outstanding: deps.outstanding }) as OwnerToolSpec,
    createDraftSuspensionNoticeTool({ notices: deps.notices }) as OwnerToolSpec,
    createShowAssetAllocationTool({ assetAllocation: deps.assetAllocation }) as OwnerToolSpec,
    createNextActionsTool({ proposer: deps.proposer }) as OwnerToolSpec,
    createFinancialSummaryTool({
      financials: deps.financials,
      ...(deps.currencyResolver
        ? { currencyResolver: deps.currencyResolver }
        : {}),
    }) as OwnerToolSpec,
  ];
  const names: Array<OwnerToolName> = [];
  for (const spec of specs) {
    registry.register(
      adaptOwnerToolSpec(spec, deps.contextFactory) as unknown as BrainToolSpec<
        unknown,
        unknown
      >,
    );
    names.push(spec.name);
  }
  return Object.freeze(names);
}
