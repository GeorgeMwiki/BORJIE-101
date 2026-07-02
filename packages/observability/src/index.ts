/**
 * @borjie/observability
 *
 * Platform observability package providing:
 * - Audit logging with fluent API and simple function interface
 * - Domain event bus with outbox pattern
 * - Structured logging with Pino
 * - Distributed tracing with OpenTelemetry
 * - Metrics collection with OpenTelemetry
 * - Security-event emission per mutation route (SOC 2 CC7.2, GDPR Art. 30)
 */

// ============================================================================
// Security events — withSecurityEvents HOF + Next.js variant + direct emit
// ============================================================================

export {
  withSecurityEvents,
  withSecurityEventsFastify,
  withSecurityEventsNextRoute,
  recordSecurityEvent,
  setSecurityEventSink,
  getSecurityEventSink,
  resetSecurityEventSink,
  type SecurityEvent,
  type SecurityEventBinding,
  type SecurityEventSeverity,
  type SecurityEventSink,
} from './security/with-security-events.js';

// ============================================================================
// Types - Audit
// ============================================================================

export type {
  AuditEvent,
  AuditActor,
  AuditTarget,
  AuditTenantContext,
  AuditRequestContext,
  AuditChangeRecord,
  CreateAuditEventOptions,
  AuditQueryOptions,
  AuditQueryResult,
} from './types/audit.types.js';

export {
  AuditCategory,
  AuditOutcome,
  AuditSeverity,
} from './types/audit.types.js';

// ============================================================================
// Types - Telemetry
// ============================================================================

export type {
  ServiceIdentity,
  OTelExporterConfig,
  TelemetryConfig,
  LogEntry,
  MetricDefinition,
} from './types/telemetry.types.js';

export {
  LogLevel,
  MetricType,
  DEFAULT_TELEMETRY_CONFIG,
  PLATFORM_METRICS,
  SpanAttributes,
} from './types/telemetry.types.js';

// ============================================================================
// Types - Domain Events
// ============================================================================

export type {
  DomainEvent,
  DomainEventMetadata,
  EventEnvelope,
  EventPriority,
  OutboxStatus,
  EventHandler,
  EventHandlerRegistration,
  EventHandlerOptions,
  EventSubscription,
  IEventStore,
  SiteCreatedPayload,
  SiteUpdatedPayload,
  OfftakeCreatedPayload,
  OfftakeTerminatedPayload,
  PaymentReceivedPayload,
  PaymentFailedPayload,
  MaintenanceRequestCreatedPayload,
  MaintenanceCompletedPayload,
  UserCreatedPayload,
  UserRoleChangedPayload,
} from './types.js';

// ============================================================================
// Audit - Core
// ============================================================================

export type {
  IAuditStore,
  AuditStoreConfig,
} from './audit/audit-store.interface.js';

export { DEFAULT_AUDIT_STORE_CONFIG } from './audit/audit-store.interface.js';

export { MemoryAuditStore } from './audit/memory-audit-store.js';

export type { AuditLoggerConfig } from './audit/audit-logger.js';

export { AuditLogger, AuditEventBuilder } from './audit/audit-logger.js';

// ============================================================================
// Audit - Offline hash-chain verify + integrity metric (egress operationalization)
//
// Offline-verifiable audit egress: recompute the in-process hash-chained
// audit trail's head from a portable export with ZERO DB access + an OTel
// integrity-failure metric/alert. Consumed by offline-chain-verify-cli and any
// live verify cron.
// ============================================================================

export type {
  SerializedAuditEvent,
  AuditChainExport,
  OfflineVerifyResult,
  OfflineVerifyOptions,
  ChainBreakReason,
} from './audit/offline-chain-verify.js';

export {
  serializedAuditEventSchema,
  auditChainExportSchema,
  verifyAuditChainExport,
  recomputeThisHash,
  recomputeSignature,
  GENESIS_PREV_HASH_V2,
} from './audit/offline-chain-verify.js';

export type {
  AuditIntegrityAlert,
  AuditIntegrityAlertHook,
  AuditIntegrityRecorder,
  AuditIntegrityRecorderOptions,
} from './audit/integrity-metric.js';

export {
  createAuditIntegrityRecorder,
  AUDIT_CHAIN_VERIFY_TOTAL,
  AUDIT_CHAIN_INTEGRITY_FAILURES_TOTAL,
} from './audit/integrity-metric.js';

// Live integrity SWEEP — the production consumer that runs verify + record over
// rows read from `audit_trail_entries` in a scheduled worker path (wired into
// the consolidation-worker ledger-attestor cron). Turns the previously
// CLI-only verifier into a live tamper detector.
export type {
  AuditTrailRow,
  AuditChainSweepOptions,
  AuditChainSweepSummary,
} from './audit/integrity-sweep.js';

export {
  runAuditChainIntegritySweep,
  groupRowsIntoExports,
} from './audit/integrity-sweep.js';

// ============================================================================
// Audit - Simple API
// ============================================================================

export type {
  AuditUser,
  AuditResource,
  AuditDetails,
  SimpleAuditLoggerConfig,
} from './audit-logger.js';

export {
  initAuditLogger,
  getAuditLogger,
  logAuditEvent,
  logAuditSuccess,
  logAuditFailure,
  logAuditDenied,
  logSystemAuditEvent,
  logServiceAuditEvent,
} from './audit-logger.js';

