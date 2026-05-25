/**
 * @borjie/central-intelligence — HQ-tier tool barrel.
 *
 * Exports the 12 `platform.*` BrainTools that make up the Central
 * Command write vocabulary, plus the `seedHqBrainTools` function that
 * adapts each `HqToolSpec` onto the existing `BrainToolRegistry`.
 *
 * The HQ tools differ from the seed PM tools in two structural ways:
 *
 *   1. They carry a `RiskTier` (read | mutate | destroy | billing |
 *      external-comm), and the adapter maps it onto the underlying
 *      BrainToolSpec `tier` so the existing tier-gating machinery
 *      treats sovereign-ledger tools as the highest cost class.
 *   2. They emit OTel + sovereign-ledger telemetry inside the executor
 *      via `withHqTelemetry`. The adapter therefore threads the
 *      composition root's `HqToolContext` factory through every call.
 *
 * The adapter does NOT bypass the existing BrainToolRegistry
 * input/output Zod gates — Zod runs at the registry boundary AND at
 * the HqToolSpec boundary so we get two layers of validation; this is
 * intentional and matches the K9 design.
 */

import type {
  BrainToolRegistry,
  BrainToolSpec,
  BrainToolTier,
} from '../../tool-spec.js';
import type {
  HqToolContext,
  HqToolExecutionResult,
  HqToolSpec,
  RiskTier,
} from '../../risk-tier.js';
import { assertHqToolSpecValid } from '../../risk-tier.js';

import {
  createListTenantsTool,
  type ListTenantsDeps,
} from './platform.list_tenants.js';
import {
  createListUsersTool,
  type ListUsersDeps,
} from './platform.list_users.js';
import {
  createSystemHealthTool,
  type SystemHealthDeps,
} from './platform.system_health.js';
import {
  createListRecentTracesTool,
  type ListRecentTracesDeps,
} from './platform.list_recent_traces.js';
import {
  createReadFeatureFlagTool,
  type ReadFeatureFlagDeps,
} from './platform.read_feature_flag.js';
import {
  createCreateTenantTool,
  type CreateTenantDeps,
} from './platform.create_tenant.js';
import {
  createCreateUserTool,
  type CreateUserDeps,
} from './platform.create_user.js';
import {
  createSetFeatureFlagTool,
  type SetFeatureFlagDeps,
} from './platform.set_feature_flag.js';
import {
  createRunConsolidationTickTool,
  type RunConsolidationTickDeps,
} from './platform.run_consolidation_tick.js';
import {
  createSetKillswitchTool,
  type SetKillswitchDeps,
} from './platform.set_killswitch.js';
import {
  createAdjustInvoiceTool,
  type AdjustInvoiceDeps,
} from './platform.adjust_invoice.js';
import {
  createSendAnnouncementTool,
  type SendAnnouncementDeps,
} from './platform.send_announcement.js';
import {
  createEvictTenantTool,
  type EvictTenantDeps,
} from './platform.evict_tenant.js';
import {
  createPayoutOwnerTool,
  type PayoutOwnerDeps,
} from './platform.payout_owner.js';
import {
  createFileKraMriTool,
  type FileKraMriDeps,
} from './platform.file_kra_mri.js';
import {
  createVerifyNidaTool,
  type VerifyNidaDeps,
} from './platform.verify_nida.js';
import {
  createVerifyEardhiTitleTool,
  type VerifyEardhiTitleDeps,
} from './platform.verify_eardhi_title.js';

// ─────────────────────────────────────────────────────────────────────
// Re-exports (full surface for every tool — Schemas, ports, types)
// ─────────────────────────────────────────────────────────────────────

