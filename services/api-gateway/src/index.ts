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
import { sql as drizzleSqlTag } from 'drizzle-orm';
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
// Dark-router wave — self-service GDPR Art.15/17/20 + TZ-PDPA s.27/28
// surface (data-export + erasure of the CALLER's own account). Auth-scoped
// to the caller; cannot read or erase anyone else's data.
import { createUsersMeRouter } from './routes/users-me.router';
// Dark-router wave — declared-facts producer (the only user-facing path
// that writes into the kernel's semantic memory). Real db-backed service,
// auth + tenant + user scoped, per-user rate-limited.
import memoryDeclareRouter from './routes/memory-declare.router';
import { notificationsRouter } from './routes/notifications';
import { onboardingRouter } from './routes/onboarding';
import { onboardingFlowRouter } from './routes/onboarding.router';
import { feedbackRouter } from './routes/feedback';
import { genuiTelemetryRouter } from './routes/genui-telemetry.hono';
import { complaintsRouter } from './routes/complaints';
// Piece C — MD Executive Brief routes (briefs + briefing subscriptions).
import {
  executiveBriefRouter,
  briefingSubscriptionRouter,
} from './routes/executive-brief.hono';
// REMOVED (borjie hard-fork): casesRouter — residential-property residue;
// the `cases` table was dropped in 0003_mining_domain.sql.
// Mining-domain backends (Wave MINING-BACKENDS) — six new scopes shipped
// as siblings to the existing /mining surface. Each carries chat-as-OS
// parity (both explicit tab + chat reach same backend) via persona tool
// handlers registered in composition/brain-tools/mining-domain-tools.ts.
import { geologyRouter } from './routes/geology/index';
import { productionRouter } from './routes/production/index';
import { cooperativesRouter } from './routes/cooperatives/index';
import { insuranceRouter } from './routes/insurance/index';
import { ownerThreadsRouter } from './routes/owner/messaging/threads.hono';
// Wave KNOWLEDGE-HANDOFF — cross-role @mention handoff (migration 0137).
// Persists the brain's `<chat_handoff />` SSE tag, fires notifications
// to the recipient, and bubbles the reply back to the source chat.
import { ownerHandoffRouter } from './routes/owner/handoff.hono';
// INV-A / FIRE-1 — tenant-visible break-glass Trust Center (consent / deny /
// revoke + the hash-chained access-transparency log for this tenant).
import { ownerBreakGlassRouter } from './routes/owner/break-glass.hono';
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
// RT-3 (2026-05-29) realtime latency telemetry.
//   POST /api/v1/metrics/realtime-latency — SSE clients post measurements.
//   GET  /api/v1/observability/realtime    — owner cockpit reads P50/P95/P99.
import { realtimeLatencyRouter } from './routes/metrics/realtime-latency.hono';
import { observabilityRealtimeRouter } from './routes/observability/realtime.hono';
// Roadmap R8 — universal personal-KB UI surfaces. Routes:
//   GET /me/persons/links
//   GET /me/persons/:personId/cells
//   GET /brain/personal-kb/search
import { personalKbRouter } from './routes/personal-kb.hono';
// Roadmap R9 — smart-compose ghost text endpoint
// (POST /brain/compose/suggest).
import { brainComposeRouter } from './routes/brain-compose.hono';
// Wave MD-INTELLIGENCE — Managing-Director cross-domain HTTP surface
// (POST /md/correlations, /md/causation/trace, /md/baselines/compare,
// /md/insights/emit) backing the four MD brain super-power tools.
import { mdRouter } from './routes/md/index.hono';
import { pnlTableRouter } from './routes/bff/pnl-table.hono';
// Roadmap R12 — Discord-style tenant switcher backend
// (GET /me/tenants + POST /me/tenants/active).
import { meTenantsRouter } from './routes/me-tenants.hono';
import { membershipsRouter } from './routes/memberships.hono';
// JA-7 — owner-facing jurisdiction snapshot endpoint
// (GET /me/jurisdiction) backing the settings/jurisdiction page.
import { meJurisdictionRouter } from './routes/me-jurisdiction.hono';
// Progressive-disclosure surfaces — serve the two previously-dark
// super-powers (MasteryGate + LearnedShortcutsPanel) from the caller's
// user_action_tracker rows (GET /me/mastery, GET /me/shortcuts).
import { meMasteryRouter } from './routes/me-mastery.hono';
import { meShortcutsRouter } from './routes/me-shortcuts.hono';
// Bidirectional notification receiver loop — push token registry
// (GET/POST /me/device-tokens, DELETE /me/device-tokens/:id).
// Mobile apps call this on successful login so the dispatcher can
// resolve every active token for a user before fanning out a push.
import { meDeviceTokensRouter } from './routes/me/device-tokens.hono';
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
// EA-05 — cross-surface CRDT state-bus front door. set/read/list/handoff over
// the durable blackboard slot store; the slot lives once + re-projects onto
// every surface via the realtime `state-bus` topic.
import { blackboardRouter } from './routes/blackboard.hono';
// Gap 6 — VP department-head dispatch. /api/v1/brain/dispatch resolves one
// of the five VPs by name via the central-intelligence registry, orchestrates
// a free-form owner/admin instruction into a line-worker plan, and runs each
// sub-MD's four-stage pipeline fail-soft (honest-degrade, never fabricated).
// Sibling /brain mount; the only path it claims is /dispatch.
import { brainDispatchRouter } from './routes/brain-dispatch.hono';
// SOTA realtime-voice BACKEND — a WS endpoint at /api/v1/brain/voice/stream
// that bridges the owner's mic to a duplex model (Gemini Live) in front of
// the real Borjie brain (mining persona + tool-calling + tenant binding).
// Attached to the HTTP server in the listen block (it is a WS-upgrade, not a
// Hono route). The attach NO-OPS with a Pino warning until a WS-upgrade
// transport (`ws` / `@hono/node-ws`) is wired — see the route file's
// §RUNTIME-FLAGS. Does not affect gateway boot when inactive.
import {
  attachBrainVoiceWebSocket,
  type WebSocketServerLike,
  type ClientSocketLike,
} from './routes/brain-voice.hono';
import { buildPortalGenuiWiring } from './composition/portal-genui/portal-genui-wiring';
import {
  setEvidenceExistenceVerifier,
  createCorpusEvidenceVerifier,
} from './composition/chat-response-gate';
import { buildResearchWiring } from './composition/research/research-wiring';
import { scheduleProactive } from './composition/proactive/proactive-wiring';
// Wave 1 EstateMind — the resident per-tenant Slow Loop heartbeat. init reads
// flag BORJIE_ESTATE_MIND ONCE (DEFAULT-ON dual-sink — only off/0/false/no
// disables); the supervisor is leader-gated at its .start() site below.
// Additive: nothing on the per-request think(req) path changes.
import {
  initEstateMind,
  createEstateMindSupervisor,
  createMdCommitmentReconciliation,
  buildEstateMindSnapshotReader,
  createTabEventLogProposalSink,
} from './composition/estate-mind-wiring';
// Living-MD organ — the felt loop that closes over the durable md_commitments
// substrate (per-turn plan re-read + deferred resurfacing + hash-chained
// timeline). Composed at the mdCommitmentBundle site; its someday-review
// supervisor is leader-gated at its .start() site like every other cron.
import {
  createLivingMdOrgan,
  type LivingMdOrgan,
} from './composition/living-md/living-md-wiring';
import { registerMdEventBridge } from './composition/living-md/event-subscriber-wiring';
import { configureLivingMdTurnHooks } from './routes/mining/chat-orchestrator';
import { livingPlanRouter } from './routes/owner/living-plan.hono';
import { commitmentGovernanceRouter } from './routes/owner/commitment-governance.hono';
// SELF-RUNNING-ORG SPINE (org-loop) — the gap→strategize→pick→assign→dispatch→
// deliver→report→close thread over the living-MD commitment substrate. The
// orchestrator composes the G0-G3 ports; the binder closes the loop in real
// time off the cockpit bus tap; assignTask() (the previously-dark write path)
// fires through the composed WorkforceDeps.
import { createWorkforceDeps } from './composition/org-loop/workforce-deps-wiring';
import { createTaskDispatchPort } from './composition/org-loop/task-dispatch-port';
import { createPersonMatcher } from './composition/org-loop/person-matcher-wiring';
import { createStrategizePort } from './composition/org-loop/strategize-port';
import { createGapBriefingPort } from './composition/org-loop/gap-briefing-port';
import {
  createOrgLoopOrchestrator,
  ORG_LOOP_CRON_NAME,
} from './composition/org-loop/org-loop-orchestrator';
import { createTaskCommitmentBinder } from './composition/org-loop/task-commitment-binder';
import { createDrizzleOrgLoopRunRepository } from '@borjie/database';
import { withServiceRoleContext, withTenantContext } from '@borjie/database';
import { tapCockpitEvents } from './services/cockpit-events';
// HITL approval consumer — the owner's approve/dismiss verbs over parked
// HIGH/sovereign org-loop runs (late-bound to the orchestrator; 503 until
// the spine composes).
import {
  orgLoopApprovalsRouter,
  registerOrgLoopApprovalActions,
} from './routes/owner/org-loop-approvals.hono';
// Wave-C C3 WIN-3/4 — the THREE graded-corrective + closed-loop organs that make
// the homeostatic controller ACT: the drive-context resolver (commitment → REAL
// drive severity from the live snapshot), the driveId → drafter registry (the
// mid-rung PROPOSE-ONLY corrective), and the durable set-point store (did-it-
// recover? auto-promote). Constructed at the md-commitments wiring site below.
import { createDriveContextResolver } from './composition/md-commitments/drive-context-resolver';
import { createDrafterRegistry } from './composition/md-commitments/drafter-registry';
// B8 — EstateMind PERCEPTION source over the live estate tables (the missing
// sensor that populates the situational model so proactive proposals emit).
import {
  createEstateMindPerceptionFromDb,
  resolveDriveThresholdsFromBaselinesDb,
} from './composition/estate-mind-perception';
// Wave-C C3 WIN-2 — the reflexion buffer that turns a divergent outcome-
// reconciliation into a durable lesson (the SAME service sovereign.ts builds for
// the chat path), so the self-correcting-memory loop fires on the live worker.
import { createReflexionBufferService } from '@borjie/database';
// Wave-C C4 — the live ambient behaviour-signal source for the proactive worker's
// affect gate (constructed in sovereign.ts over the sensorium event log).
// `getAffectAccumulator(tenantId)` returns the SAME per-tenant ToM accumulator
// the chat turns write to, so the worker's earned-trust resolver reads a LIVE
// trust posterior (adapts) instead of a static neutral default.
import {
  getProactiveBehaviorSignalSource,
  getAffectAccumulator,
} from './composition/sovereign';
// Wave-C C4 — owner-style posture reader source (the FIRST live consumer of the
// durable owner-style posterior). `getProfile(tenantId).posture.value` →
// cautious|balanced|bold tilts the earned-trust autonomy floor.
import { createOwnerStyleService } from '@borjie/ai-copilot';
import { createPgOwnerStyleProfileStore } from '@borjie/database/repositories';
// B5 — control-plane LLM-routing config reader. Installs the routing-config
// reader once at boot so admin-tuned LLM config is honored by the resolver.
import { initLlmRoutingConfig } from './composition/llm-routing-config-wiring';
// MD DEFERRAL / FOLLOW-THROUGH bundle — built once in the brain-tools wiring
// block (repo + reconcile engine + WaitFor event subscriber) and referenced at
// the EstateMind supervisor site so the reconcile sweep is injected into the
// resident Slow Loop. Null when no db handle is present.
let mdCommitmentBundle: ReturnType<typeof createMdCommitmentReconciliation> =
  null;
// The living-MD organ — composed at the mdCommitmentBundle site so the chat
// turn re-reads the durable plan, the deferred/someday work resurfaces on its
// own clock, and every lifecycle transition lands on the hash-chained timeline.
// Module-level so the cron seam, route mount, event-bridge, and shutdown block
// can all reach the single composed instance. Null when no db handle is present.
let livingMd: LivingMdOrgan | null = null;
// The self-running-org SPINE orchestrator (org-loop). Composed beside the
// living-MD organ (it reads the same commitment substrate); leader-gated at
// its .start() site; stopped on shutdown. Null when no db handle is present.
let orgLoopOrchestrator: ReturnType<typeof createOrgLoopOrchestrator> | null =
  null;