// ============================================================================
// Audit - Route-level Security Events (legacy type aliases)
//
// `withSecurityEvents`/`recordSecurityEvent` are exported once at the
// top of this barrel (lines 16-29). The `AuditableContext`/`AuditableNext`/
// `WithSecurityEventsOptions` types are kept here for in-package tests
// and the `securityEventsMiddleware` Hono signature. `securityEventsMiddleware`
// is the only function added in this block; the function exports above
// already cover the binding-shaped Hono + Fastify + Next wrappers.
// ============================================================================

export type {
  AuditableContext,
  AuditableNext,
  WithSecurityEventsOptions,
} from './security/with-security-events.js';

export { securityEventsMiddleware } from './security/with-security-events.js';

// ============================================================================
// Event Bus
// ============================================================================

export type {
  EventBusConfig,
  IOutboxStore,
} from './event-bus.js';

export {
  EventBus,
  MemoryOutboxStore,
  getEventBus,
  publish,
  subscribe,
} from './event-bus.js';

// ============================================================================
// Logging
// ============================================================================

export type { LoggerContext, LoggerConfig } from './logging/logger.js';

export { Logger, createLogger } from './logging/logger.js';

// ============================================================================
// Tracing
// ============================================================================

export type {
  SpanContext,
  CreateSpanOptions,
} from './tracing/tracer.js';

export {
  initTracing,
  shutdownTracing,
  getTracer,
  getCurrentSpan,
  withSpan,
  withSpanSync,
  setTenantContext,
  setUserContext,
  extractTraceContext,
  injectTraceContext,
} from './tracing/tracer.js';

// ============================================================================
// Metrics
// ============================================================================

export {
  initMetrics,
  shutdownMetrics,
  getMeter,
  PlatformMetrics,
} from './metrics/metrics.js';

// ============================================================================
// Health checks
// ============================================================================

export type {
  UpstreamStatus,
  UpstreamResult,
  HealthPayload,
  UpstreamProbe,
  HealthCheckOptions,
} from './health/health-check.js';

export { runHealthCheck, statusCodeFor } from './health/health-check.js';

// ============================================================================
// Sentry (error tracking)
// ============================================================================

export type { SentryConfig, SentryClient } from './sentry.js';
export {
  initSentry,
  getSentry,
  withSentry,
  installGlobalSentryHandlers,
} from './sentry.js';

// ============================================================================
// Analytics (PostHog)
// ============================================================================

export type {
  AnalyticsConfig,
  AnalyticsClient,
  AnalyticsEventName,
  AnalyticsProperties,
} from './analytics.js';
export { initAnalytics, getAnalytics, trackEvent } from './analytics.js';

// ============================================================================
// Security — secrets derivation / dual-key verify (rotation support)
// ============================================================================

export type {
  HmacAlgorithm,
  SecretPair,
} from './security/secrets-derivation.js';

export {
  sign,
  verify,
  verifyWithRotation,
  resolveSecretPair,
  verifyWithEnvRotation,
} from './security/secrets-derivation.js';

// ============================================================================
// Env helpers — central place for required-config enforcement
// ============================================================================

export { requireEnv, optionalEnv, envFlag } from './env.js';

// ============================================================================
// Pilot-mode — wider sampling + cohort tags during the 3-5 pilot window
// ============================================================================

export type {
  PilotEnvSource,
  PilotEventContext,
  PilotEventInput,
  PilotModeEnvName,
  PilotUser,
} from './pilot-mode.js';

export {
  PILOT_MODE_ENV_NAMES,
  isPilotMode,
  buildPilotEventContext,
  resolvePilotSampleRate,
  readDefaultPilotCohort,
} from './pilot-mode.js';

// ============================================================================
// Eval — online LLM-judge sampling + R-MOAT-6 dimensions
// ============================================================================

export type {
  EvalScoreScale,
  EvalSeverity,
  EvalDimensionId,
  EvalDimension,
} from './eval/dimensions.js';

export {
  EVAL_DIMENSIONS,
  EVAL_DIMENSION_COUNT,
  getEvalDimension,
} from './eval/dimensions.js';

export type {
  DimensionScore,
  JudgeScore,
  TraceForJudging,
  JudgeFn,
  ScoreSink,
  OnlineJudgeOptions,
  OnlineJudgeStats,
  OnlineJudge,
} from './eval/online-judge.js';

export {
  createOnlineJudge,
  isTraceSampled,
  traceIdToSampleValue,
} from './eval/online-judge.js';

// ============================================================================
// Decision Trace — structured per-decision audit traces (LITFIN port)
// ============================================================================

export * from './decision-trace/index.js';

// ============================================================================
// Model cards — Mitchell et al. 2019 renderer (LP-22b)
//
// Pure (record) → Markdown renderer covering intended use, metrics, and
// disaggregated fairness slices (four-fifths gate). Complements the existing
// coverage *auditor* (scripts/audit-model-card-coverage.mjs), which only
// checks card-file existence.
// ============================================================================

export * from './model-card/index.js';

// ============================================================================
// Re-exports
// ============================================================================

export { SpanKind, SpanStatusCode } from '@opentelemetry/api';
export type { Span, Tracer, Counter, Histogram } from '@opentelemetry/api';
