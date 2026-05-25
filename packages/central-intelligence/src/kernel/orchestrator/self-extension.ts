/**
 * Self-extension keystone — the MD's ability to detect a recurring
 * problem that NO existing sub-MD handles and propose a new sub-MD
 * specification to the owner.
 *
 * This module is what makes Layer-3 unbounded: the MD's catalogue of
 * sub-MDs grows as the business evolves, without redeployment of the
 * kernel.
 *
 * Flow (Phase F):
 *
 *   1. Scheduled job (daily / weekly) calls
 *      `detectRecurringGap(deps, {thresholdEventCount, windowDays})`
 *   2. If a `RecurringGapDiagnosis` is returned, the MD calls
 *      `proposeNewSubMd(diagnosis, deps)` to produce a
 *      `SubMdProposal` (LLM-drafted spec; owner reviews & approves).
 *   3. `deps.ownerApproval.ask(proposal)` puts the proposal in the
 *      owner's inbox via the four-eye flow.
 *   4. On approval the MD calls
 *      `compileAndDeploySubMd(approvedProposal, deps)` — this
 *      registers the new sub-MD in the registry and appends a
 *      sovereign-action-ledger entry. From this moment, the MD's
 *      tool-belt has a new tool.
 *
 * Phase F is the LLM-driven, supervised path. Phase G layers a
 * stricter rules-driven variant on top (frequency + cost gates,
 * persona-vector check, redundancy check vs existing sub-MDs).
 *
 * Reliability framing: every proposed sub-MD lands in
 * `riskTier: 'read'` by default; promotion to `mutate` / `external-
 * comm` requires the owner to edit the proposal explicitly. We never
 * auto-deploy a destructive sub-MD.
 */

import type { PersonaIdentity } from '../identity.js';
import type { ScopeFilter } from '../sub-mds/shared/sub-md-base.js';

// ─────────────────────────────────────────────────────────────────────
// Ports — caller injects production / fake.
// ─────────────────────────────────────────────────────────────────────

/**
 * Read recent kernel activity. The implementation reads from the
 * decision-trace + action-audit sinks; tests inject an in-memory
 * fixture.
 */
export interface ActivityLogPort {
  recent(args: {
    readonly windowDays: number;
    readonly nowMs: number;
  }): Promise<ReadonlyArray<ActivityLogEntry>>;
}

export interface ActivityLogEntry {
  readonly id: string;
  readonly occurredAtMs: number;
  /** Free-form event topic, e.g. `complaint.received`,
   *  `vp.operations.gap-recorded`, `inspection.scheduled`. */
  readonly topic: string;
  /** Optional payload — keys vary by topic. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Tenant scope of the event. */
  readonly tenantId: string;
  /** Optional handler note — e.g. which sub-MD (if any) handled it. */
  readonly handledBySubMd?: string;
  /** Optional capability-gap marker emitted by a VP's orchestrate(). */
  readonly missingLineWorker?: string;
}

/** Lists known sub-MDs so the keystone can avoid duplicate proposals. */
export interface SubMdRegistryPort {
  list(): Promise<ReadonlyArray<string>>;
  register(args: {
    readonly name: string;
    readonly spec: SubMdSpec;
  }): Promise<RegistryReceipt>;
}

export interface RegistryReceipt {
  readonly subMdId: string;
  readonly registeredAtMs: number;
  readonly version: number;
}

/** LLM router for spec generation. */
export interface LLMRouterPort {
  draftSubMdSpec(args: {
    readonly diagnosis: RecurringGapDiagnosis;
    readonly knownSubMds: ReadonlyArray<string>;
  }): Promise<SubMdSpec>;
}

/** Four-eye approval port — proposal goes to the owner inbox. */
export interface OwnerApprovalPort {
  ask(proposal: SubMdProposal): Promise<OwnerApprovalDecision>;
}

export type OwnerApprovalDecision =
  | { readonly kind: 'approved'; readonly editedSpec?: SubMdSpec; readonly approvedAtMs: number }
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'deferred'; readonly resumeAfterMs: number };

/** Sovereign-action-ledger port — every deployment is audited. */
export interface SelfExtensionLedgerPort {
  appendLedgerEntry(args: {
    readonly tenantId: string;
    readonly actionType: string;
    readonly payloadJson: Record<string, unknown>;
    readonly proposer: string;
    readonly approvers: ReadonlyArray<string>;
    readonly executedAt: Date;
  }): Promise<unknown>;
}

// ─────────────────────────────────────────────────────────────────────
// Deps + options
// ─────────────────────────────────────────────────────────────────────

export interface SelfExtensionDeps {
  readonly activityLog: ActivityLogPort;
  readonly subMdRegistry: SubMdRegistryPort;
  readonly llmRouter: LLMRouterPort;
  readonly ownerApproval: OwnerApprovalPort;
  /** Optional — when present, the deployment is appended to the
   *  sovereign-action-ledger for regulator-grade audit. */
  readonly ledger?: SelfExtensionLedgerPort;
  readonly clock?: () => number;
}

