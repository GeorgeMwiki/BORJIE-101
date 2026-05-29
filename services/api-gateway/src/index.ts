/**
 * @borjie/api-gateway
 *
 * API Gateway / Backend-for-Frontend for the BORJIE platform.
 * Handles authentication, authorization, request routing, and aggregation.
 */

// Auto-load .env FIRST — before any module reads process.env. Look at
// repo root (cwd/../../.env from services/api-gateway) and the service
// folder. Tests + prod skip via BORJIE_SKIP_DOTENV=true.
//
// Load order matters — dotenv with override=true makes the LAST load
// win for any duplicated key. We want:
//   1. .env (repo root)          — committed defaults / non-secret keys.
//   2. .env (service)            — service-specific overrides (rare).
//   3. .env.local (repo root)    — canonical dev secrets, highest prio.
//
// Why .env.local is loaded HERE in code instead of relying on
// `tsx watch --env-file=../../.env.local`: tsx-watch caches the env
// from the parent process at first boot and does not re-read the file
// on respawn. When a child respawns after a code change, anything that
// snapshotted process.env in module init (e.g. brain-teach.hono.ts's
// loadBrainEnv cache) sees an older value and returns 503
// BRAIN_NOT_CONFIGURED until the parent is killed. Loading .env.local
// explicitly here makes the load deterministic per process — every
// respawn re-reads the canonical file before any other module imports
// run. See Docs/AUDIT/POWERS_LIVE_VERIFICATION_2026-05-29.md §DO NOT SHIP.
import { config as loadDotenv } from 'dotenv';
import { resolve as resolvePath } from 'node:path';
if (!process.env.BORJIE_SKIP_DOTENV) {
  // cwd when started via `pnpm dev` is services/api-gateway. Repo root is 2 up.
  // override=true ensures stale shell exports (e.g. empty ANTHROPIC_API_KEY
  // left in a previous terminal) don't beat the canonical .env values.
  loadDotenv({ path: resolvePath(process.cwd(), '../../.env'), override: true });
  loadDotenv({ path: resolvePath(process.cwd(), '.env'), override: true });
  // .env.local LAST so its keys win on respawn (e.g. SUPABASE_JWT_SECRET).
  loadDotenv({ path: resolvePath(process.cwd(), '../../.env.local'), override: true });
}