export {
  createListTenantsTool,
  ListTenantsInputSchema,
  ListTenantsOutputSchema,
  type ListTenantsDeps,
  type ListTenantsInput,
  type ListTenantsOutput,
  type TenantsServicePort,
} from './platform.list_tenants.js';
export {
  createListUsersTool,
  ListUsersInputSchema,
  ListUsersOutputSchema,
  UserRoleSchema,
  type ListUsersDeps,
  type ListUsersInput,
  type ListUsersOutput,
  type UsersServicePort,
} from './platform.list_users.js';
export {
  createSystemHealthTool,
  SystemHealthInputSchema,
  SystemHealthOutputSchema,
  ServiceHealthRowSchema,
  ServiceHealthStateSchema,
  computeOverallState,
  type ServiceHeartbeatPort,
  type SystemHealthDeps,
  type SystemHealthInput,
  type SystemHealthOutput,
} from './platform.system_health.js';
export {
  createListRecentTracesTool,
  ListRecentTracesInputSchema,
  ListRecentTracesOutputSchema,
  RecentTraceRowSchema,
  type DecisionTraceQueryPort,
  type ListRecentTracesDeps,
  type ListRecentTracesInput,
  type ListRecentTracesOutput,
} from './platform.list_recent_traces.js';
export {
  createReadFeatureFlagTool,
  ReadFeatureFlagInputSchema,
  ReadFeatureFlagOutputSchema,
  FeatureFlagValueSchema,
  type FeatureFlagReadPort,
  type ReadFeatureFlagDeps,
  type ReadFeatureFlagInput,
  type ReadFeatureFlagOutput,
} from './platform.read_feature_flag.js';
export {
  createCreateTenantTool,
  CreateTenantInputSchema,
  CreateTenantOutputSchema,
  type CreateTenantDeps,
  type CreateTenantInput,
  type CreateTenantOutput,
  type CreateTenantPort,
} from './platform.create_tenant.js';
export {
  createCreateUserTool,
  CreateUserInputSchema,
  CreateUserOutputSchema,
  type CreateUserDeps,
  type CreateUserInput,
  type CreateUserOutput,
  type CreateUserPort,
} from './platform.create_user.js';
export {
  createSetFeatureFlagTool,
  SetFeatureFlagInputSchema,
  SetFeatureFlagOutputSchema,
  type FeatureFlagWritePort,
  type SetFeatureFlagDeps,
  type SetFeatureFlagInput,
  type SetFeatureFlagOutput,
} from './platform.set_feature_flag.js';
export {
  createRunConsolidationTickTool,
  RunConsolidationTickInputSchema,
  ConsolidationTickReportSchema,
  type ConsolidationRunnerPort,
  type RunConsolidationTickDeps,
  type RunConsolidationTickInput,
  type RunConsolidationTickOutput,
} from './platform.run_consolidation_tick.js';
export {
  createSetKillswitchTool,
  SetKillswitchInputSchema,
  SetKillswitchOutputSchema,
  KillswitchLevelSchema,
  KillswitchReasonCodeSchema,
  type KillswitchWritePort,
  type SetKillswitchDeps,
  type SetKillswitchInput,
  type SetKillswitchOutput,
} from './platform.set_killswitch.js';
export {
  createAdjustInvoiceTool,
  AdjustInvoiceInputSchema,
  AdjustInvoiceOutputSchema,
  type AdjustInvoiceDeps,
  type AdjustInvoiceInput,
  type AdjustInvoiceOutput,
  type InvoiceAdjustmentPort,
} from './platform.adjust_invoice.js';
export {
  createSendAnnouncementTool,
  SendAnnouncementInputSchema,
  SendAnnouncementOutputSchema,
  AnnouncementChannelSchema,
  type AnnouncementPort,
  type SendAnnouncementDeps,
  type SendAnnouncementInput,
  type SendAnnouncementOutput,
} from './platform.send_announcement.js';
export {
  createEvictTenantTool,
  EvictTenantInputSchema,
  EvictTenantOutputSchema,
  EvictTenantBreachKindSchema,
  type EvictionWorkflowDispatcherPort,
  type EvictTenantDeps,
  type EvictTenantInput,
  type EvictTenantOutput,
} from './platform.evict_tenant.js';
export {
  createPayoutOwnerTool,
  PayoutOwnerInputSchema,
  PayoutOwnerOutputSchema,
  type OwnerPayoutWorkflowDispatcherPort,
  type PayoutOwnerDeps,
  type PayoutOwnerInput,
  type PayoutOwnerOutput,
} from './platform.payout_owner.js';
export {
  createFileKraMriTool,
  FileKraMriInputSchema,
  FileKraMriOutputSchema,
  type KraMriFilingWorkflowDispatcherPort,
  type KraEritsFilingWorkflowDispatcherPort,
  type KraEritsOwnerRecord,
  type FileKraMriDeps,
  type FileKraMriInput,
  type FileKraMriOutput,
} from './platform.file_kra_mri.js';
export {
  createVerifyNidaTool,
  VerifyNidaInputSchema,
  VerifyNidaOutputSchema,
  type NidaVerificationPort,
  type VerifyNidaDeps,
  type VerifyNidaInput,
  type VerifyNidaOutput,
} from './platform.verify_nida.js';
export {
  createVerifyEardhiTitleTool,
  VerifyEardhiTitleInputSchema,
  VerifyEardhiTitleOutputSchema,
  EncumbranceKindSchema,
  type EardhiTitlePort,
  type VerifyEardhiTitleDeps,
  type VerifyEardhiTitleInput,
  type VerifyEardhiTitleOutput,
} from './platform.verify_eardhi_title.js';
export { refusal, withHqTelemetry } from './shared.js';