export interface DetectRecurringGapOptions {
  /** Minimum number of similar events within the window to constitute
   *  a "recurring" gap. Default 10. */
  readonly thresholdEventCount?: number;
  /** Look-back window in days. Default 30. */
  readonly windowDays?: number;
  /** Tenant scope to constrain the detection. When omitted, the
   *  detector reads across every tenant the activity-log allows. */
  readonly tenantId?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Diagnosis + proposal + receipt shapes
// ─────────────────────────────────────────────────────────────────────

export interface RecurringGapDiagnosis {
  /** Human-readable summary used by the owner-portal preview. */
  readonly pattern: string;
  readonly observedCount: number;
  readonly observedWindowDays: number;
  /** Sub-MDs the MD considered but rejected as inadequate; gives the
   *  owner the audit trail for why a new sub-MD is needed. */
  readonly noExistingSubMdHandles: ReadonlyArray<string>;
  /** Pre-filled persona shell; the LLM router refines this in
   *  `proposeNewSubMd`. */
  readonly suggestedPersona: PersonaIdentity;
  readonly suggestedScope: ScopeFilter;
  readonly suggestedToolBelt: ReadonlyArray<string>;
  readonly estimatedDailyCostUsdCents: number;
  readonly riskTier: 'read' | 'mutate' | 'external-comm';
}

/**
 * The spec the registry persists. Minimal shape — the runtime sub-MD
 * factory consumes this and produces a SubMd instance.
 */
export interface SubMdSpec {
  readonly name: string;
  readonly persona: PersonaIdentity;
  readonly scope: ScopeFilter;
  readonly toolBelt: ReadonlyArray<string>;
  readonly riskTier: 'read' | 'mutate' | 'external-comm';
  /** Free-form scope description shown in the owner-portal. */
  readonly purpose: string;
  /** Suggested SLA — e.g. `99%-classification-accuracy`. */
  readonly successCriterion: string;
  /** Schema version so future migrations stay safe. */
  readonly schemaVersion: number;
}

export interface SubMdProposal {
  readonly proposalId: string;
  readonly diagnosis: RecurringGapDiagnosis;
  readonly spec: SubMdSpec;
  readonly draftedAtMs: number;
  readonly draftedBy: 'self-extension-keystone';
  /** Cost ceiling the owner can edit before approval. */
  readonly dailyCostCeilingUsdCents: number;
}

export interface DeploymentReceipt {
  readonly proposalId: string;
  readonly subMdId: string;
  readonly registryVersion: number;
  readonly deployedAtMs: number;
  readonly ledgerEntryId: string | null;
  readonly approvers: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// detectRecurringGap
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 10;
const DEFAULT_WINDOW_DAYS = 30;

/**
 * Cluster recent activity log entries by topic + missingLineWorker
 * marker; return a diagnosis when ANY cluster exceeds the threshold
 * AND no existing sub-MD covers the pattern.
 */
export async function detectRecurringGap(
  deps: SelfExtensionDeps,
  options: DetectRecurringGapOptions = {},
): Promise<RecurringGapDiagnosis | null> {
  const clock = deps.clock ?? Date.now;
  const threshold = options.thresholdEventCount ?? DEFAULT_THRESHOLD;
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const nowMs = clock();

  const recent = await deps.activityLog.recent({ windowDays, nowMs });
  const filteredByTenant = options.tenantId
    ? recent.filter((e) => e.tenantId === options.tenantId)
    : recent;

  const knownSubMds = new Set(await deps.subMdRegistry.list());

  // Cluster: gap markers first (strongest signal), then by topic+payload
  // type for unhandled events.
  const clusters = new Map<string, ActivityLogEntry[]>();
  for (const entry of filteredByTenant) {
    const key = entry.missingLineWorker
      ? `gap:${entry.missingLineWorker}`
      : entry.handledBySubMd
        ? null // handled events do not contribute to a gap
        : `topic:${entry.topic}`;
    if (!key) continue;
    const list = clusters.get(key) ?? [];
    list.push(entry);
    clusters.set(key, list);
  }

  // Find the strongest cluster that is not already covered.
  let winner: { readonly key: string; readonly entries: ActivityLogEntry[] } | null = null;
  for (const [key, entries] of clusters) {
    if (entries.length < threshold) continue;
    const lineWorkerName = key.startsWith('gap:') ? key.slice(4) : null;
    if (lineWorkerName && knownSubMds.has(lineWorkerName)) {
      continue; // already covered, no gap
    }
    if (!winner || entries.length > winner.entries.length) {
      winner = { key, entries };
    }
  }

  if (!winner) return null;

  const firstEntry = winner.entries[0];
  if (!firstEntry) return null;

  const missingName = winner.key.startsWith('gap:')
    ? winner.key.slice(4)
    : `auto.${winner.key.replace(/[^a-z0-9.-]/gi, '-').toLowerCase()}`;

  const suggestedScope: ScopeFilter = {
    tenantId: firstEntry.tenantId,
  };

  const suggestedPersona: PersonaIdentity = {
    id: missingName,
    displayName: `Proposed: ${missingName}`,
    openingStatement: `I am a proposed sub-MD for the pattern ${winner.key}. The owner has not yet approved me.`,
    toneGuidance: 'Calm, factual, deferential — every output is a draft until approved.',
    taboos: [
      'taking action without owner approval of this proposal',
      'speaking as if already deployed',
    ],
    violationSignals: ['i acted', 'i committed', 'i sent it'],
    firstPersonNoun: 'I',
  };

  return Object.freeze({
    pattern: `${winner.entries.length} events match cluster "${winner.key}" in the last ${windowDays} days; no existing sub-MD handles them.`,
    observedCount: winner.entries.length,
    observedWindowDays: windowDays,
    noExistingSubMdHandles: Object.freeze([...knownSubMds]),
    suggestedPersona,
    suggestedScope,
    suggestedToolBelt: Object.freeze([]),
    // Cost heuristic: assume one Sonnet call per event/day, ~$0.30/MTok
    // input + $1.50/MTok output; conservative cents-per-event.
    estimatedDailyCostUsdCents: Math.max(5, Math.round(winner.entries.length / windowDays) * 3),
    // Default to the safest tier — owner must explicitly upgrade.
    riskTier: 'read' as const,
  });
}

// ─────────────────────────────────────────────────────────────────────
// proposeNewSubMd
// ─────────────────────────────────────────────────────────────────────

// C4 — riskTier ordering used to clamp an LLM-drafted spec to the
// diagnosis tier. The LLM may only request a tier <= the diagnosis tier;
// any attempt to widen the tier is silently clamped down to the
// diagnosis tier. Promotion is exclusively an owner decision via
// `OwnerApprovalDecision.editedSpec`.
const RISK_TIER_ORDER: Readonly<Record<SubMdSpec['riskTier'], number>> = Object.freeze({
  read: 0,
  mutate: 1,
  'external-comm': 2,
});

function clampRiskTier(
  llmRequested: SubMdSpec['riskTier'] | undefined,
  diagnosisCeiling: SubMdSpec['riskTier'],
): SubMdSpec['riskTier'] {
  if (!llmRequested) return diagnosisCeiling;
  const requested = RISK_TIER_ORDER[llmRequested];
  const ceiling = RISK_TIER_ORDER[diagnosisCeiling];
  if (requested === undefined || ceiling === undefined) return diagnosisCeiling;
  return requested <= ceiling ? llmRequested : diagnosisCeiling;
}

export async function proposeNewSubMd(
  diagnosis: RecurringGapDiagnosis,
  deps: SelfExtensionDeps,
): Promise<SubMdProposal> {
  const clock = deps.clock ?? Date.now;
  const knownSubMds = await deps.subMdRegistry.list();

  // The LLM port refines the persona / tool-belt / success criterion;
  // the diagnosis acts as the structured input.
  const spec = await deps.llmRouter.draftSubMdSpec({ diagnosis, knownSubMds });

  if (!spec.name || !spec.persona || !spec.scope) {
    throw new Error(
      `proposeNewSubMd: LLM returned an incomplete spec (name=${spec.name}); cannot proceed.`,
    );
  }

  const proposalId = `submd-proposal-${clock()}-${Math.floor(Math.random() * 1e9)}`;

  return Object.freeze({
    proposalId,
    diagnosis,
    spec: Object.freeze({
      ...spec,
      // C4 — Clamp the LLM-requested riskTier to the diagnosis ceiling.
      // The LLM cannot widen the tier; only owner edits can promote.
      riskTier: clampRiskTier(spec.riskTier, diagnosis.riskTier),
      schemaVersion: spec.schemaVersion ?? 1,
    }),
    draftedAtMs: clock(),
    draftedBy: 'self-extension-keystone' as const,
    // Two days of estimated cost as the default ceiling — owner can edit.
    dailyCostCeilingUsdCents: diagnosis.estimatedDailyCostUsdCents * 2,
  });
}

// ─────────────────────────────────────────────────────────────────────
// compileAndDeploySubMd
// ─────────────────────────────────────────────────────────────────────

/**
 * C4 — Allow-list of destructive HQ-tier tools that an LLM-drafted
 * proposal MUST NOT include unless the owner has explicitly promoted
 * the spec via `editedSpec`. The registry will throw before deployment
 * when the LLM's `toolBelt` contains any of these without owner edit.
 *
 * Conservative seed list — production composition can extend via the
 * `destructiveToolBlocklist` option on `compileAndDeploySubMd`.
 */
const DEFAULT_DESTRUCTIVE_TOOL_BLOCKLIST: ReadonlyArray<string> = Object.freeze([
  'platform.evict_tenant',
  'platform.delete_tenant',
  'platform.suspend_tenant',
  'platform.purge_data',
  'platform.transfer_funds',
  'platform.disburse_funds',
]);

/**
 * Registers the approved proposal as a live sub-MD. Writes a sovereign-
 * action-ledger entry so an external audit can reconstruct the moment
 * the MD's catalogue grew. The owner-approval port is expected to have
 * gated this call.
 *
 * C4 — When the caller provides the `OwnerApprovalDecision.editedSpec`,
 * the deployed spec is the owner-edited version, NOT the LLM's draft.
 * The function also rejects deployment when the spec's `toolBelt`
 * contains a destructive HQ tool without explicit owner promotion.
 */
export async function compileAndDeploySubMd(
  approvedProposal: SubMdProposal,
  deps: SelfExtensionDeps,
  args: {
    readonly approvers: ReadonlyArray<string>;
    readonly proposerActor: string;
    /**
     * C4 — Owner-edited spec from `OwnerApprovalDecision.editedSpec`.
     * When present, this REPLACES the LLM's draft. Risk-tier promotion
     * (e.g. `read` → `external-comm`) is only possible via this path.
     */
    readonly editedSpec?: SubMdSpec;
    /**
     * C4 — Override / extend the default destructive tool blocklist.
     * The caller's list FULLY REPLACES the default; use `[]` to disable
     * the check (NOT recommended).
     */
    readonly destructiveToolBlocklist?: ReadonlyArray<string>;
  } = { approvers: [], proposerActor: 'self-extension-keystone' },
): Promise<DeploymentReceipt> {
  const clock = deps.clock ?? Date.now;

  // C4 — Prefer the owner-edited spec when present. Fall back to the
  // proposal's spec only on an unedited approval.
  const baseSpec: SubMdSpec = args.editedSpec ?? approvedProposal.spec;

  // C4 — Destructive HQ-tool gate. Even an owner-edited spec must not
  // smuggle destructive tools through without explicit acknowledgement.
  // The owner promotes by removing the tool from the spec OR by passing
  // an empty blocklist. Either path is a deliberate operator action.
  const blocklist =
    args.destructiveToolBlocklist ?? DEFAULT_DESTRUCTIVE_TOOL_BLOCKLIST;
  if (blocklist.length > 0) {
    const denied = baseSpec.toolBelt.filter((tool) =>
      blocklist.includes(tool),
    );
    if (denied.length > 0) {
      throw new Error(
        `compileAndDeploySubMd: spec contains destructive HQ tools that require explicit owner promotion: ${denied.join(', ')}`,
      );
    }
  }

  // C4 — Re-clamp the deployed riskTier so an owner can ONLY promote
  // via `editedSpec`. If the deployed spec is the LLM's draft, the tier
  // is clamped to the proposal's already-clamped value (a no-op when
  // proposeNewSubMd ran first, defensive when the proposal was built
  // by another path).
  const deployedSpec: SubMdSpec = Object.freeze({
    ...baseSpec,
    riskTier: args.editedSpec
      ? baseSpec.riskTier
      : clampRiskTier(baseSpec.riskTier, approvedProposal.diagnosis.riskTier),
  });

  const receipt = await deps.subMdRegistry.register({
    name: deployedSpec.name,
    spec: deployedSpec,
  });

  let ledgerEntryId: string | null = null;
  if (deps.ledger) {
    const result = (await deps.ledger.appendLedgerEntry({
      tenantId: deployedSpec.scope.tenantId,
      actionType: 'sub-md.deployed.by.self-extension',
      payloadJson: {
        proposalId: approvedProposal.proposalId,
        subMdId: receipt.subMdId,
        registryVersion: receipt.version,
        spec: deployedSpec,
        originalSpec: approvedProposal.spec,
        ownerEdited: args.editedSpec !== undefined,
        diagnosis: approvedProposal.diagnosis,
        dailyCostCeilingUsdCents: approvedProposal.dailyCostCeilingUsdCents,
      },
      proposer: args.proposerActor,
      approvers: args.approvers,
      executedAt: new Date(clock()),
    })) as { readonly id?: string } | null | undefined;
    ledgerEntryId = result?.id ?? `ledger:${receipt.subMdId}:${receipt.version}`;
  }

  return Object.freeze({
    proposalId: approvedProposal.proposalId,
    subMdId: receipt.subMdId,
    registryVersion: receipt.version,
    deployedAtMs: clock(),
    ledgerEntryId,
    approvers: Object.freeze([...args.approvers]),
  });
}