// OpenTelemetry bootstrap — must run BEFORE any other module imports
// the OTel API or kernels emit spans. The bootstrap is idempotent and
// no-ops when OTEL_ENABLED=false.
import { bootstrapOTel } from './observability/otel-bootstrap';
bootstrapOTel({});

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { handle } from '@hono/node-server/vercel';
import { Hono } from 'hono';
import { authRouter } from './routes/auth';
import { authMfaRouter } from './routes/auth-mfa';
// Public self-signup endpoints — owner / mining-tenant + mineral-buyer.
// Run OUTSIDE auth (they are the act of creating a tenant); DI surface
// wired via `composition/signup-wiring.ts` so tests inject stubs and
// production gets real Supabase + Drizzle + hash-chained audit.
import { createOrgsRouter } from './routes/orgs/index';
import { createBuyersRouter } from './routes/buyers/index';
import { createSignupWiring } from './composition/signup-wiring';
// Public sign-in / sign-out — Supabase password grant, encrypted HttpOnly
// `borjie-session` cookie, hash-chained audit, in-memory IP throttle.
// Mounted BEFORE the legacy /auth router so `/auth/sign-in` and
// `/auth/sign-out` resolve here without an Authorization header.
import { createPublicAuthRouter } from './routes/auth/public-auth.hono';
import { createPublicAuthDeps } from './composition/public-auth-wiring';
import { tenantsRouter } from './routes/tenants.hono';
import { usersRouter } from './routes/users.hono';
import { notificationsRouter } from './routes/notifications';
import { onboardingRouter } from './routes/onboarding';
import { onboardingFlowRouter } from './routes/onboarding.router';
import { feedbackRouter } from './routes/feedback';
import { complaintsRouter } from './routes/complaints';
// Piece C — MD Executive Brief routes (briefs + briefing subscriptions).
import {
  executiveBriefRouter,
  briefingSubscriptionRouter,
} from './routes/executive-brief.hono';
import { casesRouter } from './routes/cases.hono';
// Mining-domain backends (Wave MINING-BACKENDS) — six new scopes shipped
// as siblings to the existing /mining surface. Each carries chat-as-OS
// parity (both explicit tab + chat reach same backend) via persona tool
// handlers registered in composition/brain-tools/mining-domain-tools.ts.
import { geologyRouter } from './routes/geology/index';
import { productionRouter } from './routes/production/index';
import { cooperativesRouter } from './routes/cooperatives/index';
import { insuranceRouter } from './routes/insurance/index';
import { ownerThreadsRouter } from './routes/owner/messaging/threads.hono';
// Roadmap R2 — owner saved-search alerts. New CRUD surface under
// /owner/saved-searches; companion worker lives in
// services/api-gateway/src/workers/saved-search-worker.ts.
import { savedSearchesRouter } from './routes/owner/saved-searches.hono';
// Mr. Mwikila autonomous-MD — owner-facing inbox + delegation matrix.
// Inbox lives at /owner/mwikila-inbox (list/approve/deny/reverse);
// 12 × 4 delegation tier matrix at /owner/delegation. Companion
// recorder + handler runtime live in
// services/api-gateway/src/services/mwikila-autonomy/.
import { mwikilaInboxRouter } from './routes/owner/mwikila-inbox.hono';
import { delegationRouter } from './routes/owner/delegation.hono';
// Roadmap R7 — owner-mobile cockpit hub aggregator (brief + decisions +
// opportunities + risks + reminders) under /owner/cockpit/hub.
import { cockpitHubRouter } from './routes/owner/cockpit-hub.hono';
// Roadmap R6 — cockpit live SSE push. Multiplexes six event kinds
// (decision.recorded / reminder.fired / opportunity.scan_completed /
// risk.changed / workforce.shift_event / compliance.deadline_approaching)
// onto /api/v1/cockpit/stream, auto-scoped to the auth.tenantId.
import { cockpitStreamRouter } from './routes/cockpit-stream.hono';
// Roadmap R8 — universal personal-KB UI surfaces. Routes:
//   GET /me/persons/links
//   GET /me/persons/:personId/cells
//   GET /brain/personal-kb/search
import { personalKbRouter } from './routes/personal-kb.hono';
// Roadmap R9 — smart-compose ghost text endpoint
// (POST /brain/compose/suggest).
import { brainComposeRouter } from './routes/brain-compose.hono';
// Roadmap R12 — Discord-style tenant switcher backend
// (GET /me/tenants + POST /me/tenants/active).
import { meTenantsRouter } from './routes/me-tenants.hono';
import { workforceClockInRouter } from './routes/workforce/clock-in.hono';
// R5 closure — field-workforce hero card data wires
// (GET /me, /tasks/next, POST /tasks/:id/complete, /help-requests).
import { fieldWorkforceRouter } from './routes/field/workforce.hono';
import { brainRouter } from './routes/brain.hono';
// Borjie HOME teaching chat — /api/v1/brain/teach. Surpasses LitFin's
// /api/chat/exploration register with multi-block teaching, 5-step
// lesson ladder, tenant-grounded examples, and mandatory citation
// chain. Sibling mount under /brain so Hono composes it next to the
// existing /turn route without touching the kernel.
import { brainTeachRouter } from './routes/brain-teach.hono';
// REMOVED (borjie hard-fork): property-mgmt maintenance + hr routers — Borjie
// uses /api/v1/mining/maintenance (asset events) + workforce schemas instead.
// Borjie mining-domain sub-app — see services/api-gateway/src/routes/mining/index.ts
import { miningRouter } from './routes/mining/index';
// Wave 1-2 routers (new domain features)
import applicationsRouter from './routes/applications.router';
// REMOVED (borjie hard-fork): import arrearsRouter from './routes/arrears.router';
import complianceRouter from './routes/compliance.router';
import compliancePluginsRouter from './routes/compliance-plugins.router';
import docChatRouter from './routes/doc-chat.router';
import documentRenderRouter from './routes/document-render.router';
import financialProfileRouter from './routes/financial-profile.router';
// REMOVED (borjie hard-fork): import gamificationRouter from './routes/gamification.router';
// REMOVED (borjie hard-fork): import gepgRouter from './routes/gepg.router';
import interactiveReportsRouter from './routes/interactive-reports.router';
import lettersRouter from './routes/letters.router';
import { marketplaceRouter } from './routes/marketplace.router';
// Universal tenant marketplace — Section 4 of the questionnaire
// (cross-org browsing surface). Distinct from the legacy org-side
// `marketplaceRouter` above which manages listing publishing for
// portfolio owners.
import { universalMarketplaceRouter } from './routes/marketplace/index.js';
// Roadmap R11 — buyer-initiated Request for Bids. Buyers post
// "I want N tonnes of X at TZS Y by D"; sellers in the geo radius
// respond with counter-offers. Migration 0127.
import { rfbRouter } from './routes/marketplace/rfb.hono';
// Public marketing surface — pilot applications + future PR contact
// forms. No tenant context; runs outside the auth chain on purpose.
import { marketingRouter } from './routes/marketing.hono';
import { translateRouter } from './routes/translate.hono';
import { createPilotErrorsRouter } from './routes/pilot-errors.hono';
import { pilotFeedbackRouter } from './routes/pilot-feedback.hono';
// Sentry → GitHub Issue webhook. Composition root binds
// `services.sentryToGithubBridge`; when unbound the route returns 503
// with a clear "not wired" body.
import { sentryWebhookRouter } from './routes/sentry-webhook.hono';
// Piece L brain↔tab loop — module update proposals (CRUD + approval).
import proposalsRouter from './routes/proposals.hono';
// Scope segmentation taxonomy + nodes (Wave SCOPE-SEGMENTATION).
import { scopeRouter } from './routes/scope/index';
// Workforce invitations (owner-issued; worker self-activation).
import { workforceInvitesRouter } from './routes/workforce/invites.hono';
// Piece G — GenUI artifact render endpoints. Uses a not-wired service
// stub so /types is always live; /:id/render returns 404 until the
// real Playwright + DB-backed service is bound (issue #33).
import { createArtifactsRouter } from './routes/artifacts.hono';
import { createNotWiredArtifactRenderService } from './composition/artifact-render-wiring';
import { createMigrationRouter } from './routes/migration.router';
// REMOVED (borjie hard-fork): import { negotiationsRouter } from './routes/negotiations.router';
import { createNotificationPreferencesRouter } from './routes/notification-preferences.router';
import { createNotificationWebhookRouter } from './routes/notification-webhooks.router';
// REMOVED (borjie hard-fork): import occupancyTimelineRouter from './routes/occupancy-timeline.router';
// REMOVED (borjie hard-fork): import renewalsRouter from './routes/renewals.router';
// REMOVED (borjie hard-fork): import riskReportsRouter from './routes/risk-reports.router';
import scansRouter from './routes/scans.router';
// REMOVED (borjie hard-fork): import stationMasterCoverageRouter from './routes/station-master-coverage.router';
import { tendersRouter } from './routes/tenders.router';
// REMOVED (borjie hard-fork): import { waitlistRouter } from './routes/waitlist.router';
// Veteran-expert property-domain advisor packages
// (acquisitionAdvisor, expansionAdvisor, lifecycleAdvisor,
// sustainabilityAdvisor, greenAngleAdvisor, estateDepartmentAdvisor,
// estateAutoManagement, lpms) were deleted during the mining hard-fork
// — their route imports + .route() bindings were dropped here. The
// mining-domain analogues are wired further down (geology-agent,
// licence-agent, mine-planner, sales-offtake-agent, etc).
import geoPlatformRouter from './routes/geo-platform.router';
// Wave 8 gap-closure routers
import warehouseRouter from './routes/warehouse.router';
// Wave PRE-LAUNCH-MISC — top-level currency-rates surface for FX lookups.
import { currencyRatesRouter } from './routes/currency-rates.hono';
import maintenanceTaxonomyRouter from './routes/maintenance-taxonomy.router';
import iotRouter from './routes/iot.router';
// Wave 9 enterprise polish routers
import featureFlagsRouter from './routes/feature-flags.router';
import gdprRouter from './routes/gdpr.router';
import { createDsarRouter } from './routes/dsar.router';
import aiCostsRouter from './routes/ai-costs.router';
// Wave 12 — metrics / observability snapshot
import { metricsRouter } from './routes/metrics.router';
import { createMetricsMiddleware } from './observability/metrics-middleware';
// Central Command Phase A C4 — Sensorium / Brain Skin event ingestion.
// Receives batched 14-event sensory payloads from the client-side bus.
import sensoriumRouter from './routes/sensorium.router';
// Central Command Phase A C6 — Cross-portal SSE fan-out subscriber.
// Every authenticated user opens this to receive announcements /
// notifications / state-mutations / wake-trigger events from the
// brain. Tenant-scoped via JWT (NEVER via query/body).
import crossPortalSubscribeRouter from './routes/cross-portal-subscribe.router';
// Central Command Phase B B6 — Liveblocks 3.0 rooms auth (token mint).
import liveblocksAuthRouter from './routes/liveblocks-auth.router';
// Central Command Phase B B3 — Inngest durable-execution webhook. Receives
// HMAC-signed Inngest function callbacks for the agency-run dispatcher.
// 503 when `services.inngestRuntime` is unbound (Inngest dep not installed
// or signing key absent).
import inngestWebhookRouter from './routes/inngest-webhook.router';
// Central Command Phase B B5 — session-replay cold store. Append-only
// chunk ingest from rrweb + admin-gated viewer endpoints. PII masked
// at the client BEFORE upload; gzipped payloads.
import sessionReplayRouter from './routes/session-replay.router';
// Wave 12 — MCP server + agent platform
import mcpRouter, { agentCardRouter } from './routes/mcp.router';
// Wave 11 — public marketing (Mr. Mwikila), workflows
import publicMarketingRouter from './routes/public-marketing.router';
import publicSandboxRouter from './routes/public-sandbox.router';
import publicLeadsRouter from './routes/public-leads.router';
// Borjie marketing-widget public chat — unauthenticated SSE stream of
// curated Borjie-about-Borjie responses, consumed by FloatingAskBorjie
// in the marketing site. Mounted at /api/v1/public/chat (more specific
// path than the legacy /public mount so the Borjie handler wins).
import publicChatRouter from './routes/public-chat.hono';
// Public marketing status page — aggregates 90-day uptime from the
// service_status_history table (migration 0015). Unauthenticated;
// 30 s in-process cache. Mounted at /api/v1/public/status.
import publicStatusRouter from './routes/public-status.router';
// Wave 12 — streaming AI chat (SSE) for all 4 chat surfaces
import aiChatRouter from './routes/ai-chat.router';
// Universal role-aware advisor — `POST /api/v1/ask`, GET starting-points,
// POST feedback. Owned by this work-stream; routes under
// `services/api-gateway/src/routes/advisor/` belong to P2 and are NOT
// touched from here.
import { askRouter } from './routes/ask/index.js';
// Stage advisor surface — see wiring-gap audit chain 7 (the stage
// router shipped at ./routes/stage/index.ts but was never imported
// nor mounted before this change).
import { stageRouter } from './routes/stage/index.js';
// Persistent workflow engine — replaces the legacy in-memory-only
// `workflowsRouter` (which used `@borjie/ai-copilot`'s simpler
// engine, lost every run on restart, and never composed with the
// `ai-reviewer` + `assignment-registry` ScopeGuard). See wiring-gap
// audit chain 8.
import workflowRouter from './routes/workflow/index.js';
import agentCertificationsRouter from './routes/agent-certifications.router';
// REMOVED (borjie hard-fork): import classroomRouter from './routes/classroom.router';
import trainingRouter from './routes/training.router';
import voiceRouter from './routes/voice.router';
// Wave 13 — Autonomous Department Mode routers
import exceptionsRouter from './routes/exceptions.router';
import autonomousActionsAuditRouter from './routes/autonomous-actions-audit.router';
import autonomyRouter from './routes/autonomy.router';
// Wave 28 Phase A Agent PhA2 — monthly-close orchestrator.
// REMOVED (borjie hard-fork): import monthlyCloseRouter from './routes/monthly-close.router';
// Organizational Awareness — "talk to your organization" endpoints
import orgAwarenessRouter from './routes/org-awareness.router';
// Tenant Credit Rating — FICO-scale credit + portable certificate
// REMOVED (borjie hard-fork): import creditRatingRouter from './routes/credit-rating.router';
// Property Grading — Mr. Mwikila's A–F report card system (migration 0088)
// REMOVED (borjie hard-fork): import propertyGradingRouter from './routes/property-grading.router';
// Wave-K parity-litfin — LITFIN mission-eval dashboard parity surface.
import parityCapabilityDashboardRouter from './routes/parity-capability-dashboard.router';
// AI-Native suite — Agent PhG: 8 capabilities that leverage LLMs at scale.
import aiNativeRouter from './routes/ai-native.router';
// Wave 26 — Agent Z2: expose four repos that had tests but no HTTP surface.
// REMOVED (borjie hard-fork): import subleaseRouter from './routes/sublease.router';
// REMOVED (borjie hard-fork): import damageDeductionsRouter from './routes/damage-deductions.router';
// REMOVED (borjie hard-fork): import conditionalSurveysRouter from './routes/conditional-surveys.router';
import farRouter from './routes/far.router';
// Wave 26 Z3 — Move-out checklist + Approval workflow (migration 0097)
// REMOVED (borjie hard-fork): import moveOutRouter from './routes/move-out.router';
import approvalsRouter from './routes/approvals.router';
// Wave 27 PhA1 — Vacancy-to-Lease orchestrator (migration 0098)
// REMOVED (borjie hard-fork): import vacancyPipelineRouter from './routes/vacancy-pipeline.router';
import adminJarvisRouter from './routes/admin-jarvis.router';
// Central-Command AG-UI wire — POST /admin/jarvis/stream returns SSE-framed
// AG-UI Protocol events. Replaces the 503 stub at
// `apps/admin-web/.../intelligence/thread/[id]/message/route.ts`.
import adminJarvisStreamRouter from './routes/admin-jarvis-stream.router';
import {
  tenantJarvisRouter,
  ownerJarvisRouter,
  managerJarvisRouter,
  platformHqJarvisRouter,
} from './routes/jarvis-router-factory';
// Platform overview KPI aggregator — HQ-tier counts for /platform/overview.
import platformOverviewRouter from './routes/platform-overview.router';
// Phase B Wave 30 — Task-Agents registry + executor (narrow-scope agents)
import taskAgentsRouter from './routes/task-agents.router';
// Wave 27 Agent E — Tenant Branding (per-tenant AI persona identity overrides)
import tenantBrandingRouter from './routes/tenant-branding.router';
// Wave 27 Agent C — Audit Trail v2 (cryptographically-verifiable append-only log)
import auditTrailRouter from './routes/audit-trail.router';
// Wave-K Tier-3 — Sovereign action-ledger admin surface (tail + verify).
// Wraps @borjie/database's sovereign-action-ledger service; SUPER_ADMIN+ADMIN only.
import sovereignLedgerRouter from './routes/sovereign-ledger.router';
// Wave 27 Agent F — Risk-recompute dispatcher manual-trigger surface.
// REMOVED (borjie hard-fork): import { createRiskRecomputeRouter } from './routes/risk-recompute.router';
// Wave 28 — Head briefing cohesive morning screen (JSON / markdown / voice).
import headBriefingRouter from './routes/head-briefing.router';
// Wave 28 — Junior-AI factory (team-lead self-service provisioning).
import juniorAIRouter from './routes/junior-ai.router';
// Canonical Property Graph (CPG) — tenant-scoped Neo4j query + relationship explorer.
import graphRouter from './routes/graph.router';
// Wave 29 — Forecasting (TGN + conformal) surface. Returns 503
// FORECAST_SERVICE_UNAVAILABLE when the TGN inference + repo env
// vars are unset (no mock forecasts, ever).
import forecastRouter from './routes/forecast.router';
// Central Intelligence — streaming first-person agent (SSE). Returns
// 503 INTELLIGENCE_SERVICE_UNAVAILABLE when CI_LLM_URL / adapter is
// not wired (no mock agents, ever).
import intelligenceRouter from './routes/intelligence.router';
// Frontend gap-fix BFF routers — owner-portal hits these top-level paths
// for the analytics + portfolio dashboards. Until dedicated aggregator
// services are wired, both routers return "honest empty" shapes so the
// owner-portal renders an empty state instead of stalling on a never-
// resolving fetch. Follow-ups tracked in #33.
import analyticsRouter from './routes/analytics.router';
import portfolioRouter from './routes/portfolio.router';
// Estate-manager-app dependency — list/create unit subdivision children,
// and list FAR / asset-component breakdown for a unit. Mounted under
// /api/v1/units/:id/{subdivision,components}.
import unitSubdivisionRouter from './routes/unit-subdivision.router';
import unitComponentsRouter from './routes/unit-components.router';
import { rateLimitMiddleware } from './middleware/rate-limit.middleware';
import { createRateLimitMiddleware } from './middleware/rate-limit-redis.middleware';
import { getSharedPerTenantRateBudget } from './middleware/per-tenant-rate-budget';
import {
  startOutboxWorker,
  stopOutboxWorker,
  type OutboxRunnerLike,
} from './workers/outbox-worker';
import { createCaseSLASupervisor } from './workers/cases-sla-supervisor';
// Geo SOTA 2026-05-29 — geofencing service + watcher worker. Backed by
// PostGIS (migration 0130). Watcher ticks every 30s, emits
// worker_offsite_alert + worker_in_hazard_alert. See
// Docs/RESEARCH/GEO_SOTA_2026-05-29.md §2.
import { createGeofencingService } from './services/geofencing/index.js';
import {
  createGeofenceWatcher,
  type GeofenceAlertSink,
} from './workers/geofence-watcher.js';
import { createLeaseExpiryAlertCron } from './workers/lease-expiry-alert-cron';
import type {
  NotificationSender as LeaseExpiryNotificationSender,
} from './workers/lease-expiry-alert-cron';
import { createExecutiveBriefCron } from './workers/executive-brief-cron';
import { createExecutiveBriefActionRunner } from './workers/executive-brief-action-runner';
// Wave OWNER-OS DAILY-BRIEF rebuild. Mining-native replacement for the
// disabled BossNyumba `executive-brief-cron` — composes per-tenant
// briefs, persists snapshots, dispatches via email/sms/slack with
// UNIQUE-constraint idempotency.
import { createDailyBriefCron } from './workers/daily-brief-cron';
import { registerDailyBriefCron } from './workers/daily-brief-cron-registry';
// Live FX feed — pulls BoT TZS/USD + LBMA gold AM/PM fix every 5 min
// and appends to fx_rates + external_benchmarks. Treasury panels
// consume fx_rates; brain's compare_baselines tool reads from
// external_benchmarks. See workers/fx-feed-cron.ts for upstream URLs.
import { createFxFeedCron } from './workers/fx-feed-cron';
import {
  registerDomainEventSubscribers,
  type SubscribableBus,
  type NotificationDispatcher,
} from './workers/event-subscribers';
// Outbound webhook retry — consumes `WebhookDeliveryQueued` events
// from the bus, walks the 1s/3s/9s/27s/81s backoff ladder, persists
// attempt records, and pushes terminal failures into the DLQ.
import { createWebhookRetryWorker } from './workers/webhook-retry-worker';
import { ensureTenantIsolation } from './middleware/tenant-context.middleware';
import { assertApiKeyConfig } from './middleware/api-key-registry';
import { customerAppRouter } from './routes/bff/customer-app';
import { ownerPortalRouter } from './routes/bff/owner-portal';
import { estateManagerAppRouter } from './routes/bff/estate-manager-app';
import { adminPortalRouter } from './routes/bff/admin-portal';
// Wave-4 D6 — owner-portal MissingBackendNotice skeletons. Each router
// answers a precise endpoint declared by a placeholder page in
// commit 0ee27a0 with `200 OK + X-Backend-Status: degraded` so the FE
// stops 404'ing while the backing services are still in design.
import { analyticsExportsRouter } from './routes/owner/analytics-exports.router';
import { analyticsGrowthRouter } from './routes/owner/analytics-growth.router';
import { analyticsUsageRouter } from './routes/owner/analytics-usage.router';
import { billingRouter } from './routes/owner/billing.router';
import { ownerMessagingRouter } from './routes/owner/owner-messaging.router';
import { supportRouter } from './routes/owner/support.router';
import { adminUsersRouter } from './routes/owner/admin-users.router';
// Wave OWNER-OS — owner cockpit OS surface (docs intake + drop-zone,
// regulator-form drafter, reminders CRUD + dispatcher, dynamic tabs,
// per-tenant advisor slice on /owner/brief). See:
//   services/api-gateway/src/routes/owner/{docs,forms,reminders,tabs,brief}.hono.ts
//   services/api-gateway/src/workers/reminders-dispatch.worker.ts
//   packages/database/src/migrations/0089_owner_reminders_and_tabs.sql
import { ownerDocsRouter } from './routes/owner/docs.hono';
import { ownerFormsRouter } from './routes/owner/forms.hono';
import { ownerRemindersRouter } from './routes/owner/reminders.hono';
import { ownerTabsRouter } from './routes/owner/tabs.hono';
// Wave SUPERPOWERS - chat-callable UI actions: navigate, prefill,
// highlight, share, bulk, undo, bookmark. See:
//   services/api-gateway/src/routes/owner/{share-links,undo-journal,pinned-items,superpowers}.hono.ts
//   services/api-gateway/src/composition/brain-tools/superpowers-tools.ts
import {
  ownerShareLinksRouter,
  publicShareResolverRouter,
} from './routes/owner/share-links.hono';
import { ownerUndoJournalRouter } from './routes/owner/undo-journal.hono';
import { ownerPinnedItemsRouter } from './routes/owner/pinned-items.hono';
import { ownerSuperpowersRouter } from './routes/owner/superpowers.hono';
import { ownerBriefRouter } from './routes/owner/brief.hono';
import { ownerDailyBriefRouter } from './routes/owner/daily-brief.hono';
// Wave FOUR-EYE-APPROVAL — two-person sign-off on high-stakes owner
// actions (payment > 5M TZS, regulator filing, contract signature).
import { fourEyeApprovalsRouter } from './routes/owner/four-eye-approvals.hono';
import {
  workforceTabConfigOwnerListRouter,
  workforceTabPolicyAdminRouter,
} from './routes/workforce/tab-configs-extras.hono';
import {
  workforceTabConfigOwnerRouter,
  workforceTabConfigWorkerRouter,
} from './routes/workforce/tab-configs.hono';
// Wave ESTATE-OS — family-office holdings layer routers.
import {
  estateGroupsRouter,
  estateEntitiesRouter,
  estateCapitalMovementsRouter,
  estateAssetsRouter,
} from './routes/estate/index';
import { estateSuccessionPlansRouter } from './routes/estate/succession-plans.hono';
// Wave OPS-WIDE — end-to-end operations surface.
import { externalPartiesRouter as opsExternalPartiesRouter } from './routes/ops/external-parties.hono';
import { engagementsRouter as opsEngagementsRouter } from './routes/ops/engagements.hono';
import { chainOfCustodyRouter as opsChainOfCustodyRouter } from './routes/ops/chain-of-custody.hono';
import { regulatoryFilingsRouter as opsRegulatoryFilingsRouter } from './routes/ops/regulatory-filings.hono';
// Geo SOTA 2026-05-29 — Tanzania regulatory zone lookup (PCCB / NEMC /
// EITI). Tenant-agnostic; reads from regulatory_zones via the
// geofencing service. See Docs/RESEARCH/GEO_SOTA_2026-05-29.md §5.
import { regulatoryZonesRouter } from './routes/regulatory/zones.hono.js';
import { createRemindersDispatchWorker } from './workers/reminders-dispatch.worker';
// Wave CLOSED-LOOP - 6h reconciliation worker. Walks outcome_predictions
// whose horizon has elapsed, resolves the entity's current state, computes
// drift, writes outcome_observations + outcome_reconciliations, and
// extends the AI hash-chain on each reconciliation.
import { createOutcomeReconciliationWorker } from './workers/outcome-reconciliation-worker';
// Wave DECISION-LEGIBILITY — 24-hour worker that closes the loop on
// committed decisions: joins them to outcome_reconciliations, grades
// each one (good / bad / neutral / undetermined), and writes the
// retrospective row via the hash-chained decision recorder.
import { createDecisionRetrospectiveWorker } from './workers/decision-retrospective-worker';
import { createDecisionRecorder } from './services/decision-journal/recorder';
// Wave WORKFORCE-CERT-EXPIRY — 6-hour cron that scans
// workforce_certifications for any active cert expiring in <= 30d
// and auto-creates reminders at 30d / 14d / 3d (idempotent).
import { createIcaCertExpiryCron } from './workers/ica-cert-expiry-cron';
// Roadmap R6 — hourly compliance-deadline scanner. Emits a
// `compliance.deadline_approaching` cockpit event for every
// regulatory_filings row whose due_at lands inside the 7-day
// horizon and whose status is open / in_progress.
import { createComplianceDeadlineScan } from './workers/compliance-deadline-scan.worker';
// Wave ENTITY-LEGIBILITY — 30-min indexer that embeds + tags + cross-
// references every entity in the system so the brain can resolve any
// natural-language phrase to a concrete row and traverse the entity
// graph in one hop. Companion to migration 0115 + the brain tools in
// composition/brain-tools/entity-legibility-tools.ts.
import { createEntityIndexerWorker } from './workers/entity-indexer-worker';
// Wave OWNER-CONTACT-RESOLVER — per-owner email/phone/slack resolver
// replaces the BORJIE_OWNER_FALLBACK_EMAIL env-var crutch.
import {
  makeEmailForOwner,
  makePhoneForOwner,
  makeSlackHandleForOwner,
} from './services/owner-identity/resolver';
import { createEmailProviderFromEnv } from './services/notification-dispatch/email-provider';
import { resolveSmsProviderFromEnv } from './services/notification-dispatch/sms-provider';
import { buildServices, type ServiceRegistry } from './composition/service-registry';
import { getDb } from './composition/db-client';
import { createServiceContextMiddleware } from './composition/service-context.middleware';
import {
  wireCognitive,
  createCognitiveContextMiddleware,
  type WiredCognitive,
} from './composition/cognitive-wiring';
import {
  createHeartbeatSupervisor,
  createBackgroundSupervisor,
  createPostgresWebhookDeliveryRepository,
  createAmbientBehaviorObserver,
  createIntelligenceHistorySupervisor,
} from './composition/background-wiring';
import {
  setBrainExtraSkills,
  appendBrainExtraSkills,
} from './composition/brain-extensions';
// Wave UNWIRED-LOGIC-SWEEP-2 — persona-aware brain tool catalog wiring.
// Surfaces the 50+ persona-aware brain tools (owner, manager, worker,
// buyer, admin, scope, md-intelligence, workforce, mining-production,
// cooperative, insurance, owner-messaging, superpowers, decision-journal,
// entity-legibility, opportunity-scanner, risk-scanner) onto the brain
// `extraSkills` list so the brain orchestrator can dispatch any of them
// per persona ceiling. Previously the catalog shipped fully built but
// no production call site invoked `buildPersonaToolHandlers`, leaving
// every persona-aware tool dormant.
import {
  buildPersonaToolHandlers,
  configureDecisionJournalTools,
  configureOpportunityScannerTools,
  configureRiskScannerTools,
  type PersonaToolGate,
} from './composition/brain-tools';
// Loopback HTTP client — closes the gap where `PersonaToolGate.httpClient`
// was never bound, leaving every persona-tool handler stuck on its
// defensive `if (!client) return { fake }` fallback. See
// `Docs/AUDIT/REALITY_CHECK_2026-05-29.md` G-A.
import { createLoopbackHttpClient } from './composition/brain-tools/loopback-http-client';
// Persona-tool audit sink — closes G-D in REALITY_CHECK_2026-05-29.md.
// Without this, every WRITE persona-tool call skipped the audit-chain
// append. The Pino-backed sink emits `tool.persona_audit` events so
// every brain decision lands in the standard observability pipeline.
import { createPinoAuditSink } from './composition/brain-tools/audit-sink';