// ─────────────────────────────────────────────────────────────────────
// Tool-name registry — useful for tests + observability
// ─────────────────────────────────────────────────────────────────────

export const HQ_TOOL_NAMES: ReadonlyArray<`platform.${string}`> = Object.freeze([
  'platform.list_tenants',
  'platform.list_users',
  'platform.system_health',
  'platform.list_recent_traces',
  'platform.read_feature_flag',
  'platform.create_tenant',
  'platform.create_user',
  'platform.set_feature_flag',
  'platform.run_consolidation_tick',
  'platform.set_killswitch',
  'platform.adjust_invoice',
  'platform.send_announcement',
  'platform.evict_tenant',
  'platform.payout_owner',
  'platform.file_kra_mri',
  'platform.verify_nida',
  'platform.verify_eardhi_title',
]);

export const HQ_TOOL_TIERS: Readonly<Record<string, RiskTier>> = Object.freeze({
  'platform.list_tenants': 'read',
  'platform.list_users': 'read',
  'platform.system_health': 'read',
  'platform.list_recent_traces': 'read',
  'platform.read_feature_flag': 'read',
  'platform.create_tenant': 'mutate',
  'platform.create_user': 'mutate',
  'platform.set_feature_flag': 'mutate',
  'platform.run_consolidation_tick': 'mutate',
  'platform.set_killswitch': 'destroy',
  'platform.adjust_invoice': 'billing',
  'platform.send_announcement': 'external-comm',
  'platform.evict_tenant': 'destroy',
  'platform.payout_owner': 'billing',
  'platform.file_kra_mri': 'external-comm',
  'platform.verify_nida': 'read',
  'platform.verify_eardhi_title': 'read',
});

// ─────────────────────────────────────────────────────────────────────
// HqToolSpec → BrainToolSpec adapter
// ─────────────────────────────────────────────────────────────────────

/**
 * The composition root must supply this factory each time the
 * registry runs a tool — it captures `callerId`, RBAC scopes, the
 * pre-resolved four-eye approval-record id, the OTel + sovereign-
 * ledger ports, and the clock.
 *
 * In tests, the rig hands in a fixed scopes list + in-memory ports.
 */
export interface HqToolContextFactory {
  (toolName: `platform.${string}`): HqToolContext;
}

/**
 * Map a `RiskTier` onto the `BrainToolTier` cost-class so the existing
 * registry's tier-gate keeps working without surprises:
 *
 *   - read           → 'free'
 *   - mutate         → 'pro'
 *   - destroy        → 'enterprise'
 *   - billing        → 'enterprise'
 *   - external-comm  → 'enterprise'
 */
export function brainTierForRiskTier(riskTier: RiskTier): BrainToolTier {
  if (riskTier === 'read') return 'free';
  if (riskTier === 'mutate') return 'pro';
  return 'enterprise';
}

/**
 * Adapt a single `HqToolSpec` onto a `BrainToolSpec` registered with
 * the kernel registry.
 *
 * The adapter:
 *   - validates the spec at construction time via `assertHqToolSpecValid`
 *   - threads the per-call `HqToolContext` from the supplied factory
 *   - translates `HqToolExecutionResult` into either the validated
 *     output (kind: 'ok') or a thrown Error (kind: 'refused' | 'failed')
 *     so the existing registry's executor-failure branch picks it up
 *     and the audit row tags the failure mode.
 */