// Wave-C C3 WIN-3 — the graded-corrective ladder ceiling. Resolve the tenant
// delegation cap for the md_commitments homeostatic controller from the env at
// bootstrap (the only place process.env is read). It is CLAMPED — it can be set
// DOWN ('nudge' / 'draft') but is NEVER raised above 'delegate' (the owner-direct
// HITL safe-halt); an unknown / unset value defaults to the full graded ladder.
function resolveMdAutonomyCap(
  raw: string | undefined,
): import('./composition/md-commitments/reconcile-engine').AutonomyCap {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'nudge') return 'nudge';
  if (v === 'draft') return 'draft';
  // 'delegate', anything else, or unset → the full graded ladder (still HITL at
  // the top rung; money/licence stay HITL forever regardless of the cap).
  return 'delegate';
}
// Wave 1 OK-3 — blackboard control-shell scheduler. The Hayes-Roth 1985
// metalevel scheduler: on every slot convergence it maps the region + its
// candidate KnowledgeSources (the distinct slot writers) through the control
// shell and proposes the single KS to act next — PROPOSE-ONLY, audit-plane
// only (it never invokes the KS, never reaches a client). DEFAULT-ON
// kill-switch (BORJIE_CONTROL_SHELL); the cross-replica `start(tenantId)` is
// leader-gated below. Convergence is wired via registerSlotConvergedListener.
import {
  createControlShellWiring,
  createTabEventLogActivationSink,
  createControlShellConnectSupervisor,
  createActiveTenantSource,
  type ActiveTenantSource,
} from './composition/control-shell-wiring';
import { registerSlotConvergedListener } from './composition/blackboard-slots-wiring';
import { createPinoLikeLogger } from './utils/pino-shim';
import { createCalendarRouter } from './routes/owner/calendar.hono';
import { createCalendarChannelFromEnv } from './services/notification-dispatch/calendar-providers/index';
// REMOVED (borjie hard-fork): property-mgmt maintenance + hr routers — Borjie
// uses /api/v1/mining/maintenance (asset events) + workforce schemas instead.
// Borjie mining-domain sub-app — see services/api-gateway/src/routes/mining/index.ts
import { miningRouter } from './routes/mining/index';
// Wave 1-2 routers (new domain features)
import applicationsRouter from './routes/applications.router';
// REMOVED (borjie hard-fork): import arrearsRouter from './routes/arrears.router';
import complianceRouter from './routes/compliance.router';
import compliancePluginsRouter from './routes/compliance-plugins.router';
// Issue #194 chain C-A — regulator data-subject-request inbox
// (`/api/v1/regulator/requests/*`).
import { createRegulatorRequestsRouter } from './routes/regulator';
import { RegulatorRequestService } from './services/regulator/request-service';
// Issue #194 chain C-B — licence renewal full flow
// (`/api/v1/compliance/licences/:id/renewal/*`).
import { createLicenceRenewalRouter } from './routes/compliance/licences/renewal.hono';
import { LicenceRenewalService } from './services/regulator/licence-renewal-service';
// Issue #194 chain C-C — AI-assisted inspection narratives
// (`/api/v1/compliance/inspections/:id/narrative/*`).
import { createInspectionNarrativeRouter } from './routes/compliance/inspections/narrative.hono';
import { InspectionNarrativeService } from './services/inspection-narrative/generator';
// Issue #194 chain C-B watcher — fires expiring-licence reminders.
import { startLicenceRenewalWatcher } from './workers/licence-renewal-watcher';
import docChatRouter from './routes/doc-chat.router';
import documentRenderRouter from './routes/document-render.router';
import financialProfileRouter from './routes/financial-profile.router';
// REMOVED (borjie hard-fork): import gamificationRouter from './routes/gamification.router';
// REMOVED (borjie hard-fork): import gepgRouter from './routes/gepg.router';
import interactiveReportsRouter from './routes/interactive-reports.router';
import lettersRouter from './routes/letters.router';
import { marketplaceRouter } from './routes/marketplace.router';
// MS-3 — universalMarketplaceRouter import removed (dead property-residual
// `/marketplace-universal` surface unmounted; cross-org browsing is served
// by the mining marketplace + RFB routers).
// Roadmap R11 — buyer-initiated Request for Bids. Buyers post
// "I want N tonnes of X at TZS Y by D"; sellers in the geo radius
// respond with counter-offers. Migration 0127.
import { rfbRouter } from './routes/marketplace/rfb.hono';
// Commercial chain L7 — buyer fulfilment notification queue.
// Migration 0132. RLS-scoped to the buyer's tenant on read.
import { buyerNotificationsRouter } from './routes/buyer/notifications.hono';
// B6 — buyer-persona superpowers (bulk-action / undo-last / pinned-items /
// search). Mirrors the owner superpowers wiring, persona-guarded to 'buyer'.
import { buyerSuperpowersRouter } from './routes/buyer/superpowers.hono';
import { buyerTabProjectionRouter } from './routes/buyer/tab-projection.hono';
import { buyerInquiriesRouter } from './routes/mining/flows/inquiry-flow.hono';
// Commercial chain L8 — settlement orchestrator entry point.
// Drives LedgerService.post() + M-Pesa B2C payout on buyer sign-delivery.
import { rfbResponsesRouter } from './routes/marketplace/rfb-responses.hono';
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
// LP-25 / LP-30 — unified channel ingress (whatsapp/sms/voice/email/web)
// + feature-phone USSD session webhook. Signature-verify-first, then
// sender->tier resolution and cross-channel state-sync. See route file.
import { createChannelsRouter } from './routes/channels.hono';
// Piece L brain↔tab loop — module update proposals (CRUD + approval).
import proposalsRouter from './routes/proposals.hono';
// Scope segmentation taxonomy + nodes (Wave SCOPE-SEGMENTATION).
import { scopeRouter } from './routes/scope/index';
// Workforce invitations (owner-issued; worker self-activation).
import { workforceInvitesRouter } from './routes/workforce/invites.hono';
// Workforce openings + manager review (issue #193, HR onboarding chain L-A).
import { workforceOpeningsRouter } from './routes/workforce/openings.hono';
// Owner payroll runs + commit (issue #193, payroll chain L-B).
import { ownerPayrollRouter } from './routes/owner/payroll.hono';
// Piece G — GenUI artifact render endpoints. Uses a not-wired service
// stub so /types is always live; /:id/render returns 404 until the
// real Playwright + DB-backed service is bound (issue #33).
import { createArtifactsRouter } from './routes/artifacts.hono';
import { createModalityArtifactsRouter } from './routes/modality-artifacts.hono';
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
import publicSandboxRouter from './routes/public-sandbox.router';
import publicLeadsRouter from './routes/public-leads.router';
// Borjie marketing-widget public chat — unauthenticated SSE stream of
// curated Borjie-about-Borjie responses, consumed by FloatingAskBorjie
// in the marketing site. Mounted at /api/v1/public/chat (more specific
// path than the legacy /public mount so the Borjie handler wins).
import publicChatRouter from './routes/public-chat.hono';
// Borjie marketing SAFE-LIST tools — replaces the prior HARD FORBID on
// the public surface with a positive allowlist of public, read-only,
// no-auth tools (capabilities, jurisdiction, pricing, regulation,
// commodity price, case study, demo booking, concept cards). Wired at
// /api/v1/public/tools/:name; the router exports the per-session 10/min
// rate limit inline so the mount is a single api.route call.
import publicToolsRouter from './routes/public-tools.hono';
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
import flowAutonomyRouter from './routes/workflow/flow-autonomy.js';
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
// REMOVED (borjie hard-fork): platform-overview.router queried deleted
// property tables (units, payments) — dead since the property→mining migration.
// Phase B Wave 30 — Task-Agents registry + executor (narrow-scope agents)
import taskAgentsRouter from './routes/task-agents.router';
// Wave 27 Agent E — Tenant Branding (per-tenant AI persona identity overrides)
import tenantBrandingRouter from './routes/tenant-branding.router';
// Phase D D7 — Persona Registry admin surface (SUPER_ADMIN / ADMIN only).
// Reads `services.personaRegistry` (kernel PersonaRegistry hydrated from
// the Drizzle-backed store). Returns 503 NOT_IMPLEMENTED when slot is null.
import personaRegistryRouter from './routes/persona-registry.router';
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
// Regulator-facing Chain-of-Thought reservoir (GDPR Art.15 / TZ-PDPA s.13 DSAR
// read-back, PII-scrubbed, admin-role + tenant-scoped). Was BUILT + unit-tested
// but never mounted — admin-web's mission-eval CoT panel had no backend. Now
// reachable at /admin/cot-query/query.
import cotQueryRouter from './routes/cot-query.router';
// Persona-drift events read surface (KI-011). admin-web's persona-drift screen
// polls GET /api/v1/persona-drift/events; the route was never mounted, so the
// screen showed a permanent "Could not load" alert. Admin-role + tenant-scoped
// (RLS-bound) read of the persisted kernel_persona_drift_events breaches.
import createPersonaDriftRouter, {
  type PersonaDriftEventRow,
} from './routes/persona-drift.router';
// Generative jurisdiction unlock — promote a learned country into the launch
// market (enabled_countries, migration 0337). Seeded TZ-only; new markets are a
// governed row, not a deploy. Backs mwikila.jurisdiction.promote.
import { createJurisdictionPromotionRouter } from './routes/admin/jurisdiction-promotion.hono';
// Universal integration fabric — the ONE governed route over the 21 dormant
// connector packages (Slack / email / calendar / CRM / devtools / social …).
// Generic dispatch over composition/connector-catalog.ts; backs the
// integration.connector.{list,invoke} brain tools. Honest-degrades when a
// connector is not connected or its runtime invoker is not provisioned.
import { createConnectorsRouter } from './routes/integrations/connectors.hono';
// LAST outward-reach seam — bind the REAL runtime invokers behind the connector
// fabric + legacy-portal route. Both honest-degrade (credential / env-gated):
// connectorInvokers executes a live action only when the tenant HAS connected
// the account AND the provider env + cipher key are provisioned; legacyPortalFileKra
// drives a live (lazy) Playwright portal only when LEGACY_PORTAL_LIVE + a vault
// are set. Governance unchanged — both stay HIGH-gated by their brain tools upstream.
import { createConnectorInvokers } from './composition/connector-invokers-wiring';
import { createLegacyPortalLiveWiring } from './composition/legacy-portal-live-wiring';
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
// REMOVED (borjie hard-fork): unit-subdivision + unit-components routers
// queried deleted property tables (units, assetComponents) — dead since the
// property→mining migration.
import { rateLimitMiddleware } from './middleware/rate-limit.middleware';
import { createRateLimitMiddleware } from './middleware/rate-limit-redis.middleware';
import { getSharedPerTenantRateBudget } from './middleware/per-tenant-rate-budget';
import {
  startOutboxWorker,
  stopOutboxWorker,
  type OutboxRunnerLike,
} from './workers/outbox-worker';
// REMOVED (borjie hard-fork): createCaseSLASupervisor — residential-property
// residue; the `cases` table was dropped in 0003_mining_domain.sql.
// Geo SOTA 2026-05-29 — geofencing service + watcher worker. Backed by
// PostGIS (migration 0130). Watcher ticks every 30s, emits
// worker_offsite_alert + worker_in_hazard_alert. See
// Docs/RESEARCH/GEO_SOTA_2026-05-29.md §2.
import { createGeofencingService } from './services/geofencing/index.js';
import {
  createGeofenceWatcher,
  type GeofenceAlertSink,
} from './workers/geofence-watcher.js';
import { createLicenceExpiryAlertCron } from './workers/licence-expiry-alert-cron';
import { isWithinQuietHours } from './workers/reminders-quiet-hours';
// H2 deferral closure — idempotency_keys cron (mig 0154). Deletes
// rows past `expires_at` hourly so the dedup table doesn't grow
// forever. The partial unique index keeps duplicate requests dedup'd
// even between sweeps.
import { registerIdempotencySweeperCron } from './composition/idempotency-sweeper';
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
// Deep-health admin gate — role derived from the VERIFIED bearer JWT, never
// a client-supplied header.
import { verifyJwt, extractBearerToken } from './middleware/auth-core';
import { customerAppRouter } from './routes/bff/customer-app';
import { ownerPortalRouter } from './routes/bff/owner-portal';
// Endpoint wave — owner group/holdings rollup. Mounted at the specific
// `/owner/group-rollup` prefix BEFORE the broad `/owner` BFF so the
// specific path wins Hono trie resolution.
import { ownerGroupRollupRouter } from './routes/owner/group-rollup.hono';
// REMOVED (borjie hard-fork): estate-manager-app BFF served property-era
// dashboards (work orders, inspections, vendors, units, arrears) over tables
// dropped in migration 0003 — dead since the property→mining migration.
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
// admin-rest-3 — cross-tenant subscription / MRR overview for the admin-web
// Platform → Subscriptions page. Thin aggregator over the `tenants` index,
// platform-admin gated. Honest-degrades to an empty envelope + note when no
// DB / no billing table.
import { adminSubscriptionsRouter } from './routes/admin/subscriptions.hono';
// Wave OWNER-OS — owner cockpit OS surface (docs intake + drop-zone,
// regulator-form drafter, reminders CRUD + dispatcher, dynamic tabs,
// per-tenant advisor slice on /owner/brief). See:
//   services/api-gateway/src/routes/owner/{docs,forms,reminders,tabs,brief}.hono.ts
//   services/api-gateway/src/workers/reminders-dispatch.worker.ts
//   packages/database/src/migrations/0089_owner_reminders_and_tabs.sql
import { ownerDocsRouter } from './routes/owner/docs.hono';
import { ownerFormsRouter } from './routes/owner/forms.hono';
import { ownerRemindersRouter } from './routes/owner/reminders.hono';
// Wave SELF-ACTING-MD K5 — owner notification-preference write path. Lets the
// owner set an ORDERED channel priority (honoured by the reminders dispatcher's
// deliverable-channel resolver). Closes the "no write path for prefs" gap.
import { ownerContactPrefsRouter } from './routes/owner/contact-prefs.hono';
import { ownerTabsRouter } from './routes/owner/tabs.hono';
// Wave CHAT-ACTIONS — the chat→action EXECUTION bridge. The cockpit chat
// (/api/v1/brain/teach) emits action chips; these endpoints actually
// EXECUTE the SAFE ones (reminders today) through the fail-closed
// auto-authorize gate + the typed executor registry, then append a
// hash-chained audit row. See:
//   services/api-gateway/src/routes/owner/chat-actions.hono.ts
//   services/api-gateway/src/services/action-executor/
import { ownerChatActionsRouter } from './routes/owner/chat-actions.hono';
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
// Admin-side bulk-action surface — distinct whitelist + 4-eye approval
// for HIGH-impact verbs (suspend tenant, regulator-pack export, etc).
import { adminSuperpowersRouter } from './routes/admin/superpowers.hono';
// JC-7 admin jurisdiction override — four-eye PROPOSE -> APPROVE flow
// (a tenant cannot self-change jurisdiction; only Borjie internal admin
// can, via a DIFFERENT second admin). Auth-guarded factory built from the
// composition-root Drizzle adapters (migration 0322 jurisdiction_proposals).
import { createMountedAdminTenantJurisdictionRouter } from './composition/jurisdiction-override-wiring';
// Damage-settlement (migration 0279) — contractor / site damage claims +
// mine-rehabilitation action-plan approval. Backs the site.damage_claim.* /
// site.rehabilitation.approve_plan brain tools. Ported from the BN dispute /
// damage-deduction + conditional-survey stack, retargeted real-estate → mining.
import { damageClaimsRouter } from './routes/damage-claims.hono';
// Org / team-management (migration 0280) — staff create / KPI / task /
// escalation / bulk-CSV write surface. Backs the staff.* brain tools. Ported
// from the BN org/team-management stack, retargeted real-estate → mining.
import { orgAdminRouter } from './routes/org-admin.hono';
// Training scenarios + mastery checkpoint (migration 0283) — owner-cockpit
// rehearsal surface. GET /, POST /generate, POST /sessions(+/:id/turn,
// /:id/complete), GET /checkpoint, POST /checkpoint/submit. Concept-catalog-
// grounded (never fabricated); honest-degrades to a typed 503 when the DB
// client is unset. Backs owner-web /training/scenarios + /training/checkpoint.
// Ported from the BN training-scenarios stack, retargeted real-estate → mining.
import { scenariosRouter } from './routes/scenarios.hono';
// AI course-generation (migration 0284) — owner-cockpit create-course surface.
// POST /generate (202 + detached generation), GET /, GET /:id. Honest-degrades
// to a typed 503 when the DB client is unset, and to the deterministic concept-
// catalog sequencer when no LLM key is configured (provenance 'deterministic').
// Backs owner-web /training/create-course + /training/course/[id]. Ported from
// the BN course-gen stack, retargeted real-estate → mining.
import { coursesRouter } from './routes/courses.hono';
// Agentic plan / subagent + sandbox-preview (migration 0281) — plan-mode /
// agent-teams / worktree-style sandbox write surface. Backs the plan.* /
// sandbox.* brain tools. Ported from the BN md-agentic stack, retargeted
// real-estate → mining.
import { mdAgenticRouter } from './routes/md-agentic.hono';
// Admin Control Tower — cross-tenant toggles wired to REAL platform state
// (kill-switch / feature flags / rate caps), four-eye gated + SOC2 audited.
import { adminControlTowerRouter } from './routes/admin/control-tower.hono';
// Admin Control Plane — Borjie-internal control plane over the brain: power
// flags (global + per-tenant), LLM core+ordered-fallbacks+ensemble+per-use-case
// routing, model catalog, and the suggest-only AI recommender. Admin-only auth;
// no tenant business data; every mutation hash-chain audited.
import { adminControlPlaneRouter } from './routes/admin/control-plane.hono';
import { ownerBriefRouter } from './routes/owner/brief.hono';
import { ownerDailyBriefRouter } from './routes/owner/daily-brief.hono';
// Real Holt-Winters forecasts (cash-flow, production, royalty) wired
// to live Drizzle aggregates over `sales` + `shift_reports`. Returns
// calibrated point + 95% interval per future day. No stubs.
import { ownerForecastsRouter } from './routes/owner/forecasts.hono';
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
// Wave 2 — self-acting-MD workers: proactive-intel insight loop + KG auto-sync.
import {
  createProactiveIntelWorker,
  type ProactiveOwnerResolver,
  type ProactivePostureReader,
  type ProactivePosture,
} from './workers/proactive-intel.worker';
import { createKgSyncWorker } from './workers/kg-sync.worker';
// Wave 3 — the proactive worker's LIVE per-tenant data feed; the self-build
// (gap→spec→generate→propose) operator-gated route.
import { createTickInputsProvider } from './composition/proactive/tick-inputs-provider.js';
import { internalModulesRouter } from './routes/internal/modules.hono';
// Wave ENTITY-LEGIBILITY-WIRE — the six entity.* brain tools POST to
// /internal/entity-legibility/* over the loopback client but NO router was
// mounted there, so every call 404'd and the tools fell to their empty stub.
import { internalEntityLegibilityRouter } from './routes/internal/entity-legibility.hono';
// Wave BRAIN-LOOPBACK-WIRE — borjie.ask / borjie.cite / documents.* /
// jurisdiction-discovery.discover brain tools likewise POSTed to unmounted
// /internal/* routes. These routers light them up.
import { internalBrainLoopbackRouter } from './routes/internal/brain-loopback.hono';
import { internalJurisdictionDiscoveryRouter } from './routes/internal/jurisdiction-discovery.hono';
// Wave NOTIFICATION-DISPATCH-WIRE — turn on the already-built notification
// rails: the dispatch drain worker (delivers notification_dispatch_log
// pending rows via email/SMS/push with retry+backoff+DLQ), its push
// provider seam, and the announcement fan-out worker (expands operator
// broadcasts into per-recipient dispatch-log rows the drain then sends).
import { createNotificationDispatcher } from './services/notification-dispatch/dispatcher-worker';
import { resolvePushProviderFromEnv } from './services/notification-dispatch/push-provider';
import { createAnnouncementFanoutWorker } from './workers/announcement-fanout.worker';
import { createAnnouncementRecipientResolver } from './workers/announcement-recipient-resolver';
// Wave CLOSED-LOOP - 6h reconciliation worker. Walks outcome_predictions
// whose horizon has elapsed, resolves the entity's current state, computes
// drift, writes outcome_observations + outcome_reconciliations, and
// extends the AI hash-chain on each reconciliation.
import { createOutcomeReconciliationWorker } from './workers/outcome-reconciliation-worker';
// Wave AUTONOMY-CRON-WIRE — Mr. Mwikila autonomous-MD worker composition.
// Fires per-tenant per-handler at a configurable cadence so the inbox
// fills via the cron, not only when an inbound HTTP route lands a row.
// Prior to this import the worker was exported but never instantiated
// in index.ts — the "Acts on owner's behalf" claim was vacuous.
import { createMwikilaAutonomousWiring } from './composition/mwikila-autonomous-wiring';
// Wave CLOSED-LOOP-RESOLVERS — real observation resolvers for the
// outcome-reconciliation worker. Replaces the previous `resolvers: {}`
// (which forced EVERY prediction to expire with `no_observation_resolver`)
// with per-entity-type Drizzle queries against production / financial /
// compliance tables so the closed-loop feedback arm actually receives
// real signal.
import { buildOutcomeResolvers } from './composition/outcome-resolvers';
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
  makeTimezoneForOwner,
} from './services/owner-identity/resolver';
import { createEmailProviderFromEnv } from './services/notification-dispatch/email-provider';
import { resolveSmsProviderFromEnv } from './services/notification-dispatch/sms-provider';
import { buildServices, type ServiceRegistry } from './composition/service-registry';
import { getDb, getServiceRoleWorkerClient } from './composition/db-client';
// Scale-P0 lane wiring — each init fn reads its OWN env flag ONCE here at
// bootstrap and DEFAULTS to today's behaviour (merging is a runtime no-op
// until the operator flips the flag). These four are the ONLY new gateway
// bootstrap wires this integration pass adds; the lanes themselves never
// touch index.ts.
//   - initDbClient()         flag DATABASE_POOL_MODE  (default 'session' = today)
//   - initClusterLock() +    flag CRON_LEADER_ELECTION (default off = run-on-every-replica)
//     withClusterLeader() / releaseLeadership()
//   - initRedisTokenBucket() gate REDIS_URL           (unset = in-process limiter = today)
//   - initCockpitBus()       gate REDIS_URL (via CrossPortalBus; in-memory = today)
import { initDbClient } from './composition/db-client';
import {
  initClusterLock,
  withClusterLeader,
  releaseLeadership,
  lockIdFor,
} from './composition/cluster-lock';
import { initRedisTokenBucket } from './middleware/rate-limiter';
import { initCockpitBus, publishCockpitEvent } from './services/cockpit-events';
// KI-010 — the governed, PROPOSE-ONLY self-extension cron. Born-dark (zero
// importers) until this wire. `createSelfExtensionCron` only PROPOSES new
// sub-MDs to the owner four-eye inbox + drives a self-build dry-run; it NEVER
// auto-deploys (the runtime-apply primitive stays UNMOUNTED — see
// self-extension-cron-wiring.ts). Composed unconditionally below (so it is
// reachable + tested), but only .start()ed behind the default-OFF
// BORJIE_SELF_EXTENSION_CRON_ENABLED flag.
import { createSelfExtensionCron } from './composition/self-extension-cron';
import { buildSelfExtensionCronDeps } from './composition/self-extension-cron-wiring';