// Wave CLOSED-LOOP - every WRITE brain tool earns a predicted_outcome
// row in outcome_predictions BEFORE the handler runs. The reconciler
// (workers/outcome-reconciliation-worker.ts) closes the loop after the
// horizon elapses. Wrapper-applied at registration so no descriptor
// file changes.
import {
  wrapWritesWithOutcomePrediction,
  unmodeledPredictor,
  type WriteToolIdSet,
} from './composition/brain-tools/outcome-predictor';
import { listPersonaToolDescriptors } from './composition/brain-tools';
// Wave CLOSED-LOOP - calibration monitor (tracker + alerter + brain
// tool). Lets the owner / brain self-check prediction accuracy.
import {
  createCalibrationTracker,
  buildCalibrationScoreTool,
} from './services/calibration-monitor';
import { createDrizzleDraftPersistence } from './services/document-drafter';
import { buildDocumentDrafterTools } from './services/document-drafter/brain-tools';
import { createDrizzleRevisionsPersistence } from './services/document-drafter/revisions-persistence';
import { buildFreeFormDrafterTool } from './services/document-drafter/free-form-brain-tool';
import { buildMediaGenerationTools } from './services/media-generation/brain-tools';
import { ownerDraftsRouter } from './routes/owner/drafts.hono';
// Wave-3-int2 — brain↔tab loop composition (Piece L → Piece B handlers).
import {
  createDispatchRouterWiring,
  createStubEstateHandlerDeps,
  createStubMiningHandlerDeps,
} from './composition/dispatch-router-wiring';
import { installJarvisCaptureHook } from './routes/jarvis-router-factory';
import { buildQueryOrganizationTool } from '@borjie/ai-copilot';
import { createAmbientBrainMiddleware } from './middleware/ambient-brain.middleware';
import { createWebhookDlqRouter } from './routes/webhook-dlq.router';
import { createOpenApiRouter } from './openapi';
import {
  createDeepHealthHandler,
  postgresProbe,
  redisProbe,
  anthropicProbe,
  openaiProbe,
  elevenLabsProbe,
  gepgProbe,
} from './health/deep-health';
import { validateEnv } from './config/validate-env';
import { securityEventsMiddleware } from '@borjie/observability';
// SOTA perf middleware — Brotli compression + Cache-Control presets.
// See `packages/performance-toolkit/src/cache/` for the implementation.
import { expressCacheControl } from '@borjie/performance-toolkit/cache';

// Scale-hardening: cover the auth headers + secret families the top-level
// gateway pino instance touches (pino-http records req/res shapes that
// include Authorization, Cookie, and any field a handler dumps into a
// log line). The `@borjie/observability` Logger uses an equivalent
// default set — this list is the gateway-specific mirror because pino
// is constructed inline here, not via createLogger.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-internal-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  '*.refreshToken',
  '*.jwt',
  '*.bearer',
  '*.secret',
  '*.mfaSecret',
  '*.apiKey',
  '*.api_key',
  '*.webhookSecret',
  '*.authorization',
  '*.cookie',
  '*.creditCard',
  '*.ssn',
  '*.bankAccount',
  '*.iban',
  '*.nationalId',
];

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
});

// Dynamic model registry — bind the SSRF-guarded fetch port and Pino
// logger, then kick off a fire-and-forget L1 cache warm. `getModelLatest`
// is safe to call immediately via L3 baselines; warm just hot-loads L1
// so the first brain-call doesn't see the baseline fallback path.
import { wireDynamicModelRegistry } from './composition/dynamic-model-registry-wiring';
wireDynamicModelRegistry({ logger });

// Wave AGENTIC-PLATFORM — OAuth2 device-flow + capability manifest
// (migration 0118 + Docs/RESEARCH/AGENTIC_SOTA_COMPARISON.md). Powers
// the public MCP / CLI / SDK consumers — Claude Code, Cursor,
// Windsurf, `borjie` CLI, `@borjie/api-sdk`. Mounted at the very end
// of the route table so existing routes keep their lookup order.
import { oauthDeviceRouter } from './routes/oauth-device.hono';
import { wellKnownRouter } from './routes/well-known.hono';

// Fail-fast env validation — throws with a precise error message if required
// vars (DATABASE_URL, JWT_SECRET) are missing or malformed. Warnings are
// logged but do not block boot. Skipped in test environments where vitest
// provides its own fixtures.
if (process.env.NODE_ENV !== 'test') {
  try {
    const { warnings } = validateEnv(process.env);
    for (const w of warnings) logger.warn({ env: true }, w);
  } catch (err) {
    logger.fatal(
      { err: err instanceof Error ? err.message : String(err) },
      'Environment validation failed — aborting boot'
    );
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}

const app = express();
const port = process.env.PORT || 4000;

// Hoisted flag — flipped by gracefulShutdown so /health + /healthz start
// returning 503 the moment a SIGTERM lands. Load balancers see the
// unhealthy status and drain traffic before in-flight requests finish.
let isShuttingDown = false;

// Middleware
app.use(helmet());
// Default Cache-Control = private+revalidate so no API response is ever
// CDN-cached by accident. Route-level overrides win (set per-handler).
app.use(expressCacheControl('private-revalidate'));

// CORS — restrict to allowed origins. Wildcard CORS combined with cookie
// auth would enable CSRF; header-based auth alone is defensible, but we
// whitelist anyway so the attack surface is minimal. Origins come from the
// env var; absence is fatal in production.
const allowedOrigins = (() => {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    if (!raw) {
      throw new Error(
        'api-gateway: ALLOWED_ORIGINS env var is required in production ' +
          '(comma-separated list of https://... origins).'
      );
    }
    return raw.split(',').map((o) => o.trim()).filter(Boolean);
  }
  // Dev: ALWAYS include the canonical localhost / 127.0.0.1 dev surface
  // matrix, then union with any explicit ALLOWED_ORIGINS the operator
  // sets (e.g. a tunneled origin for mobile-on-device tests). Chrome
  // treats `localhost` and `127.0.0.1` as distinct origins; the user
  // can hit either. Ports: 3000/3010/3020/3030/3040 web surfaces,
  // 3001-3003 legacy spare, 5173 Vite.
  const devHosts = ['localhost', '127.0.0.1'];
  const devPorts = ['3000', '3001', '3002', '3003', '3010', '3020', '3030', '3040', '5173', '8081', '8082'];
  const baseDev = devHosts.flatMap((host) =>
    devPorts.map((port) => `http://${host}:${port}`),
  );
  const fromEnv = raw
    ? raw.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
  return Array.from(new Set([...baseDev, ...fromEnv]));
})();

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server calls (no Origin) and explicitly whitelisted
      // browser origins. Deny everything else.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Tenant-ID',
      'Idempotency-Key',
    ],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Remaining'],
    maxAge: 86_400,
  })
);
// Skip express.json() for /api/v1 AND /mcp paths — those are handled
// by Hono sub-apps which consume the raw request body themselves.
// Running express.json() first would drain the body stream and Hono
// would see an empty request. No Express handler outside those paths
// reads req.body today, but we keep the parser for potential future use.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/v1') || req.path.startsWith('/mcp')) {
    return next();
  }
  return express.json({ limit: '2mb' })(req, res, next);
});
app.use(pinoHttp({ logger }));
// Rate limit — when REDIS_URL is set we use the Redis-backed limiter so
// the cap is enforced cluster-wide (HPA scales the gateway 3-20 replicas;
// the in-memory limiter would otherwise allow `max * replicas` requests).
// If REDIS_URL is unset (local dev / tests) we fall back to the original
// in-memory middleware so those paths continue to work. The Redis-backed
// middleware also degrades to in-memory on its own if the pipeline throws,
// so a Redis outage never hard-fails a request.
app.use(
  (() => {
    if (!process.env.REDIS_URL) {
      logger.info('rate-limit: REDIS_URL unset — using in-memory limiter (dev mode)');
      return rateLimitMiddleware();
    }
    try {
      // Lazy-require ioredis — the ESM / CJS export shape varies across
      // bundlers; mirror the pattern already used by the deep-health probe
      // so both code paths pick up the same constructor.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ioredisMod = require('ioredis');
      const RedisCtor =
        ioredisMod?.default ?? ioredisMod?.Redis ?? ioredisMod;
      const client = new RedisCtor(process.env.REDIS_URL, {
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        lazyConnect: false,
      });
      client.on?.('error', (err: Error) => {
        logger.warn(
          { err: err.message },
          'rate-limit: redis client error (middleware will fall back to in-memory)',
        );
      });
      logger.info('rate-limit: using Redis-backed distributed limiter');
      return createRateLimitMiddleware({
        redis: client,
        logger: {
          warn: (meta, msg) => logger.warn(meta as object, msg),
        },
        // G5 — robustness 2026-05-29. Every Redis fallback gets
        // captured to Sentry so on-call sees the degraded mode
        // light up. The hook resolves the sentry client lazily so
        // boot order doesn't trip the wire.
        sentryCapture: (err, ctx) => {
          try {
            // Lazy require — sentry init happens later in this boot
            // sequence so a top-of-file import would resolve before
            // the DSN is wired.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const obs = require('@borjie/observability') as {
              getSentry?: () => {
                captureException: (err: unknown, ctx?: unknown) => void;
              };
            };
            obs.getSentry?.().captureException(err, ctx);
          } catch {
            // Sentry hook bugs must never break the request pipeline.
          }
        },
      });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'rate-limit: failed to initialize Redis limiter — using in-memory',
      );
      return rateLimitMiddleware();
    }
  })()
);

// Health check — both /health (legacy) and /healthz (k8s-style) are served.
// Returns `{ status, version, service, timestamp, upstreams }` per the
// shared contract in @borjie/observability. Deep probes live at
// /api/v1/health/deep (admin-only, cached 15s).
const healthHandler = async (
  _req: express.Request,
  res: express.Response,
): Promise<void> => {
  if (isShuttingDown) {
    res.status(503).json({
      status: 'shutting_down',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
    });
    return;
  }
  const payload = {
    status: 'ok' as const,
    version: process.env.APP_VERSION ?? 'dev',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    upstreams: {
      deep: {
        status: 'ok' as const,
        note: 'see GET /api/v1/health/deep for upstream cascade',
      },
    },
  };
  res.json(payload);
};
app.get('/health', healthHandler);
app.get('/healthz', healthHandler);

// API v1 - Hono routes
// FIXED C-1 production startup guard: refuses to boot if API keys aren't configured.
assertApiKeyConfig();

// ----------------------------------------------------------------------------
// Composition root — build service registry once at startup.
//
// The registry is a single typed bag of domain services (marketplace,
// waitlist, negotiation, gamification, migration, etc.). It is lazily
// instantiated: when DATABASE_URL is unset it returns a degraded
// skeleton of all-nulls and routers fall back to 503. When the URL is
// set, real Postgres-backed services are constructed and pure-DB
// endpoints start returning real rows.
// ----------------------------------------------------------------------------
let serviceRegistry: ServiceRegistry;
try {
  serviceRegistry = buildServices({ db: getDb() });
  if (serviceRegistry.isLive) {
    logger.info('service-registry: live (Postgres-backed domain services wired)');
  } else {
    logger.warn(
      'service-registry: degraded (DATABASE_URL unset — pure-DB endpoints will 503)'
    );
  }
} catch (err) {
  logger.error(
    { err: err instanceof Error ? err.message : String(err) },
    'service-registry: initialization failed, falling back to degraded mode'
  );
  serviceRegistry = buildServices({ db: null });
}

// ----------------------------------------------------------------------------
// R8 wiring follow-up — construct the cognitive-memory + persistent-memory
// bundles so brain-turn handlers can prepend recalled context to the system
// prompt. The 12-wire cognitive-composition.compose() pipeline is deferred
// until the cognitive-engine / brain-llm-router / calibration ports land
// (see composition/cognitive-wiring.ts file header). Construction is
// fail-soft: a broken bundle degrades to null and enrichment short-circuits.
// ----------------------------------------------------------------------------
const wiredCognitive: WiredCognitive = wireCognitive({
  db: getDb(),
  logger: {
    debug: (message, meta) => logger.debug(meta ?? {}, message),
    info: (message, meta) => logger.info(meta ?? {}, message),
    warn: (message, meta) => logger.warn(meta ?? {}, message),
    error: (message, meta) => logger.error(meta ?? {}, message),
  },
});

// Wave 12 — heartbeat engine + Wave 27 Agent F risk-recompute dispatcher.
// Constructed here (ahead of the api routes) because the risk-recompute
// router needs accessors to the dispatcher + in-memory job tracker the
// supervisor owns. The supervisor is inert until `.start()` is called
// further down the boot sequence, so constructing it early is safe.
const heartbeatSupervisor = createHeartbeatSupervisor(
  serviceRegistry,
  logger,
  30_000,
);

// ----------------------------------------------------------------------------
// Wave-3-int2 — Brain↔Tab loop composition.
//
// Wires the dispatch-router (Piece L) + ESTATE 5-handler set (Piece B) +
// tenant-override routing-rules loader. Returns a `postThinkCaptureHook`
// we install on every Jarvis router so `/think` + `/stream` fire the
// hook fire-and-forget after each turn.
//
// Stubbed ports today (createStubEstateHandlerDeps) — Wave-3-int3 will
// swap in the Drizzle-backed CoreEntityRepository, LedgerService, and
// Piece M work-assignments port.
// ----------------------------------------------------------------------------
const dispatchRouterWiring = createDispatchRouterWiring({
  estate: createStubEstateHandlerDeps(),
  // Closes the historical gh-issue #34 work-item: 3 mining handlers
  // replace the pre-Borjie estate stubs (open_maintenance_case →
  // open_equipment_maintenance, schedule_renewal_negotiation →
  // schedule_licence_renewal, bulk_mark_for_renewal_prep →
  // bulk_mark_licences_for_renewal).
  mining: createStubMiningHandlerDeps(),
  logger: {
    info: (meta, msg) => logger.info(meta, msg),
    warn: (meta, msg) => logger.warn(meta, msg),
    error: (meta, msg) => logger.error(meta, msg),
  },
});
installJarvisCaptureHook(async (input) => {
  await dispatchRouterWiring.postThinkCaptureHook(input);
});
logger.info(
  {
    handlerRegistry: (dispatchRouterWiring.handlerRegistry as {
      listRegistered?: () => unknown;
    }).listRegistered?.(),
  },
  'dispatch-router-wiring: live (brain↔tab loop wired)'
);

// Wave 26 Agent Z4 — boot-time observability for the three AI-brain
// utilities. Each line tells operators at a glance whether the feature
// is active without hunting through a tenant-request log.
logger.info(
  {
    llmRouter: serviceRegistry.llmRouter ? 'live' : 'null',
    budgetGuardedAnthropic: serviceRegistry.buildBudgetGuardedAnthropicClient
      ? 'live'
      : 'null',
    aiCostLedger: serviceRegistry.aiCostLedger ? 'live' : 'null',
    providers: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
    },
  },
  'ai-brain-utilities wired',
);

// Persistent-stores boot summary — surfaces which path each of the 5
// stores took at boot (persistent vs memory) so operators see the live
// posture in a single log line. Persistent paths require BOTH
// DATABASE_URL to be set AND the per-port `PERSISTENT_*_DISABLED` env
// flag to be off.
logger.info(
  {
    modeByStore: serviceRegistry.persistentStores.modeByStore,
    databaseUrl: Boolean(process.env.DATABASE_URL),
  },
  'persistent-stores wired',
);

