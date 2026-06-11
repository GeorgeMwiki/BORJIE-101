/**
 * Mining-domain Hono sub-app — aggregates every mining route into a
 * single mount-point so `services/api-gateway/src/index.ts` only needs
 * one `api.route('/mining', miningRouter)` call.
 *
 * Sub-routes (one file per resource):
 *   /sites             — sites + site sections
 *   /licences          — TZ mining licences + events
 *   /drill-holes       — geological drill / pit / trench logs
 *   /samples           — lab-bound assay packets
 *   /shift-reports     — supervisor shift roll-ups
 *   /attendance        — GPS-fenced check-in / check-out
 *   /fuel-logs         — fuel issued / consumed per asset
 *   /maintenance       — asset maintenance events
 *   /ore-parcels       — saleable stockpiles + list-for-sale
 *   /sales             — ore-parcel sale transactions
 *   /incidents         — safety incidents
 *   /grievances        — community grievances
 *   /cockpit           — owner cockpit widgets
 *   /chat              — Master Brain SSE stream
 *   /lmbm              — Live Mining Brain Memory (graph)
 *   /documents         — upload / doc-chat / sign
 *   /reports           — report generator
 *   /portfolio-map     — GeoJSON portfolio map
 *   /marketplace       — public listings
 *   /bids              — bids + accept / reject
 *   /buyers/kyc        — buyer KYC submission + status
 *   /csr-plans         — CSR commitments with delivered_pct (migration 0082)
 *   /drafts            — document drafter (contracts, RFPs, letters, memos)
 *   /escalations       — manager-dispatch escalation chain (migration 0081)
 *   /approvals         — unified Linear-Triage approval queue (migration 0081)
 *   /tasks/:id/suggest-assignee — AI-suggested assignee (rules v1)
 *   /tasks             — manager-assigned worker tasks (B-WorkerTasks)
 *   /toolbox-talks     — pre-shift safety briefings (acknowledge / schedule)
 *   /document-intelligence — corpus-scoped doc-chat sessions
 *   /brain/vision-turn — multimodal Brain (Photo Advisor)
 *   /internal/*        — admin-console SUPER_ADMIN surfaces
 */

import { OpenAPIHono } from '@hono/zod-openapi';

import { miningSitesRouter } from './sites.hono';
import { miningLicencesRouter } from './licences.hono';
import { miningDrillHolesRouter } from './drill-holes.hono';
import { miningSamplesRouter } from './samples.hono';
import { miningShiftReportsRouter } from './shift-reports.hono';
import { miningAttendanceRouter } from './attendance.hono';
import { miningFuelLogsRouter } from './fuel-logs.hono';
import { miningMaintenanceRouter } from './maintenance.hono';
import { miningOreParcelsRouter } from './ore-parcels.hono';
import { miningSalesRouter } from './sales.hono';
import { miningIncidentsRouter } from './incidents.hono';
import { miningGrievancesRouter } from './grievances.hono';
import { miningCockpitRouter } from './cockpit.hono';
// Live FX feed read path — see workers/fx-feed-cron.ts for the writer.
import { miningFxRouter } from './fx.hono';
import { miningChatRouter } from './chat.hono';
import { miningLmbmRouter } from './lmbm.hono';
import { miningDocumentsRouter } from './documents.hono';
import { miningReportsRouter } from './reports.hono';
import { miningPortfolioMapRouter } from './portfolio-map.hono';
import { miningMarketplaceRouter } from './marketplace.hono';
import { miningBidsRouter } from './bids.hono';
// Wave WS-2 — buyer ↔ seller bid chat + post-settlement seller ratings.
// Threads hang off request_for_bid_responses; ratings off settlements.
// Tables: bid_messages (0172), seller_ratings (0173).
import { miningBidMessagingRouter } from './bid-messaging.hono';
import { miningBuyersKycRouter } from './buyers-kyc.hono';
import { miningCsrPlansRouter } from './csr-plans.hono';
import { miningDocsRouter } from './docs.hono';

// New-user ONBOARDING BOOTSTRAP — upload/OCR → recognise → propose →
// PERSIST real rows into employees / sites / licences via the
// @borjie/data-onboarding recipe pipeline + Drizzle RowWriter.
import { miningOnboardingRouter } from './onboarding.hono';