// Stable cron names wrapped with withClusterLeader(...) at their .start()
// sites below. Single source of truth so gracefulShutdown releases exactly
// the locks the boot sequence acquired (lock-id = lockIdFor(name)). Keep in
// sync with the wrapped .start() calls in the listen block.
const CLUSTER_LEADER_CRON_NAMES = [
  'heartbeat',
  'background-supervisor',
  'intelligence-history',
  'learning-amplification',
  'geofence-watcher',
  'licence-expiry',
  'executive-brief',
  'daily-brief',
  'ica-cert-expiry',
  'compliance-deadline-scan',
  'entity-indexer',
  'fx-feed',
  'executive-brief-action-runner',
  'reminders-dispatch',
  'announcement-fanout',
  'outcome-reconciliation',
  'mwikila-autonomous',
  'proactive-scheduler',
  'decision-retrospective',
  'estate-mind',
  'control-shell',
  'loop-economy',
  'someday-review',
  'org-loop',
  // KI-010 — governed, propose-only self-extension cron. Listed so
  // gracefulShutdown releases its lock; only .start()ed behind the
  // default-OFF BORJIE_SELF_EXTENSION_CRON_ENABLED flag (see listen block).
  'self-extension',
] as const;
import { createServiceContextMiddleware } from './composition/service-context.middleware';
import {
  wireCognitive,
  createCognitiveContextMiddleware,
  type WiredCognitive,
} from './composition/cognitive-wiring';
// LP-30 — composer deep-execution deps. Builds the 10-port CompositionDeps
// whose `cot` + `substrate` ports run the real `runLATS` +
// `discoverReasoningStructure` executors. Threaded into `wireCognitive` so
// the TTC-routed deep composer is available (flag default OFF, fail-safe;
// opt-in via env after a staging canary).
import {
  buildCognitiveCompositionDeps,
  createAnthropicComposerInfer,
} from './composition/cognitive-composition-deps-wiring';
import { resolveSkillEmbedder } from './composition/sovereign';
import {
  createHeartbeatSupervisor,
  createBackgroundSupervisor,
  createPostgresWebhookDeliveryRepository,
  createAmbientBehaviorObserver,
  createIntelligenceHistorySupervisor,
} from './composition/background-wiring';
// Learning Amplification (LitFin port) — Bayesian feedback loop that
// makes Mr. Mwikila measurably smarter user-over-user. Wiring resolves
// the Supabase service-role client + configures both the recorder and
// nightly amplification job; the worker drives the cron tick.
import { createLearningAmplificationWiring } from './composition/learning-amplification-wiring';
import { createLearningAmplificationCron } from './workers/learning-amplification-cron';
// R8 — AOP meta-learning loop (Decagon pattern). Composes the dark
// registry/runner/regression/canary factories over the persisted AOP
// store and drives OBSERVE→PROPOSE→REGRESSION→CANARY on the cron seam.
import {
  createAnthropicAopExecutor,
  createAopMetaLoopCron,
} from './composition/aop-wiring';
// LOOP-ECONOMY — the cognitive-loop substrate (declarative LoopSpec
// registry + pure scheduler + the forecast-surprise builtin). Composes
// the dark loop-economy factories over the REAL estate organs
// (situational-model snapshot reader + gated proactive proposal sink)
// and drives FOLD → SCHEDULE → MEMBRANE → LEARN on the cron seam.
import { createLoopEconomyCronFromDb } from './composition/loop-economy-wiring';
import {
  setBrainExtraSkills,
  appendBrainExtraSkills,
  setBrainModalityCapabilities,
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
  configureMdDeferTools,
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
// FINAL NEEDS-DESIGN wave — durable brain memory. The Drizzle MemoryTool
// adapter (agent_memory, migration 0302) backs the mwikila.memory.* persona
// tools so "remember X" / "what do you remember about Y" persist across
// sessions, devices, and restarts (FORCE RLS scopes each tenant's notebook).
import { createDrizzleMemoryTool } from './composition/memory/drizzle-memory-tool';
// FINAL NEEDS-DESIGN wave — jurisdiction registry. Eager-loads the TZ launch
// profile + regulators + compliance frameworks (pure, no I/O) so the deploy
// log proves the profile is live and the data-analysis brain tool's
// getJurisdictionContext('tz') resolves to a real row from first call.
import { initJurisdictionRegistry } from './composition/jurisdiction-registry';
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
import {
  buildModalityCapabilities,
  type ModalityCapabilities,
} from './composition/modality-capability';
import { ownerDraftsRouter } from './routes/owner/drafts.hono';
// Wave-3-int2 — brain↔tab loop composition (Piece L → Piece B handlers).
import {
  createDispatchRouterWiring,
  createStubMiningHandlerDeps,
} from './composition/dispatch-router-wiring';
// Wave-3-int3 — REAL dispatch-handler deps (LedgerService money path,
// hash-chained audit, cross-portal notifications, Drizzle mining repos).
import {
  createRealMiningHandlerDeps,
} from './composition/dispatch-handler-deps-wiring';
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
// Dark-router wave — public, recon-safe dependency roll-up for uptime
// probes / load balancers / status pages. Returns ONLY { overall, timestamp }
// (the DA1-audited safe surface); the full per-dependency detail stays gated.
import { createHealthDependenciesPublicHandler } from './routes/health-dependencies.router';
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

// Feed the LIVE, rank-driven tier→model-id map into the ai-copilot juniors so
// core reasoning (the DEEP tier) runs the front of the Anthropic capability
// rank — Fable today, whatever supersedes it tomorrow — with zero code change.
// resolveTierModel goes env-pin → registry (L2 /v1/models) → L3 baseline;
// setModelTierMap rebinds the package's per-call resolution (not the static
// catalog). Without this the juniors fall back to DEFAULT_TIER_MODEL_IDS,
// which already encodes the same deep=Fable cascade.
import { setModelTierMap } from '@borjie/ai-copilot';
import { resolveTierModel } from './composition/model-tier-map';
setModelTierMap({
  cheap: resolveTierModel('cheap'),
  standard: resolveTierModel('standard'),
  deep: resolveTierModel('deep'),
});
logger.info(
  {
    deep: resolveTierModel('deep'),
    standard: resolveTierModel('standard'),
    cheap: resolveTierModel('cheap'),
  },
  'model-tiering: rank-driven deck bound — DEEP=core-reasoning at rank front (Fable), auto-promotes on a superior Anthropic model',
);

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

// H2 deferral closure — hoisted so the shutdown handler can reach the
// stop handle regardless of cron-registration ordering.
let idempotencySweeperStop: (() => void) | undefined;

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
    // SEC (hardening H9): the JWT iss/aud rollback flag is an INCIDENT
    // escape hatch only — left set in production it silently re-opens the
    // cross-project token-acceptance hole SEC-G2 closed. Fail the boot loud
    // rather than run a production gateway with the binding off.
    if ((process.env.BORJIE_JWT_ISS_AUD ?? 'on').toLowerCase() === 'off') {
      throw new Error(
        'api-gateway: BORJIE_JWT_ISS_AUD=off is forbidden in production — ' +
          'the iss/aud binding (SEC-G2) must stay enforced. Remove the env ' +
          'var (it exists only for time-boxed incident rollback in staging).'
      );
    }
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

// SEC-G3 — wire the shared (Redis) token-revocation store at boot so a
// logout / refresh-rotation / role-change on ANY HPA replica revokes the
// token cluster-wide (the in-process Map only catches same-replica
// revocations). GATE: REDIS_URL. When unset (local dev / tests) the
// token-blocklist façade stays on its in-process Map = today's behaviour.
// The Redis adapter degrades to the local Map on a Redis error and flips a
// health flag (see redis-token-blocklist.ts) rather than failing open.
(() => {
  if (!process.env.REDIS_URL) {
    logger.info(
      'token-blocklist: REDIS_URL unset — using in-process revocation map (dev mode)',
    );
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ioredisMod = require('ioredis');
    const RedisCtor = ioredisMod?.default ?? ioredisMod?.Redis ?? ioredisMod;
    const client = new RedisCtor(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    client.on?.('error', (err: Error) => {
      logger.warn(
        { err: err.message },
        'token-blocklist: redis client error (revocation will fall back to in-process map)',
      );
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const blkMod = require('./middleware/redis-token-blocklist') as {
      RedisTokenBlocklist: new (opts: {
        redis: unknown;
        logger?: { warn: (meta: unknown, msg: string) => void };
        sentryCapture?: (err: unknown, ctx?: Record<string, unknown>) => void;
      }) => unknown;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const facadeMod = require('./middleware/token-blocklist') as {
      wireRedisRevocationStore: (store: unknown) => void;
    };
    const store = new blkMod.RedisTokenBlocklist({
      redis: client,
      logger: { warn: (meta, msg) => logger.warn(meta as object, msg) },
      sentryCapture: (err, ctx) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const obs = require('@borjie/observability') as {
            getSentry?: () => {
              captureException: (err: unknown, ctx?: unknown) => void;
            };
          };
          obs.getSentry?.().captureException(err, ctx);
        } catch {
          // Sentry hook bugs must never break the auth pipeline.
        }
      },
    });
    facadeMod.wireRedisRevocationStore(store);
    logger.info('token-blocklist: wired Redis-backed cross-replica revocation store');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'token-blocklist: failed to initialize Redis store — using in-process map',
    );
  }
})();

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
// Public dependency roll-up — recon-safe `{ overall, timestamp }` only.
// Lets external uptime probes / load balancers / status pages render a
// degraded-mode indicator without learning the integration topology.
app.get('/healthz/dependencies', createHealthDependenciesPublicHandler());

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
// Scale-P0 db-client lane — read DATABASE_POOL_MODE ONCE and eagerly
// materialise the single shared primary + readonly clients so the one
// bounded pool is the factory of record before the first request. With no
// env set, poolMode resolves to 'session' (today's exact reserve()-pin +
// prepared-statements-on behaviour) and this is a pure no-op beyond logging.
// Idempotent + fail-soft: a degraded (no DATABASE_URL) boot still returns
// null handles and the gateway 503s pure-DB endpoints exactly as before.
try {
  const dbInit = initDbClient();
  logger.info(
    { poolMode: dbInit.poolMode, hasPrimary: dbInit.db !== null },
    'db-client: bootstrap init complete',
  );
} catch (err) {
  logger.warn(
    { err: err instanceof Error ? err.message : String(err) },
    'db-client: initDbClient failed at bootstrap (continuing — getDb() lazy path still applies)',
  );
}

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

// B5 — control-plane LLM-routing config reader. Install the routing-config
// reader ONCE at boot over the platform service-role db so admin-tuned LLM
// config is honored by the router's resolver. The reader fail-safes to the
// static ladder until the first warm lands; when db is null we skip (the
// resolver simply keeps the static ladder — today's exact behaviour).
{
  const platformDb = serviceRegistry.db;
  if (platformDb) {
    initLlmRoutingConfig({ db: platformDb, logger });
  } else {
    logger.warn(
      'llm-routing-config: skipped (no platform db — static routing ladder retained)'
    );
  }
}

// ----------------------------------------------------------------------------
// Scale-P0 redis-rate-limiter lane (RSS-08) — wire the distributed token
// bucket ONCE at bootstrap. GATE: REDIS_URL. When unset, initRedisTokenBucket
// returns null and perUserRateLimit / customRateLimit keep the in-process
// limiter — today's exact behaviour. When set, the per-route token bucket is
// enforced cluster-wide via the shared Lua script. Idempotent: a double-wire
// is ignored. We pass the Sentry capture hook so on-call pages light up if the
// bucket degrades back to in-process (mirrors the rate-limit-redis pattern).
try {
  initRedisTokenBucket({
    sentryCapture: (err, ctx) => {
      try {
        // Lazy require — sentry init happens later in this boot sequence, so a
        // top-of-file import would resolve before the DSN is wired.
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
    'rate-limiter: initRedisTokenBucket failed (in-process limiter remains in force)',
  );
}

// ----------------------------------------------------------------------------
// Scale-P0 redis-sse-bus lane (RSS-05) — back the cockpit SSE bus with the
// composition-root CrossPortalBus singleton ONCE at boot. GATE: REDIS_URL is
// mediated by the CrossPortalBus itself (it selects the ioredis pub/sub
// backend only when REDIS_URL is set, in-memory otherwise). With REDIS_URL
// unset the bus is in-memory and nothing changes vs. today — the local
// EventEmitter remains the sole path. `serviceRegistry.crossPortalBus` is a
// Promise (the Redis impl lazy-imports ioredis), so we await it fire-and-forget
// and wire on resolve; a failure leaves the local-only path intact.
void serviceRegistry.crossPortalBus
  .then((bus) => {
    initCockpitBus(bus);
    logger.info('cockpit-bus: wired to cross-portal bus (cross-replica SSE fan-out gated on REDIS_URL)');
  })
  .catch((err: unknown) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'cockpit-bus: initCockpitBus skipped (cross-portal bus unavailable — local EventEmitter remains the sole path)',
    );
  });

// ----------------------------------------------------------------------------
// LIVE money path — wire the settlement + payroll ledger ports to the REAL
// double-entry LedgerService (CLAUDE.md hard rule: money goes through
// LedgerService.post()). Replaces the dev SHA-256 stubs that wrote nothing.
// Fail-soft: when DATABASE_URL is unset this is a no-op and the dev stub
// remains (the gateway already 503s pure-DB endpoints in that mode).
// ----------------------------------------------------------------------------
import { registerProductionLedgerPorts } from './composition/ledger/index.js';
try {
  registerProductionLedgerPorts(getDb());
} catch (err) {
  logger.error(
    { err: err instanceof Error ? err.message : String(err) },
    'ledger-production-wiring: failed to register settlement/payroll ledger ports',
  );
  // FAIL BOOT (M1): when a database EXISTS, a wiring failure must NOT be
  // swallowed. If we continued, the settlement/payroll ledger ports would
  // be unwired and the orchestrator could stamp status='posted' + fire a
  // real M-Pesa payout while NOTHING was written to the double-entry
  // ledger. (The resolvers also fail loud with LEDGER_NOT_WIRED as a
  // second line of defence; this rethrow stops the process at boot.) When
  // there is no database, `registerProductionLedgerPorts` does not throw —
  // it explicitly allows the dev stub — so this branch only fires on a
  // genuine wiring fault with money infrastructure present.
  if (getDb() !== null) {
    throw err;
  }
}

// ----------------------------------------------------------------------------
// Translation facade binding — runs once after the service registry is up
// so every consumer of `translate(...)` in @borjie/translation resolves to
// the real Claude-backed + Drizzle-cached implementation. Fails open with
// a logged warning when ANTHROPIC_API_KEY is missing.
// ----------------------------------------------------------------------------
import { wireTranslation } from './composition/translation-wiring.js';
wireTranslation({ db: getDb(), logger });

// ----------------------------------------------------------------------------
// R8 wiring follow-up — construct the cognitive-memory + persistent-memory
// bundles so brain-turn handlers can prepend recalled context to the system
// prompt.
//
// LP-30 — the 12-wire cognitive-composition.compose() pipeline is now LIVE:
// `compositionDeps` supplies the 10 ports, whose `cot` + `substrate` ports run
// the real `@borjie/extended-reasoning` `runLATS` and
// `@borjie/reasoning-substrate` `discoverReasoningStructure` executors. The
// composer is TTC-routed (Self-Discover / LATS) and gated by
// `BORJIE_COGNITIVE_COMPOSER_ENABLED` (default OFF; opt-in via env after a
// staging canary — set to '1'/'true'/'on' to enable). Construction is
// fail-soft: a broken bundle degrades to null,
// `runForTurn` returns null on any error, and enrichment falls back to
// memory-recall-only — the gateway always boots and always serves the turn.
// ----------------------------------------------------------------------------
const wiredCognitive: WiredCognitive = wireCognitive({
  db: getDb(),
  logger: {
    debug: (message, meta) => logger.debug(meta ?? {}, message),
    info: (message, meta) => logger.info(meta ?? {}, message),
    warn: (message, meta) => logger.warn(meta ?? {}, message),
    error: (message, meta) => logger.error(meta ?? {}, message),
  },
  // LP-30 — turn the deep composer on. The embedder is shared with the kernel
  // + skill retriever; the inference port is now bound to a REAL Sonnet-backed
  // infer when ANTHROPIC_API_KEY is present, and falls back to a deterministic
  // degraded stub when it is absent so the pipeline still runs offline. (The
  // composer itself remains gated by BORJIE_COGNITIVE_COMPOSER_ENABLED.)
  //
  // `createAnthropicComposerInfer` returns `undefined` when no key is present;
  // under `exactOptionalPropertyTypes` we omit the optional `infer` key in
  // that case (rather than passing `undefined`) so the builder applies its
  // documented degraded-stub default.
  compositionDeps: buildCognitiveCompositionDeps({
    ...(() => {
      const infer = createAnthropicComposerInfer({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      return infer ? { infer } : {};
    })(),
    embedder: resolveSkillEmbedder(),
    logger: {
      info: (meta, msg) => logger.info(meta, msg),
      warn: (meta, msg) => logger.warn(meta, msg),
    },
  }),
  env: process.env,
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
// Wires the dispatch-router (Piece L) + the 3 MINING accept-proposal
// handlers + tenant-override routing-rules loader. Returns a
// `postThinkCaptureHook` we install on every Jarvis router so `/think` +
// `/stream` fire the hook fire-and-forget after each turn.
//
// Wave-3-int3 — REAL handler ports are now wired when a database is
// present: the brain's accept_proposal path writes real `tasks` /
// `temporal_entities` / `maintenance_events` rows, appends to the
// hash-chained `ai_audit_chain`, and fans notifications out on the cross-
// portal bus. None of the MINING dispatch handlers touch money — a mining
// estate's real money (royalty / sales) flows through `LedgerService.post()`
// in `services/payments-ledger`, NOT through any dispatch handler. (The
// pre-Borjie property-era ESTATE dispatch handlers — lease deposit /
// receipt draft — were EXCISED; they had no mining-domain backing schema.)
//
// When DATABASE_URL is unset (DB-less dev/smoke), there is no repo
// infrastructure, so the silent-success stubs are the correct fallback
// and the gateway still boots.
// ----------------------------------------------------------------------------
const dispatchHandlerDb = getDb();
const dispatchHandlerLogger = {
  info: (meta: object, msg: string) => logger.info(meta, msg),
  warn: (meta: object, msg: string) => logger.warn(meta, msg),
  error: (meta: object, msg: string) => logger.error(meta, msg),
};
const dispatchRouterWiring = createDispatchRouterWiring({
  // Closes the historical gh-issue #34 work-item: 3 mining handlers
  // replace the pre-Borjie estate stubs (open_maintenance_case →
  // open_equipment_maintenance, schedule_renewal_negotiation →
  // schedule_licence_renewal, bulk_mark_for_renewal_prep →
  // bulk_mark_licences_for_renewal). The property-era ESTATE dispatch
  // actions were excised entirely — there is no `estate` field to wire.
  mining: dispatchHandlerDb
    ? createRealMiningHandlerDeps({
        db: dispatchHandlerDb as never,
        crossPortalBus: serviceRegistry.crossPortalBus,
        logger: dispatchHandlerLogger,
      })
    : createStubMiningHandlerDeps(),
  logger: dispatchHandlerLogger,
});
installJarvisCaptureHook(async (input) => {
  await dispatchRouterWiring.postThinkCaptureHook(input);
});
logger.info(
  {
    handlerRegistry: (dispatchRouterWiring.handlerRegistry as {
      listRegistered?: () => unknown;
    }).listRegistered?.(),
    handlerPorts: dispatchHandlerDb ? 'real' : 'stub',
    // MINING dispatch handlers write tasks/maintenance rows — NO money.
    // The real money path (royalty/sales) is LedgerService.post() in
    // services/payments-ledger, never reached via dispatch.
    handlerEffect: dispatchHandlerDb
      ? 'tasks/maintenance (no money)'
      : 'stub-noop',
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

  // Modality capabilities (forecast / media-video+gif / document) — behind
  // BORJIE_MODALITY_CAPABILITIES (DEFAULT-ON kill-switch; set the flag to
  // `off` to disable). When ON, the engines are
  // constructed once and exposed as rail-gated, evidence-stamped capability
  // brain-tools registered ALONGSIDE the existing image/chart/diagram tools.
  // The brain-tools path returns the artifact directly (the chat renderer
  // inlines it); the arbiter→engine→PROPOSAL path (brain-kernel-wiring) binds
  // its own per-request proposal sink, so the tool-path sink is a no-op here.
  const modalityCapabilities: ModalityCapabilities = buildModalityCapabilities({
    envSource: process.env,
    proposalSink: {
      async emit(): Promise<{ readonly surfacedProposalId: string }> {
        return { surfacedProposalId: 'tool-path-no-proposal' };
      },
    },
    fetch: ((url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
      fetch(url, init as RequestInit) as unknown) as never,
    logger,
  });
  const capabilityTools = modalityCapabilities.capabilityTools;
  if (modalityCapabilities.enabled) {
    setBrainModalityCapabilities(modalityCapabilities);
  }

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
  for (const t of capabilityTools) personaWriteIds.add(t.name);
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
    ...capabilityTools,
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
      // MD DEFERRAL / FOLLOW-THROUGH — build the durable md_commitments
      // reconcile bundle ONCE (repo + reconcile engine + WaitFor event
      // subscriber) and wire the defer brain tools (md.defer /
      // md.commitment.*) to its repository. The reconcile engine is injected
      // into the EstateMind supervisor below; the bundle is null when no db.
      //
      // Wave-C C3 WIN-3/4 — CONSTRUCT + BIND the three graded-corrective +
      // closed-loop organs so the homeostatic controller ACTS LIVE:
      //   (1) driveContextResolver — maps each commitment to its REAL standing-
      //       drive severity by running DEFAULT_DRIVES over the LIVE per-tenant
      //       situational snapshot (the SAME store the salience arena reads), so
      //       the corrective ladder is graded to the true danger instead of the
      //       fabricated `c.sovereign ? 1 : 0.6`. Honest-degrades to legacy when
      //       no snapshot / unbound commitment.
      //   (2) drafterRegistry — driveId → its bound DRAFTER (licence-renewal /
      //       royalty-filing / payroll), the mid-rung corrective. PROPOSE-ONLY:
      //       writes a DRAFT `proposed` mwikila_actions_inbox row (HITL), never
      //       executes. Money/licence stay HITL forever.
      //   (3) the durable set-point store is auto-built inside
      //       createMdCommitmentReconciliation over the dedicated
      //       set_point_state table (migration 0330) so the did-it-recover?
      //       auto-promote arc is live.
      // The autonomy cap clamps the graded ladder (nudge→draft→delegate); it is
      // NEVER raised above 'delegate' (the owner-direct safe-halt — itself a HITL
      // park). Env-tunable DOWN only; default the full graded ladder.
      const dbForMd = serviceRegistry.db as unknown as Parameters<
        typeof createMdCommitmentReconciliation
      >[0]['db'];
      const mdLogger = createPinoLikeLogger('md-commitments');
      const mdAutonomyCap = resolveMdAutonomyCap(
        process.env.BORJIE_MD_AUTONOMY_CAP,
      );
      mdCommitmentBundle = createMdCommitmentReconciliation({
        db: dbForMd,
        logger: mdLogger,
        // (1) the REAL standing-drive severity, from the live snapshot.
        driveContextResolver: dbForMd
          ? createDriveContextResolver({
              snapshotReader: buildEstateMindSnapshotReader(
                dbForMd as unknown as Parameters<
                  typeof buildEstateMindSnapshotReader
                >[0],
                createPinoLikeLogger('md-drive-snapshot'),
              ),
              // Wave-C C2 — judge a breach against THIS estate's consolidated
              // baseline when available (honest-degrades to kernel defaults).
              resolveThresholds: (tenantId: string) =>
                resolveDriveThresholdsFromBaselinesDb(
                  dbForMd as unknown as Parameters<
                    typeof resolveDriveThresholdsFromBaselinesDb
                  >[0],
                  tenantId,
                ),
              logger: createPinoLikeLogger('md-drive-resolver'),
            })
          : null,
        // (2) the mid-rung PROPOSE-ONLY drafters (licence / royalty / payroll).
        drafterRegistry: dbForMd
          ? createDrafterRegistry(
              dbForMd as unknown as { execute(q: unknown): Promise<unknown> },
              createPinoLikeLogger('md-drafter-registry'),
            )
          : null,
        // The graded ladder ceiling. Clamped — never raised above 'delegate'.
        autonomyCap: mdAutonomyCap,
      });
      if (mdCommitmentBundle) {
        // LIVING-MD ORGAN — compose the felt loop over the durable substrate so
        // the chat turn re-reads the plan (turnHooks), deferred/someday work
        // resurfaces on its own leader-gated clock (somedayReviewSupervisor),
        // and every lifecycle transition appends to the hash-chained timeline
        // (timelineSink). Pure composition over the bundle + estate-mind sink.
        const listActiveTenantIdsForMd = async (): Promise<
          ReadonlyArray<string>
        > => {
          if (!dbForMd) return [];
          try {
            const res = await (
              dbForMd as unknown as { execute(q: unknown): Promise<unknown> }
            ).execute(
              drizzleSqlTag`SELECT id FROM tenants WHERE status = 'active'`,
            );
            const rows = Array.isArray(res)
              ? (res as readonly unknown[])
              : ((res as { rows?: readonly unknown[] }).rows ?? []);
            return rows
              .map((r) => {
                const id = (r as { id?: unknown }).id;
                return typeof id === 'string' ? id : String(id ?? '');
              })
              .filter((s) => s.length > 0);
          } catch {
            return [];
          }
        };
        livingMd = createLivingMdOrgan({
          repository: mdCommitmentBundle.repository,
          eventSubscriber: mdCommitmentBundle.eventSubscriber,
          proposalSink: dbForMd
            ? createTabEventLogProposalSink(
                dbForMd as unknown as { execute(q: unknown): Promise<unknown> },
                createPinoLikeLogger('living-md-proposal-sink'),
              )
            : null,
          listActiveTenantIds: listActiveTenantIdsForMd,
          db: dbForMd as unknown as Parameters<
            typeof createLivingMdOrgan
          >[0]['db'],
          logger: createPinoLikeLogger('living-md'),
        });
        // Feed the LIVING-MD hash-chained timeline into the defer tools so
        // confirm/reopen/block lands on the lifecycle trail the plan-tab +
        // governance surfaces read.
        configureMdDeferTools({
          repo: mdCommitmentBundle.repository,
          timelineSink: livingMd.timelineSink,
        });
        // Inject the per-turn re-read + post-turn commitment_state hooks into the
        // LIVE chat seam (DI — chat-orchestrator stays import-free of the organ).
        configureLivingMdTurnHooks(livingMd.turnHooks);

        // ── SELF-RUNNING-ORG SPINE (org-loop) ─────────────────────────
        // Compose the gap→strategize→pick→assign→dispatch→deliver→report→
        // close thread over the SAME commitment substrate. This lights up
        // the previously-dark assignTask() write path through the composed
        // WorkforceDeps; the binder closes the loop in real time when a
        // worker completes the dispatched task. PROPOSE-ONLY/HITL: HIGH/
        // sovereign assignments are surfaced for owner approval, never
        // auto-executed. Kill-switch BORJIE_ORG_LOOP (default-ON).
        if (dbForMd) {
          const orgLoopLogger = createPinoLikeLogger('org-loop');
          const orgLoopRunRepo = createDrizzleOrgLoopRunRepository(
            dbForMd as unknown as Parameters<
              typeof createDrizzleOrgLoopRunRepository
            >[0],
          );
          const workforceDeps = createWorkforceDeps({
            db: dbForMd as unknown as Parameters<
              typeof createWorkforceDeps
            >[0]['db'],
          });
          orgLoopOrchestrator = createOrgLoopOrchestrator({
            commitmentRepo: mdCommitmentBundle.repository,
            runRepo: orgLoopRunRepo,
            strategist: createStrategizePort({
              logger: createPinoLikeLogger('org-loop-strategize'),
            }),
            personMatcher: createPersonMatcher({
              db: dbForMd as unknown as Parameters<
                typeof createPersonMatcher
              >[0]['db'],
              logger: createPinoLikeLogger('org-loop-matcher'),
            }),
            dispatcher: createTaskDispatchPort({ workforceDeps }),
            briefer: createGapBriefingPort(),
            proposalSink: createTabEventLogProposalSink(
              dbForMd as unknown as { execute(q: unknown): Promise<unknown> },
              createPinoLikeLogger('org-loop-sink'),
            ),
            cockpit: {
              publish: (event) =>
                void publishCockpitEvent(
                  event as Parameters<typeof publishCockpitEvent>[0],
                ),
            },
            listActiveTenantIds: listActiveTenantIdsForMd,
            logger: orgLoopLogger,
          });
          // RE-LOOP closure binder — task completion (mwikila.acted /
          // mining.task.complete on the cockpit bus) marks the originating
          // commitment done with positive proof + advances the run to
          // closed. Local process tap = exactly-once cluster semantics.
          const taskCommitmentBinder = createTaskCommitmentBinder({
            runRepo: orgLoopRunRepo,
            commitmentRepo: mdCommitmentBundle.repository,
            logger: createPinoLikeLogger('org-loop-binder'),
          });
          tapCockpitEvents((event) => {
            void taskCommitmentBinder.onMwikilaActed(event);
          });
          // Late-bind the HITL approval consumer: the owner's approve verb
          // resumes a parked HIGH/sovereign run through the dispatch leg;
          // dismiss closes it. Until this registration the route 503s.
          registerOrgLoopApprovalActions(orgLoopOrchestrator);
          orgLoopLogger.info(
            { wiring: 'org-loop', killSwitchEnv: 'BORJIE_ORG_LOOP' },
            'org-loop: spine composed (strategize+match+dispatch+brief+binder+approval-consumer) — assignTask write-path LIVE, propose-only/HITL',
          );
        }
        mdLogger.info(
          { autonomyCap: mdAutonomyCap },
          'md-commitments: graded-corrective + closed-loop set-point organs wired (drive-context resolver + drafter registry + set_point_state store) + LIVING-MD organ composed (turn re-read + someday resurfacing + hash-chained timeline) — homeostatic controller LIVE, propose-only/HITL',
        );
      }
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
    // Eager-load the jurisdiction registry (TZ launch profile) so its first
    // consumer — the data-analysis brain tool's getJurisdictionContext('tz') —
    // resolves immediately and the deploy log records the live profile ids.
    initJurisdictionRegistry();
    const personaHandlers = buildPersonaToolHandlers(personaGate, {
      onDuplicate: (toolId) =>
        logger.warn({ toolId }, 'brain-tools: duplicate descriptor ignored'),
      // Durable brain memory — the same Drizzle backend (agent_memory) used by
      // the kernel scratchpad; binds the mwikila.memory.* tools to persisted
      // storage instead of the volatile in-memory fallback.
      memoryTool: createDrizzleMemoryTool(getDb()),
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
  // Admin gate derives the role from the VERIFIED bearer JWT — never from a
  // client-supplied header (the prior x-user-role check let any caller probe
  // the full Postgres/Redis/provider cascade in production).
  requireAdmin: (req) => {
    const verified = verifyJwt(extractBearerToken(req.header('authorization')));
    // SUPER_ADMIN/ADMIN are the real admin members of the verified-JWT role
    // union (the prior header check compared against role names that do not
    // exist in the JWT vocabulary — it could never pass legitimately).
    if (
      verified.ok &&
      (verified.payload.role === 'SUPER_ADMIN' ||
        verified.payload.role === 'ADMIN')
    ) {
      return true;
    }
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
// Portal-genui: MD-authored dynamic tabs — construct the engine + mount its
// router. The engine is exposed on the live serviceRegistry the middleware
// already closed over (mount order vs. the middleware is irrelevant).
const portalGenuiWiring = buildPortalGenuiWiring();
(serviceRegistry as { portalGenUIEngine?: unknown }).portalGenUIEngine =
  portalGenuiWiring.engine;
// K1a — the generated-tab record store, read by the /tabs/:id/records endpoints
// on the same router so a generated tab's fields can actually COLLECT data
// (validated against the tab's own field schema).
(serviceRegistry as { portalGenUIRecordStore?: unknown }).portalGenUIRecordStore =
  portalGenuiWiring.recordStore;
// Wave-B residual — tenant-scoped storage adapter for the generated-tab file/
// signature/audio upload endpoint (POST /portal-genui/tabs/:id/upload). Without
// this attachment getStorageAdapter(c) is undefined and the route honest-501s.
(serviceRegistry as { portalGenUIStorageAdapter?: unknown }).portalGenUIStorageAdapter =
  portalGenuiWiring.storageAdapter;
// LAST outward-reach seam — bind the REAL connector + legacy-portal runtime
// invokers onto the SAME serviceRegistry the service-context middleware closed
// over (the connectors route reads `services.connectorInvokers`; the legacy-
// portal route reads `services.legacyPortalFileKra`). Both are credential/env
// gated and honest-degrade: an unprovisioned connector / unset live env leaves
// the slot empty so the routes keep their structured not-provisioned envelopes.
{
  const connectorInvokersWiring = createConnectorInvokers({
    db: serviceRegistry.db as unknown as
      | { execute(q: unknown): Promise<unknown> }
      | null,
    logger: createPinoLikeLogger('connector-invokers'),
  });
  (serviceRegistry as { connectorInvokers?: unknown }).connectorInvokers =
    connectorInvokersWiring.connectorInvokers;

  const legacyPortalWiring = createLegacyPortalLiveWiring({
    logger: createPinoLikeLogger('legacy-portal-live'),
  });
  if (legacyPortalWiring.fileKra !== undefined) {
    (serviceRegistry as { legacyPortalFileKra?: unknown }).legacyPortalFileKra =
      legacyPortalWiring.fileKra;
  }
}
// KI-011 — bind the Drizzle-backed persona-drift event source onto the SAME
// serviceRegistry the service-context middleware closed over (the persona-drift
// route reads `services.personaDriftEventSource`). The read is RLS-bound: it
// runs inside `withTenantContext(db, tenantId)` so the tenant-isolation policy
// on `kernel_persona_drift_events` (migration 0305, FORCE RLS on
// app.current_tenant_id) returns exactly that tenant's breaches. Tenant-scoped
// read, NOT a cross-tenant scan — no service-role bypass. When DATABASE_URL is
// unset the slot stays empty and the route returns an honest `{ data: [] }`.
{
  const driftDb = serviceRegistry.db;
  if (driftDb) {
    (serviceRegistry as { personaDriftEventSource?: unknown }).personaDriftEventSource =
      {
        async list(args: {
          readonly tenantId: string;
          readonly limit: number;
        }): Promise<ReadonlyArray<PersonaDriftEventRow>> {
          return withTenantContext(driftDb, args.tenantId, async (tx) => {
            const res = await tx.execute(drizzleSqlTag`
              SELECT id, persona_id, violation_type, severity, excerpt, detected_at
                FROM kernel_persona_drift_events
               WHERE tenant_id = ${args.tenantId}
               ORDER BY detected_at DESC
               LIMIT ${args.limit}`);
            const rows =
              (res as { rows?: Array<Record<string, unknown>> }).rows ??
              (Array.isArray(res) ? (res as Array<Record<string, unknown>>) : []);
            return rows.map((r): PersonaDriftEventRow => {
              const excerpt = String(r.excerpt ?? '');
              // The excerpt is shaped `…drift: dim <name> drifted by …` by the
              // emitter (persona-drift/alert.ts). Surface the worst-dim hint when
              // the marker is present; the client renders '—' when absent.
              const dimMatch = excerpt.match(/dim ([a-z0-9_]+) drifted/i);
              return {
                id: String(r.id ?? ''),
                personaId: String(r.persona_id ?? ''),
                violationType: String(r.violation_type ?? ''),
                excerpt,
                severity: (r.severity as 'low' | 'medium' | 'high') ?? 'low',
                detectedAt:
                  r.detected_at instanceof Date
                    ? r.detected_at.toISOString()
                    : String(r.detected_at ?? ''),
                ...(dimMatch ? { worstDim: dimMatch[1] } : {}),
              };
            });
          });
        },
      };
  }
}
// W2a — optional tenant-scoped read port for LIVE widget-data (mapped estate
// domains). Same `$client.unsafe(sql, params)` boundary the record store uses;
// RLS FORCE on app.current_tenant_id isolates in the DB. Unbound in dev/test →
// the resolver degrades mapped-domain reads to empty rows (tab_records always
// works via the record store, not this port).
{
  const widgetDb = getDb();
  if (widgetDb) {
    const widgetClient = (widgetDb as unknown as {
      $client: {
        unsafe<Row = Record<string, unknown>>(
          sql: string,
          params?: ReadonlyArray<unknown>,
        ): Promise<ReadonlyArray<Row>>;
      };
    }).$client;
    (serviceRegistry as { portalGenUIQueryPort?: unknown }).portalGenUIQueryPort = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<ReadonlyArray<Row>> {
        return widgetClient.unsafe<Row>(sql, params ?? []);
      },
    };
    // Stage-2 evidence-existence verifier (iq-evidence-stage2-disabled-12) —
    // give the Auditor real teeth: confirm every cited evidence_id actually
    // resolves to an intelligence_corpus_chunk for this tenant (or the global
    // corpus) before a recommendation is allowed out. Same tenant-scoped
    // `$client.unsafe` boundary (RLS FORCE isolates); fail-open on infra fault
    // so a DB blip degrades to Stage-1 regex only, never blocks a turn.
    setEvidenceExistenceVerifier(
      createCorpusEvidenceVerifier({
        async query<Row = Record<string, unknown>>(
          sql: string,
          params?: ReadonlyArray<unknown>,
        ): Promise<ReadonlyArray<Row>> {
          return widgetClient.unsafe<Row>(sql, params ?? []);
        },
      }),
    );
  }
}
api.route('/portal-genui', portalGenuiWiring.router);
// Deep research: make the research-orchestrator engine reachable on demand.
// The engine was built + DB-backed but no gateway route ever constructed its
// ModeRunDeps, so users could not trigger research. Construct the engine +
// mount its router beside portal-genui; the engine is exposed on the live
// serviceRegistry the service-context middleware already closed over.
const researchWiring = buildResearchWiring();
(serviceRegistry as { researchEngine?: unknown }).researchEngine =
  researchWiring.engine;
api.route('/research', researchWiring.router);
// Owner calendar integration — build the calendar channel (null without a
// CALENDAR_TOKEN_KEY) + mount the OAuth/connect router (503s when unconfigured).
const calendarChannel = serviceRegistry.db
  ? createCalendarChannelFromEnv({
      db: serviceRegistry.db as unknown as Parameters<
        typeof createCalendarChannelFromEnv
      >[0]['db'],
      logger,
    })
  : null;
api.route('/owner/calendar', createCalendarRouter({ channel: calendarChannel }));
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
const publicAuthDeps = createPublicAuthDeps({
  db: getDb(),
  logger,
  // Wire the security-hardening credential-stuffing detector (per-account
  // failure signal across IPs) into the sign-in route. Always present on
  // the ported-platform bundle in both live + degraded modes.
  stuffingDetector:
    serviceRegistry.portedPlatform.securityHardeningInstance.stuffingDetector,
});
api.route('/auth', createPublicAuthRouter(publicAuthDeps));
api.route('/auth', authRouter);
api.route('/auth/mfa', authMfaRouter);
api.route('/tenants', tenantsRouter);
// Self-service GDPR/PDPA surface. Mounted BEFORE `/users` so the more
// specific `/users/me/*` prefix resolves to this router; `usersRouter`
// defines no `/me` route, so the two never collide.
api.route('/users/me', createUsersMeRouter());
api.route('/users', usersRouter);
// Declared-facts producer — POST/GET/DELETE /memory/declare. Real
// semantic-memory store, auth + tenant + user scoped, per-user rate-limited.
api.route('/memory', memoryDeclareRouter);
api.route('/notifications', notificationsRouter);
// Phase F.5 tenant-signup flow mounts FIRST so specific paths
// (/signup, /first-site, /first-workforce-import, /first-md-chat,
// /checklist) match before the legacy customer move-in router.
api.route('/onboarding', onboardingFlowRouter);
api.route('/onboarding', onboardingRouter);
api.route('/feedback', feedbackRouter);
// Client-side self-healing beacon — the genui renderer reports an unknown-kind
// / schema-validation fallback here; it closes the projector seam to the
// internal-admin console + returns the customer-loop-closure contract.
api.route('/genui-telemetry', genuiTelemetryRouter);
api.route('/complaints', complaintsRouter);
// Piece C — Executive briefs (T1-T3 only) + subscription cadence registry.
api.route('/briefs', executiveBriefRouter);
api.route('/briefing-subscriptions', briefingSubscriptionRouter);
// REMOVED (borjie hard-fork): api.route('/cases', casesRouter) — residential-property residue.
// Mining-domain backends — Wave MINING-BACKENDS.
api.route('/geology', geologyRouter);
api.route('/production', productionRouter);
api.route('/cooperatives', cooperativesRouter);
api.route('/insurance', insuranceRouter);
api.route('/owner/threads', ownerThreadsRouter);
// Wave KNOWLEDGE-HANDOFF — POST /owner/handoff (create),
// GET /owner/handoff/inbox, POST /owner/handoff/:id/resolve.
api.route('/owner/handoff', ownerHandoffRouter);
// INV-A / FIRE-1 — tenant-visible break-glass Trust Center.
api.route('/owner/break-glass', ownerBreakGlassRouter);
// EA-05 — cross-surface CRDT state-bus. Tenant-scoped slot set/read/list +
// surface handoff; the slot lives once + re-projects onto every surface.
api.route('/blackboard', blackboardRouter);
// Roadmap R2 — owner saved-search alerts.
api.route('/owner/saved-searches', savedSearchesRouter);
// Mr. Mwikila autonomous-MD inbox + delegation surface.
api.route('/owner/mwikila-inbox', mwikilaInboxRouter);
// LIVING-MD plan surfaces — the owner's lens on the durable md_commitments
// plan (summary / upcoming / overdue / deferred / past + per-item timeline) and
// the per-tenant governance set-points the someday-review cadence reads fresh.
api.route('/owner/living-plan', livingPlanRouter);
api.route('/owner/commitment-governance', commitmentGovernanceRouter);
// HITL approval consumer for parked HIGH/sovereign org-loop runs — approve
// advances the parked run through the dispatch leg; dismiss closes it.
api.route('/owner/org-loop-approvals', orgLoopApprovalsRouter);
api.route('/owner/delegation', delegationRouter);
// Roadmap R7 — owner-mobile cockpit hub aggregator.
api.route('/owner/cockpit', cockpitHubRouter);
// Roadmap R6 — cockpit live SSE push.
api.route('/cockpit', cockpitStreamRouter);
// RT-3 — realtime latency telemetry. The metrics POST is colocated under
// /metrics; the aggregate GET sits under /observability so the cockpit
// widget reads from a "read-only stats" surface, not a write endpoint.
api.route('/metrics', realtimeLatencyRouter);
api.route('/observability', observabilityRealtimeRouter);
// Roadmap R8 — personal-KB UI surfaces. The router carries the full
// path segments inside (/me/* + /brain/personal-kb/search) so mount at
// root rather than under a prefix.
api.route('/', personalKbRouter);
// Roadmap R9 — smart-compose ghost-text suggestions
// (POST /brain/compose/suggest).
api.route('/brain', brainComposeRouter);
// Wave MD-INTELLIGENCE — MD cross-domain super-power tools surface.
api.route('/md', mdRouter);
// R-FUTURE-3 — PnL BFF for owner-web finance surface
// (GET /owner/finance/pnl?month=YYYY-MM).
api.route('/owner/finance', pnlTableRouter);
// Roadmap R12 — Discord-style tenant switcher backend.
api.route('/me/tenants', meTenantsRouter);
// Surface-completion SC-4 — the pairing surface (invite/QR redeem +
// public-discovery request→approve + org-side lifecycle + invite minting).
api.route('/memberships', membershipsRouter);
// JA-7 — owner-facing jurisdiction snapshot endpoint.
api.route('/me/jurisdiction', meJurisdictionRouter);
// Progressive-disclosure: mastery score + ranked learned shortcuts.
api.route('/me/mastery', meMasteryRouter);
api.route('/me/shortcuts', meShortcutsRouter);
// Bidirectional notification receiver loop — push token registry.
api.route('/me/device-tokens', meDeviceTokensRouter);
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
// Gap 6 — sibling /brain mount for VP department-head dispatch. brainRouter
// owns /turn, /threads, /personae, /migrate; brainTeachRouter owns /teach;
// brainDispatchRouter claims only /dispatch. Additive: NEVER touches /turn.
api.route('/brain', brainDispatchRouter);
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
// Specific owner group/holdings rollup — MUST precede the broad `/owner`
// BFF mount below so the more specific prefix wins.
api.route('/owner/group-rollup', ownerGroupRollupRouter);
api.route('/owner', ownerPortalRouter);
// REMOVED (borjie hard-fork): api.route('/manager', estateManagerAppRouter);
api.route('/admin', adminPortalRouter);
// admin-rest-3 — cross-tenant subscription / MRR overview. Mounted at the
// more-specific `/admin/subscriptions` prefix so it is never shadowed by the
// broad `/admin` portal mounts (adminPortalRouter / adminUsersRouter own
// disjoint sub-paths). Platform-admin gated inside the router.
api.route('/admin/subscriptions', adminSubscriptionsRouter);
// Wave 1-2 feature routers
api.route('/applications', applicationsRouter);
// REMOVED (borjie hard-fork): api.route('/arrears', arrearsRouter);
api.route('/compliance', complianceRouter);
api.route('/compliance-plugins', compliancePluginsRouter);
// Issue #194 chain C-A — regulator data-subject-request inbox.
// Mounts `/api/v1/regulator/requests/*`. The service slot binds the
// shared Drizzle client + Pino-backed audit sink.
{
  const regulatorRequestService = new RegulatorRequestService({
    db: getDb() as unknown as never,
    logger,
    auditSink: createPinoAuditSink(logger) as unknown as never,
  });
  api.route(
    '/regulator',
    (() => {
      const sub = new Hono();
      sub.route(
        '/requests',
        createRegulatorRequestsRouter({ service: regulatorRequestService }),
      );
      return sub;
    })(),
  );
}
// Issue #194 chain C-B — licence renewal flow under /api/v1/compliance.
{
  const renewalService = new LicenceRenewalService({
    db: getDb() as unknown as never,
    logger,
    auditSink: createPinoAuditSink(logger) as unknown as never,
  });
  api.route(
    '/compliance',
    createLicenceRenewalRouter({ service: renewalService }),
  );
  // Background watcher — opens reminder events on the 90/60/30/14/7/1
  // ladder so the cockpit pulses without the owner having to poll.
  const watcher = startLicenceRenewalWatcher({
    db: getDb() as unknown as never,
    logger,
  });
  watcher.start();
}
// Issue #194 chain C-C — AI-assisted inspection narratives under
// /api/v1/compliance. The `loadInspection` resolver is a no-op stub
// in MVP — a follow-on phase wires it to `pre_shift_inspections`.
{
  const narrativeService = new InspectionNarrativeService({
    db: getDb() as unknown as never,
    logger,
    auditSink: createPinoAuditSink(logger) as unknown as never,
  });
  api.route(
    '/compliance',
    createInspectionNarrativeRouter({ service: narrativeService }),
  );
}
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
// Commercial chain L7 — buyer's at-rest notification queue.
api.route('/buyer/notifications', buyerNotificationsRouter);
// B6 — buyer-persona superpowers (bulk-action / undo / pinned / search).
api.route('/buyer/superpowers', buyerSuperpowersRouter);
// Surface-completion SC-6 — the buyer leg of owner-spawn tab projection
// (per-membership-scoped, explicit buyerProjection opt-in only).
api.route('/buyer/tabs', buyerTabProjectionRouter);
api.route('/buyer/inquiries', buyerInquiriesRouter);
// Commercial chain L8 — sign-delivery → ledger → payout. Mounted at
// /api/v1/marketplace/rfb-responses to match the spec.
api.route('/marketplace/rfb-responses', rfbResponsesRouter);
// MS-3 — `/marketplace-universal` (universalMarketplaceRouter) unmounted:
// dead property-residual surface; its in-memory seeded data port was
// already killed. Use the mining marketplace + RFB surfaces instead.
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
// LP-25 / LP-30 — unified channel ingress + USSD. Mounted at
// /api/v1/webhooks/channels/:channel (POST) and
// /api/v1/webhooks/channels/ussd/session (POST). Signature is verified
// FIRST on the raw body (fail-closed); an invalid signature returns 400
// and never reaches the brain. Sender->tier is fail-soft (anonymous on
// no match). In-memory stores by default; production injects Redis-backed
// conversation + USSD session stores.
api.route('/webhooks/channels', createChannelsRouter());
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
// HR onboarding chain L-A (issue #193) — owner posts openings + manager reviews.
api.route('/workforce/openings', workforceOpeningsRouter);
// Payroll chain L-B (issue #193) — owner runs period payroll + commits via LedgerService.post().
api.route('/owner/payroll', ownerPayrollRouter);
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
// Modality artifacts — fetch the artifact (forecast JSON / document archive
// refs / media descriptor) behind a surfaced modality PROPOSAL so owner-web's
// GenUITabHost renders it on Open. Read-only; never mutates a tab.
api.route('/modality-artifacts', createModalityArtifactsRouter());
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
  // R20 / KI-013 — bind copilot from the composition root. Null until
  // ANTHROPIC_API_KEY + ai-copilot deps are wired (OA-003); the router
  // already falls back to the 501 / dev-flag path when missing.
  // exactOptionalPropertyTypes forbids passing `undefined`, so we
  // conditionally spread.
  ...(serviceRegistry.migrationWizardCopilot
    ? { migrationWizardCopilot: serviceRegistry.migrationWizardCopilot }
    : {}),
});
// Notification preferences — owner-settings-2 fix.
//
// The previous binding was an in-memory ECHO stub: GET always returned a
// hard-coded empty shape and PUT echoed the body back without persisting,
// so every owner toggle silently reverted on the next refetch (data loss).
//
// The `createNotificationPreferencesRouter` DI contract is SYNCHRONOUS — the
// router calls `getPreferences(...)` / `upsertPreferences(...)` and hands the
// return straight to `c.json(...)` with no `await`. We therefore back it with
// a process-durable in-memory store (`notificationPreferencesStore`) keyed by
// `${tenantId}::${userId}`, with IMMUTABLE snapshots (never mutate a stored
// object — every upsert builds a fresh frozen record). This removes the
// user-observable data-loss bug: a saved preference now survives the
// post-save refetch and every subsequent GET for the life of the gateway.
//
// CROSS-PROCESS DURABILITY (recorded for the schema-owning agent): a fully
// cross-restart-durable fix additionally needs (1) a `notification_preferences`
// Drizzle table matching this shape (channels map, templates record,
// quietHoursStart/End) under packages/database, and (2) the router upgraded to
// an ASYNC DI it can `await`. The store below is the gateway-owned slice of
// that fix and is the seam those two changes plug into.
type NotifPrefs = Readonly<{
  channels: Readonly<Record<string, boolean>>;
  templates: Readonly<Record<string, boolean>>;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}>;
type NotifPrefsPatch = Partial<{
  channels: Record<string, boolean>;
  templates: Record<string, boolean>;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}>;
const NOTIF_PREFS_DEFAULT: NotifPrefs = Object.freeze({
  channels: Object.freeze({}),
  templates: Object.freeze({}),
  quietHoursStart: null,
  quietHoursEnd: null,
});
const notifPrefsKey = (userId: string, tenantId: string) =>
  `${tenantId}::${userId}`;
// Merge a patch onto the prior snapshot IMMUTABLY so partial updates (e.g.
// only `channels`) never clobber unrelated fields.
const mergeNotifPrefs = (prior: NotifPrefs, input: unknown): NotifPrefs => {
  const patch = (input ?? {}) as NotifPrefsPatch;
  return Object.freeze({
    channels: Object.freeze({ ...prior.channels, ...(patch.channels ?? {}) }),
    templates: Object.freeze({ ...prior.templates, ...(patch.templates ?? {}) }),
    quietHoursStart:
      patch.quietHoursStart !== undefined
        ? patch.quietHoursStart
        : prior.quietHoursStart,
    quietHoursEnd:
      patch.quietHoursEnd !== undefined
        ? patch.quietHoursEnd
        : prior.quietHoursEnd,
  });
};
// owner-settings-2 — DURABLE notification preferences. The prior impl was an
// in-memory echo stub (lost on restart / reverted on the next GET). Back the
// router with the `notification_preferences` table (migration 0329) over the
// same tenant-scoped `$client.unsafe` boundary the widget-data / record-store
// ports use; rows are explicitly scoped by (tenant_id, user_id) and the table
// FORCE-enables RLS. When the DB is unbound (dev/test) we fall back to a
// process-durable in-memory Map so unit tests run without Postgres.
const notificationPreferencesRouter = ((): ReturnType<
  typeof createNotificationPreferencesRouter
> => {
  const notifDb = getDb();
  const notifClient = notifDb
    ? (notifDb as unknown as {
        $client: {
          unsafe<Row = Record<string, unknown>>(
            sql: string,
            params?: ReadonlyArray<unknown>,
          ): Promise<ReadonlyArray<Row>>;
        };
      }).$client
    : null;

  if (!notifClient) {
    const store = new Map<string, NotifPrefs>();
    return createNotificationPreferencesRouter({
      getPreferences: (userId, tenantId) =>
        store.get(notifPrefsKey(userId, tenantId)) ?? NOTIF_PREFS_DEFAULT,
      upsertPreferences: (userId, tenantId, input) => {
        const key = notifPrefsKey(userId, tenantId);
        const next = mergeNotifPrefs(
          store.get(key) ?? NOTIF_PREFS_DEFAULT,
          input,
        );
        store.set(key, next);
        return next;
      },
    });
  }

  type PrefsRow = {
    channels: Record<string, boolean> | null;
    templates: Record<string, boolean> | null;
    quiet_hours_start: string | null;
    quiet_hours_end: string | null;
  };
  const rowToPrefs = (row: PrefsRow | undefined): NotifPrefs =>
    row
      ? Object.freeze({
          channels: Object.freeze(row.channels ?? {}),
          templates: Object.freeze(row.templates ?? {}),
          quietHoursStart: row.quiet_hours_start ?? null,
          quietHoursEnd: row.quiet_hours_end ?? null,
        })
      : NOTIF_PREFS_DEFAULT;

  const dbGet = async (
    userId: string,
    tenantId: string,
  ): Promise<NotifPrefs> => {
    try {
      const rows = await notifClient.unsafe<PrefsRow>(
        `SELECT channels, templates, quiet_hours_start, quiet_hours_end
           FROM notification_preferences
          WHERE tenant_id = $1 AND user_id = $2
          LIMIT 1`,
        [tenantId, userId],
      );
      return rowToPrefs(rows[0]);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'notification-preferences: read failed (degrading to default)',
      );
      return NOTIF_PREFS_DEFAULT;
    }
  };

  return createNotificationPreferencesRouter({
    getPreferences: dbGet,
    upsertPreferences: async (userId, tenantId, input) => {
      const next = mergeNotifPrefs(await dbGet(userId, tenantId), input);
      try {
        const rows = await notifClient.unsafe<PrefsRow>(
          `INSERT INTO notification_preferences
             (tenant_id, user_id, channels, templates,
              quiet_hours_start, quiet_hours_end, updated_at)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, now())
           ON CONFLICT (tenant_id, user_id) DO UPDATE SET
             channels = EXCLUDED.channels,
             templates = EXCLUDED.templates,
             quiet_hours_start = EXCLUDED.quiet_hours_start,
             quiet_hours_end = EXCLUDED.quiet_hours_end,
             updated_at = now()
           RETURNING channels, templates, quiet_hours_start, quiet_hours_end`,
          [
            tenantId,
            userId,
            JSON.stringify(next.channels),
            JSON.stringify(next.templates),
            next.quietHoursStart,
            next.quietHoursEnd,
          ],
        );
        return rowToPrefs(rows[0]) ?? next;
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'notification-preferences: upsert failed',
        );
        return next;
      }
    },
  });
})();
// Webhooks terminate here and forward deliveries via the same event bus
// the rest of the services use, so a downstream subscriber in the
// notifications service can persist status updates.
// Redis-backed webhook idempotency so a duplicate delivery callback (Twilio
// retries; at-least-once webhooks) never double-applies. Without it the
// idempotency middleware fails-loud (503) for any keyed callback — so a real
// Twilio receipt could never reach onDeliveryStatus. Mirror the rate-limit
// redis bootstrap. When REDIS_URL is unset (dev/test) keyed callbacks 503 by
// design; keyless providers (AT / Meta) still pass through.
const webhookIdempotencyRedis = (() => {
  if (!process.env.REDIS_URL) {
    logger.info(
      'notification-webhooks: REDIS_URL unset — keyed delivery callbacks 503 (fail-loud) in dev',
    );
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ioredisMod = require('ioredis');
    const RedisCtor = ioredisMod?.default ?? ioredisMod?.Redis ?? ioredisMod;
    const client = new RedisCtor(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    client.on?.('error', (err: Error) => {
      logger.warn(
        { err: err.message },
        'notification-webhooks: redis client error (idempotency degraded)',
      );
    });
    logger.info('notification-webhooks: Redis-backed idempotency enabled');
    return client;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'notification-webhooks: failed to init idempotency redis',
    );
    return null;
  }
})();
const notificationWebhooksRouter = createNotificationWebhookRouter({
  idempotencyRedis: webhookIdempotencyRedis,
  logger: { error: (meta, msg) => logger.error(meta as object, msg) },
  onDeliveryStatus: async (update) => {
    // 1) CLOSE THE LOOP — persist the provider-confirmed receipt onto the
    //    matching dispatch-log row so tracking/closing actually closes (was a
    //    born-dark event with zero subscribers). Service-role: the table is
    //    FORCE-RLS. Correlate by the REAL resolved tenant + provider_message_id.
    if (update.providerMessageId && serviceRegistry.db) {
      const pmid = update.providerMessageId;
      // Bind as an ISO string, NOT a Date object — Drizzle's tx.execute (this
      // runs inside withServiceRoleContext) rejects a raw Date param with
      // ERR_INVALID_ARG_TYPE ("Received an instance of Date"); a timestamptz
      // accepts the ISO string fine.
      const at = update.occurredAt.toISOString();
      try {
        await withServiceRoleContext(serviceRegistry.db, async (tx) => {
          if (update.status === 'delivered') {
            await tx.execute(drizzleSqlTag`
              UPDATE notification_dispatch_log
                 SET delivered_at = ${at}, updated_at = now()
               WHERE tenant_id = ${update.tenantId} AND provider_message_id = ${pmid}`);
          } else if (update.status === 'read') {
            await tx.execute(drizzleSqlTag`
              UPDATE notification_dispatch_log
                 SET read_at = ${at},
                     delivered_at = COALESCE(delivered_at, ${at}),
                     updated_at = now()
               WHERE tenant_id = ${update.tenantId} AND provider_message_id = ${pmid}`);
          } else if (update.status === 'failed') {
            await tx.execute(drizzleSqlTag`
              UPDATE notification_dispatch_log
                 SET bounced_at = ${at},
                     bounce_reason = ${`${update.provider}:${update.status}`},
                     delivery_status = 'failed',
                     updated_at = now()
               WHERE tenant_id = ${update.tenantId} AND provider_message_id = ${pmid}`);
          } else if (update.status === 'sent') {
            await tx.execute(drizzleSqlTag`
              UPDATE notification_dispatch_log
                 SET delivery_reported_at = COALESCE(delivery_reported_at, ${at}),
                     updated_at = now()
               WHERE tenant_id = ${update.tenantId} AND provider_message_id = ${pmid}`);
          }
        });
      } catch (err) {
        logger.error(
          {
            err: err instanceof Error ? err.message : String(err),
            providerMessageId: pmid,
          },
          'notification-webhook: failed to persist delivery receipt',
        );
      }
    }
    // 2) Fan the receipt onto the event bus (SSE / other listeners) with the
    //    REAL tenant (was hard-coded 'system').
    try {
      await serviceRegistry.eventBus.publish({
        event: {
          eventId: `webhook_${Date.now()}`,
          eventType: 'NotificationDeliveryStatus',
          timestamp: new Date().toISOString(),
          tenantId: update.tenantId,
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
// Wave 11 — public marketing (Mr. Mwikila, unauthenticated) + AI workflow engine.
// The mining public chat owns /public/chat. The legacy real-estate
// marketing-brain router (public-marketing.router.ts) was REMOVED: its /chat
// only shadow-collided with this one (a reorder would have silently reverted
// the marketing chat to canned property text), and its /pricing-advice +
// /demo-estate + /waitlist routes were unreferenced by any app.
api.route('/public', publicChatRouter);
api.route('/public/sandbox', publicSandboxRouter);
api.route('/public/leads', publicLeadsRouter);
api.route('/public/status', publicStatusRouter);
// SAFE-LIST tools surface for the unauthenticated marketing widget.
// READ-ONLY, no tenant data, no auth, bilingual sw/en. See
// `routes/public-tools.hono.ts` for the security posture (10/min/session
// rate cap, SAFE-LIST gate, no PII echo, no DB writes).
api.route('/public/tools', publicToolsRouter);
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
// Flow-keyed autonomy posture + creation-time auto-vs-gated confirmation
// (migration 0308). Mounted as a sibling segment so the literal
// `/workflow/flow-autonomy` paths never collide with `/workflow/runs/:id`.
api.route('/workflow/flow-autonomy', flowAutonomyRouter);
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
// REMOVED (borjie hard-fork): api.route('/platform/overview', platformOverviewRouter)
// — queried deleted property tables (units, payments).
// Phase B Wave 30 — Task-Agents (narrow-scope single-job agents + manual runs)
api.route('/task-agents', taskAgentsRouter);
// Wave 27 Agent E — Tenant Branding (per-tenant AI persona identity)
api.route('/tenant-branding', tenantBrandingRouter);
// Phase D D7 — Persona Registry admin CRUD (SUPER_ADMIN / ADMIN only).
// Reads `services.personaRegistry` (kernel PersonaRegistry from
// the Drizzle-backed store); returns 503 NOT_IMPLEMENTED when null.
api.route('/persona-registry', personaRegistryRouter);
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
// Regulator-facing CoT reservoir read-back (DSAR / accountability surface).
api.route('/admin/cot-query', cotQueryRouter());
// KI-011 — persona-drift events read surface for admin-web. Mounted at
// /api/v1/persona-drift/events (the literal the client polls). Admin-role +
// tenant-scoped (RLS-bound) read of persisted kernel_persona_drift_events.
api.route('/persona-drift', createPersonaDriftRouter());
// Generative jurisdiction unlock — the governed launch-market registry.
api.route('/admin/jurisdictions', createJurisdictionPromotionRouter());
// Universal integration fabric — un-darks the 21 connector packages behind
// one generic, governed, honest-degrading dispatch surface.
api.route('/integrations/connectors', createConnectorsRouter());
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
// Real Holt-Winters forecasts (cash-flow / production / royalty).
// Mounted before any /owner/* wildcards so the specific path wins.
api.route('/owner/forecasts', ownerForecastsRouter);
api.route('/owner/docs', ownerDocsRouter);
api.route('/owner/forms', ownerFormsRouter);
api.route('/owner/drafts', ownerDraftsRouter);
api.route('/owner/reminders', ownerRemindersRouter);
// Wave SELF-ACTING-MD K5 — GET/PUT /owner/contact-prefs (ordered channel priority).
api.route('/owner/contact-prefs', ownerContactPrefsRouter);
// Wave CHAT-ACTIONS — POST /owner/chat/micro-action + /owner/chat/confirm-action.
// Mounted before the generic /owner/* wildcards so the specific path wins.
api.route('/owner/chat', ownerChatActionsRouter);
api.route('/owner/tabs', ownerTabsRouter);
// Wave SUPERPOWERS - chat-callable surface for share / undo / bookmark /
// bulk. The public token resolver is mounted OUTSIDE auth (token-only).
api.route('/owner/share-links', ownerShareLinksRouter);
api.route('/owner/undo-journal', ownerUndoJournalRouter);
api.route('/owner/pinned-items', ownerPinnedItemsRouter);
api.route('/owner/superpowers', ownerSuperpowersRouter);
// Admin counterpart — only the bulk-action verb-set differs.
api.route('/admin/superpowers', adminSuperpowersRouter);
// JC-7 admin jurisdiction override (four-eye). Mounted at the api root —
// the router's own paths are absolute (/admin/tenants/:id/jurisdiction…).
// Auth-guarded inside the factory (authMiddleware + requireRole +
// admin-context pin). Backed by jurisdiction_proposals (migration 0322).
api.route(
  '/',
  createMountedAdminTenantJurisdictionRouter({
    db: getDb() as unknown as { execute(q: unknown): Promise<unknown> },
    logger: {
      info: (message, meta) => logger.info({ ...(meta ?? {}) }, message),
      warn: (message, meta) => logger.warn({ ...(meta ?? {}) }, message),
      error: (message, meta) => logger.error({ ...(meta ?? {}) }, message),
    },
  }),
);
// Damage-settlement (migration 0279) — POST / (file), GET /open, GET /:id,
// POST /:id/respond, POST /:id/settle, POST /rehabilitation-plans/:planId/
// action-plans/:actionPlanId/approve. Wraps the site.damage_claim.* /
// site.rehabilitation.approve_plan brain tools' real routes.
api.route('/damage-claims', damageClaimsRouter);
// Org / team-management (migration 0280) — POST /staff, POST /staff/kpis,
// POST /tasks, POST /escalations, POST /staff/bulk-csv. Wraps the staff.*
// brain tools' real routes (owner / admin role only; full audit + provenance).
api.route('/org-admin', orgAdminRouter);
// Training scenarios + mastery checkpoint (migration 0283) — GET /, POST
// /generate, POST /sessions(+/:id/turn, /:id/complete), GET /checkpoint, POST
// /checkpoint/submit. Concept-catalog-grounded rehearsal surface; honest-
// degrades to a typed 503 when the DB client is unset (gap 13). Backs
// owner-web /training/scenarios + /training/checkpoint.
api.route('/scenarios', scenariosRouter);
// AI course-generation (migration 0284) — POST /generate (202 + detached
// generation), GET /, GET /:id. Owner-scoped on top of RLS; honest-degrades to
// the deterministic concept-catalog sequencer when no LLM key is configured.
// Backs owner-web /training/create-course + /training/course/[id].
api.route('/courses', coursesRouter);
// Agentic plan / subagent + sandbox (migration 0281) — POST /plans, POST
// /subagents/dispatch, GET /subagents/:teamRunId/aggregate, POST /sandbox/
// writes, GET /sandbox/writes, POST /sandbox/writes/:id/commit, POST /sandbox/
// writes/:id/reject. Wraps the plan.* / sandbox.* brain tools' real routes
// (owner / admin role only; commit validates payload + FK before atomic write).
api.route('/md-agentic', mdAgenticRouter);
// Admin Control Tower — GET /controls + POST /toggle (+ /toggle/:id/approve).
// Each toggle drives a real platform control; HIGH-impact ones are four-eye
// gated and only mutate state on the second-eye approval. SOC2-audited.
api.route('/admin/control-tower', adminControlTowerRouter);
// Admin Control Plane — GET/PUT /powers, GET/PUT /llm-routing, GET
// /model-catalog, POST /ai-suggest. Admin-only (SUPER_ADMIN | ADMIN);
// platform-config only (no tenant business data); each mutation is
// hash-chain audited + recorded in the undo journal. The routing config
// changes WHICH model answers, never WHETHER a sovereign action runs.
api.route('/admin/control-plane', adminControlPlaneRouter);
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
// Wave 3 (W3c) — the self-build proposal surface (SUPER_ADMIN + four-eye gated,
// propose-only — never auto-applies). Mounted BEFORE the broad /internal route
// so the more-specific /internal/modules prefix wins.
api.route('/internal/modules', internalModulesRouter);
// Brain-tool loopback routers — MUST mount BEFORE the broad `/internal` route
// below so their more-specific prefixes win first-match lookup (the
// route-shadow law). Each is the backing endpoint for a previously born-dark
// persona-tool whose handler POSTs to `/internal/...` over the loopback client.
api.route('/internal/entity-legibility', internalEntityLegibilityRouter);
api.route('/internal/brain', internalBrainLoopbackRouter);
api.route('/internal/documents', internalBrainLoopbackRouter);
api.route('/internal/jurisdiction-discovery', internalJurisdictionDiscoveryRouter);
api.route('/internal', workforceTabPolicyAdminRouter);api.route('/support', supportRouter);
api.route('/admin', adminUsersRouter);
// REMOVED (borjie hard-fork): /units/:id/{subdivision,components} — queried
// deleted property tables (units, assetComponents).

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
    // REMOVED (borjie hard-fork): { prefix: '/cases', app: casesRouter, defaultTag: 'cases' },
    { prefix: '/brain', app: brainRouter, defaultTag: 'brain' },
    // REMOVED (borjie hard-fork): { prefix: '/maintenance', app: maintenanceRouter, ... },
    // REMOVED (borjie hard-fork): { prefix: '/hr', app: hrRouter, ... },
    { prefix: '/customer', app: customerAppRouter, defaultTag: 'bff-customer' },
    { prefix: '/owner', app: ownerPortalRouter, defaultTag: 'bff-owner' },
    // REMOVED (borjie hard-fork): { prefix: '/manager', app: estateManagerAppRouter, defaultTag: 'bff-manager' },
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
    // MS-3 — `/marketplace-universal` registry entry removed (router unmounted).
    { prefix: '/migration', app: migrationRouter as unknown as Hono, defaultTag: 'migration' },
// REMOVED (borjie hard-fork):     { prefix: '/negotiations', app: negotiationsRouter, defaultTag: 'negotiations' },
    { prefix: '/me/notification-preferences', app: notificationPreferencesRouter, defaultTag: 'notifications' },
    { prefix: '/me/device-tokens', app: meDeviceTokensRouter, defaultTag: 'notifications' },
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
// REMOVED (borjie hard-fork): the Cases SLA worker supervisor. The `cases`
// table (rent-arrears / eviction / deposit-dispute) is residential-property
// residue dropped in 0003_mining_domain.sql; mining uses the `grievances`
// subsystem as its equivalent. The supervisor, worker, repo, route and
// domain module were fully removed on 2026-06-14.

// Learning Amplification (LitFin port) — boot the wiring once so
// recordObservation()/runAmplification() can resolve the Supabase
// service-role client, then construct the nightly cron handle. Both
// degrade to no-ops when env is unset (recorder bumps in-memory
// dropped counter; job returns a zero summary).
createLearningAmplificationWiring({ logger });
const learningAmplificationCron = createLearningAmplificationCron({ logger });

// R8 — AOP meta-learning loop. Observes candidate AOP versions persisted
// in the registry store (aop_specs / aop_regression_sets /
// aop_active_versions), regression-replays each candidate against its
// historical-transcript set through the budget-guarded Anthropic client,
// and walks winners up the canary ladder (shadow → 1% → 5% → 25% → live)
// ONE rung per tick — activation flips ONLY through the factories' own
// regression+canary gate. Honest-degrade: no Anthropic key ⇒ candidates
// HELD at their stage (no fake passes); no DB ⇒ the null store yields
// zero candidates. Kill-switch: BORJIE_AOP_META_LOOP=off.
const aopMetaLoopCron = createAopMetaLoopCron({
  store: serviceRegistry.persistentStores.aopRegistryStore,
  executor: createAnthropicAopExecutor({
    buildBudgetGuardedAnthropicClient:
      serviceRegistry.buildBudgetGuardedAnthropicClient,
  }),
  logger: createPinoLikeLogger('aop-meta-loop'),
});

// LOOP-ECONOMY — the brain's standing cognitive loops. Registers the
// builtin forecast-surprise loop (active inference: compare world-model
// forecasts against actuals, surface the sharpest violations as learning
// signals), folds the durable per-tenant situational snapshot each tick,
// runs the substrate's PURE scheduler, and routes every decided action
// through the GOVERNED proactive proposal sink (idempotent drive-keyed
// proactive_nudge — never a direct write). READ+LEARN only; loop efficacy
// is scored back onto the registry (reflexion EMA). No formed-loop
// persistence store exists yet — builtins only, logged honestly.
// Kill-switch: BORJIE_LOOP_ECONOMY=off. Degraded mode (no db): the loop
// registers DORMANT and every tick is a free no-op.
const loopEconomyCron = createLoopEconomyCronFromDb({
  db: (serviceRegistry.db as unknown as
    | (typeof serviceRegistry.db & { execute(q: unknown): Promise<unknown> })
    | null) ?? null,
  logger: createPinoLikeLogger('loop-economy'),
});

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

// DETECTION (mining licence-expiry). Daily scan of the mining `licences`
// table against the 60/30/7/1-day expiry windows: enqueues one pending
// notification_dispatch_log row per (licence, window) (channel=email,
// template=licence.expiry_warning), idempotent via idempotency_key, wrapped
// in withServiceRoleContext. The dispatch drain worker delivers them. This
// replaces the BossNyumba lease no-op (leases/customers tables were excised
// in the mining hard-fork) AND its dead silent-success sender stub — the
// time-based reminder DETECTION leg was previously dark. No-op in degraded
// mode (no DB).
const licenceExpiryCron = serviceRegistry.db
  ? createLicenceExpiryAlertCron({
      db: serviceRegistry.db as Parameters<
        typeof createLicenceExpiryAlertCron
      >[0]['db'],
      logger,
    })
  : {
      start() {},
      stop() {},
      async tickOnce() {
        return {
          scanned: 0,
          enqueued: 0,
          skippedAlreadySent: 0,
          failed: 0,
          byWindow: {},
        };
      },
    };

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
      db: serviceRegistry.db as unknown as never,
      logger,
    })
  : { start() {}, stop() {}, async tickOnce() { return { scanned: 0, executed: 0, failed: 0, skipped: 0 }; } };

// Wave NOTIFICATION-DISPATCH-WIRE — parse the optional reminder
// quiet-hours window from env. QUIET_HOURS_START / QUIET_HOURS_END are
// local hours (0-23; a leading "HH" of an "HH:MM" string is accepted).
// Returns undefined unless BOTH bounds are valid, leaving quiet-hours
// off by default. This file is the bootstrap, so reading process.env
// here is allowed.
function parseQuietHoursEnv(): { startHour: number; endHour: number } | undefined {
  const h = (v: string | undefined): number | null => {
    if (!v) return null;
    const n = Number.parseInt(v.split(':')[0] ?? '', 10);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
  };
  const start = h(process.env.QUIET_HOURS_START);
  const end = h(process.env.QUIET_HOURS_END);
  return start === null || end === null ? undefined : { startHour: start, endHour: end };
}

// Wave OWNER-OS — reminders dispatch worker. Polls the `reminders`
// table every 30s and ships rows by email (SendGrid/SES via env), SMS
// (Africa's Talking / Twilio composite), or Slack webhook. Disabled
// transparently when DATABASE_URL is unset (degraded mode). Single
// no-op tick is returned so callers can still invoke tickOnce in tests.
// Dedicated SMALL service-role pool for the out-of-band notification workers
// (drain / reminders / fan-out). Their withServiceRoleContext transactions run
// on a tight loop; isolating them from the main request pool keeps both under
// the Supabase session-pooler client ceiling (see db-client.ts). Falls back to
// the shared client when the dedicated pool can't be opened.
const notificationWorkerDb =
  getServiceRoleWorkerClient() ?? serviceRegistry.db;
const remindersDispatchWorker = serviceRegistry.db
  ? createRemindersDispatchWorker({
      db: notificationWorkerDb as unknown as { execute(q: unknown): Promise<unknown> },
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
      // Wave NOTIFICATION-DISPATCH-WIRE — per-owner IANA tz feeds the
      // reminder quiet-hours window. The window itself is opt-in via
      // QUIET_HOURS_START / QUIET_HOURS_END (local hours, 0-23); absent
      // env leaves quiet-hours disabled (every reminder ships on time).
      timezoneForOwner: makeTimezoneForOwner(
        serviceRegistry.db as unknown as Parameters<typeof makeTimezoneForOwner>[0],
      ),
      ...(parseQuietHoursEnv() ? { quietHours: parseQuietHoursEnv()! } : {}),
      intervalMs: Number(process.env.BORJIE_REMINDERS_INTERVAL_MS ?? 30_000) || 30_000,
      // No-reminder-slips sweep: a 'sent' but un-acknowledged reminder is
      // re-fired after this window (bounded by maxNudges), then escalated — so
      // an owner who misses a single fired deadline reminder still gets a
      // second nudge and a loud escalation (the SOTA follow-up/closing
      // guarantee). Default ON at 24h; the owner acks to stop. Set
      // BORJIE_REMINDERS_RE_REMIND_MS=0 to disable the sweep.
      reRemindAfterMs: Number(process.env.BORJIE_REMINDERS_RE_REMIND_MS ?? 86_400_000) || 0,
      maxNudges: Number(process.env.BORJIE_REMINDERS_MAX_NUDGES ?? 2) || 2,
      enabled: process.env.NODE_ENV !== 'test' && process.env.BORJIE_REMINDERS_WORKER_DISABLED !== 'true',
    })
  : { start() {}, stop() {}, async tickOnce() { return { claimed: 0, sent: 0, failed: 0, retried: 0, deferred: 0, reRemindNudged: 0, escalated: 0 }; } };

// ── Wave-C C4 — proactive-intel regulation readers (owner-resolver + posture) ─
// Both built from EXISTING services: the `users(tenant_id, is_owner)` SELECT the
// mwikila-autonomous worker already uses, and the durable owner-style service over
// the Drizzle `owner_style_profiles` store. Fail-safe: any read fault degrades to
// the neutral path (no owner → affect/trust skipped; balanced posture).

/**
 * Resolve a tenant's primary owner user-id — the per-user key the affect/trust
 * readers need (the worker is tenant-scoped). Mirrors the proven
 * `users(tenant_id, is_owner)` lookup; returns null on any miss.
 */
function createTenantOwnerResolver(
  db: { execute(q: unknown): Promise<unknown> },
  log: typeof logger,
): ProactiveOwnerResolver {
  return {
    async ownerForTenant(tenantId: string): Promise<string | null> {
      try {
        const result = await db.execute(drizzleSqlTag`
          SELECT u.id AS owner_user_id
            FROM users u
           WHERE u.tenant_id = ${tenantId}
             AND u.is_owner  = TRUE
             AND u.status    = 'active'
           ORDER BY u.created_at ASC
           LIMIT 1
        `);
        const rows = Array.isArray(result)
          ? (result as ReadonlyArray<Record<string, unknown>>)
          : (((result as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
              []) as ReadonlyArray<Record<string, unknown>>);
        const id = rows[0]?.owner_user_id;
        return typeof id === 'string' && id.length > 0 ? id : null;
      } catch (err) {
        log.debug(
          { worker: 'proactive-intel', tenantId, err: err instanceof Error ? err.message : String(err) },
          'proactive-intel: ownerForTenant lookup failed; neutral context',
        );
        return null;
      }
    },
  };
}

/**
 * Owner-style posture reader — the FIRST live consumer of the durable
 * owner-style posterior. Reads `getProfile(tenantId).posture.value`
 * (cautious|balanced|bold). Built over the Drizzle `owner_style_profiles` store;
 * degrades to 'balanced' on any miss.
 */
function createOwnerStylePostureReader(
  db: NonNullable<typeof serviceRegistry.db>,
  log: typeof logger,
): ProactivePostureReader {
  const service = createOwnerStyleService({
    store: createPgOwnerStyleProfileStore(
      db as unknown as Parameters<typeof createPgOwnerStyleProfileStore>[0],
    ) as unknown as NonNullable<
      NonNullable<Parameters<typeof createOwnerStyleService>[0]>['store']
    >,
  });
  return {
    async postureForTenant(tenantId: string): Promise<ProactivePosture> {
      try {
        const profile = await service.getProfile(tenantId);
        const value = profile.posture?.value;
        return value === 'cautious' || value === 'bold' ? value : 'balanced';
      } catch (err) {
        log.debug(
          { worker: 'proactive-intel', tenantId, err: err instanceof Error ? err.message : String(err) },
          'proactive-intel: postureForTenant failed; balanced',
        );
        return 'balanced';
      }
    },
  };
}

// Wave 2 (W2b) — proactive-intel worker. Runs the previously-DARK proactive-intel
// detectors + recommendation composer per active tenant on a cadence and routes
// each insight onto the cockpit bus (publishCockpitEvent → mwikila.proposes), so
// the MD finally surfaces proactive insights. Honest-degrades to idle (warn-once)
// until a live per-tenant TickInputs provider is injected; never crashes boot.
const proactiveIntelWorker = serviceRegistry.db
  ? createProactiveIntelWorker({
      db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
      logger,
      publish: publishCockpitEvent,
      // W3a — the LIVE per-tenant data feed. Without it the worker idles; with it
      // the detectors read real cashflow / royalty-arrears / churn signals over
      // the same tenant-scoped $client.unsafe port the record store uses (RLS
      // FORCE backstops). A missing/empty source → neutral default (detector
      // self-skips), never a fabricated signal.
      // Each slice query is per-tenant (tenantId is params[0]); the worker
      // bypasses databaseMiddleware so it carries NO ambient GUC. Pin ONE
      // connection via $client.begin and bind the tenant GUC (txn-local, both
      // names) on it before the raw read, else FORCE-RLS zeroes
      // cash_balances/forecasts/sales/buyers silently. Empty tenantId →
      // neutral [] (the detector self-skips), never a fabricated signal.
      inputsForTenant: createTickInputsProvider({
        query: {
          query: async <Row = Record<string, unknown>>(
            sql: string,
            params?: ReadonlyArray<unknown>,
          ): Promise<ReadonlyArray<Row>> => {
            const client = (
              serviceRegistry.db as unknown as {
                $client: {
                  begin<T>(
                    fn: (tx: {
                      unsafe<R = Record<string, unknown>>(
                        s: string,
                        p?: ReadonlyArray<unknown>,
                      ): Promise<ReadonlyArray<R>>;
                    }) => Promise<T>,
                  ): Promise<T>;
                };
              }
            ).$client;
            const tenantId = String((params ?? [])[0] ?? '');
            if (tenantId.length === 0) return [] as ReadonlyArray<Row>;
            return client.begin(async (tx) => {
              await tx.unsafe(
                "SELECT set_config('app.current_tenant_id', $1, true)",
                [tenantId],
              );
              await tx.unsafe(
                "SELECT set_config('app.tenant_id', $1, true)",
                [tenantId],
              );
              return tx.unsafe<Row>(sql, (params ?? []) as ReadonlyArray<unknown>);
            });
          },
        },
        logger,
      }),
      // ── Wave-C C4 — proactive affect-gating + earned-trust delegation ──────
      // (1) behaviorSignalSource: the LIVE ambient ribbon (sovereign.ts) — the
      //     affect gate goes quiet under frustration/flow, leans in under
      //     disengagement. (2) ownerResolver: maps a tenant → its primary owner
      //     user-id (the affect/trust readers are per-user; the worker is
      //     tenant-scoped) via the SAME `users(tenant_id, is_owner)` SELECT the
      //     mwikila-autonomous worker uses. (3) postureReader: owner-style's
      //     first live consumer (cautious|balanced|bold tilts the trust floor).
      // (4) affectReader (ToM trust) — NOW WIRED. It delegates to the SHARED
      // per-tenant affective accumulator (`getAffectAccumulator(tenantId)`),
      // which is the SAME instance the chat turns `observe(...)` into (injected
      // into every cached brain in sovereign.ts via `mutable.affectiveAccumulator`).
      // So the earned-trust resolver now reads a LIVE per-owner trust posterior
      // and ADAPTS (was conservative-neutral). The accumulator is pure in-memory
      // + 24h-TTL-evicting and `read(...)` returns null until the first turn
      // populates it, so this honest-degrades to the prior neutral posture on a
      // cold worker — never throws, no DB dependency.
      affectReader: {
        read: (tenantId: string, userId: string, nowMs?: number) =>
          getAffectAccumulator(tenantId).read(tenantId, userId, nowMs),
      },
      ...(getProactiveBehaviorSignalSource()
        ? { behaviorSignalSource: getProactiveBehaviorSignalSource()! }
        : {}),
      ownerResolver: createTenantOwnerResolver(
        serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
        logger,
      ),
      postureReader: createOwnerStylePostureReader(
        serviceRegistry.db,
        logger,
      ),
      intervalMs: Number(process.env.BORJIE_PROACTIVE_INTEL_INTERVAL_MS ?? 1_800_000) || 1_800_000,
      enabled: process.env.NODE_ENV !== 'test' && process.env.BORJIE_PROACTIVE_INTEL_WORKER_DISABLED !== 'true',
    })
  : { start() {}, stop() {}, async tickOnce() { return { tenants: 0, detected: 0, delivered: 0 }; } };

// Wave 2 (W2d) — KG sync worker. Every 6h (env BORJIE_KG_SYNC_INTERVAL_MS) walks
// every active tenant and runs the registry-driven ingestKnowledgeGraph pass so
// kg_nodes/kg_edges stay fresh for GraphRAG without a manual POST (declarative
// INGEST_SOURCE registry — every domain, not 5 hardcoded tables). Idempotent.
const kgSyncWorker = serviceRegistry.db
  ? createKgSyncWorker({
      db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
      logger,
      intervalMs: Number(process.env.BORJIE_KG_SYNC_INTERVAL_MS ?? 21_600_000) || 21_600_000,
      enabled: process.env.NODE_ENV !== 'test' && process.env.BORJIE_KG_SYNC_WORKER_DISABLED !== 'true',
    })
  : { start() {}, stop() {}, async tickOnce() { return { tenantsScanned: 0, tenantsIngested: 0, tenantsFailed: 0, nodes: 0, edges: 0 }; } };

// Notification-dispatch drain — delivers notification_dispatch_log
// (pending) rows via email/SMS/push with retry+backoff+DLQ. The
// announcement fan-out + push rails enqueue rows that THIS worker sends.
// Safe alongside any other drainer (FOR UPDATE SKIP LOCKED).
const notificationDispatchAbort = new AbortController();
const notificationDispatcher = serviceRegistry.db
  ? createNotificationDispatcher({
      db: notificationWorkerDb as unknown as { execute(q: unknown): Promise<unknown> },
      logger,
      emailProvider: createEmailProviderFromEnv(),
      smsProvider: resolveSmsProviderFromEnv(),
      pushProvider: resolvePushProviderFromEnv(),
      // Per-recipient preference gate — honors the owner's saved per-channel /
      // per-template opt-outs AND quiet-hours window before sending. Reads
      // notification_preferences under a service-role context (FORCE-RLS
      // table); fail-open ('deliver') so a prefs read error never drops a
      // notification. Urgent safety alerts bypass quiet-hours (never delayed).
      shouldDeliver: async ({ tenantId, userId, channel, templateKey }) => {
        // Read prefs on the dedicated worker pool (same isolation as the drain)
        // so the per-row gate doesn't re-introduce main-pool contention.
        const sdb = notificationWorkerDb ?? serviceRegistry.db;
        if (!sdb) return 'deliver';
        const parseHour = (v: unknown): number | null => {
          if (typeof v !== 'string') return null;
          const h = Number.parseInt(v.slice(0, 2), 10);
          return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
        };
        try {
          return await withServiceRoleContext(sdb, async (tx) => {
            const res = await tx.execute(drizzleSqlTag`
              SELECT channels, templates, quiet_hours_start, quiet_hours_end
                FROM notification_preferences
               WHERE tenant_id = ${tenantId} AND user_id = ${userId}
               LIMIT 1`);
            const rows =
              (res as { rows?: Array<Record<string, unknown>> }).rows ??
              (Array.isArray(res) ? (res as Array<Record<string, unknown>>) : []);
            const row = rows[0];
            if (!row) return 'deliver'; // no saved prefs → deliver (opt-out, not opt-in)
            const channels = (row.channels ?? {}) as Record<string, boolean>;
            const templates = (row.templates ?? {}) as Record<string, boolean>;
            // The prefs UI stores the human channel name 'push'; dispatch rows
            // carry the rail name 'app_push'. Normalize so the push opt-out
            // actually suppresses app_push (otherwise it was a dead toggle).
            const prefChannel = channel === 'app_push' ? 'push' : channel;
            if (channels[prefChannel] === false) return 'suppress';
            if (templates[templateKey] === false) return 'suppress';
            // Quiet-hours: defer DEFERRABLE notifications inside the owner's
            // window. Urgent safety alerts (incident escalation / safety /
            // sovereign) always deliver — they must never be delayed. Window
            // evaluated in EAT (launch tz; covers TZ/KE/UG — per-owner tz is a
            // refinement, NG is +1).
            const urgent = /^(mining\.incident\.escalation|safety|sovereign)/.test(
              templateKey,
            );
            const qs = parseHour(row.quiet_hours_start);
            const qe = parseHour(row.quiet_hours_end);
            if (
              !urgent &&
              qs !== null &&
              qe !== null &&
              isWithinQuietHours(new Date(), 'Africa/Dar_es_Salaam', qs, qe)
            ) {
              return 'defer';
            }
            return 'deliver';
          });
        } catch {
          return 'deliver'; // fail-open on delivery
        }
      },
    })
  : null;
// Broadcast fan-out — expands operator announcements into per-recipient
// notification_dispatch_log rows (the drain worker above then sends them).
const announcementFanoutWorker = serviceRegistry.db
  ? createAnnouncementFanoutWorker({
      db: notificationWorkerDb as unknown as { execute(q: unknown): Promise<unknown> },
      logger,
      resolveRecipients: createAnnouncementRecipientResolver(
        serviceRegistry.db as unknown as Parameters<
          typeof createAnnouncementRecipientResolver
        >[0],
      ),
      intervalMs: Number(process.env.BORJIE_ANNOUNCEMENT_FANOUT_INTERVAL_MS ?? 60_000) || 60_000,
      enabled: process.env.NODE_ENV !== 'test' && process.env.BORJIE_ANNOUNCEMENT_FANOUT_DISABLED !== 'true',
    })
  : { start() {}, stop() {}, async tickOnce() { return { claimed: 0, enqueued: 0, skippedNoRecipients: 0 }; } };

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
      // Wave CLOSED-LOOP-RESOLVERS — three real resolver categories:
      //   1. Production / output (production_tonnage_events)
      //   2. Financial (ledger_entries — credit/debit/net cash-flow)
      //   3. Compliance (regulatory_filings — deadlines + statuses)
      // Entity types not covered still close out as `expired` per the
      // worker's own contract — no regression for unwired types.
      resolvers: buildOutcomeResolvers({
        db: serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> },
        logger,
      }),
      // Wave-C C3 WIN-2 — self-correcting memory. A divergent reconciliation
      // whose drift clears the floor is now synthesised into a durable reflexion
      // lesson in the SAME `reflexion_buffer` the chat path reads (sovereign.ts
      // builds the identical service). The buffer's `record` satisfies the
      // kernel `ReflexionRecorderPort` shape; it swallows DB faults, so a
      // recorder fault never fails the reconciliation.
      reflexionRecorder: createReflexionBufferService(
        serviceRegistry.db as unknown as Parameters<
          typeof createReflexionBufferService
        >[0],
      ),
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

// KI-010 — the governed, PROPOSE-ONLY self-extension cron. Constructed
// UNCONDITIONALLY here (so the keystone is composed + reachable + covered by the
// cron-wiring test) but kept INERT-by-default two ways:
//   1. `enabled` is wired to the default-OFF env flag below — even the elected
//      leader's .start() is a no-op until BORJIE_SELF_EXTENSION_CRON_ENABLED.
//   2. The terminal action is a four-eye PENDING proposal + a self-build
//      dry-run. The runtime-apply / sub-MD register() path stays UNMOUNTED
//      (fail-closed thrower) — see self-extension-cron-wiring.ts. This closes
//      the born-dark defect WITHOUT enabling autonomous self-modification.
const selfExtensionEnabled =
  process.env.BORJIE_SELF_EXTENSION_CRON_ENABLED === 'true';
const selfExtensionCron = serviceRegistry.db
  ? createSelfExtensionCron(
      buildSelfExtensionCronDeps({
        db: serviceRegistry.db as unknown as Parameters<
          typeof buildSelfExtensionCronDeps
        >[0]['db'],
        // Bind the service-role GUC for every out-of-band read (RLS FORCE has
        // no request-bound tenant here). SAME audited platform-scope path the
        // resident estate-mind / proactive workers use.
        withServiceRole: <T,>(
          fn: (tx: { execute(q: unknown): Promise<unknown> }) => Promise<T>,
        ): Promise<T> =>
          withServiceRoleContext(
            serviceRegistry.db as Parameters<typeof withServiceRoleContext>[0],
            fn as never,
          ) as Promise<T>,
        logger: createPinoLikeLogger('self-extension-cron'),
        // Default-OFF: the cron is composed but inert until the owner flips the
        // flag. NODE_ENV==='test' is also implicitly off via the cron default.
        enabled: selfExtensionEnabled,
      }),
    )
  : { start() {}, stop() {}, async tickOnce() {
      return {
        tenantsScanned: 0,
        diagnosed: 0,
        proposalsEnqueued: 0,
        buildProposalsDriven: 0,
        errored: 0,
      };
    } };
// Boot-proof: log the composed-but-disabled / enabled state EITHER way so a
// reader of the boot log can confirm the keystone is wired and know exactly how
// to turn it on. Proposals are four-eye/HITL gated; nothing auto-deploys.
logger.info(
  {
    enabled: selfExtensionEnabled,
    dbPresent: Boolean(serviceRegistry.db),
    flag: 'BORJIE_SELF_EXTENSION_CRON_ENABLED',
  },
  selfExtensionEnabled
    ? 'self-extension cron: composed and ENABLED — proposals are four-eye/HITL gated; runtime-apply stays UNMOUNTED'
    : 'self-extension cron: composed, disabled by default — set BORJIE_SELF_EXTENSION_CRON_ENABLED=true to enable; proposals are four-eye/HITL gated',
);

// Wave AUTONOMY-CRON-WIRE — Mr. Mwikila autonomous-MD worker. Fires
// every 15 min by default, scans every active tenant, runs all 5
// handlers (license-renewal, shift-scheduler, royalty-filing, payroll,
// marketplace-counter) through the runtime which enforces the
// inviolable rails (kill-switch fail-closed, four-eye policy, envelope
// thresholds, family-relation guard) before any inbox row is written.
//
// The handler ports ship safe-empty here so the worker exercises the
// runtime + rails on every tick but proposes nothing until per-domain
// wiring lands behind the same composition root. See
// composition/mwikila-autonomous-wiring.ts for the full topology.
const mwikilaAutonomousWorker = createMwikilaAutonomousWiring({
  db: (serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> }) ?? null,
  logger,
  isKillSwitchOpen: () =>
    Boolean(
      (
        serviceRegistry as unknown as {
          killSwitch?: { isOpen?: () => boolean };
        }
      ).killSwitch?.isOpen?.(),
    ),
});

const proactiveScheduler = scheduleProactive({
  db: (serviceRegistry.db as unknown as { execute(q: unknown): Promise<unknown> }) ?? null,
  logger,
});

// Wave 1 EstateMind — the resident per-tenant Slow Loop. PERCEIVE → ORIENT →
// evaluate standing drives → emit self-formulated goals as PROPOSALS through
// the DUAL sink: the EXISTING gated proactive_nudge AND an ADDITIVE
// OrchestratorRequest proposal into the arbiter-fronted spine (it NEVER
// executes money/licence actions — those stay HITL). DEFAULT-ON kill-switch
// (BORJIE_ESTATE_MIND; only off/0/false/no disables); leader-gated at .start().
const estateMindConfig = initEstateMind();
const estateMindSupervisor = createEstateMindSupervisor({
  db: (serviceRegistry.db as unknown as
    | (typeof serviceRegistry.db & { execute(q: unknown): Promise<unknown> })
    | null) ?? null,
  logger: createPinoLikeLogger('estate-mind'),
  config: estateMindConfig,
  // B8 — PERCEPTION source over the live estate tables. Without it the
  // situational model stays empty, every standing drive reports SATISFIED, and
  // the loop emits ZERO proactive nudges. The factory binds the kernel's
  // PerceptionSource port to the real `withServiceRoleContext` over the
  // platform db (read-only, tenant-scoped, degrade-safe); a null db yields a
  // no-op source so the supervisor stays a safe no-op without it.
  perception: createEstateMindPerceptionFromDb(
    (serviceRegistry.db as unknown as
      | (typeof serviceRegistry.db & { execute(q: unknown): Promise<unknown> })
      | null) ?? null,
    createPinoLikeLogger('estate-mind-perception'),
  ),
  // DEFERRAL / FOLLOW-THROUGH — inject the durable md_commitments RECONCILE
  // sweep into the resident Slow Loop. The bundle was built in the brain-tools
  // wiring block above; null leaves the tick exactly as before (purely
  // additive). The sweep is fail-safe: a fault never breaks the tick.
  reconciliation: mdCommitmentBundle?.reconciliation ?? null,
  // Wave-C C2 / Wave-D — per-tenant schema-conditioned drive thresholds, APPLIED.
  // The resolver reads this estate's consolidated `baseline:*` facts and judges a
  // breach against THIS estate's baseline (mean ± k·sd) rather than the static
  // default. The loop is now closed end-to-end: the kernel cycle's
  // `motivation.formulateGoals(snapshot, override?)` accepts a per-call thresholds
  // override, the EstateMind tick resolves per-tenant thresholds via its
  // `thresholdsResolver` dep BEFORE evaluating drives, and the supervisor wiring
  // (estate-mind-wiring.ts) forwards this `resolveThresholds` into
  // `createEstateMind({ thresholdsResolver })`. The Wave-D estate-baseline
  // consolidation pass (estate-baseline-computer.ts) WRITES the `baseline:*`
  // facts this reads. Honest-degrade: until a tenant has enough history for a
  // metric, the resolver returns {} for it and that drive falls through to
  // DEFAULT_DRIVE_THRESHOLDS exactly as before.
  resolveThresholds: (tenantId: string) =>
    resolveDriveThresholdsFromBaselinesDb(
      (serviceRegistry.db as unknown as
        | (typeof serviceRegistry.db & { execute(q: unknown): Promise<unknown> })
        | null) ?? null,
      tenantId,
      createPinoLikeLogger('estate-mind-thresholds'),
    ),
});

// Wave 1 OK-3 — blackboard control-shell scheduler. Construct the wiring
// (DEFAULT-ON via BORJIE_CONTROL_SHELL; INERT when explicitly disabled), then
// REGISTER its delta trigger with the slot store so a slot convergence (a
// local route `set`/`remove` OR a merged remote delta) fires onSlotConverged →
// pickNext → the audit-plane sink. The candidate source defaults to the REAL
// slot-writer source over the durable slot repository (the distinct actors that
// have posted to the tenant's blackboard). PROPOSE-ONLY: it never invokes the
// KS, never reaches a client; a fault never breaks the slot path or a turn.
const controlShellWiring = createControlShellWiring({
  // No measurement source wired yet → the shell falls back to competence 0.5
  // internally (spec §3.2). This is honest: capability measurement is a
  // separate seam; the scheduler is fully functional without it.
  measurementSource: null,
  // Real audit-plane sink: Pino + a propose-only tab_event_log row (best-effort,
  // RLS-bound, degrade-safe). Never returned to a client; never calls the KS.
  activationSink: createTabEventLogActivationSink(
    (serviceRegistry.db as unknown as
      | { execute(q: unknown): Promise<unknown> }
      | null) ?? null,
    createPinoLikeLogger('control-shell-sink'),
  ),
  logger: createPinoLikeLogger('control-shell'),
});
// Wire the convergence trigger: every converged slot fans out to this handler.
// Fail-safe — onSlotConverged never throws, so a control-shell fault can never
// break the slot/state-bus path. No-op when the wiring is INERT (kill-switch
// off) because INERT_WIRING.onSlotConverged resolves null.
const controlShellUnsubscribe = controlShellWiring.enabled
  ? registerSlotConvergedListener((slot) => {
      void controlShellWiring.onSlotConverged(slot);
    })
  : () => {};
// Cross-replica half — the elected leader connects each active tenant's
// state-bus so a convergence on ANOTHER replica also fires the handler here.
// Active-tenant discovery is degrade-safe (returns [] on any fault / no db).
const controlShellTenantSource: ActiveTenantSource = createActiveTenantSource(
  (serviceRegistry.db as unknown as
    | { execute(q: unknown): Promise<unknown> }
    | null) ?? null,
);
const controlShellConnectSupervisor = createControlShellConnectSupervisor({
  wiring: controlShellWiring,
  tenantSource: controlShellTenantSource,
  logger: createPinoLikeLogger('control-shell-connect'),
});

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
    learningAmplificationCron.stop();
    logger.info('shutdown: learning-amplification cron stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: learning-amplification cron stop failed');
  }
  try {
    aopMetaLoopCron.stop();
    logger.info('shutdown: aop-meta-loop cron stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: aop-meta-loop cron stop failed');
  }
  try {
    loopEconomyCron.stop();
    logger.info('shutdown: loop-economy cron stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: loop-economy cron stop failed');
  }
  try {
    livingMd?.somedayReviewSupervisor.stop();
    logger.info('shutdown: living-md someday-review stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: living-md someday-review stop failed');
  }
  try {
    orgLoopOrchestrator?.stop();
    logger.info('shutdown: org-loop spine stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: org-loop spine stop failed');
  }
  try {
    geofenceWatcher.stop();
    logger.info('shutdown: geofence watcher stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: geofence watcher stop failed');
  }
  try {
    licenceExpiryCron.stop();
    logger.info('shutdown: licence-expiry cron stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: licence-expiry cron stop failed');
  }
  try {
    idempotencySweeperStop?.();
    logger.info('shutdown: idempotency-sweeper cron stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: idempotency-sweeper cron stop failed');
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
  try { announcementFanoutWorker.stop(); } catch (err) { logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: announcement-fanout stop failed'); }
  try { notificationDispatchAbort.abort(); } catch (err) { logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: notification-dispatch abort failed'); }
  try {
    outcomeReconciliationWorker.stop();
    logger.info('shutdown: outcome-reconciliation worker stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: outcome-reconciliation stop failed');
  }
  // KI-010 — self-extension cron. stop() is a safe no-op when it was never
  // started (flag off), but called for lifecycle symmetry with the other crons.
  try {
    selfExtensionCron.stop();
    logger.info('shutdown: self-extension cron stopped');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: self-extension cron stop failed');
  }
  try {
    mwikilaAutonomousWorker.stop();
    proactiveScheduler.stop();
    estateMindSupervisor.stop();
    // OK-3 — stop the control-shell connect supervisor (tears down realtime
    // subscriptions) and drop its convergence listener so no late delta fires
    // during drain. Best-effort; never blocks shutdown.
    controlShellConnectSupervisor.stop();
    controlShellUnsubscribe();
    logger.info('shutdown: mwikila autonomous worker stopped');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'shutdown: mwikila autonomous worker stop failed',
    );
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

  // Scale-P0 cron-leader-election lane (RSS-06) — release every per-cron
  // advisory lock so another replica can be promoted promptly. No-op (and
  // resolves instantly) when CRON_LEADER_ELECTION is unset/"off" — there is
  // no held connection in pass-through mode. The dedicated session ending on
  // process exit would release the locks anyway; explicit unlock is cleaner.
  try {
    await Promise.all(
      CLUSTER_LEADER_CRON_NAMES.map((name) =>
        releaseLeadership(lockIdFor(name)).catch((err: unknown) => {
          logger.warn(
            { cron: name, err: err instanceof Error ? err.message : String(err) },
            'shutdown: releaseLeadership failed (session close will release)',
          );
        }),
      ),
    );
    logger.info('shutdown: cluster leadership released');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'shutdown: cluster leadership release failed');
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

/**
 * Build the `ws`-backed WS-upgrade transport for the brain-voice endpoint,
 * conforming to the `WebSocketServerLike` contract in brain-voice.hono.ts.
 *
 * Uses a `noServer`-mode `WebSocketServer` hooked onto the Express HTTP
 * server's `'upgrade'` event, gated to the exact voice pathname (other paths
 * are left untouched so any future WS routes coexist). Each accepted `ws`
 * socket is adapted to `ClientSocketLike` (the `ws` API already matches
 * `send` / `close` / `on('message'|'close'|'error')` shapes).
 *
 * Returns `undefined` (so attach no-ops + warns, boot stays clean) when `ws`
 * cannot be loaded — e.g. install-pending — rather than throwing.
 */
function buildVoiceWebSocketServerFactory(): WebSocketServerLike | undefined {
  let WebSocketServerCtor: typeof import('ws').WebSocketServer;
  try {
    // Lazy require (mirrors the inline-require pattern used elsewhere in this
    // bootstrap) so a missing/broken `ws` module can never crash module load.
    WebSocketServerCtor = (require('ws') as typeof import('ws')).WebSocketServer;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'brain-voice: `ws` module unavailable — voice WS transport not built (endpoint inactive)',
    );
    return undefined;
  }

  return ({ server: httpServer, path, onConnection }) => {
    const wss = new WebSocketServerCtor({ noServer: true });

    httpServer.on('upgrade', (request, socket, head) => {
      let pathname: string;
      try {
        pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      } catch {
        return; // malformed upgrade target — leave for other handlers
      }
      if (pathname !== path) return; // not ours — do not touch the socket

      wss.handleUpgrade(request, socket, head, (rawSocket) => {
        const query = (() => {
          try {
            return new URL(request.url ?? '/', 'http://localhost').searchParams;
          } catch {
            return new URLSearchParams();
          }
        })();
        // `ws.WebSocket` already satisfies the ClientSocketLike surface
        // (send/close/on). Cast through the shared type so the conformance
        // is explicit and checked at the boundary.
        onConnection(rawSocket as unknown as ClientSocketLike, query);
      });
    });

    wss.on('error', (err: Error) => {
      logger.warn(
        { err: err.message, path },
        'brain-voice: WebSocketServer error (voice transport degraded)',
      );
    });
  };
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

  // SOTA realtime-voice BACKEND — attach the brain-voice WS endpoint to the
  // HTTP server now that it is listening. We build the `ws`-backed upgrade
  // transport (noServer mode, filtered to the voice path) and pass it as
  // `webSocketServerFactory`; if `ws` is unavailable or the build fails the
  // factory is undefined and attach falls back to its safe no-op + warn.
  // Wrapped so a wiring bug in the voice channel can never crash gateway boot.
  try {
    const voiceWsFactory = buildVoiceWebSocketServerFactory();
    attachBrainVoiceWebSocket({
      server,
      // Conditional spread honours exactOptionalPropertyTypes: omit the key
      // entirely (rather than passing `undefined`) so attach takes its safe
      // no-op + warn path when `ws` is unavailable.
      ...(voiceWsFactory ? { webSocketServerFactory: voiceWsFactory } : {}),
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'brain-voice: attach failed (voice channel disabled, gateway continues)',
    );
  }

  // Scale-P0 cron-leader-election lane (RSS-06) — initialise the cluster
  // lock ONCE before any cron starts. GATE: CRON_LEADER_ELECTION. Unset /
  // "off" (DEFAULT) → withClusterLeader is a PASS-THROUGH and every cron
  // runs on every replica exactly as today. "on" → leader-only: the wrapped
  // crons start only on the replica that wins the per-lock-id advisory lock
  // (held on the dedicated session connection from DATABASE_SESSION_URL,
  // falling back to DATABASE_URL). Reads its env ONCE here, never per tick.
  initClusterLock();

  // Wave 12 — start heartbeat + background scheduler after the server
  // is listening. Both are gated by DATABASE_URL internally; degraded
  // mode skips the supervisors gracefully.
  withClusterLeader(heartbeatSupervisor, lockIdFor('heartbeat')).start();
  withClusterLeader(backgroundSupervisor, lockIdFor('background-supervisor')).start();
  withClusterLeader(intelligenceHistorySupervisor, lockIdFor('intelligence-history')).start();
  // REMOVED (borjie hard-fork): the Cases SLA supervisor start() — residential-property residue.
  // Learning Amplification (LitFin port) — nightly Bayesian roll-up of
  // learning_observations. Interval overridable via
  // BORJIE_LEARNING_AMPLIFY_INTERVAL_MS (min 60s).
  withClusterLeader(learningAmplificationCron, lockIdFor('learning-amplification')).start();
  // R8 — AOP meta-learning loop. Until this start() the meta-learning
  // organ was dark: the registry/runner/regression/canary factories had
  // ZERO production callers. Leader-gated; every tick is fail-safe (a
  // fault never escapes); inert under NODE_ENV=test and when
  // BORJIE_AOP_META_LOOP=off.
  withClusterLeader(aopMetaLoopCron, lockIdFor('aop-meta-loop')).start();
  // LOOP-ECONOMY — until this start() the cognitive-loop substrate
  // (createLoopRegistry / scheduleLoops / createForecastSurpriseLoop) had
  // ZERO production callers: the brain's standing loops never ran.
  // Leader-gated; every tick is fail-safe; loops are READ+LEARN only —
  // decided actions route through the governed proactive proposal sink.
  // Inert under NODE_ENV=test and when BORJIE_LOOP_ECONOMY=off.
  withClusterLeader(loopEconomyCron, lockIdFor('loop-economy')).start();
  // LIVING-MD someday-review — the deferred-resurfacing heartbeat. Leader-gated
  // (only the elected leader sweeps), inert under NODE_ENV=test, default-ON
  // (BORJIE_SOMEDAY_REVIEW). Resurfaces tickler/someday commitments whose time
  // has come back into the owner's plan via the governed proposal sink.
  if (livingMd) {
    withClusterLeader(
      livingMd.somedayReviewSupervisor,
      lockIdFor('someday-review'),
    ).start();
  }
  // SELF-RUNNING-ORG SPINE — leader-gated sweep over live commitments
  // needing delegation (strategize→match→dispatch→brief, propose-only/
  // HITL). Inert under NODE_ENV=test; kill-switch BORJIE_ORG_LOOP.
  if (orgLoopOrchestrator) {
    withClusterLeader(
      orgLoopOrchestrator,
      lockIdFor(ORG_LOOP_CRON_NAME),
    ).start();
  }
  // Geo SOTA 2026-05-29 — start the geofence watcher (no-op when DB
  // is absent or BORJIE_GEOFENCE_WATCHER_DISABLED=true).
  withClusterLeader(geofenceWatcher, lockIdFor('geofence-watcher')).start();
  // DETECTION — start the mining licence-expiry alert cron. Ticks daily,
  // scans `licences` at 60/30/7/1-day expiry windows, enqueues pending
  // notification_dispatch_log rows, idempotent via idempotency_key.
  withClusterLeader(licenceExpiryCron, lockIdFor('licence-expiry')).start();
  // H2 deferral closure — idempotency_keys sweeper. Hourly DELETE of
  // rows past expires_at. Module-scoped `idempotencySweeperStop` is
  // set here so the gracefulShutdown handler above can stop it.
  if (process.env.NODE_ENV !== 'test') {
    const dbForSweeper = (serviceRegistry as unknown as { db?: unknown }).db;
    if (dbForSweeper) {
      idempotencySweeperStop = registerIdempotencySweeperCron({
        db: dbForSweeper as never,
      });
      logger.info('idempotency-sweeper cron started');
    } else {
      logger.warn('idempotency-sweeper cron skipped — no db in service registry');
    }
  }
  // Piece C — executive brief cron. Daily / weekly / monthly subscriptions
  // get briefs generated at their local_time + cadence. ON_DEMAND
  // subscriptions are never auto-fired.
  withClusterLeader(executiveBriefCron, lockIdFor('executive-brief')).start();
  // Wave OWNER-OS DAILY-BRIEF rebuild — start the per-tenant daily-brief
  // cron. Ticks every 5 min, fires per tenant when their local
  // `daily_brief_cadence` matches the wall clock; idempotent via
  // UNIQUE constraint on the dispatch ledger.
  withClusterLeader(dailyBriefCron, lockIdFor('daily-brief')).start();
  // Wave WORKFORCE-CERT-EXPIRY — 6h cron that scans
  // workforce_certifications for any active cert expiring within 30d
  // and auto-creates reminders at 30d / 14d / 3d (idempotent via
  // UNIQUE(tenant_id, cert_id, days_before)).
  withClusterLeader(icaCertExpiryCron, lockIdFor('ica-cert-expiry')).start();
  // Roadmap R6 — hourly compliance-deadline scanner. Pushes
  // `compliance.deadline_approaching` events for filings whose
  // due_at lands inside the 7-day horizon.
  withClusterLeader(complianceDeadlineScan, lockIdFor('compliance-deadline-scan')).start();
  // Wave ENTITY-LEGIBILITY — 30-min indexer that embeds + tags + cross-
  // references every entity in the system so the brain can resolve any
  // natural-language phrase and traverse the graph in one hop.
  withClusterLeader(entityIndexerWorker, lockIdFor('entity-indexer')).start();
  // Live FX feed — pulls BoT TZS/USD + LBMA gold AM/PM fix every 5 min
  // and writes rows into both fx_rates + external_benchmarks. Leader-only
  // is especially important here: every replica hitting BoT/LBMA risks an
  // upstream rate-limit / ban (RSS-06 fx-feed sibling note).
  withClusterLeader(fxFeedCron, lockIdFor('fx-feed')).start();
  // Piece E (issue #41) — drain the approved-actions queue every 10s,
  // dispatch to the junior executor, audit each dispatch.
  withClusterLeader(executiveBriefActionRunner, lockIdFor('executive-brief-action-runner')).start();
  // Wave OWNER-OS — reminders dispatch worker. Polls the `reminders`
  // table every 30s (configurable via BORJIE_REMINDERS_INTERVAL_MS).
  // Email default; SMS / Slack land when the operator wires the keys.
  withClusterLeader(remindersDispatchWorker, lockIdFor('reminders-dispatch')).start();
  // Wave 2 (W2b) — proactive-intel insight loop (cluster-leader gated so only one
  // instance ticks). Surfaces MD-authored proactive insights onto the cockpit bus.
  withClusterLeader(proactiveIntelWorker, lockIdFor('proactive-intel')).start();
  // Wave 2 (W2d) — KG auto-sync so GraphRAG stays fresh across every domain.
  withClusterLeader(kgSyncWorker, lockIdFor('kg-sync')).start();
  // Wave NOTIFICATION-DISPATCH-WIRE — start the broadcast fan-out (enqueues
  // per-recipient dispatch-log rows) and the dispatch drain (sends them via
  // email/SMS/push). The drain runs as a long-lived runForever loop bounded
  // by an AbortController that graceful-shutdown trips.
  withClusterLeader(announcementFanoutWorker, lockIdFor('announcement-fanout')).start();
  // The DRAIN is deliberately NOT cluster-leader-gated (unlike the fan-out and
  // every sibling above): its claim is an atomic `UPDATE ... FOR UPDATE SKIP
  // LOCKED` (dispatcher-worker.ts), so running it on every replica is safe AND
  // desirable — no two replicas can claim the same row, and N replicas drain
  // the queue N× faster. Leader-gating here would throttle delivery for no
  // correctness gain. (Audit finding: intentional, not an oversight.)
  if (notificationDispatcher && process.env.NODE_ENV !== 'test' && process.env.BORJIE_NOTIFICATION_DISPATCH_DISABLED !== 'true') {
    void notificationDispatcher
      .runForever({ signal: notificationDispatchAbort.signal })
      .catch((err) => logger.error({ worker: 'notification-dispatch', err: err instanceof Error ? err.message : String(err) }, 'notification-dispatch: runForever exited'));
  }
  // Wave CLOSED-LOOP - outcome reconciliation worker. Every 6h walks
  // outcome_predictions whose horizon has elapsed and writes back
  // outcome_observations + outcome_reconciliations, hash-chained.
  withClusterLeader(outcomeReconciliationWorker, lockIdFor('outcome-reconciliation')).start();
  // KI-010 — governed, propose-only self-extension cron. Leader-gated like the
  // other resident workers. The cron's own .start() is a NO-OP unless
  // BORJIE_SELF_EXTENSION_CRON_ENABLED=true (the flag is bound to `enabled` at
  // construction above), so calling start() here is safe + inert by default.
  // Even when enabled it only PROPOSES (four-eye/HITL); runtime-apply is
  // UNMOUNTED. Composed unconditionally so the keystone is reachable + tested.
  withClusterLeader(selfExtensionCron, lockIdFor('self-extension')).start();
  // Wave AUTONOMY-CRON-WIRE — Mr. Mwikila autonomous-MD worker. Every
  // 15 min by default, walks every active tenant, runs all 5 handlers
  // through the runtime (kill-switch + inviolable rails enforced) so
  // the inbox fills on a cadence rather than only on inbound route
  // calls. Inert in test mode + when BORJIE_MWIKILA_WORKER_DISABLED=true.
  withClusterLeader(mwikilaAutonomousWorker, lockIdFor('mwikila-autonomous')).start();
  withClusterLeader(proactiveScheduler, lockIdFor('proactive-scheduler')).start();
  // Wave 1 EstateMind — resident Slow Loop heartbeat. Only the elected leader
  // ticks (one resident mind per cluster); `.start()` is a no-op unless
  // BORJIE_ESTATE_MIND=on, so this is inert by default.
  withClusterLeader(estateMindSupervisor, lockIdFor('estate-mind')).start();
  // Wave 1 OK-3 — blackboard control-shell scheduler. The LOCAL convergence
  // path (registerSlotConvergedListener above) already fires on every replica
  // for local slot writes. This leader-gated start() adds the CROSS-REPLICA
  // half: the elected leader connects each active tenant's `state-bus` so a
  // convergence on another replica/surface also schedules. INERT when the
  // kill-switch (BORJIE_CONTROL_SHELL) is off; propose-only + audit-plane only.
  withClusterLeader(controlShellConnectSupervisor, lockIdFor('control-shell')).start();
  // Wave DECISION-LEGIBILITY - 24h retrospective worker. For every
  // committed decision whose prediction horizon has passed, joins
  // outcome_reconciliations + outcome_observations, grades the
  // decision (good / bad / neutral / undetermined), and writes the
  // hash-chained retrospective entry via the decision recorder.
  withClusterLeader(decisionRetrospectiveWorker, lockIdFor('decision-retrospective')).start();
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

      // LIVING-MD event bridge — relay the carried domain/outbox events
      // (ledger.credit, settlement, slot.stale, …) onto the injected MD event
      // bus so a `waiting_for` commitment flips to `due` the moment its real
      // trigger fires (at-least-once + idempotent on tenantId:eventKey). The
      // bridge replaces the prior `global` event-bus anti-pattern; absent the
      // organ (no db) it is simply skipped.
      if (livingMd) {
        registerMdEventBridge({
          bus: subscribableBus,
          mdEventBus: livingMd.mdEventBus,
          logger,
        });
      }

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

  // Crash-signal handlers (CLAUDE.md: Pino only — it handles redaction and
  // forwards to Sentry/OTel via the bootstrap pipeline that ran first).
  // - unhandledRejection: a stray fire-and-forget rejection must be OBSERVABLE
  //   but must NOT take down in-flight requests — log and keep serving.
  // - uncaughtException: the process is in an unknown state — log loudly and
  //   DRAIN via gracefulShutdown (mirrors SIGTERM) instead of dying silently
  //   with dropped in-flight requests and no structured record.
  process.on('unhandledRejection', (reason) => {
    logger.error(
      {
        evt: 'unhandled_rejection',
        error: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      },
      'unhandledRejection — logged; process kept alive',
    );
  });
  process.on('uncaughtException', (err) => {
    logger.error(
      { evt: 'uncaught_exception', error: err.message, stack: err.stack },
      'uncaughtException — draining via graceful shutdown',
    );
    void gracefulShutdown('uncaughtException');
  });
}

export default app;