// Wire the org-awareness query-organization skill into the Brain registry.
// The brain factory (ai-chat.router / brain.hono) reads these extra skills
// when it constructs per-tenant Brains, so Mr. Mwikila can answer
// "show me my bottlenecks" / "how has arrears resolution improved" via
// the same chat surface as every other skill.
try {
  const queryService = serviceRegistry.orgAwareness.queryService;
  const orgSkill = buildQueryOrganizationTool({
    async answer(req) {
      return queryService.answer(req);
    },
  });

  // Document drafter (B-DocDrafter) — register draft_contract,
  // draft_rfp, draft_rfp_response, draft_letter, revise_draft. The
  // persistence port uses the shared db client; RLS enforces tenant
  // isolation at the row level on every call.
  const draftPersistence = createDrizzleDraftPersistence(getDb());
  const draftTools = buildDocumentDrafterTools({ persistence: draftPersistence });
  const revisionsPersistence = createDrizzleRevisionsPersistence(getDb());
  const freeFormTool = buildFreeFormDrafterTool({
    persistence: draftPersistence,
    revisionsPersistence,
  });
  const mediaTools = buildMediaGenerationTools();

  // Build the WRITE-tool set from the persona descriptor catalog plus
  // every tool registered here that mutates state (draft_*, free-form
  // draft, media generation). We use it to know which extras to wrap
  // with `withOutcomePrediction`. Read-only tools pass through.
  const personaWriteIds = new Set<string>(
    listPersonaToolDescriptors()
      .filter((d) => d.isWrite === true)
      .map((d) => d.id),
  );
  // The drafter / freeform / media tools all mutate state - none of
  // them are read-only. We add them to the WRITE set by tool name so
  // the wrapper covers them too.
  for (const t of draftTools) personaWriteIds.add(t.name);
  personaWriteIds.add(freeFormTool.name);
  for (const t of mediaTools) personaWriteIds.add(t.name);
  const writeIds: WriteToolIdSet = personaWriteIds;

  // Wave CLOSED-LOOP - bind the calibration tracker and surface its
  // read-only brain tool so the owner can ask "did your last 5
  // recommendations work?" and the brain can self-check before
  // quoting confidence.
  const calibrationTracker = createCalibrationTracker({
    db: getDb() as unknown as { execute(q: unknown): Promise<unknown> },
  });
  const calibrationScoreTool = buildCalibrationScoreTool({
    tracker: calibrationTracker,
  });

  const rawSkills = [
    orgSkill,
    ...draftTools,
    freeFormTool,
    ...mediaTools,
    calibrationScoreTool,
  ];
  const wrappedSkills = wrapWritesWithOutcomePrediction(rawSkills, writeIds, {
    db: (serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> }) ?? null,
    logger,
    predictor: unmodeledPredictor,
    disabled:
      process.env.NODE_ENV === 'test' ||
      process.env.BORJIE_OUTCOME_PREDICTOR_DISABLED === 'true',
  });
  setBrainExtraSkills(wrappedSkills);
  logger.info(
    {
      drafterToolCount: draftTools.length,
      freeFormToolEnabled: true,
      mediaToolCount: mediaTools.length,
      writeToolsWrapped: Array.from(writeIds).filter((id) =>
        rawSkills.some((s) => s.name === id),
      ).length,
    },
    'brain-extensions: org.query_organization + document-drafter + free-form + media-generation skills wired (WRITE tools wrapped with outcome-predictor)',
  );

  // Wave UNWIRED-LOGIC-SWEEP-2 — wire the 50+ persona-aware brain tools.
  // The brain-tools/* descriptor catalog has shipped fully built for
  // months but no production call site invoked `buildPersonaToolHandlers`,
  // leaving every persona-aware tool dormant. Wire it here so the brain
  // orchestrator can dispatch any of them subject to persona ceiling +
  // kill-switch + audit.
  try {
    const dbForBrainTools = (serviceRegistry.db as unknown as {
      execute(q: unknown): Promise<unknown>;
    }) ?? null;
    if (dbForBrainTools) {
      // Tools that need a tenant-bound DB client to read state (the
      // scanners + decision-journal) opt in via their own `configureX`.
      // Tools that defer to internal HTTP routes do not need this.
      configureOpportunityScannerTools({ db: dbForBrainTools });
      configureRiskScannerTools({ db: dbForBrainTools });
      configureDecisionJournalTools({ db: dbForBrainTools });
    }
    // The `ServiceRegistry` interface does not currently model an
    // optional kill-switch slot. Some legacy boot paths attached an
    // `isOpen()` port directly to the registry — keep a defensive
    // read-through so this site fails-open (kill-switch closed = false)
    // when the slot is absent. Cast through `unknown` to side-step the
    // missing-field typecheck without weakening the registry contract.
    const killSwitchOpen =
      (
        (serviceRegistry as unknown as {
          killSwitch?: { isOpen?: () => boolean };
        }).killSwitch?.isOpen?.()
      ) === true;
    // Bind a loopback HTTP client onto the gate so persona-tool
    // handlers that do `ctx.httpClient.get/post(...)` reach the
    // gateway's own routes through the same auth + RLS + observability
    // path a browser request would take. Without this binding every
    // handler falls into its `if (!client) return { fake }` defensive
    // fallback (see Docs/AUDIT/REALITY_CHECK_2026-05-29.md G-A).
    //
    // The client requires `JWT_SECRET` so it can mint a service-bound
    // HS256 token per call. If the secret is absent we leave
    // `httpClient` undefined and the handlers continue to use their
    // fallback — preferable to crashing the boot path.
    const jwtSecret = process.env.JWT_SECRET ?? '';
    const gatewayPort = Number(process.env.PORT ?? '4001') || 4001;
    const personaLoopbackClient =
      jwtSecret.length >= 32
        ? createLoopbackHttpClient({
            origin: `http://127.0.0.1:${gatewayPort}`,
            apiPrefix: '/api/v1',
            jwtSecret,
            logger: {
              warn: (ctx, msg): void =>
                logger.warn(ctx as object, msg),
            },
          })
        : undefined;
    if (!personaLoopbackClient) {
      logger.warn(
        { jwtSecretLen: jwtSecret.length },
        'persona-tool loopback HTTP client unbound — JWT_SECRET missing or <32 chars; handlers will continue to use defensive fallbacks',
      );
    }
    // Pino-backed audit sink — emits one structured info per WRITE-tool
    // call so every brain decision is searchable + alertable in the
    // standard observability pipeline. Closes G-D in REALITY_CHECK.
    const personaAuditSink = createPinoAuditSink(logger);
    const personaGate: PersonaToolGate = {
      killSwitchOpen,
      // The persona slug is resolved from `ToolExecutionContext.actor`
      // by the orchestrator at dispatch time. Fallback to T1 owner
      // strategist when the actor metadata is missing so the brain's
      // default surface stays usable in degraded mode.
      resolvePersonaSlug(ctx): string | undefined {
        const role = (ctx as { actor?: { role?: string } }).actor?.role;
        if (role === 'OWNER') return 'T1_owner_strategist';
        if (role === 'TENANT_ADMIN' || role === 'PLATFORM_ADMIN')
          return 'T2_admin_strategist';
        if (role === 'MANAGER') return 'T3_module_manager';
        if (role === 'WORKER' || role === 'EMPLOYEE')
          return 'T4_field_employee';
        if (role === 'CUSTOMER' || role === 'BUYER')
          return 'T5_customer_concierge';
        return 'T1_owner_strategist';
      },
      auditSink: personaAuditSink,
      ...(personaLoopbackClient && { httpClient: personaLoopbackClient }),
    };
    const personaHandlers = buildPersonaToolHandlers(personaGate, {
      onDuplicate: (toolId) =>
        logger.warn({ toolId }, 'brain-tools: duplicate descriptor ignored'),
    });
    appendBrainExtraSkills(personaHandlers);
    logger.info(
      {
        personaToolCount: personaHandlers.length,
        killSwitchOpen,
      },
      'brain-extensions: persona-aware tool catalog wired (owner / manager / worker / buyer / admin / scope / md-intel / workforce / mining-production / cooperative / insurance / messaging / superpowers / decision-journal / entity-legibility / opportunity-scanner / risk-scanner)',
    );
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'brain-extensions: persona-aware tool catalog wiring failed (non-fatal)',
    );
  }
} catch (err) {
  logger.warn(
    { err: err instanceof Error ? err.message : String(err) },
    'brain-extensions: failed to wire org / drafter skills (non-fatal)'
  );
}

// Deep health cascade — admin-only; probes every upstream with 15s cache.
// Mounted on the Express app so probes can use the serviceRegistry that
// was just built above without crossing into Hono's sub-app.
const deepHealthHandler = createDeepHealthHandler({
  version: process.env.APP_VERSION ?? 'dev',
  cacheMs: Number(process.env.DEEP_HEALTH_CACHE_MS ?? '15000') || 15_000,
  requireAdmin: (req) => {
    const roleHeader = req.header('x-user-role');
    if (roleHeader === 'TENANT_ADMIN' || roleHeader === 'PLATFORM_ADMIN') return true;
    return process.env.NODE_ENV !== 'production';
  },
  probes: [
    postgresProbe(async () => {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
      // Use postgres-js directly for the probe — drizzle's `.execute()`
      // surface shape drifted across 0.36/0.37 and the wrapper wasn't
      // worth the complexity. This hits the DB wire with a trivial
      // `SELECT 1` and closes the connection.
      const { default: postgres } = await import('postgres');
      const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 2 });
      try {
        const rows = await sql`SELECT 1 as ok`;
        if (rows[0]?.ok !== 1) throw new Error('unexpected row');
      } finally {
        await sql.end({ timeout: 1 });
      }
    }),
    redisProbe(async () => {
      if (!process.env.REDIS_URL) throw new Error('REDIS_URL not set');
      // ioredis is a gateway dep. Named export shape under ESM varies;
      // guard for both default + named, pick whichever is constructable.
      const ioredis = await import('ioredis');
      const RedisCtor =
        (ioredis as unknown as { default?: new (...a: never[]) => unknown })
          .default ??
        (ioredis as unknown as { Redis?: new (...a: never[]) => unknown })
          .Redis ??
        (ioredis as unknown as new (...a: never[]) => unknown);
      const client = new (RedisCtor as new (url: string, opts: unknown) => {
        connect: () => Promise<void>;
        ping: () => Promise<string>;
        disconnect: () => void;
      })(process.env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout: 1_000,
        lazyConnect: true,
      });
      try {
        await client.connect();
        const pong = await client.ping();
        if (pong !== 'PONG') throw new Error(`unexpected ping: ${pong}`);
      } finally {
        client.disconnect();
      }
    }),
    anthropicProbe(process.env.ANTHROPIC_API_KEY),
    openaiProbe(process.env.OPENAI_API_KEY),
    elevenLabsProbe(process.env.ELEVENLABS_API_KEY),
    gepgProbe(process.env.GEPG_HEALTH_URL),
    // G5 — robustness 2026-05-29. Pure introspection probe — reads
    // the in-process rate-limit Redis status flag (toggled by the
    // middleware on every fallback) and surfaces it as `degraded`
    // when the gateway is currently in fallback mode. No live Redis
    // call; this is the gateway's own view of whether its rate-
    // limiter is talking to Redis successfully.
    {
      name: 'rate-limit-redis',
      optional: true,
      timeoutMs: 100,
      run: async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('./middleware/rate-limit-redis.middleware') as {
          getRateLimitRedisStatus: () => {
            status: 'up' | 'down' | 'unknown';
            fallbackCount: number;
            lastError: string | null;
          };
        };
        const s = mod.getRateLimitRedisStatus();
        if (s.status === 'down') {
          throw new Error(
            `rate-limit redis fallback in effect — fallbackCount=${s.fallbackCount} lastError=${s.lastError ?? 'n/a'}`,
          );
        }
      },
    },
    // G6 — robustness 2026-05-29. Pure introspection probe — reads
    // the in-process worker heartbeat registry and surfaces `degraded`
    // when any worker hasn't ticked in 2× its interval. A stuck cron
    // is no longer invisible until an operator greps logs.
    {
      name: 'workers',
      optional: false,
      timeoutMs: 100,
      run: async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('./workers/worker-heartbeat') as {
          snapshotWorkers: () => ReadonlyArray<{
            name: string;
            stuck: boolean;
            msSinceLastTick: number | null;
            intervalMs: number;
            lastError: string | null;
          }>;
        };
        const snapshot = mod.snapshotWorkers();
        const stuck = snapshot.filter((w) => w.stuck);
        if (stuck.length > 0) {
          const names = stuck
            .map(
              (w) =>
                `${w.name} (msSinceLastTick=${w.msSinceLastTick ?? 'never'}, intervalMs=${w.intervalMs})`,
            )
            .join(', ');
          throw new Error(`stuck workers: ${names}`);
        }
      },
    },
  ],
});
app.get('/api/v1/health/deep', (req, res) => {
  void deepHealthHandler(req, res);
});