// Wave OWNER-OS PANELS-WIRE (final 5) — the last CTA-only owner-os panels
// land on real, RLS-scoped read surfaces:
//   /esg          → village_meetings (community engagement; real rows)
//   /procurement  → procurement_recommendations (real rows)
//   /accounting   → real journal lines from payments-ledger ledger_entries (WS-4)
//   /legal        → empty contract (contracts-library table still needed)
//   /ancillary    → empty contract (ancillary-business table still needed)
import { miningEsgRouter } from './esg.hono';
import { miningProcurementRouter } from './procurement.hono';
import { miningAccountingRouter } from './accounting.hono';
import { miningLegalRouter } from './legal.hono';
import { miningAncillaryRouter } from './ancillary.hono';

// Document Drafter (B-DocDrafter) — drafts of contracts / RFPs /
// letters / notices / memos. Bilingual (sw + en) templates;
// migration 0084.
import { miningDraftsRouter } from './draft.hono';

// Manager Dispatch (B-MgrDispatch) — escalations, approvals, AI suggest.
// `tasks-suggest` is mounted under `/tasks` and exposes only
// `:id/suggest-assignee`, so it coexists with `tasks.hono.ts` (owned by
// the B-WorkerTasks wave) without endpoint collision.
import { miningEscalationsRouter } from './escalations.hono';
import { miningApprovalsRouter } from './approvals.hono';
import { miningTasksSuggestRouter } from './tasks-suggest.hono';
// Assignment-plan preview — wraps the pure-compute
// `@borjie/workforce-orchestrator` planAssignment() (risk-tier + HITL gate
// + follow-up cadence). Complements `tasks-suggest` (WHO) by answering WHAT
// dispatch plan a chosen task gets; no new tables, no migrations.
import { miningAssignmentPlannerRouter } from './assignment-planner.hono';

// B-WorkerTasks — manager-assigned worker tasks (list / complete /
// block / reassign). Coexists with miningTasksSuggestRouter under
// the same `/tasks` prefix (suggest only owns `/:id/suggest-assignee`).
import { miningTasksRouter } from './tasks.hono';

// Worker safety — pre-shift toolbox talks (list / schedule / ack).
import { miningToolboxRouter } from './toolbox.hono';

// Generic offline-sync acknowledgement sink (wm-toolbox-ack-404). POST
// /toolbox-acks dispatches on payload.kind: task_complete → mining_tasks done,
// talk_ack → toolbox-talks acknowledge. Idempotent. Backs the workforce-mobile
// offline write queue's `toolbox_ack` entity (endpointFor → 'toolbox-acks').
import { miningToolboxAcksRouter } from './toolbox-acks.hono';
// Legacy-portal browser super-power — the MD drives no-API third-party portals
// (KRA iTax …) via AXTree perception. Reachable at /mining/legacy-portal/*.
import { createLegacyPortalRouter } from './legacy-portal.hono';

// Causal root-cause + counterfactual intervention simulation (Wave D). POST
// /root-cause ("why did cash dip?") + POST /simulate ("hedge now vs in 2 weeks").
// Read-only analysis over the KG + ledger; honest-degrades to "cannot establish".
import { miningCausalInterventionRouter } from './causal-intervention.hono';

// Buyer sale-document list + biometric sign (buyer-mobile-1). GET /, GET /:id,
// POST /:id/sign backed by offtake_agreements, buyer-scoped via RLS.
import { miningBuyersDocumentsRouter } from './buyers-documents.hono';

// Buyer notification preferences round-trip (buyer-mobile-4 / -11). GET + PUT
// (+ POST) /buyers/profile/notifications persisting into buyers.attributes.
import { miningBuyersNotificationsRouter } from './buyers-notifications.hono';

// Employee performance coaching (wm-worker-coach-endpoint-missing). GET
// /copilots/worker-coach grounded in the worker's mining_tasks rows.
import { miningWorkerCoachRouter } from './worker-coach.hono';

// WS-3 workforce wires — worker payslip read (own committed line item) +
// worker leave requests with single manager approval (NO four-eye) + audit.
import { miningPayslipRouter } from './payslip.hono';
import { miningLeaveRequestsRouter } from './leave-requests.hono';

