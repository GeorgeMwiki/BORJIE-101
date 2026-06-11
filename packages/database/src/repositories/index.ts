/**
 * Repository exports for BORJIE database.
 *
 * Property-domain repositories (customer, lease, payment, maintenance,
 * inspection, scheduling, utilities, compliance, messaging, property,
 * hr, operations, vacancy-pipeline) were deleted in the pre-Borjie
 * hard-fork. Re-introduce mining-domain equivalents (buyers,
 * shipments, assays, etc.) under the mining schemas as those domains
 * land.
 */

export {
  buildPaginatedResult,
  DEFAULT_PAGINATION,
} from './base.repository.js';

export {
  TenantRepository,
  UserRepository,
  type RepoEncryptionDeps,
} from './tenant.repository.js';

// Brain — Thread Store. Reads conversation.schema, which survives the
// hard-fork. Required by the kernel composition root.
export { BrainThreadRepository } from './brain-thread.repository.js';
export type {
  BrainThread,
  BrainThreadEvent,
} from './brain-thread.repository.js';

// Sovereign four-eye approvals (migration 0115). Postgres adapter for
// the kernel's ApprovalStore port.
export {
  createPgApprovalStore,
  type ApprovalRecord as PgApprovalRecord,
  type ApprovalSignature as PgApprovalSignature,
  type ApprovalStatus as PgApprovalStatus,
  type ApprovalStore as PgApprovalStore,
  type PgApprovalStoreScope,
  type ProposedAction as PgProposedAction,
} from './sovereign-approvals.repository.js';

// Owner-style profile store (migration 0282 / gap-8). Postgres adapter for the
// OwnerStyleProfileStore port in @borjie/ai-copilot. Round-trips the full
// Dirichlet posterior through profile_json; typed columns are a queryable
// projection. Honest-degrade: never fabricates a profile.
export {
  createPgOwnerStyleProfileStore,
  type OwnerStyleProfile as PgOwnerStyleProfile,
  type OwnerStyleProfileStore as PgOwnerStyleProfileStore,
} from './owner-style.repository.js';

// Piece A (Universal Asset & Entity Model) — polymorphic root + per-type
// extension repositories. Single public class CoreEntityRepository covers
// insert / find / recursive descent / custom-field validation / hybrid
// BM25 + dense + geo search with MMR rerank.
export {
  CoreEntityRepository,
  mmrRerank,
  type CoreEntityInput,
  type CoreEntityCommon,
  type LandEntityInput,
  type BuildingEntityInput,
  type SubUnitEntityInput,
  type VehicleEntityInput,
  type MachineryEntityInput,
  type ItAssetEntityInput,
  type PersonEntityInput,
  type IntangibleEntityInput,
  type SearchHybridParams,
  type SearchHit,
  type AddCustomFieldParams,
} from './core-entity.repository.js';

// Wave WS-4 ANALYTICS — analytics warehouse reads + aggregations
// (migrations 0175/0176/0177). Read fns back the owner-portal Analytics
// routers; aggregate fns back the consolidation-worker analytics-aggregate
// task. All run on the passed (RLS-pinned) Drizzle client.
export {
  usageSeries,
  growthSeries,
  listExportTemplates,
  aggregateUsageDaily,
  aggregateGrowthMonthly,
  type UsageSeriesPoint,
  type GrowthSeriesPoint,
  type ExportTemplateRow,
  type DateRange as AnalyticsDateRange,
  type AggregateResult as AnalyticsAggregateResult,
} from './analytics-warehouse.repository.js';

// Wave WS-4 ACCOUNTING — READ-ONLY projection over the canonical
// payments-ledger `ledger_entries` for the owner-portal accounting tab.
// Reads existing journals (never a parallel ledger, never a write).
export {
  listLedgerLines,
  type AccountingLedgerLine,
  type ListLedgerOptions,
} from './accounting-ledger-read.repository.js';