const api = new Hono();
// Endpoint smoke matrix follow-up — register the structured error
// envelope on the api Hono app so any uncaught throw surfaces as
// `{ error: { code: 'INTERNAL_ERROR' | 'TABLE_NOT_PROVISIONED' | ..., message } }`.
// Without this Hono returns its default text/plain `Internal Server
// Error` body and the smoke runner cannot tell genuine bugs from
// missing-table 5xx noise.
import { createHonoErrorHandler as __createHonoErrorHandlerForApi } from './middleware/error-envelope';
api.onError(__createHonoErrorHandlerForApi(logger));
// Wave 12 — Metrics middleware runs first so it captures the full
// latency of every downstream handler + middleware.
api.use('*', createMetricsMiddleware());
// FIXED H-2: apply tenant-isolation enforcement globally on all /api/v1/* routes.
// Auth middleware still runs first per-router; this is a defense-in-depth layer.
api.use('*', ensureTenantIsolation);
// Inject the service registry + flat tenantId/userId into the request ctx
// so 22 new routers can pull real service instances out of the context.
api.use('*', createServiceContextMiddleware(serviceRegistry));
// R8 wiring follow-up — expose the cognitive bundle on every request via
// `c.get('cognitive')`. Routes (e.g. brain.hono.ts /turn) can read it to
// enrich the system prompt with recalled memories. When the bundle is
// fully degraded (cognitiveMemory=null + persistent=null) the enrichment
// function returns an empty result, so dependent routes still serve.
api.use(
  '*',
  createCognitiveContextMiddleware(wiredCognitive) as Parameters<
    typeof api.use
  >[1],
);
// Wave 12 — Ambient brain observer. Records a behaviour event on every
// authed request so stalls/errors can bubble up into proactive
// interventions. Shared observer instance passed to the middleware so
// subscribers persist across requests.
const behaviorObserver = createAmbientBehaviorObserver();
api.use('*', createAmbientBrainMiddleware(behaviorObserver, logger));
// Flaky-CI-closure — apply `securityEventsMiddleware` globally so every
// mutating request (POST/PUT/DELETE/PATCH) auto-emits a structured
// SecurityEvent row (SOC 2 CC7.2, GDPR Art. 30). Idempotent verbs are
// passed through with zero overhead. The Security Route Coverage gate
// at `.github/workflows/security-route-coverage.yml` detects this mount
// and counts every router under `/api/v1/*` as wrapped.
api.use('*', securityEventsMiddleware);
// Public self-signup — /orgs/signup (owner / mining tenant) and
// /buyers/signup (mineral buyer). Mount BEFORE /auth so the routes
// remain public; both routers attach no auth middleware internally
// and degrade to 503 reasons when DATABASE_URL or
// SUPABASE_SERVICE_ROLE_KEY are unset.
const signupWiring = createSignupWiring({
  db: getDb(),
  logger,
});
api.route('/orgs', createOrgsRouter(signupWiring.orgs));
api.route('/buyers', createBuyersRouter(signupWiring.buyers));
// Public sign-in / sign-out mount — Hono matches first-wins, so this
// router's `/sign-in` + `/sign-out` claim those subpaths before the
// legacy authRouter (which would otherwise hit the JWT-verify
// middleware via `/me`/`/refresh`/`/logout`).
const publicAuthDeps = createPublicAuthDeps({ db: getDb(), logger });
api.route('/auth', createPublicAuthRouter(publicAuthDeps));
api.route('/auth', authRouter);
api.route('/auth/mfa', authMfaRouter);
api.route('/tenants', tenantsRouter);
api.route('/users', usersRouter);
api.route('/notifications', notificationsRouter);
// Phase F.5 tenant-signup flow mounts FIRST so specific paths
// (/signup, /first-property, /first-tenant-import, /first-md-chat,
// /checklist) match before the legacy customer move-in router.
api.route('/onboarding', onboardingFlowRouter);
api.route('/onboarding', onboardingRouter);
api.route('/feedback', feedbackRouter);
api.route('/complaints', complaintsRouter);
// Piece C — Executive briefs (T1-T3 only) + subscription cadence registry.
api.route('/briefs', executiveBriefRouter);
api.route('/briefing-subscriptions', briefingSubscriptionRouter);
api.route('/cases', casesRouter);
// Mining-domain backends — Wave MINING-BACKENDS.
api.route('/geology', geologyRouter);
api.route('/production', productionRouter);
api.route('/cooperatives', cooperativesRouter);
api.route('/insurance', insuranceRouter);
api.route('/owner/threads', ownerThreadsRouter);
// Roadmap R2 — owner saved-search alerts.
api.route('/owner/saved-searches', savedSearchesRouter);
// Mr. Mwikila autonomous-MD inbox + delegation surface.
api.route('/owner/mwikila-inbox', mwikilaInboxRouter);
api.route('/owner/delegation', delegationRouter);
// Roadmap R7 — owner-mobile cockpit hub aggregator.
api.route('/owner/cockpit', cockpitHubRouter);
// Roadmap R6 — cockpit live SSE push.
api.route('/cockpit', cockpitStreamRouter);
// Roadmap R8 — personal-KB UI surfaces. The router carries the full
// path segments inside (/me/* + /brain/personal-kb/search) so mount at
// root rather than under a prefix.
api.route('/', personalKbRouter);
// Roadmap R9 — smart-compose ghost-text suggestions
// (POST /brain/compose/suggest).
api.route('/brain', brainComposeRouter);
// Roadmap R12 — Discord-style tenant switcher backend.
api.route('/me/tenants', meTenantsRouter);
api.route('/workforce', workforceClockInRouter);
// R5 closure — field-workforce hero card surface
// (apps/workforce-mobile/src/components/WorkerHomeHero.tsx).
api.route('/field/workforce', fieldWorkforceRouter);
api.route('/brain', brainRouter);
// Sibling /brain mount for the teaching chat — Hono composes both
// routers under the same prefix; brainRouter already owns /turn,
// /threads, /personae, /migrate so the only path brainTeachRouter
// claims is /teach. Additive: NEVER touches /turn behaviour.
api.route('/brain', brainTeachRouter);
// REMOVED (borjie hard-fork): api.route('/maintenance', maintenanceRouter);
//   Replaced by /api/v1/mining/maintenance (asset maintenance events) plus
//   /api/v1/mining/tasks (covers all mining task types including equipment
//   maintenance) and /api/v1/mining/shift-reports.
// REMOVED (borjie hard-fork): api.route('/hr', hrRouter);
//   Replaced by workforce_certifications + workforce_invitations +
//   workforce_role_tab_configs schemas plus /api/v1/workforce/* routers
//   and the workforce-mobile app (47 screens).
// Borjie mining-domain: aggregates /mining/sites, /licences, /drill-holes,
// /samples, /shift-reports, /attendance, /fuel-logs, /maintenance,
// /ore-parcels, /sales, /incidents, /grievances, /cockpit, /chat (SSE),
// /lmbm, /documents, /reports, /portfolio-map, /marketplace, /bids,
// /buyers/kyc, plus /internal/* (admin-console SUPER_ADMIN surfaces).
api.route('/mining', miningRouter);
api.route('/customer', customerAppRouter);
api.route('/owner', ownerPortalRouter);
api.route('/manager', estateManagerAppRouter);
api.route('/admin', adminPortalRouter);
// Wave 1-2 feature routers
api.route('/applications', applicationsRouter);
// REMOVED (borjie hard-fork): api.route('/arrears', arrearsRouter);
api.route('/compliance', complianceRouter);
api.route('/compliance-plugins', compliancePluginsRouter);
api.route('/doc-chat', docChatRouter);
api.route('/document-render', documentRenderRouter);
api.route('/financial-profile', financialProfileRouter);
// REMOVED (borjie hard-fork): api.route('/gamification', gamificationRouter);
// REMOVED (borjie hard-fork): api.route('/gepg', gepgRouter);
api.route('/interactive-reports', interactiveReportsRouter);
api.route('/letters', lettersRouter);
api.route('/marketplace', marketplaceRouter);
// Roadmap R11 — buyer-initiated RFB. Mounted as a sub-router under
// the legacy marketplace prefix so client URLs read
// `/api/v1/marketplace/rfb/*` (matches the buyer-mobile fetch calls).
api.route('/marketplace/rfb', rfbRouter);
api.route('/marketplace-universal', universalMarketplaceRouter);
api.route('/marketing', marketingRouter);
// Borjie locale-toggle re-translation — see routes/translate.hono.ts.
// Mounted publicly (no auth) because the widget translates already-visible
// chat content; cached in Redis with sha256(text+from+to+context) keys.
api.route('/translate', translateRouter);
// Pilot-mode error dashboard — admin-tier only. Reads the in-memory
// ring buffer populated by `captureErrorWithPilotContext()` so QA can
// pull "last hour of errors per cohort" without standing up Sentry.
// See `routes/pilot-errors.hono.ts` for the auth gate + Sentry-reader
// upgrade path.
api.route('/pilot', createPilotErrorsRouter());
// Pilot in-app "Niarifu Borjie" feedback widget (Wave PILOT-FEEDBACK).
// Auth-required; writes to `pilot_feedback` (migration 0077). RLS-scoped.
api.route('/pilot/feedback', pilotFeedbackRouter);
// Sentry webhook bridge — POST /api/v1/webhooks/sentry. Composition
// root binds `services.sentryToGithubBridge`; when unbound the route
// returns 503 with a clear "not wired" body. HMAC signature verified
// via SENTRY_WEBHOOK_SECRET env var (see route file).
api.route('/webhooks/sentry', sentryWebhookRouter);
// Piece L brain↔tab loop — module update proposals CRUD + audit.
// Tenant-scoped via the route's auth middleware; RLS belt-and-braces.
api.route('/proposals', proposalsRouter);
// Wave SCOPE-SEGMENTATION — hierarchical scope taxonomy + nodes.
// Powers the brain's scope filtering tools.
api.route('/scope', scopeRouter);
// Workforce invitations — owners issue, workers self-activate.
// `/activate` intentionally bypasses tenant scope (cross-tenant lookup
// by phone+code); all other routes are RLS-scoped via auth middleware.
api.route('/workforce/invites', workforceInvitesRouter);
// Piece G — GenUI artifacts. /types always live, /:id/render gated on
// real wiring (returns 404 from not-wired stub until composition lands).
api.route(
  '/artifacts',
  createArtifactsRouter({
    service: createNotWiredArtifactRenderService(),
    resolveTenantId: (c): string | null => {
      // Tenant lookup via Supabase JWT-attached header; real auth
      // middleware lower in the stack writes `x-borjie-tenant`.
      const v = c.req.header('x-borjie-tenant');
      return typeof v === 'string' && v.length > 0 ? v : null;
    },
  }),
);
// Routers built via factory — inject real services from the composition root
// where available. For services that aren't yet wired, the factory gracefully
// returns a 503/501 to the client rather than a synchronous throw — a pilot
// can hit the endpoint, see the reason, and continue.
const migrationRouter = createMigrationRouter({
  getService: (_tenantId: string) => {
    const svc = serviceRegistry.migration;
    if (!svc) {
      throw Object.assign(
        new Error('MigrationService unavailable — DATABASE_URL not configured'),
        { statusCode: 503 }
      );
    }
    return svc;
  },
});
// Notification preferences — the real store lives in the notifications
// service; until the HTTP binding lands we return the posted shape
// verbatim so clients can dev against a stable surface.
const notificationPreferencesRouter = createNotificationPreferencesRouter({
  getPreferences: () => ({ channels: {}, templates: {}, quietHoursStart: null, quietHoursEnd: null }),
  upsertPreferences: (_u, _t, input) => input,
});
// Webhooks terminate here and forward deliveries via the same event bus
// the rest of the services use, so a downstream subscriber in the
// notifications service can persist status updates.
const notificationWebhooksRouter = createNotificationWebhookRouter({
  onDeliveryStatus: async (update) => {
    try {
      await serviceRegistry.eventBus.publish({
        event: {
          eventId: `webhook_${Date.now()}`,
          eventType: 'NotificationDeliveryStatus',
          timestamp: new Date().toISOString(),
          tenantId: 'system',
          correlationId: `wh_${Date.now()}`,
          causationId: null,
          metadata: {},
          payload: update,
        } as unknown as never,
        version: 1,
        aggregateId: update.providerMessageId ?? 'unknown',
        aggregateType: 'NotificationDelivery',
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'notification-webhook: failed to publish delivery status'
      );
    }
  },
});
api.route('/migration', migrationRouter);
// REMOVED (borjie hard-fork): api.route('/negotiations', negotiationsRouter);
api.route('/me/notification-preferences', notificationPreferencesRouter);
api.route('/notification-webhooks', notificationWebhooksRouter);
// REMOVED (borjie hard-fork): api.route('/occupancy-timeline', occupancyTimelineRouter);
// REMOVED (borjie hard-fork): api.route('/renewals', renewalsRouter);
// REMOVED (borjie hard-fork): api.route('/risk-reports', riskReportsRouter);
api.route('/scans', scansRouter);
// REMOVED (borjie hard-fork): api.route('/station-master-coverage', stationMasterCoverageRouter);
api.route('/tenders', tendersRouter);
// REMOVED (borjie hard-fork): api.route('/waitlist', waitlistRouter);
// Veteran-expert property-domain advisor routes (acquisition,
// expansion, lifecycle, sustainability, green-angle, estate-department,
// estate-auto-management, lpms) were retired in the mining hard-fork.
api.route('/geo-platform', geoPlatformRouter);
// Wave 8 — warehouse stock (S7), maintenance taxonomy (S7), IoT observations (S3)
api.route('/warehouse', warehouseRouter);
api.route('/maintenance-taxonomy', maintenanceTaxonomyRouter);
api.route('/iot', iotRouter);
// Wave PRE-LAUNCH-MISC — currency-rates surface for FX lookups (latest rates only).
api.route('/currency-rates', currencyRatesRouter);
// Wave 9 — feature flags, GDPR right-to-be-forgotten, AI cost ledger.
api.route('/feature-flags', featureFlagsRouter);
api.route('/gdpr', gdprRouter);
api.route('/dsar', createDsarRouter());
api.route('/ai-costs', aiCostsRouter);
// Wave 12 — metrics snapshot for SystemHealth page
api.route('/metrics', metricsRouter);
// Central Command Phase A C4 — Sensorium / Brain Skin. POST /sensorium/events
// receives batched sensory payloads from the client-side 14-event bus.
api.route('/sensorium', sensoriumRouter);
// Central Command Phase A C6 — Cross-portal SSE fan-out. GET
// /cross-portal/subscribe streams brain-driven announcements +
// notifications + state-mutations + wake-triggers to ANY logged-in
// user, scoped to their JWT tenantId.
api.route('/cross-portal', crossPortalSubscribeRouter);
// Central Command Phase B B6 — Liveblocks 3.0 rooms auth. POST
// /realtime/auth mints session tokens scoped to caller's tenantId.
api.route('/realtime', liveblocksAuthRouter);
// Central Command Phase B B3 — Inngest durable-execution webhook.
// POST /inngest receives HMAC-SHA256-signed function callbacks from
// Inngest cloud. 5-min replay window via timestamp tolerance;
// in-memory idempotency dedupe by event.id. Returns 503 when
// `services.inngestRuntime` is unbound (Inngest dep not installed
// or `INNGEST_SIGNING_KEY` absent).
api.route('/inngest', inngestWebhookRouter);
// Central Command Phase B B5 — session-replay cold store.
// POST /session-replay/chunks (auth, 5MB cap, dedup) +
// admin-gated GET /session-replay/sessions and chunk readback.
api.route('/session-replay', sessionReplayRouter);
// Wave 12 — MCP server mounted for Claude Desktop, GPT, Cursor, partner agents
api.route('/mcp', mcpRouter);
// A2A Agent Card — expose under /api/v1/.well-known/agent.json (the standard
// .well-known/ path would require mounting at the express root; this variant
// is still discoverable by A2A clients that follow our OpenAPI spec).
api.route('/.well-known/agent.json', agentCardRouter);
// Wave 11 — public marketing (Mr. Mwikila, unauthenticated) + AI workflow engine
// Borjie public chat mounts FIRST so its /chat handler wins lookup over
// the legacy pre-Borjie marketing-brain /chat under the same prefix.
api.route('/public', publicChatRouter);
api.route('/public', publicMarketingRouter);
api.route('/public/sandbox', publicSandboxRouter);
api.route('/public/leads', publicLeadsRouter);
api.route('/public/status', publicStatusRouter);
// Streaming AI chat — POST /api/v1/ai/chat with SSE response
api.route('/ai', aiChatRouter);
// Universal role-aware advisor — POST /api/v1/ask, GET /api/v1/ask/starting-points,
// POST /api/v1/ask/feedback. See `routes/ask/ask.router.ts`.
api.route('/ask', askRouter);
// Stage-aware capability advisor (Chain 7 of WIRING_GAPS_2026-05-24.md
// — the 8th advisor whose router shipped but was never mounted).
api.route('/stage', stageRouter);
// Persistent workflow engine (Chain 8) — composes
// `@borjie/workflow-engine` + `@borjie/ai-reviewer` +
// `@borjie/assignment-registry`. Mounted at the singular
// `/workflow` path; the plural `/workflows` mount that previously
// fronted the in-memory `ai-copilot` engine has been REMOVED so
// runs survive process restarts and so the new engine is the single
// source of truth.
api.route('/workflow', workflowRouter);
api.route('/agent-certifications', agentCertificationsRouter);
// REMOVED (borjie hard-fork): api.route('/classroom', classroomRouter);
api.route('/training', trainingRouter);
api.route('/voice', voiceRouter);
// Wave 13 — Autonomous Department Mode
api.route('/exceptions', exceptionsRouter);
api.route('/audit', autonomousActionsAuditRouter);
api.route('/autonomy', autonomyRouter);
// Wave 28 Phase A Agent PhA2 — monthly bookkeeping close.
// REMOVED (borjie hard-fork): api.route('/monthly-close', monthlyCloseRouter);
// Organizational Awareness — "talk to your organization" endpoints
api.route('/org', orgAwarenessRouter);
// Tenant Credit Rating — FICO-scale credit + portable certificate
// REMOVED (borjie hard-fork): api.route('/credit-rating', creditRatingRouter);
// Property Grading — Mr. Mwikila's A–F report card system
// REMOVED (borjie hard-fork): api.route('/property-grading', propertyGradingRouter);
// Wave-K parity-litfin — LITFIN mission-eval dashboard parity surface
// (aggregates over kernel_provenance + kernel_cot_reservoir).
api.route('/parity/capability', parityCapabilityDashboardRouter);
// AI-Native suite — Agent PhG: sentiment, market surveillance, multimodal,
// polyglot support, predictive interventions, policy simulator, NL query.
api.route('/ai-native', aiNativeRouter);
// Wave 26 — Agent Z2: four repos Agent T flagged with zero router wiring.
// REMOVED (borjie hard-fork): api.route('/subleases', subleaseRouter);
// REMOVED (borjie hard-fork): api.route('/damage-deductions', damageDeductionsRouter);
// REMOVED (borjie hard-fork): api.route('/conditional-surveys', conditionalSurveysRouter);
api.route('/far', farRouter);
// Wave 26 Z3 — Move-out checklist + Approval workflow.
// REMOVED (borjie hard-fork): api.route('/move-out', moveOutRouter);
api.route('/approvals', approvalsRouter);
// Wave 27 PhA1 — Vacancy-to-Lease orchestrator (state machine + pipeline runs)
// REMOVED (borjie hard-fork): api.route('/vacancy-pipeline', vacancyPipelineRouter);
// Personal Jarvis-style AI for every Borjie user — each surface
// hits the same central-intelligence brain kernel but selects a
// surface-specific persona and personalises the opening with the
// operator's name. See packages/central-intelligence/src/kernel/
// identity.ts for the persona catalogue.
//
// Per-tenant token-budget — only mounted on Jarvis kernel routes so a
// runaway tenant cannot starve the platform's Anthropic budget. Auth
// runs first inside each surface's router, then `tenantId` is on the
// context for the budget gate. Process-local in-memory bucket; see
// `per-tenant-rate-budget.ts` for the documented Redis upgrade.
const tenantBudget = getSharedPerTenantRateBudget();
api.use('/customer/jarvis/*', tenantBudget.handler);
api.use('/owner/jarvis/*', tenantBudget.handler);
api.use('/manager/jarvis/*', tenantBudget.handler);
api.use('/admin/jarvis/*', tenantBudget.handler);
api.use('/platform/jarvis/*', tenantBudget.handler);
api.route('/customer/jarvis', tenantJarvisRouter);
api.route('/owner/jarvis', ownerJarvisRouter);
api.route('/manager/jarvis', managerJarvisRouter);
// Central-Command AG-UI SSE wire — mounted BEFORE the parent
// admin-jarvis router so the more-specific path wins lookup order.
// Replaces the 503 stub at the Next.js admin-web route.
api.route('/admin/jarvis/stream', adminJarvisStreamRouter);
api.route('/admin/jarvis', adminJarvisRouter);          // agency admin (Nyumba Mind — Agency Brain)
api.route('/platform/jarvis', platformHqJarvisRouter);  // Borjie HQ (Nyumba Mind sovereign)
// Platform overview KPI aggregator — read-only, platform-tier auth, used
// by admin-web /platform/overview KPI tiles.
api.route('/platform/overview', platformOverviewRouter);
// Phase B Wave 30 — Task-Agents (narrow-scope single-job agents + manual runs)
api.route('/task-agents', taskAgentsRouter);
// Wave 27 Agent E — Tenant Branding (per-tenant AI persona identity)
api.route('/tenant-branding', tenantBrandingRouter);
// Wave 27 Agent C — Audit Trail v2 (record / verify / bundle / entries)
api.route('/audit-trail', auditTrailRouter);
// Wave-K Tier-3 — Sovereign action-ledger admin (tail + verify).
api.route('/admin/sovereign-ledger', sovereignLedgerRouter);
// Wave 28 — Head briefing (cohesive morning screen)
api.route('/head/briefing', headBriefingRouter);
// Wave 28 — Junior-AI factory (team-lead self-service provisioning)
api.route('/junior-ai', juniorAIRouter);
// Canonical Property Graph — relationship-explorer + named-query surface
api.route('/graph', graphRouter);
// Wave 29 — Forecasting surface (TGN + conformal). Returns 503
// FORECAST_SERVICE_UNAVAILABLE until the inference + repo adapters are
// wired (no mock forecasts, ever).
api.route('/forecast', forecastRouter);
// Central Intelligence — streaming SSE first-person agent. Auth-gated.
// Every endpoint derives ScopeContext from the session, never from the
// body. Returns 503 INTELLIGENCE_SERVICE_UNAVAILABLE when the LLM
// adapter is not wired (no mock agents).
api.route('/intelligence', intelligenceRouter);
// REMOVED (borjie hard-fork): Wave 27 risk-recompute trigger — pre-Borjie
// property-risk router deleted in wave 1. Borjie mining-risk recompute lives
// in services/api-gateway/src/workers/executive-brief-action-runner.ts now.
// api.route(
//   '/risk-recompute',
//   createRiskRecomputeRouter({
//     getDispatcher: () => heartbeatSupervisor.riskDispatcher,
//     getJobs: () => heartbeatSupervisor.riskJobs,
//   }),
// );
// Frontend gap-fix routers — owner-portal hits these top-level paths.
// `/analytics/summary`, `/portfolio/{summary,performance,growth}`. Until
// dedicated aggregators land, each returns an "honest empty" shape so
// the dashboard pages render the empty state cleanly. See each router
// Aggregator follow-ups are tracked in #33.
api.route('/analytics', analyticsRouter);
api.route('/portfolio', portfolioRouter);
// Wave-4 D6 — owner-portal placeholder-page skeletons. Each line
// answers an endpoint declared by a `MissingBackendNotice` page in
// owner-portal (commit 0ee27a0). All return `{ data: [] }` with
// `X-Backend-Status: degraded` and a concrete next-step in `meta`.
api.route('/analytics/exports', analyticsExportsRouter);
api.route('/analytics/growth', analyticsGrowthRouter);
api.route('/analytics/usage', analyticsUsageRouter);
api.route('/billing', billingRouter);
api.route('/owner/messaging', ownerMessagingRouter);
// Wave OWNER-OS — mount BEFORE the wildcard owner mounts so the more
// specific paths win lookup order.
api.route('/owner/brief', ownerBriefRouter);
// Wave OWNER-OS DAILY-BRIEF rebuild — cron-aware daily brief surface.
// GET / returns today's snapshot (cached or null); POST /trigger forces
// a generate-and-dispatch right now (owner-only). Mounted BEFORE the
// generic /owner/* wildcards so the specific path wins lookup.
api.route('/owner/daily-brief', ownerDailyBriefRouter);
api.route('/owner/docs', ownerDocsRouter);
api.route('/owner/forms', ownerFormsRouter);
api.route('/owner/drafts', ownerDraftsRouter);
api.route('/owner/reminders', ownerRemindersRouter);
api.route('/owner/tabs', ownerTabsRouter);
// Wave SUPERPOWERS - chat-callable surface for share / undo / bookmark /
// bulk. The public token resolver is mounted OUTSIDE auth (token-only).
api.route('/owner/share-links', ownerShareLinksRouter);
api.route('/owner/undo-journal', ownerUndoJournalRouter);
api.route('/owner/pinned-items', ownerPinnedItemsRouter);
api.route('/owner/superpowers', ownerSuperpowersRouter);
api.route('/public/share', publicShareResolverRouter);
// Wave FOUR-EYE-APPROVAL — high-stakes action gate. The Hono router
// covers /request, /pending, /approve/:token, /reject/:token under
// the /owner/four-eye prefix so owner-web modals can target a single
// path tree without touching the brain.
api.route('/owner/four-eye', fourEyeApprovalsRouter);
// Wave ESTATE-OS — family-office holdings layer.
api.route('/estate/groups', estateGroupsRouter);
api.route('/estate/entities', estateEntitiesRouter);
api.route('/estate/capital-movements', estateCapitalMovementsRouter);
api.route('/estate/succession-plans', estateSuccessionPlansRouter);
api.route('/estate/assets', estateAssetsRouter);
// Wave OPS-WIDE — the end-to-end operations surface (counterparties,
// engagements, mineral chain-of-custody, regulator calendar).
// Mounted as /api/v1/ops/* — drives owner-web /counterparties,
// /chain-of-custody and /regulatory-calendar plus the new brain tools.
api.route('/ops/external-parties', opsExternalPartiesRouter);
api.route('/ops/engagements', opsEngagementsRouter);
api.route('/ops/chain-of-custody', opsChainOfCustodyRouter);
api.route('/ops/regulatory-filings', opsRegulatoryFilingsRouter);
// Geo SOTA 2026-05-29 — Tanzania regulatory zone lookup. Auth-required
// (rate-limit + audit) but tenant-agnostic.
api.route('/regulatory/zones', regulatoryZonesRouter);
// Wave WORKFORCE-FIXED-TABS — mount BEFORE wildcard owner mounts so the
// more specific `/owner/workforce/*` paths win lookup order.
api.route('/owner/workforce', workforceTabConfigOwnerRouter);
api.route('/owner/workforce', workforceTabConfigOwnerListRouter);
api.route('/workforce', workforceTabConfigWorkerRouter);
api.route('/internal', workforceTabPolicyAdminRouter);api.route('/support', supportRouter);
api.route('/admin', adminUsersRouter);
// Unit subdivision + components — Manager-app dependency. Hono mounts
// path-param prefixes correctly: `:id` is parsed and exposed via
// `c.req.param('id')` inside the sub-router.
api.route('/units/:id/subdivision', unitSubdivisionRouter);
api.route('/units/:id/components', unitComponentsRouter);

// Wave AGENTIC-PLATFORM — OAuth2 device-flow + per-agent access tokens.
// PUBLIC endpoints (no auth): /oauth/device/code, /oauth/device/verify,
// /oauth/device/details, /oauth/token, /oauth/revoke.
// OWNER-AUTH endpoints (Supabase JWT / session cookie):
// /oauth/device/approve, /oauth/device/deny, /oauth/agent-tokens.
// Backed by migration 0118 (oauth_agent_tokens + oauth_device_codes).
// Mounted late so it never accidentally shadows existing /api/v1/auth.
api.route('/oauth', oauthDeviceRouter);

// Wave 12 — Webhook DLQ admin router. Mounted at /api/v1/webhooks via
// the factory's own prefix. The factory expects a repository + requeue
// function; we wire Postgres when the registry is live, otherwise the
// endpoints are not registered.
if (serviceRegistry.isLive && serviceRegistry.db) {
  const webhookDlqRouter = createWebhookDlqRouter({
    repository: createPostgresWebhookDeliveryRepository(serviceRegistry.db),
    async requeue(event) {
      try {
        await serviceRegistry.eventBus.publish({
          event: {
            eventId: `webhook_${Date.now()}`,
            eventType: 'WebhookDeliveryQueued',
            timestamp: new Date().toISOString(),
            tenantId: event.tenantId,
            correlationId: `wh_${Date.now()}`,
            causationId: null,
            metadata: {},
            payload: event,
          } as unknown as never,
          version: 1,
          aggregateId: event.deliveryId,
          aggregateType: 'WebhookDelivery',
        });
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'webhook-dlq: requeue publish failed',
        );
      }
      return event.deliveryId;
    },
  });
  api.route('/', webhookDlqRouter);
}

