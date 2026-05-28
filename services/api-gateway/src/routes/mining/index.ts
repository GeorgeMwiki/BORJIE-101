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
import { miningBuyersKycRouter } from './buyers-kyc.hono';
import { miningCsrPlansRouter } from './csr-plans.hono';
import { miningDocsRouter } from './docs.hono';

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

// B-WorkerTasks — manager-assigned worker tasks (list / complete /
// block / reassign). Coexists with miningTasksSuggestRouter under
// the same `/tasks` prefix (suggest only owns `/:id/suggest-assignee`).
import { miningTasksRouter } from './tasks.hono';

// Worker safety — pre-shift toolbox talks (list / schedule / ack).
import { miningToolboxRouter } from './toolbox.hono';

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
// Wave OWNER-OS DAILY-BRIEF rebuild — fleet overview for the admin cockpit.
import { adminDailyBriefOverviewRouter } from './internal/daily-brief-overview.hono';

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
mining.route('/buyers', miningBuyersKycRouter);
// /csr-plans — Corporate Social Responsibility commitments + delivered_pct
// (migration 0082).
mining.route('/csr-plans', miningCsrPlansRouter);

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

// Worker safety pulse — toolbox-talks.
mining.route('/toolbox-talks', miningToolboxRouter);

// "Documents as alive entities" — corpus-scoped doc-intelligence.
mining.route('/document-intelligence', miningDocumentIntelligenceRouter);

// Photo Advisor — multimodal Brain vision turn.
mining.route('/brain', miningBrainVisionRouter);

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
// Wave OWNER-OS DAILY-BRIEF rebuild — admin fleet overview of today's
// daily-brief sends + failures + top alerts across every tenant.
mining.route('/internal/daily-brief-overview', adminDailyBriefOverviewRouter);

export const miningRouter = mining;