export function adaptHqToolSpec<I, O>(
  hqSpec: HqToolSpec<I, O>,
  contextFactory: HqToolContextFactory,
): BrainToolSpec<I, O> {
  assertHqToolSpecValid(hqSpec);
  return {
    name: hqSpec.name,
    description: hqSpec.description,
    schemaIn: hqSpec.inputSchema,
    schemaOut: hqSpec.outputSchema,
    tier: brainTierForRiskTier(hqSpec.riskTier),
    requiresApproval: hqSpec.approvalRequired,
    executor: async (input: I): Promise<O> => {
      const ctx = contextFactory(hqSpec.name);
      const result: HqToolExecutionResult<O> = await hqSpec.execute(input, ctx);
      if (result.kind === 'ok') return result.output;
      if (result.kind === 'refused') {
        throw new Error(
          `hq-tool-refused:${result.reasonCode}:${result.message}`,
        );
      }
      throw new Error(`hq-tool-failed:${result.message}`);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Seed function — composition root calls this once at boot
// ─────────────────────────────────────────────────────────────────────

/**
 * Composed deps bundle — the composition root threads a single object
 * with every port set, and `seedHqBrainTools` wires the 12 tools onto
 * the registry in one pass.
 */
export interface SeedHqBrainToolsDeps {
  readonly tenantsList: ListTenantsDeps['tenantsService'];
  readonly usersList: ListUsersDeps['usersService'];
  readonly heartbeats: SystemHealthDeps['heartbeats'];
  readonly tracesQuery: ListRecentTracesDeps['traces'];
  readonly flagsRead: ReadFeatureFlagDeps['flags'];
  readonly tenantsCreate: CreateTenantDeps['tenantsService'];
  readonly usersCreate: CreateUserDeps['usersService'];
  readonly flagsWrite: SetFeatureFlagDeps['flags'];
  readonly consolidation: RunConsolidationTickDeps['consolidation'];
  readonly killswitchWrite: SetKillswitchDeps['killswitch'];
  readonly invoices: AdjustInvoiceDeps['invoices'];
  readonly announcements: SendAnnouncementDeps['announcements'];
  readonly evictionDispatcher: EvictTenantDeps['evictionDispatcher'];
  readonly ownerPayoutDispatcher: PayoutOwnerDeps['ownerPayoutDispatcher'];
  readonly kraMriDispatcher: FileKraMriDeps['kraMriDispatcher'];
  readonly kraEritsDispatcher?: FileKraMriDeps['kraEritsDispatcher'];
  readonly maxAdjustmentUsdCents: number;
  readonly maxRecipientCount: number;
  readonly maxPayoutUsdCents: number;
  /** Threshold for extra-HIL (5-eye) approval on payouts. Default $10k. */
  readonly extraHilPayoutUsdCents?: number;
  readonly nida: VerifyNidaDeps['nida'];
  readonly eardhi: VerifyEardhiTitleDeps['eardhi'];
  readonly contextFactory: HqToolContextFactory;
}

/**
 * Build the 12 HQ tools and register them on `registry`. Caller is
 * responsible for ensuring the registry is otherwise empty of
 * `platform.*` names (the registry itself throws on collisions).
 *
 * Returns the list of registered tool names so the composition root
 * can confirm the catalog at boot.
 */
export function seedHqBrainTools(
  registry: BrainToolRegistry,
  deps: SeedHqBrainToolsDeps,
): ReadonlyArray<`platform.${string}`> {
  const specs: ReadonlyArray<HqToolSpec> = [
    createListTenantsTool({ tenantsService: deps.tenantsList }) as HqToolSpec,
    createListUsersTool({ usersService: deps.usersList }) as HqToolSpec,
    createSystemHealthTool({ heartbeats: deps.heartbeats }) as HqToolSpec,
    createListRecentTracesTool({ traces: deps.tracesQuery }) as HqToolSpec,
    createReadFeatureFlagTool({ flags: deps.flagsRead }) as HqToolSpec,
    createCreateTenantTool({ tenantsService: deps.tenantsCreate }) as HqToolSpec,
    createCreateUserTool({ usersService: deps.usersCreate }) as HqToolSpec,
    createSetFeatureFlagTool({ flags: deps.flagsWrite }) as HqToolSpec,
    createRunConsolidationTickTool({
      consolidation: deps.consolidation,
    }) as HqToolSpec,
    createSetKillswitchTool({ killswitch: deps.killswitchWrite }) as HqToolSpec,
    createAdjustInvoiceTool({
      invoices: deps.invoices,
      maxAdjustmentUsdCents: deps.maxAdjustmentUsdCents,
    }) as HqToolSpec,
    createSendAnnouncementTool({
      announcements: deps.announcements,
      maxRecipientCount: deps.maxRecipientCount,
    }) as HqToolSpec,
    createEvictTenantTool({
      evictionDispatcher: deps.evictionDispatcher,
    }) as HqToolSpec,
    createPayoutOwnerTool({
      ownerPayoutDispatcher: deps.ownerPayoutDispatcher,
      maxPayoutUsdCents: deps.maxPayoutUsdCents,
      ...(deps.extraHilPayoutUsdCents !== undefined
        ? { extraHilUsdCents: deps.extraHilPayoutUsdCents }
        : {}),
    }) as HqToolSpec,
    createFileKraMriTool({
      kraMriDispatcher: deps.kraMriDispatcher,
      ...(deps.kraEritsDispatcher !== undefined
        ? { kraEritsDispatcher: deps.kraEritsDispatcher }
        : {}),
    }) as HqToolSpec,
    createVerifyNidaTool({ nida: deps.nida }) as HqToolSpec,
    createVerifyEardhiTitleTool({ eardhi: deps.eardhi }) as HqToolSpec,
  ];

  const names: Array<`platform.${string}`> = [];
  for (const spec of specs) {
    registry.register(
      adaptHqToolSpec(spec, deps.contextFactory) as unknown as BrainToolSpec<
        unknown,
        unknown
      >,
    );
    names.push(spec.name);
  }
  return Object.freeze(names);
}