// OpenAPI spec + Swagger UI. Mounted AFTER every router so the
// harvester can see them. The spec lives at /api/v1/openapi.json and
// the interactive UI at /api/v1/docs.
const openApiRouter = createOpenApiRouter({
  title: 'BORJIE API',
  version: process.env.APP_VERSION ?? '1.0.0',
  description:
    'BORJIE multi-tenant property management platform — full HTTP API. ' +
    'Generated from the live gateway at runtime.',
  servers: [
    { url: '/api/v1', description: 'This gateway' },
  ],
  mountedRouters: [
    { prefix: '/auth', app: authRouter, defaultTag: 'auth' },
    { prefix: '/auth/mfa', app: authMfaRouter, defaultTag: 'auth' },
    // Public self-signup endpoints (no auth) — see composition/signup-wiring.ts.
    { prefix: '/orgs', app: createOrgsRouter(signupWiring.orgs), defaultTag: 'signup' },
    { prefix: '/buyers', app: createBuyersRouter(signupWiring.buyers), defaultTag: 'signup' },
    { prefix: '/tenants', app: tenantsRouter, defaultTag: 'tenants' },
    { prefix: '/users', app: usersRouter, defaultTag: 'users' },
    // REMOVED (borjie hard-fork): { prefix: '/properties', app: propertiesRouter, defaultTag: 'properties' },
    // REMOVED (borjie hard-fork): { prefix: '/units', app: unitsRouter, defaultTag: 'units' },
    // REMOVED (borjie hard-fork): { prefix: '/customers', app: customersRouter, defaultTag: 'customers' },
    // REMOVED (borjie hard-fork): { prefix: '/leases', app: leasesRouter, defaultTag: 'leases' },
    // REMOVED (borjie hard-fork): { prefix: '/invoices', app: invoicesApp, defaultTag: 'invoices' },
    // REMOVED (borjie hard-fork): { prefix: '/payments', app: paymentsApp, defaultTag: 'payments' },
    // REMOVED (borjie hard-fork): { prefix: '/work-orders', app: workOrdersRouter, defaultTag: 'work-orders' },
    // REMOVED (borjie hard-fork): { prefix: '/vendors', app: vendorsRouter, defaultTag: 'vendors' },
    { prefix: '/notifications', app: notificationsRouter, defaultTag: 'notifications' },
    { prefix: '/onboarding', app: onboardingRouter, defaultTag: 'onboarding' },
    { prefix: '/feedback', app: feedbackRouter, defaultTag: 'feedback' },
    { prefix: '/complaints', app: complaintsRouter, defaultTag: 'complaints' },
    // REMOVED (borjie hard-fork): { prefix: '/inspections', app: inspectionsRouter, defaultTag: 'inspections' },
    // REMOVED (borjie hard-fork): { prefix: '/documents', app: documentsHonoRouter, defaultTag: 'documents' },
    // REMOVED (borjie hard-fork): { prefix: '/scheduling', app: schedulingRouter, defaultTag: 'scheduling' },
    // REMOVED (borjie hard-fork): { prefix: '/messaging', app: messagingRouter, defaultTag: 'messaging' },
    { prefix: '/cases', app: casesRouter, defaultTag: 'cases' },
    { prefix: '/brain', app: brainRouter, defaultTag: 'brain' },
    // REMOVED (borjie hard-fork): { prefix: '/maintenance', app: maintenanceRouter, ... },
    // REMOVED (borjie hard-fork): { prefix: '/hr', app: hrRouter, ... },
    { prefix: '/customer', app: customerAppRouter, defaultTag: 'bff-customer' },
    { prefix: '/owner', app: ownerPortalRouter, defaultTag: 'bff-owner' },
    { prefix: '/manager', app: estateManagerAppRouter, defaultTag: 'bff-manager' },
    { prefix: '/admin', app: adminPortalRouter, defaultTag: 'bff-admin' },
    { prefix: '/applications', app: applicationsRouter, defaultTag: 'applications' },
// REMOVED (borjie hard-fork):     { prefix: '/arrears', app: arrearsRouter, defaultTag: 'arrears' },
    { prefix: '/compliance', app: complianceRouter, defaultTag: 'compliance' },
    { prefix: '/compliance-plugins', app: compliancePluginsRouter, defaultTag: 'compliance-plugins' },
    { prefix: '/doc-chat', app: docChatRouter, defaultTag: 'doc-chat' },
    { prefix: '/document-render', app: documentRenderRouter, defaultTag: 'document-render' },
    { prefix: '/financial-profile', app: financialProfileRouter, defaultTag: 'financial-profile' },
// REMOVED (borjie hard-fork):     { prefix: '/gamification', app: gamificationRouter, defaultTag: 'gamification' },
// REMOVED (borjie hard-fork):     { prefix: '/gepg', app: gepgRouter, defaultTag: 'gepg' },
    { prefix: '/interactive-reports', app: interactiveReportsRouter, defaultTag: 'interactive-reports' },
    { prefix: '/letters', app: lettersRouter, defaultTag: 'letters' },
    { prefix: '/marketplace', app: marketplaceRouter, defaultTag: 'marketplace' },
    { prefix: '/marketplace-universal', app: universalMarketplaceRouter, defaultTag: 'marketplace-universal' },
    { prefix: '/migration', app: migrationRouter as unknown as Hono, defaultTag: 'migration' },
// REMOVED (borjie hard-fork):     { prefix: '/negotiations', app: negotiationsRouter, defaultTag: 'negotiations' },
    { prefix: '/me/notification-preferences', app: notificationPreferencesRouter, defaultTag: 'notifications' },
    { prefix: '/notification-webhooks', app: notificationWebhooksRouter, defaultTag: 'notifications' },
// REMOVED (borjie hard-fork):     { prefix: '/occupancy-timeline', app: occupancyTimelineRouter, defaultTag: 'occupancy-timeline' },
// REMOVED (borjie hard-fork):     { prefix: '/renewals', app: renewalsRouter, defaultTag: 'renewals' },
// REMOVED (borjie hard-fork):     { prefix: '/risk-reports', app: riskReportsRouter, defaultTag: 'risk-reports' },
    { prefix: '/scans', app: scansRouter, defaultTag: 'scans' },
// REMOVED (borjie hard-fork):     { prefix: '/station-master-coverage', app: stationMasterCoverageRouter, defaultTag: 'station-master-coverage' },
    { prefix: '/tenders', app: tendersRouter, defaultTag: 'tenders' },
// REMOVED (borjie hard-fork):     { prefix: '/waitlist', app: waitlistRouter, defaultTag: 'waitlist' },
    { prefix: '/feature-flags', app: featureFlagsRouter, defaultTag: 'feature-flags' },
    { prefix: '/gdpr', app: gdprRouter, defaultTag: 'gdpr' },
    { prefix: '/ai-costs', app: aiCostsRouter, defaultTag: 'ai-costs' },
    { prefix: '/exceptions', app: exceptionsRouter, defaultTag: 'autonomy' },
    { prefix: '/audit', app: autonomousActionsAuditRouter, defaultTag: 'autonomy' },
// REMOVED (borjie hard-fork):     { prefix: '/subleases', app: subleaseRouter, defaultTag: 'subleases' },
// REMOVED (borjie hard-fork):     { prefix: '/damage-deductions', app: damageDeductionsRouter, defaultTag: 'damage-deductions' },
// REMOVED (borjie hard-fork):     { prefix: '/conditional-surveys', app: conditionalSurveysRouter, defaultTag: 'conditional-surveys' },
    { prefix: '/far', app: farRouter, defaultTag: 'far' },
    { prefix: '/analytics', app: analyticsRouter, defaultTag: 'analytics' },
    { prefix: '/portfolio', app: portfolioRouter, defaultTag: 'portfolio' },
  ],
});
api.route('/', openApiRouter);

app.use('/api/v1', handle(api));

// Wave AGENTIC-PLATFORM — capability manifest + MCP discovery, mounted
// at the express ROOT under /.well-known/ per the spec. PUBLIC (no auth),
// CDN-cacheable. Routes:
//   GET /.well-known/borjie-capabilities.json
//   GET /.well-known/mcp.json
app.use('/.well-known', handle(wellKnownRouter));

// Wave AGENTIC-PLATFORM — public MCP server (@borjie/mcp-server-borjie).
// Mounted at the express ROOT so clients connect to the URL the
// discovery manifest hands out. PUBLIC entry (the dispatcher gates
// every tools/call on the OAuth2 device-flow bearer token + per-scope
// rate limit + four-eye approval for sovereign tool prefixes).
//   POST /mcp           — JSON-RPC 2.0 single request/response
//   GET  /mcp/sse       — long-lived SSE channel (session, message,
//                          $/progress, notifications/resources/updated,
//                          logging/message events)
//   POST /mcp/messages  — sidecar POST for SSE-connected clients
import { mcpPublicRouter } from './routes/mcp-public.hono';
app.use('/mcp', handle(mcpPublicRouter));

