/**
 * @borjie/api-gateway
 *
 * API Gateway / Backend-for-Frontend for the BORJIE platform.
 * Handles authentication, authorization, request routing, and aggregation.
 */

// Auto-load .env FIRST — before any module reads process.env. Look at
// repo root (cwd/../../.env from services/api-gateway) and the service
// folder. Tests + prod skip via BORJIE_SKIP_DOTENV=true.
import { config as loadDotenv } from 'dotenv';
import { resolve as resolvePath } from 'node:path';
if (!process.env.BORJIE_SKIP_DOTENV) {
  // cwd when started via `pnpm dev` is services/api-gateway. Repo root is 2 up.
  // override=true ensures stale shell exports (e.g. empty ANTHROPIC_API_KEY
  // left in a previous terminal) don't beat the canonical .env values.
  loadDotenv({ path: resolvePath(process.cwd(), '../../.env'), override: true });
  loadDotenv({ path: resolvePath(process.cwd(), '.env'), override: true });
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
import { brainRouter } from './routes/brain.hono';
// Borjie HOME teaching chat — /api/v1/brain/teach. Surpasses LitFin's
// /api/chat/exploration register with multi-block teaching, 5-step
// lesson ladder, tenant-grounded examples, and mandatory citation
// chain. Sibling mount under /brain so Hono composes it next to the
// existing /turn route without touching the kernel.
import { brainTeachRouter } from './routes/brain-teach.hono';
import { maintenanceRouter } from './routes/maintenance.hono';
import { hrRouter } from './routes/hr.hono';
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
// Public marketing surface — pilot applications + future PR contact
// forms. No tenant context; runs outside the auth chain on purpose.
import { marketingRouter } from './routes/marketing.hono';
import { translateRouter } from './routes/translate.hono';
import { createPilotErrorsRouter } from './routes/pilot-errors.hono';
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
import {
  registerDomainEventSubscribers,
  type SubscribableBus,
  type NotificationDispatcher,
} from './workers/event-subscribers';
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
import { ownerBriefRouter } from './routes/owner/brief.hono';
import { ownerDailyBriefRouter } from './routes/owner/daily-brief.hono';
import {
  workforceTabConfigOwnerListRouter,
  workforceTabPolicyAdminRouter,
} from './routes/workforce/tab-configs-extras.hono';import { createRemindersDispatchWorker } from './workers/reminders-dispatch.worker';
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
import { setBrainExtraSkills } from './composition/brain-extensions';
import { createDrizzleDraftPersistence } from './services/document-drafter';
import { buildDocumentDrafterTools } from './services/document-drafter/brain-tools';
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
// Skip express.json() for /api/v1 paths — those are handled by the
// Hono sub-app which consumes the raw request body itself. Running
// express.json() first would drain the body stream and Hono would
// see an empty request. No Express handler outside /api/v1 reads
// req.body today, but we keep the parser for potential future use.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/v1')) return next();
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

  setBrainExtraSkills([orgSkill, ...draftTools]);
  logger.info(
    { drafterToolCount: draftTools.length },
    'brain-extensions: org.query_organization + document-drafter skills wired',
  );
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
  ],
});
app.get('/api/v1/health/deep', (req, res) => {
  void deepHealthHandler(req, res);
});

const api = new Hono();
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
api.route('/brain', brainRouter);
// Sibling /brain mount for the teaching chat — Hono composes both
// routers under the same prefix; brainRouter already owns /turn,
// /threads, /personae, /migrate so the only path brainTeachRouter
// claims is /teach. Additive: NEVER touches /turn behaviour.
api.route('/brain', brainTeachRouter);
api.route('/maintenance', maintenanceRouter);
api.route('/hr', hrRouter);
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
api.route('/owner/reminders', ownerRemindersRouter);
api.route('/owner/tabs', ownerTabsRouter);
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
    { prefix: '/maintenance', app: maintenanceRouter, defaultTag: 'maintenance' },
    { prefix: '/hr', app: hrRouter, defaultTag: 'hr' },
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
      intervalMs: Number(process.env.BORJIE_REMINDERS_INTERVAL_MS ?? 30_000) || 30_000,
      enabled: process.env.NODE_ENV !== 'test' && process.env.BORJIE_REMINDERS_WORKER_DISABLED !== 'true',
    })
  : { start() {}, stop() {}, async tickOnce() { return { claimed: 0, sent: 0, failed: 0 }; } };

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
  // Piece E (issue #41) — drain the approved-actions queue every 10s,
  // dispatch to the junior executor, audit each dispatch.
  executiveBriefActionRunner.start();
  // Wave OWNER-OS — reminders dispatch worker. Polls the `reminders`
  // table every 30s (configurable via BORJIE_REMINDERS_INTERVAL_MS).
  // Email default; SMS / Slack land when the operator wires the keys.
  remindersDispatchWorker.start();
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