// DOC-INTEL — "documents as alive entities" (upload / sessions /
// ask / summary).
import { miningDocumentIntelligenceRouter } from './document-intelligence.hono';

// Photo Advisor — multimodal Brain turn for workforce-mobile vision.
// Returns 503 BACKEND_VISION_UNAVAILABLE until orchestrator multimodal
// API ships; the route itself is wired so the FE contract is honored.
import { miningBrainVisionRouter } from './brain-vision.hono';

import { miningInternalTenantsRouter } from './internal/tenants.hono';
import { miningInternalCorpusRouter } from './internal/corpus.hono';
import { miningInternalPromptsRouter } from './internal/prompts.hono';
import { miningInternalAuditLogRouter } from './internal/audit-log.hono';
import { miningInternalKillswitchRouter } from './internal/killswitch.hono';
import { miningInternalDecisionLogRouter } from './internal/decision-log.hono';
import { miningInternalSloRouter } from './internal/slo.hono';
import { miningInternalPromotionsRouter } from './internal/promotions.hono';
import { miningInternalRegulatorPipelineRouter } from './internal/regulator-pipeline.hono';
import { miningInternalCitationsRouter } from './internal/citations.hono';
import { miningInternalComplianceQueueRouter } from './internal/compliance-queue.hono';
// R31 — admin-web internal-form endpoints (FlagRolloutForm /
// JuniorActions / TicketAck parent screens previously rendered stubs).
import { miningInternalFeatureFlagsRouter } from './internal/feature-flags.hono';
import { miningInternalJuniorsRouter } from './internal/juniors.hono';
import { miningInternalSupportTicketsRouter } from './internal/support-tickets.hono';
// INV-A / FIRE-1 — platform operator break-glass surface (deny-by-default
// access request + grant-status list; surfaces NO tenant business data).
import { miningInternalBreakGlassRouter } from './internal/break-glass.hono';
// INV-A / FIRE-2 — decision-trace replay: metadata-only by default, full
// decision CONTENT behind break-glass. Replaces the admin-web service-role
// Supabase client that bypassed RLS for any ?tenant=.
import { miningInternalDecisionTraceRouter } from './internal/decision-trace.hono';
// Wave OWNER-OS DAILY-BRIEF rebuild — fleet overview for the admin cockpit.
import { adminDailyBriefOverviewRouter } from './internal/daily-brief-overview.hono';

// Endpoint wave — royalty ledger projection (read), buyer wallet
// (top-up / balance / escrow), fleet telemetry, SIC asset pings, and the
// admin-console internal marketplace + models surfaces.
import { miningRoyaltyRouter } from './royalty.hono';
// B2 — statements BFF proxy. Thin authenticated pass-through to the
// standalone payments-ledger service's statement-generation surface; the
// downstream service re-verifies the JWT and binds tenant scope.
import { miningStatementsRouter } from './statements.hono';
import { buyersWalletRouter } from './buyers-wallet.hono';
import { miningFleetRouter } from './fleet.hono';
import { miningSicPingsRouter } from './sic-pings.hono';
import { miningInternalMarketplaceRouter } from './internal/marketplace.hono';
import { miningInternalModelsRouter } from './internal/models.hono';