// API versioning
app.get('/api/v1', (_req, res) => {
  res.json({
    version: '1.0.0',
    docs: {
      gateway: '/api/v1/docs',
      mining: '/api/v1/mining/docs',
    },
    endpoints: [
      '/api/v1/auth',
      '/api/v1/auth/mfa',
      '/api/v1/tenants',
      '/api/v1/users',
      '/api/v1/properties',
      '/api/v1/units',
      '/api/v1/customers',
      '/api/v1/leases',
      '/api/v1/invoices',
      '/api/v1/payments',
      '/api/v1/work-orders',
      '/api/v1/vendors',
      '/api/v1/notifications',
      '/api/v1/reports',
      '/api/v1/dashboard',
      '/api/v1/onboarding',
      '/api/v1/feedback',
      '/api/v1/complaints',
      '/api/v1/inspections',
      '/api/v1/documents',
      '/api/v1/scheduling',
      '/api/v1/messaging',
      '/api/v1/cases',
      '/api/v1/brain',
      '/api/v1/maintenance',
      '/api/v1/hr',
      '/api/v1/mining',
      '/api/v1/customer',
      '/api/v1/owner',
      '/api/v1/manager',
      '/api/v1/admin',
    ],
  });
});

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    logger.error(err, 'Unhandled error');
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Wave 12 — background scheduler supervisor. Heartbeat supervisor is
// constructed earlier (see the block right after the service-registry
// bootstrap) because the risk-recompute router mounted below needs the
// dispatcher it owns.
const backgroundSupervisor = createBackgroundSupervisor(serviceRegistry, logger);

// Wave 26 — intelligence-history worker (Z4). Runs `createIntelligenceHistoryWorker`
// on a daily cadence so `intelligence_history` snapshots are produced out-of-band
// from the scheduler's tenant loop. The scheduler also registers a
// `recompute_intelligence_history` task per-tenant; this standalone supervisor
// guarantees a run even when the scheduler is disabled.
const intelligenceHistorySupervisor = createIntelligenceHistorySupervisor(
  serviceRegistry.db,
  {
    info: (meta, msg) => logger.info(meta, msg),
    warn: (meta, msg) => logger.warn(meta, msg),
  },
);
// Wave 26 — Cases SLA worker supervisor. Wraps the per-tenant
// CaseSLAWorker (domain-services/cases/sla-worker.ts) in a multi-tenant
// supervisor that ticks active tenants every 5 minutes, auto-escalating
// overdue cases and emitting CaseSLABreached events once the ceiling is
// hit. No-op in degraded mode.
const casesSlaSupervisor = createCaseSLASupervisor(serviceRegistry, logger);

// Geo SOTA 2026-05-29 — geofencing service backed by PostGIS (migration
// 0130). Wraps point-in-polygon / distance / regulatory-zone queries
// behind one typed surface. The watcher worker (next) reads recent
// workforce_locations fixes every 30s and emits off-site / in-hazard
// alerts. See Docs/RESEARCH/GEO_SOTA_2026-05-29.md.
const geofencingService = serviceRegistry.db
  ? createGeofencingService({
      db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
    })
  : null;
const geofenceWatcherAlertSink: GeofenceAlertSink = {
  // Pino-friendly placeholder sink — the WhatsApp/SMS dispatcher and
  // owner cockpit event bus wire-up land in a follow-up. For now we
  // log the alert with full payload so the audit trail records it.
  async emit(alert) {
    logger.info(
      {
        alertKind: alert.kind,
        tenantId: alert.tenantId,
        employeeId: alert.employeeId,
        idempotencyKey: alert.idempotencyKey,
        capturedAt: alert.capturedAt,
        ...(alert.kind === 'worker_offsite_alert' && {
          expectedSiteId: alert.expectedSiteId,
          distanceMeters: alert.distanceMeters,
        }),
        ...(alert.kind === 'worker_in_hazard_alert' && {
          hazardId: alert.hazardId,
          severity: alert.severity,
        }),
      },
      'geofence-watcher: alert emitted',
    );
  },
};
const geofenceWatcher =
  serviceRegistry.db && geofencingService
    ? createGeofenceWatcher({
        db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
        geofencing: geofencingService,
        alertSink: geofenceWatcherAlertSink,
        logger,
      })
    : { start() {}, stop() {}, async tickOnce() {} };

// Wave 15 — TRC pilot. Daily scan of `leases.end_date` against the
// 60/30/7/1-day warning windows. Dispatches via the existing notifications
// infrastructure (whatsapp → sms → email → in_app priority). Skipped in
// degraded mode (no DB) and in tests.
const leaseExpiryNotificationSender: LeaseExpiryNotificationSender = {
  // Pino-friendly placeholder sender — once the WhatsApp/SMS providers
  // have tenant-scoped credentials wired, swap this for a thin adapter
  // around `notificationService.sendNotification(recipient, channel, ...)`
  // (services/notifications/src/services/notification.service.ts).
  // Wave 15 deliberately leaves this stub-shaped so the cron is testable
  // and the dispatch_log row is written even when no provider is reachable.
  async send(args) {
    logger.info(
      {
        tenantId: args.tenantId,
        leaseId: args.lease.id,
        leaseNumber: args.lease.leaseNumber,
        window: args.window,
        channel: args.channel,
        idempotencyKey: args.idempotencyKey,
      },
      'lease-expiry-cron: dispatch (stub provider — Wave 15)',
    );
    return { delivered: true, providerMessageId: `stub-${args.idempotencyKey}` };
  },
};

// DISABLED — BossNyumba leases/customers tables no longer exist in the
// mining hard-fork. Queries against `leases` + `customers` were crashing
// the process every tick. Re-enable when a mining-domain replacement is
// designed (e.g. licence-expiry-alert-cron against `licences`).
const leaseExpiryCron = { start() {}, stop() {}, async tickOnce() { return { scanned: 0, dispatched: 0, skippedAlreadySent: 0, failed: 0, byWindow: {} }; } };

// Piece C — executive brief cron. Scans `briefing_subscriptions` every
// EXECUTIVE_BRIEF_CRON_INTERVAL_MS (default 5 min) and generates briefs
// for any DAILY / WEEKLY / MONTHLY subscription whose next_due_at has
// passed. ON_DEMAND subscriptions are skipped — they fire via the
// POST /briefs/generate route.
// DISABLED — `briefing_subscriptions` table not yet migrated in this
// branch; queries crash the process every tick. Re-enable once the
// migration lands and a mining-domain subscription schema is finalized.
const executiveBriefCron = { start() {}, stop() {}, async tickOnce() { return { scanned: 0, generated: 0, degraded: 0, refused: 0, failed: 0 }; } };

// Wave OWNER-OS DAILY-BRIEF rebuild — mining-native daily-brief cron.
// Ticks every BORJIE_DAILY_BRIEF_CRON_INTERVAL_MS (default 5 min) and
// composes / dispatches today's brief for every tenant whose
// `daily_brief_cadence` matches the current minute in their local
// timezone (Africa/Dar_es_Salaam fallback). Idempotent via
// UNIQUE(tenant_id, snapshot_date, channel, recipient) on
// `daily_brief_dispatches`. Persists snapshots in
// `owner_brief_snapshots` so the owner-web dashboard hits cache.
const dailyBriefCron = serviceRegistry.db
  ? createDailyBriefCron({
      db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
      logger,
      emailProvider: createEmailProviderFromEnv(),
      smsProvider: resolveSmsProviderFromEnv(),
      intervalMs: Number(process.env.BORJIE_DAILY_BRIEF_CRON_INTERVAL_MS ?? 5 * 60_000) || 5 * 60_000,
      enabled:
        process.env.NODE_ENV !== 'test' &&
        process.env.BORJIE_DAILY_BRIEF_CRON_DISABLED !== 'true',
    })
  : {
      start() {},
      stop() {},
      async tickOnce() {
        return { scanned: 0, generated: 0, dispatched: 0, failed: 0 };
      },
      async triggerForTenant(tenantId: string) {
        return {
          tenantId,
          generated: false,
          snapshotId: null,
          dispatched: 0,
          skipped: 0,
          failed: 0,
          reason: 'db_unwired',
        };
      },
    };
// Expose the live handle so the manual-trigger endpoint can call it.
registerDailyBriefCron(dailyBriefCron);

// Wave WORKFORCE-CERT-EXPIRY — 6h cron that scans
// workforce_certifications for any active cert expiring within 30d
// and auto-creates reminders at 30d / 14d / 3d. Idempotent via
// UNIQUE(tenant_id, cert_id, days_before) on
// workforce_cert_expiry_reminders.
const icaCertExpiryCron = serviceRegistry.db
  ? createIcaCertExpiryCron({
      db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
      logger,
    })
  : {
      start() {},
      stop() {},
      async tickOnce() {
        return { scanned: 0, remindersCreated: 0, dedupSkipped: 0, failed: 0 };
      },
    };

// Roadmap R6 — hourly compliance-deadline scanner. Emits a
// `compliance.deadline_approaching` cockpit event for every
// regulatory_filings row whose due_at lands inside the 7-day horizon.
const complianceDeadlineScan = serviceRegistry.db
  ? createComplianceDeadlineScan({
      db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
      logger,
    })
  : {
      start() {},
      stop() {},
      async tickOnce() {
        return { scanned: 0, emitted: 0 };
      },
    };

// Wave ENTITY-LEGIBILITY — 30-min indexer that embeds + tags + cross-
// references every entity in the system so the brain can resolve any
// natural-language phrase to a concrete row and traverse the entity
// graph in one hop. Disabled when BORJIE_ENTITY_INDEXER_DISABLED=true
// (e.g. test runs). Interval is env-tunable via
// BORJIE_ENTITY_INDEXER_INTERVAL_MS.
const entityIndexerWorker = serviceRegistry.db
  ? createEntityIndexerWorker({
      db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
      logger,
    })
  : {
      start() {},
      stop() {},
      async tickOnce() {
        return {
          indexedCount: 0,
          edgesUpserted: 0,
          failedRows: 0,
          perKindCounts: {},
        };
      },
    };

// Live FX feed cron — see fx-feed-cron.ts. Ticks every 5 min by default;
// override via BORJIE_FX_FEED_CRON_INTERVAL_MS. Disabled when
// BORJIE_FX_FEED_CRON_DISABLED=true (e.g. test runs).
const fxFeedCron = serviceRegistry.db
  ? createFxFeedCron({
      db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
      logger,
      intervalMs: Number(process.env.BORJIE_FX_FEED_CRON_INTERVAL_MS ?? 5 * 60_000) || 5 * 60_000,
      enabled:
        process.env.NODE_ENV !== 'test' &&
        process.env.BORJIE_FX_FEED_CRON_DISABLED !== 'true',
    })
  : {
      start() {},
      stop() {},
      async tickOnce() {
        return {
          tickedAt: new Date().toISOString(),
          bot: { value: null, inserted: false },
          lbma: { amValue: null, pmValue: null, inserted: false },
          errors: ['db_unwired'],
        };
      },
    };

// Piece E (issue #41) — executive-brief action runner. Drains
// `executive_brief_actions WHERE status='approved' AND executed_at IS NULL`
// every BORJIE_ACTION_RUNNER_INTERVAL_MS (default 10s) and dispatches
// each row to the junior executor. Result + outcome land back on the row;
// each dispatch is hash-chained into ai_audit_chain.
const executiveBriefActionRunner = serviceRegistry.db
  ? createExecutiveBriefActionRunner({
      db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
      logger,
    })
  : { start() {}, stop() {}, async tickOnce() { return { scanned: 0, executed: 0, failed: 0, skipped: 0 }; } };

// Wave OWNER-OS — reminders dispatch worker. Polls the `reminders`
// table every 30s and ships rows by email (SendGrid/SES via env), SMS
// (Africa's Talking / Twilio composite), or Slack webhook. Disabled
// transparently when DATABASE_URL is unset (degraded mode). Single
// no-op tick is returned so callers can still invoke tickOnce in tests.
const remindersDispatchWorker = serviceRegistry.db
  ? createRemindersDispatchWorker({
      db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
      logger,
      emailProvider: createEmailProviderFromEnv(),
      smsProvider: resolveSmsProviderFromEnv(),
      // Wave OWNER-CONTACT-RESOLVER — replace the fallback-email env
      // var with a per-owner resolver. The resolver reads
      // `owner_contact_prefs` first then falls back to `users.email`,
      // `users.phone`, and the user's preferred locale/timezone.
      emailForOwner: makeEmailForOwner(
        serviceRegistry.db as unknown as Parameters<typeof makeEmailForOwner>[0],
      ),
      phoneForOwner: makePhoneForOwner(
        serviceRegistry.db as unknown as Parameters<typeof makePhoneForOwner>[0],
      ),
      slackHandleForOwner: makeSlackHandleForOwner(
        serviceRegistry.db as unknown as Parameters<typeof makeSlackHandleForOwner>[0],
      ),
      intervalMs: Number(process.env.BORJIE_REMINDERS_INTERVAL_MS ?? 30_000) || 30_000,
      enabled: process.env.NODE_ENV !== 'test' && process.env.BORJIE_REMINDERS_WORKER_DISABLED !== 'true',
    })
  : { start() {}, stop() {}, async tickOnce() { return { claimed: 0, sent: 0, failed: 0 }; } };

// Wave CLOSED-LOOP - 6h tick. For each outcome_predictions row whose
// horizon has elapsed and has no reconciliation yet, resolve the
// entity's current state through the per-entity resolver port, compute
// drift, insert outcome_observations + outcome_reconciliations, and
// extend the AI hash-chain. Per-entity resolvers are wired sparingly
// here - downstream agents register more via the resolver map as new
// action_target_entity_type values come online. Unresolved entity
// types land predictions in 'expired' status (auditable) rather than
// dangling forever.
// Decision-retrospective recorder — hash-chained, append-only. Lives
// next to the outcome-reconciliation worker so both share the same db
// handle and lifecycle.
const decisionRecorder = serviceRegistry.db
  ? createDecisionRecorder({
      db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
    })
  : null;

const decisionRetrospectiveWorker =
  serviceRegistry.db && decisionRecorder
    ? createDecisionRetrospectiveWorker({
        db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
        logger,
        recorder: decisionRecorder,
        intervalMs:
          Number(
            process.env.BORJIE_DECISION_RETROSPECTIVE_INTERVAL_MS ??
              24 * 60 * 60 * 1000,
          ) || 24 * 60 * 60 * 1000,
        enabled:
          process.env.NODE_ENV !== 'test' &&
          process.env.BORJIE_DECISION_RETROSPECTIVE_DISABLED !== 'true',
      })
    : {
        start() {},
        stop() {},
        async tickOnce() {
          return { considered: 0, graded: 0, skipped: 0, failed: 0 };
        },
      };

const outcomeReconciliationWorker = serviceRegistry.db
  ? createOutcomeReconciliationWorker({
      db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
      logger,
      // Resolvers ship empty here on first boot so unwired entity types
      // close out as 'expired' (with audit) instead of looping. Sibling
      // agents register concrete resolvers via the map as their domains
      // come online (licence renewal, royalty filing, supplier switch,
      // shipment delivery, ...).
      resolvers: {},
      intervalMs:
        Number(
          process.env.BORJIE_OUTCOME_RECONCILIATION_INTERVAL_MS ??
            6 * 60 * 60 * 1000,
        ) || 6 * 60 * 60 * 1000,
      enabled:
        process.env.NODE_ENV !== 'test' &&
        process.env.BORJIE_OUTCOME_RECONCILIATION_DISABLED !== 'true',
    })
  : {
      start() {},
      stop() {},
      async tickOnce() {
        return {
          claimed: 0,
          matched: 0,
          divergent: 0,
          undetermined: 0,
          expired: 0,
          errored: 0,
        };
      },
    };