// MD commitments (migration 0321) — the durable DEFERRAL / FOLLOW-THROUGH
// commitment ledger (the brain's prospective-memory backlog + the closed
// loop). Drizzle adapter runs every method inside withServiceRoleContext so the
// out-of-band EstateMind RECONCILE sweep can read + advance commitments while
// RLS FORCE isolates every request caller. In-memory twin for tests. Honest
// closure: markDone REQUIRES a confirmation proof; create is idempotent on
// (tenantId, idempotencyKey); evidence-required at the row boundary.
export {
  createDrizzleMdCommitmentRepository,
  createInMemoryMdCommitmentRepository,
  type MdCommitment,
  type MdCommitmentRepository,
  type CreateMdCommitmentInput,
  type TransitionInput as MdCommitmentTransitionInput,
  type ConfirmInput as MdCommitmentConfirmInput,
  // Capability Gap Register (Loop A, P0; migration 0326).
  type CreateGapInput as MdCommitmentCreateGapInput,
  type AdvanceGapStatusInput as MdCommitmentAdvanceGapStatusInput,
  type GapAuditAppendPort as MdCommitmentGapAuditAppendPort,
  TERMINAL_GAP_STATUSES,
  isTerminalGapStatus,
  // FIX 5 — replayable audit chain (the log verifies without the live row).
  replayGapAuditChain,
  type ReplayableGapAuditEntry as MdCommitmentReplayableGapAuditEntry,
  type GapAuditReplayResult as MdCommitmentGapAuditReplayResult,
} from './md-commitment-repository.js';

// Org loop runs (migration 0341) — the SELF-RUNNING-ORG SPINE correlation
// identity: one durable row per loop run joining an md_commitments row
// (commitmentId, the close-the-loop back-edge) to the mining_tasks row the
// workforce orchestrator spawned (taskId, the dispatch forward-edge). Carries
// the stage machine (detect → strategize → pick → assign → dispatch → deliver →
// report → reloop → closed), honest status, the chosen employee + match
// confidence (matcher-learning inputs), and the evidence ids threaded from the
// commitment. The Drizzle adapter runs every method inside withServiceRoleContext
// so the out-of-band loop-economy cron can read + advance runs while RLS FORCE
// isolates every request caller. In-memory twin for tests.
export {
  createDrizzleOrgLoopRunRepository,
  createInMemoryOrgLoopRunRepository,
  type OrgLoopRun,
  type OrgLoopRunRepository,
  type CreateOrgLoopRunInput,
  type AdvanceOrgLoopRunInput,
} from './org-loop-run-repository.js';

// Org memberships (migrations 0305/0336/0344) — the WRITE-PATH + targeting
// reads for the User⟷Membership⟷Org substrate (surface-completion SC-1). Lights
// up the previously-dark org_memberships join: connect / redeemInvite / leave /
// block lifecycle + listActiveForIdentity (the multi-org JWT + switcher SET),
// verifyActiveMembership (the switch authorization), resolveAudience (the
// surface-completion audience fan). Owns the membership graph ONLY — the shadow
// users row is provisioned upstream (authz stays on user_id + RLS). Drizzle impl
// runs under withServiceRoleContext (cross-org by nature); in-memory twin for tests.
export {
  createDrizzleOrgMembershipRepository,
  createInMemoryOrgMembershipRepository,
  InviteRedemptionError,
  type OrgMembership,
  type OrgMembershipRepository,
  type OrgMembershipStatus,
  type OrgMembershipRelationshipType,
  type ConnectMembershipInput,
  type RedeemInviteInput,
  type RedeemInviteResult,
  type BlockMembershipInput,
  type AudienceQuery,
  type InMemoryOrgMembershipSeed,
} from './org-membership.repository.js';

// Enum guards — bug fix A-BUG-DEEP #9. Property-domain enums (lease,
// customer, document) retained as opaque type aliases until the
// mining-domain equivalents replace them.
export {
  assertLeaseStatus,
  assertLeaseStatuses,
  assertCustomerStatus,
  assertCustomerStatuses,
  assertUserStatus,
  assertDocumentStatus,
  assertDocumentType,
  LEASE_STATUS_VALUES,
  CUSTOMER_STATUS_VALUES,
  USER_STATUS_VALUES,
  DOCUMENT_STATUS_VALUES,
  DOCUMENT_TYPE_VALUES,
  type LeaseStatus,
  type CustomerStatus,
  type UserStatus,
  type DocumentStatus,
  type DocumentType,
} from './enum-guards.js';