// Mining ADVISOR wave — twelve new junior-advisor read/compute surfaces, each
// backed by its own @borjie/<advisor> package + (where stateful) a new
// RLS-scoped domain table. All evidence-grounded, tenant-scoped via the
// shared auth + database middleware. Mount paths avoid the existing `/fleet`
// (telemetry) prefix — fleet-management lands at `/fleet-ops`.
import { miningShiftPlannerRouter } from './shift-planner.hono';
import { miningCapacityExpansionRouter } from './capacity-expansion.hono';
import { miningCostEngineerRouter } from './cost-engineer.hono';
import { miningFxTreasuryRouter } from './fx-treasury.hono';
import { miningMarketIntelligenceRouter } from './market-intelligence.hono';
import { miningGeologyAdvisorRouter } from './geology-advisor.hono';
import { miningMinePlannerRouter } from './mine-planner.hono';
import { miningCommodityIntelligenceRouter } from './commodity-intelligence.hono';
import { miningMarketplaceAdvisorRouter } from './marketplace-advisor.hono';
import { miningInventoryRouter } from './inventory.hono';
import { miningFleetOpsRouter } from './fleet-ops.hono';
import { miningProcurementCoordinationRouter } from './procurement-coordination.hono';
// FINAL NEEDS-DESIGN wave — knowledge-graph (GraphRAG ingest/stats/neighbors),
// conformal calibration (prediction/observation/state), progressive-intelligence
// (live coaching), recommendations (next-best-action), and three internal-admin
// analytics surfaces (funnel/cohorts, A/B experiments, audit-pack minting).
import { miningKnowledgeGraphRouter } from './knowledge-graph.hono';
import { miningConformalRouter } from './conformal-calibration.hono';
import { miningProgressiveRouter } from './progressive-intelligence.hono';
import { miningRecommendationsRouter } from './recommendations.hono';
import { miningInternalAnalyticsRouter } from './internal/analytics.hono';
import { miningInternalAbTestsRouter } from './internal/ab-tests.hono';
import { miningInternalAuditPackRouter } from './internal/audit-pack.hono';

// Use OpenAPIHono so the `app.openapi(routeDef, handler)` registrations
// inside the migrated route files (sites, licences, cockpit, chat,
// marketplace, bids) propagate into a shared `openAPIRegistry`. The
// generator at `scripts/generate-openapi-spec.mjs` reads from this
// registry via `mining.getOpenAPI31Document(...)`.
const mining = new OpenAPIHono();

mining.route('/sites', miningSitesRouter);
mining.route('/licences', miningLicencesRouter);
mining.route('/drill-holes', miningDrillHolesRouter);
mining.route('/samples', miningSamplesRouter);
mining.route('/shift-reports', miningShiftReportsRouter);
mining.route('/attendance', miningAttendanceRouter);
mining.route('/fuel-logs', miningFuelLogsRouter);
mining.route('/maintenance', miningMaintenanceRouter);
mining.route('/ore-parcels', miningOreParcelsRouter);
mining.route('/sales', miningSalesRouter);
mining.route('/incidents', miningIncidentsRouter);
mining.route('/grievances', miningGrievancesRouter);
mining.route('/cockpit', miningCockpitRouter);
mining.route('/fx', miningFxRouter);
mining.route('/chat', miningChatRouter);
mining.route('/lmbm', miningLmbmRouter);
mining.route('/documents', miningDocumentsRouter);
mining.route('/reports', miningReportsRouter);
mining.route('/portfolio-map', miningPortfolioMapRouter);
mining.route('/marketplace', miningMarketplaceRouter);
mining.route('/bids', miningBidsRouter);
// WS-2 — bid chat (thread per RFB response) + post-settlement seller
// ratings + reputation aggregate. Endpoints: /bid-messaging/threads/
// :responseId/messages, /bid-messaging/settlements/:settlementId/rate,
// /bid-messaging/reputation/:sellerTenantId.
mining.route('/bid-messaging', miningBidMessagingRouter);
mining.route('/buyers', miningBuyersKycRouter);
// Buyer wallet — top-up / balance / escrow. Mounted AFTER the KYC router on
// the same `/buyers` prefix; the two routers own disjoint sub-paths
// (`/kyc/*` vs `/wallet/*`), so Hono trie resolution keeps both reachable.
mining.route('/buyers', buyersWalletRouter);
// Buyer sale-document list + biometric sign (buyer-mobile-1) and notification
// prefs round-trip (buyer-mobile-4 / -11). Mounted on the SAME `/buyers`
// family at more-specific prefixes (`/buyers/documents/*`,
// `/buyers/profile/notifications`) so they own disjoint sub-paths from the KYC
// + wallet routers and Hono trie resolution keeps every one reachable.
mining.route('/buyers/documents', miningBuyersDocumentsRouter);
mining.route('/buyers/profile/notifications', miningBuyersNotificationsRouter);
// /csr-plans — Corporate Social Responsibility commitments + delivered_pct
// (migration 0082).
mining.route('/csr-plans', miningCsrPlansRouter);