// Graceful shutdown — documented and tested step-by-step:
//  1. Flip a "shutting down" flag so the /health probe returns 503.
//  2. Tell the HTTP server to stop accepting NEW connections.
//  3. Stop background workers (outbox, heartbeat, scheduler).
//  4. Wait for in-flight requests to drain (server.close()).
//  5. Close DB + Redis (best-effort).
//  6. Exit 0. Force-exit after 10s if drain hangs.
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'shutdown: signal received — starting drain');

  // Step 2 — server.close() stops accepting new requests and calls the
  // callback once every in-flight request has completed. Start the
  // force-kill timer in parallel so a hung request can't pin the process.
  const forceExit = setTimeout(() => {
    logger.error('shutdown: forced exit after 10s drain timeout');
    process.exit(1);
  }, 10_000);
  forceExit.unref?.();

  // Step 3 — stop every background producer before closing sockets so
  // they don't race against a closed pool.
  try {
    stopOutboxWorker();
    logger.info('shutdown: outbox worker stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: outbox stop failed');
  }
  try {
    heartbeatSupervisor.stop();
    logger.info('shutdown: heartbeat supervisor stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: heartbeat stop failed');
  }
  try {
    backgroundSupervisor.stop();
    logger.info('shutdown: background supervisor stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: background stop failed');
  }
  try {
    intelligenceHistorySupervisor.stop();
    logger.info('shutdown: intelligence-history supervisor stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: intelligence-history stop failed');
  }
  try {
    casesSlaSupervisor.stop();
    logger.info('shutdown: cases SLA supervisor stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: cases SLA stop failed');
  }
  try {
    geofenceWatcher.stop();
    logger.info('shutdown: geofence watcher stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: geofence watcher stop failed');
  }
  try {
    leaseExpiryCron.stop();
    logger.info('shutdown: lease-expiry cron stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: lease-expiry cron stop failed');
  }
  try {
    executiveBriefCron.stop();
    logger.info('shutdown: executive-brief cron stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: executive-brief cron stop failed');
  }
  try {
    dailyBriefCron.stop();
    logger.info('shutdown: daily-brief cron stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: daily-brief cron stop failed');
  }
  try {
    icaCertExpiryCron.stop();
    logger.info('shutdown: ica-cert-expiry cron stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: ica-cert-expiry cron stop failed');
  }
  try {
    complianceDeadlineScan.stop();
    logger.info('shutdown: compliance-deadline-scan cron stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: compliance-deadline-scan cron stop failed');
  }
  try {
    entityIndexerWorker.stop();
    logger.info('shutdown: entity-indexer worker stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: entity-indexer worker stop failed');
  }
  try {
    fxFeedCron.stop();
    logger.info('shutdown: fx-feed cron stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: fx-feed cron stop failed');
  }
  try {
    executiveBriefActionRunner.stop();
    logger.info('shutdown: executive-brief action runner stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: executive-brief action runner stop failed');
  }
  try {
    remindersDispatchWorker.stop();
    logger.info('shutdown: reminders-dispatch worker stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: reminders-dispatch stop failed');
  }
  try {
    outcomeReconciliationWorker.stop();
    logger.info('shutdown: outcome-reconciliation worker stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: outcome-reconciliation stop failed');
  }
  try {
    decisionRetrospectiveWorker.stop();
    logger.info('shutdown: decision-retrospective worker stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: decision-retrospective stop failed');
  }
  try {
    serviceRegistry.wakeLoopCron?.stop();
    logger.info('shutdown: wake-loop cron stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: wake-loop cron stop failed');
  }
  try {
    serviceRegistry.idleSessionEmitter?.stop();
    logger.info('shutdown: idle-session emitter stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: idle-session emitter stop failed');
  }
  try {
    serviceRegistry.sessionReplayRetention?.stop();
    logger.info('shutdown: session-replay retention worker stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: session-replay retention stop failed');
  }
  try {
    serviceRegistry.sovereignLedgerVerifyCron?.stop();
    logger.info('shutdown: sovereign-ledger verify cron stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: sovereign-ledger verify cron stop failed');
  }

  // Step 4 — close the HTTP server. Wrapped in a promise so we can
  // await the drain completion.
  await new Promise<void>((resolveDrain) => {
    if (!server) { resolveDrain(); return; }
    server.close(() => { resolveDrain(); });
  });
  logger.info('shutdown: server drained (no in-flight requests)');

  // Step 5 — close DB + Redis. The drizzle client doesn't expose .end()
  // directly; the underlying postgres-js client does. Best-effort only.
  try {
    const maybeClient = (serviceRegistry.db as unknown as {
      $client?: { end?: () => Promise<void> };
    })?.$client;
    if (maybeClient?.end) {
      await maybeClient.end();
      logger.info('shutdown: postgres pool closed');
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: postgres close failed');
  }

  clearTimeout(forceExit);
  logger.info('shutdown: complete, exiting 0');
  process.exit(0);
}

let server: ReturnType<typeof app.listen> | null = null;

// Start server
if (require.main === module) {
  // Initialize Sentry + PostHog analytics at boot — no-ops when DSN/key absent.
  void import('@borjie/observability').then(async (obs) => {
    if (obs.initSentry && obs.installGlobalSentryHandlers) {
      await obs.initSentry({
        dsn: process.env.SENTRY_DSN,
        service: 'api-gateway',
        environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
        release: process.env.GIT_SHA,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
      });
      obs.installGlobalSentryHandlers();
    }
    if (obs.initAnalytics) {
      await obs.initAnalytics({
        apiKey: process.env.POSTHOG_API_KEY,
        host: process.env.POSTHOG_HOST,
        service: 'api-gateway',
        environment: process.env.NODE_ENV,
      });
    }
  }).catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'sentry/analytics init failed');
  });

  server = app.listen(port, () => {
    logger.info({ port }, 'API Gateway started');
  });

  // Wave 12 — start heartbeat + background scheduler after the server
  // is listening. Both are gated by DATABASE_URL internally; degraded
  // mode skips the supervisors gracefully.
  heartbeatSupervisor.start();
  backgroundSupervisor.start();
  intelligenceHistorySupervisor.start();
  // Wave 26 — start the Cases SLA supervisor alongside the other
  // background workers. Skipped in tests + when disabled by env.
  casesSlaSupervisor.start();
  // Geo SOTA 2026-05-29 — start the geofence watcher (no-op when DB
  // is absent or BORJIE_GEOFENCE_WATCHER_DISABLED=true).
  geofenceWatcher.start();
  // Wave 15 — start the lease-expiry alert cron. Ticks daily, scans
  // for leases at 60/30/7/1-day expiry windows, idempotent via
  // notification_dispatch_log.idempotency_key.
  leaseExpiryCron.start();
  // Piece C — executive brief cron. Daily / weekly / monthly subscriptions
  // get briefs generated at their local_time + cadence. ON_DEMAND
  // subscriptions are never auto-fired.
  executiveBriefCron.start();
  // Wave OWNER-OS DAILY-BRIEF rebuild — start the per-tenant daily-brief
  // cron. Ticks every 5 min, fires per tenant when their local
  // `daily_brief_cadence` matches the wall clock; idempotent via
  // UNIQUE constraint on the dispatch ledger.
  dailyBriefCron.start();
  // Wave WORKFORCE-CERT-EXPIRY — 6h cron that scans
  // workforce_certifications for any active cert expiring within 30d
  // and auto-creates reminders at 30d / 14d / 3d (idempotent via
  // UNIQUE(tenant_id, cert_id, days_before)).
  icaCertExpiryCron.start();
  // Roadmap R6 — hourly compliance-deadline scanner. Pushes
  // `compliance.deadline_approaching` events for filings whose
  // due_at lands inside the 7-day horizon.
  complianceDeadlineScan.start();
  // Wave ENTITY-LEGIBILITY — 30-min indexer that embeds + tags + cross-
  // references every entity in the system so the brain can resolve any
  // natural-language phrase and traverse the graph in one hop.
  entityIndexerWorker.start();
  // Live FX feed — pulls BoT TZS/USD + LBMA gold AM/PM fix every 5 min
  // and writes rows into both fx_rates + external_benchmarks.
  fxFeedCron.start();
  // Piece E (issue #41) — drain the approved-actions queue every 10s,
  // dispatch to the junior executor, audit each dispatch.
  executiveBriefActionRunner.start();
  // Wave OWNER-OS — reminders dispatch worker. Polls the `reminders`
  // table every 30s (configurable via BORJIE_REMINDERS_INTERVAL_MS).
  // Email default; SMS / Slack land when the operator wires the keys.
  remindersDispatchWorker.start();
  // Wave CLOSED-LOOP - outcome reconciliation worker. Every 6h walks
  // outcome_predictions whose horizon has elapsed and writes back
  // outcome_observations + outcome_reconciliations, hash-chained.
  outcomeReconciliationWorker.start();
  // Wave DECISION-LEGIBILITY - 24h retrospective worker. For every
  // committed decision whose prediction horizon has passed, joins
  // outcome_reconciliations + outcome_observations, grades the
  // decision (good / bad / neutral / undetermined), and writes the
  // hash-chained retrospective entry via the decision recorder.
  decisionRetrospectiveWorker.start();
  // K7 parity-litfin Gap H — wake-loop cron. Until this start() call the
  // supervisor was inert: the brain only woke when an out-of-band k8s
  // CronJob fired. In-process start arms an advisory-lock-guarded interval
  // so the brain wakes on cadence even when no CronJob is installed.
  // Degraded-mode (no DB) is internally a no-op; safe to call unconditionally.
  serviceRegistry.wakeLoopCron?.start();
  // Central Command Phase B B2 — idle-session emitter supervisor. Scans
  // `sensorium_event_log` every minute and writes a reflexion-buffer entry
  // for every (tenant, user, session) tuple that has gone idle ≥ 5 min.
  // Null in degraded mode; `.start()` is a no-op there.
  serviceRegistry.idleSessionEmitter?.start();
  // Central Command Phase C C4 — session-replay retention purge worker.
  // Hourly tick deletes `session_replay_chunks` older than
  // SESSION_REPLAY_RETENTION_DAYS (default 90) and best-effort purges
  // the cold-store blobs. Null in degraded mode.
  serviceRegistry.sessionReplayRetention?.start();
  // Wave-K Tier-3 — sovereign-ledger verify supervisor. Walks the
  // hash-chain on cadence (default 1h) and emits verified/tampered
  // events on the shared bus. Degraded-mode (no DB) is a no-op.
  serviceRegistry.sovereignLedgerVerifyCron?.start();

  // Start the outbox drainer + register domain-event subscribers. The
  // outbox publishes events into the in-process bus; the subscribers
  // turn those events into customer-visible outcomes (notifications,
  // audit entries). Runner is resolved lazily via the observability
  // event-bus singleton so tests can stub it out.
  void import('@borjie/observability').then((obs) => {
    // Initialize the event-bus singleton first; getEventBus() throws
    // if called without a config on first use. Config is idempotent
    // across calls (the module memoises the first instance).
    let runner: OutboxRunnerLike | undefined;
    try {
      runner = obs.getEventBus?.({
        serviceName: 'api-gateway',
        enableOutbox: true,
      } as unknown as never) as unknown as OutboxRunnerLike | undefined;
    } catch (e) {
      runner = undefined;
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, 'observability: getEventBus init failed');
    }
    if (!runner) {
      runner = (obs as unknown as { eventBus?: OutboxRunnerLike }).eventBus;
    }
    if (runner && typeof (runner as OutboxRunnerLike).processOutbox === 'function') {
      startOutboxWorker(runner as OutboxRunnerLike, {
        logger,
        enabled: process.env.NODE_ENV !== 'test' && process.env.OUTBOX_WORKER_DISABLED !== 'true',
        intervalMs: Number(process.env.OUTBOX_INTERVAL_MS || '5000') || 5000,
        batchSize: Number(process.env.OUTBOX_BATCH_SIZE || '50') || 50,
      });
    } else {
      logger.warn('outbox worker: event bus runner not available; worker not started');
    }

    // Register event subscribers. Same bus reference as the outbox
    // drainer so subscribers receive events the drainer publishes.
    const subscribableBus = runner as unknown as SubscribableBus | undefined;
    if (subscribableBus && typeof subscribableBus.subscribe === 'function') {
      // Minimal HTTP-based notification dispatcher. Posts to the
      // notifications service; a future iteration can swap this for
      // an in-process transport when services are co-deployed.
      const notificationsUrl = process.env.NOTIFICATIONS_SERVICE_URL?.trim();
      const dispatcher: NotificationDispatcher = {
        async send(params) {
          if (!notificationsUrl) {
            // No configured notifications service — log the dispatch so
            // operators see what would have been sent without crashing.
            logger.info({ params }, 'notification dispatch skipped (NOTIFICATIONS_SERVICE_URL unset)');
            return { success: true };
          }
          try {
            const res = await fetch(`${notificationsUrl.replace(/\/$/, '')}/send`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(process.env.INTERNAL_API_KEY ? { 'X-Internal-Key': process.env.INTERNAL_API_KEY } : {}),
              },
              body: JSON.stringify(params),
            });
            if (!res.ok) {
              const text = await res.text().catch(() => '');
              return { success: false, error: `${res.status}: ${text.slice(0, 200)}` };
            }
            return { success: true };
          } catch (err) {
            return { success: false, error: err instanceof Error ? err.message : String(err) };
          }
        },
      };
      // Wave 18 — pass the arrears service through so InvoiceOverdue
      // events open real cases instead of just logging a metric.
      registerDomainEventSubscribers({
        bus: subscribableBus,
        notifications: dispatcher,
        logger,
        arrearsService: serviceRegistry.arrears?.service ?? null,
      });

      // Outbound webhook delivery — subscribe the retry-worker to every
      // `WebhookDeliveryQueued` event emitted by the DLQ admin router
      // and any future point that pushes onto the queue. Without this
      // subscription the events were being published to nowhere and
      // outbound webhooks silently failed.
      //
      // When the database-backed repository is not bound (test runs,
      // local dev without a webhook table) the worker is created
      // anyway but every delivery short-circuits to a single attempt
      // logged at warn level — same shape as the bus-empty path. We
      // never want a partial wire to crash the bus subscriber chain.
      if (serviceRegistry.isLive && serviceRegistry.db) {
        try {
          const webhookRepo = createPostgresWebhookDeliveryRepository(
            serviceRegistry.db,
          );
          const webhookRetryWorker = createWebhookRetryWorker({
            repository: webhookRepo,
            logger,
          });
          subscribableBus.subscribe(
            'WebhookDeliveryQueued',
            async (event) => {
              const payload = (event.payload ?? {}) as Record<string, unknown>;
              if (
                typeof payload['deliveryId'] !== 'string' ||
                typeof payload['tenantId'] !== 'string' ||
                typeof payload['targetUrl'] !== 'string' ||
                typeof payload['eventType'] !== 'string'
              ) {
                logger.warn(
                  { eventType: event.eventType },
                  'webhook-retry: malformed WebhookDeliveryQueued payload',
                );
                return;
              }
              await webhookRetryWorker.processDelivery({
                deliveryId: payload['deliveryId'] as string,
                tenantId: payload['tenantId'] as string,
                targetUrl: payload['targetUrl'] as string,
                eventType: payload['eventType'] as string,
                payload: (payload['payload'] ?? {}) as Record<string, unknown>,
                ...(typeof payload['hmacSecret'] === 'string'
                  ? { hmacSecret: payload['hmacSecret'] as string }
                  : {}),
              });
            },
            { id: 'webhook-retry.queued' },
          );
          logger.info('webhook-retry: subscribed to WebhookDeliveryQueued');
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'webhook-retry: subscription skipped (persistence not ready)',
          );
        }
      }

      // Wave 19 — bridge the domain bus onto the observability bus.
      // Domain services publish through `InMemoryEventBus` (the
      // composition-root bus wired into every service constructor).
      // The api-gateway subscribers registered above attach to the
      // observability `EventBus`. Without this bridge the two buses
      // are disjoint and every domain event is silently dropped.
      //
      // The forwarder flattens the domain `EventEnvelope` into the
      // observability `DomainEvent<T>` shape — subscribers already
      // fall back to `event.eventType ?? event.type`, so both fields
      // are populated.
      const domainBus = serviceRegistry.eventBus as unknown as {
        addForwarder?: (fwd: (env: unknown) => Promise<void> | void) => () => void;
      } | undefined;
      const obsPublish = (runner as unknown as {
        publish?: (event: unknown) => Promise<void> | void;
      }).publish;
      if (
        domainBus &&
        typeof domainBus.addForwarder === 'function' &&
        typeof obsPublish === 'function'
      ) {
        domainBus.addForwarder(async (envelope) => {
          const env = envelope as {
            event?: {
              eventType?: string;
              eventId?: string;
              tenantId?: string;
              timestamp?: string | Date;
              correlationId?: string;
              metadata?: Record<string, unknown>;
              payload?: Record<string, unknown>;
            };
            aggregateId?: string;
            aggregateType?: string;
          };
          const domainEvent = env.event ?? {};
          const eventType = domainEvent.eventType ?? 'UnknownEvent';
          // Build an observability-shaped DomainEvent. `type` is what
          // the observability pattern-matcher and api-gateway
          // subscribers key off of.
          await obsPublish.call(runner, {
            id: domainEvent.eventId ?? `evt_${Date.now()}`,
            type: eventType,
            eventType, // keep both for subscriber fallback
            aggregateType: env.aggregateType ?? 'Unknown',
            aggregateId: env.aggregateId ?? 'unknown',
            timestamp: domainEvent.timestamp ?? new Date(),
            timestampMs: Date.now(),
            version: 1,
            payload: domainEvent.payload ?? {},
            metadata: {
              sourceService: 'domain-services',
              tenantId: domainEvent.tenantId,
              correlationId: domainEvent.correlationId,
              ...(domainEvent.metadata ?? {}),
            },
          });
        });
        logger.info('event-bus bridge: domain bus → observability bus wired');
      } else {
        logger.warn(
          'event-bus bridge: forwarder unavailable; domain events may not reach api-gateway subscribers',
        );
      }
    } else {
      logger.warn('event subscribers: bus.subscribe not available; subscribers not registered');
    }
  }).catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'failed to load observability for outbox worker');
  });

  process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
  process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
}

export default app;