// Owner-os panel BFFs (PANELS-WIRE final 5). `/esg` + `/procurement` return
// real tenant rows; `/accounting` reads REAL journal lines from the
// payments-ledger `ledger_entries` (WS-4 — a read-only projection, never a
// parallel ledger); `/legal` + `/ancillary` return a real empty list (200, [])
// until their domain tables are modelled, so each panel renders a proper state.
mining.route('/esg', miningEsgRouter);
mining.route('/procurement', miningProcurementRouter);
mining.route('/accounting', miningAccountingRouter);
mining.route('/legal', miningLegalRouter);
mining.route('/ancillary', miningAncillaryRouter);

// New-user onboarding bootstrap — POST /onboarding/ingest +
// /onboarding/commit. Persists real rows into the tenant's domain
// tables (employees / sites / licences) with idempotency + hash-chained
// audit + row provenance.
mining.route('/onboarding', miningOnboardingRouter);

// Document drafter (B-DocDrafter).
mining.route('/drafts', miningDraftsRouter);

// Manager Dispatch surfaces (B-MgrDispatch).
mining.route('/escalations', miningEscalationsRouter);
mining.route('/approvals', miningApprovalsRouter);
// `tasks-suggest` only handles POST /:id/suggest-assignee — does not
// collide with the worker tasks router endpoints (`/`, `/:id/complete`,
// `/:id/block`, `/:id/reassign`). Mount the tasks router AFTER the
// suggest router so Hono trie resolution gives the more specific
// `/:id/suggest-assignee` priority. Both nest at `/tasks/*`.
mining.route('/tasks', miningTasksSuggestRouter);
mining.route('/tasks', miningTasksRouter);
// Assignment-plan preview (pure orchestrator compute). Distinct prefix so
// it never collides with `/tasks` (suggest WHO) — this answers WHAT plan.
mining.route('/assignment-planner', miningAssignmentPlannerRouter);

// Worker safety pulse — toolbox-talks.
mining.route('/toolbox-talks', miningToolboxRouter);
// Generic offline-sync ack sink — `POST /toolbox-acks` dispatches
// task_complete → mining_tasks done, talk_ack → toolbox-talks acknowledge.
// Distinct prefix from `/toolbox-talks` so neither shadows the other.
mining.route('/toolbox-acks', miningToolboxAcksRouter);
mining.route('/legacy-portal', createLegacyPortalRouter());
mining.route('/causal', miningCausalInterventionRouter);

// Employee copilots — performance coaching. The workforce-mobile mining client
// resolves `/copilots/worker-coach` under the `/api/v1/mining` prefix, so the
// copilots surface lives HERE (mining sub-app), not as a top-level mount.
mining.route('/copilots', miningWorkerCoachRouter);

// WS-3 workforce wires — worker payslip (own committed line item) + leave
// requests (worker submit / manager approve|reject with audit append).
mining.route('/payslip', miningPayslipRouter);
mining.route('/leave-requests', miningLeaveRequestsRouter);

// Endpoint wave — royalty ledger projection (read), fleet telemetry, and
// SIC asset-pings ingestion.
mining.route('/royalties', miningRoyaltyRouter);
// B2 — statements proxy: GET /statements (+ /:id) forwards to the
// payments-ledger service; tenant scope enforced end-to-end downstream.
mining.route('/statements', miningStatementsRouter);
mining.route('/fleet', miningFleetRouter);
mining.route('/sic-pings', miningSicPingsRouter);

// "Documents as alive entities" — corpus-scoped doc-intelligence.
mining.route('/document-intelligence', miningDocumentIntelligenceRouter);

// Photo Advisor — multimodal Brain vision turn.
mining.route('/brain', miningBrainVisionRouter);

// Mining ADVISOR wave mounts. `/fleet-ops` is distinct from `/fleet`
// (telemetry) above; the others are net-new prefixes.
mining.route('/shift-planner', miningShiftPlannerRouter);
mining.route('/capacity-expansion', miningCapacityExpansionRouter);
mining.route('/cost-engineer', miningCostEngineerRouter);
mining.route('/fx-treasury', miningFxTreasuryRouter);
mining.route('/market-intelligence', miningMarketIntelligenceRouter);
mining.route('/geology-advisor', miningGeologyAdvisorRouter);
mining.route('/mine-planner', miningMinePlannerRouter);
mining.route('/commodity-intelligence', miningCommodityIntelligenceRouter);
mining.route('/marketplace-advisor', miningMarketplaceAdvisorRouter);
mining.route('/inventory', miningInventoryRouter);
mining.route('/fleet-ops', miningFleetOpsRouter);
// Mount path matches the router's self-documented prefix + the owner-web
// client (procurement-coordination.ts) + the surface hints — all of which
// expect `/procurement-coordination`. (Was `/procurement-analytics`, the one
// outlier that 404'd the vendors/budgets/spend panels.)
mining.route('/procurement-coordination', miningProcurementCoordinationRouter);

// FINAL NEEDS-DESIGN wave mounts. `/knowledge-graph` (POST /ingest, GET /stats,
// GET /neighbors/:id) drives the GraphRAG store that chat-orchestrator expands
// against; `/conformal` (POST /predictions, POST /observations, GET /state) runs
// the online-ACI coverage-feedback loop; `/progressive` (POST /coach) surfaces
// live coaching; `/recommendations` returns next-best-action with evidence.
mining.route('/knowledge-graph', miningKnowledgeGraphRouter);
mining.route('/conformal', miningConformalRouter);
mining.route('/progressive', miningProgressiveRouter);
mining.route('/recommendations', miningRecommendationsRouter);

// OpenAPI 3.1 static spec + Swagger UI for the mining sub-API.
// Mount BEFORE `/internal/*` so the docs surface is open even when
// internal tenant routes are gated to SUPER_ADMIN.
mining.route('/', miningDocsRouter);

mining.route('/internal/tenants', miningInternalTenantsRouter);
mining.route('/internal/corpus', miningInternalCorpusRouter);
mining.route('/internal/prompts', miningInternalPromptsRouter);
mining.route('/internal/audit-log', miningInternalAuditLogRouter);
mining.route('/internal/killswitch', miningInternalKillswitchRouter);
mining.route('/internal/decision-log', miningInternalDecisionLogRouter);
mining.route('/internal/slo', miningInternalSloRouter);
mining.route('/internal/promotions', miningInternalPromotionsRouter);
mining.route('/internal/regulator-pipeline', miningInternalRegulatorPipelineRouter);
mining.route('/internal/citations', miningInternalCitationsRouter);
mining.route('/internal/compliance-queue', miningInternalComplianceQueueRouter);
// R31 — admin-web parent screens stop rendering stubs.
mining.route('/internal/feature-flags', miningInternalFeatureFlagsRouter);
mining.route('/internal/juniors', miningInternalJuniorsRouter);
mining.route('/internal/support/tickets', miningInternalSupportTicketsRouter);
// INV-A / FIRE-1 — operator break-glass request + grant-status surface.
mining.route('/internal/break-glass', miningInternalBreakGlassRouter);
// INV-A / FIRE-2 — decision-trace replay (metadata default, content gated).
mining.route('/internal/decision-trace', miningInternalDecisionTraceRouter);
// Wave OWNER-OS DAILY-BRIEF rebuild — admin fleet overview of today's
// daily-brief sends + failures + top alerts across every tenant.
mining.route('/internal/daily-brief-overview', adminDailyBriefOverviewRouter);
// Endpoint wave — admin-console internal marketplace + models surfaces.
mining.route('/internal/marketplace', miningInternalMarketplaceRouter);
mining.route('/internal/models', miningInternalModelsRouter);
// FINAL NEEDS-DESIGN wave — internal-admin analytics. `/internal/analytics`
// (funnel + cohorts over real activation_events), `/internal/ab-tests`
// (ab_experiments CRUD + promote-winner), `/internal/audit-pack` (regulator
// bundle list + mint). SUPER_ADMIN/ADMIN-gated cross-tenant HQ surfaces.
mining.route('/internal/analytics', miningInternalAnalyticsRouter);
mining.route('/internal/ab-tests', miningInternalAbTestsRouter);
mining.route('/internal/audit-pack', miningInternalAuditPackRouter);

export const miningRouter = mining;
