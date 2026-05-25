/**
 * @borjie/enterprise-hardening
 * 
 * Enterprise hardening package for the BORJIE property management SaaS platform.
 * Provides compliance, resilience, performance, and enterprise integration capabilities.
 * 
 * ## Modules
 * 
 * ### Compliance
 * - SOC 2 Type II controls and evidence management
 * - GDPR/CCPA privacy controls and DSR workflows
 * - Data retention policies and lifecycle management
 * 
 * ### Resilience
 * - Circuit breaker pattern for fault tolerance
 * - Rate limiting for API protection
 * - Health checks for availability monitoring
 * - Disaster recovery coordination
 * 
 * ### Performance
 * - Multi-layer caching strategies
 * - Resource monitoring and alerting
 * - Cost management and FinOps utilities
 * 
 * ### Enterprise
 * - Webhook delivery system
 * - Partner API gateway with key management
 * - Custom workflows engine
 * 
 * @packageDocumentation
 */

// Compliance exports
export {
  // SOC 2
  SOC2Category,
  ControlStatus,
  EvidenceType,
  SOC2ControlRegistry,
  SOC2ComplianceManager,
  ControlEvidenceSchema,
  type SOC2ControlDefinition,
  type ControlEvidence,
  type ControlAssessment,
  // Privacy
  PrivacyRegulation,
  DSRType,
  DSRStatus,
  LegalBasis,
  DataCategory,
  PrivacyManager,
  ConsentRecordSchema,
  DSRRequestSchema,
  type ConsentRecord,
  type DataSubjectRequest,
  type PersonalDataInventory,
  type PrivacyImpactAssessment,
  // Data Retention
  RetentionPolicyType,
  LifecycleStage,
  RetentionClassification,
  DefaultRetentionPolicies,
  DataRetentionManager,
  RetentionPolicySchema,
  LegalHoldSchema,
  type RetentionPolicy,
  type LegalHold,
  type RetentionJob,
} from './compliance';

// Resilience exports
export {
  // Circuit Breaker
  CircuitState,
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitBreakerPresets,
  CircuitOpenError,
  type CircuitBreakerConfig,
  type CircuitMetrics,
  type CircuitEvent,
  type CircuitEventListener,
  // Rate Limiter
  RateLimitAlgorithm,
  RateLimitScope,
  RateLimiter,
  RateLimiterRegistry,
  InMemoryRateLimitStore,
  RateLimitPresets,
  type RateLimitConfig,
  type RateLimitResult,
  type RateLimitContext,
  type RateLimitStore,
  // Health Check
  HealthStatus,
  HealthCheckType,
  DependencyType,
  HealthCheckManager,
  HealthCheckBuilders,
  HealthStatusCodes,
  type HealthCheckConfig,
  type HealthCheckDefinition,
  type HealthCheckResult,
  type HealthResponse,
  // Disaster Recovery
  RegionStatus,
  FailoverMode,
  BackupType,
  RecoveryType,
  DisasterRecoveryManager,
  FailoverRequestSchema,
  DrillScheduleSchema,
  DrillResultsSchema,
  type RegionConfig,
  type BackupRecord,
  type RecoveryPlan,
  type FailoverEvent,
  type DRDrill,
  type RecoveryMetrics,
} from './resilience';

// Performance exports
export {
  // Caching
  CacheStrategy,
  EvictionPolicy,
  CacheManager,
  TenantCacheManager,
  InMemoryCacheStore,
  CachePresets,
  type CacheConfig,
  type CacheEntry,
  type CacheStats,
  type CacheStore,
  // Resource Monitor
  ResourceType,
  ResourceStatus,
  CostDimension,
  ResourceMonitorManager,
  CostManager,
  DefaultResourceThresholds,
  type ResourceMetric,
  type ResourceThreshold,
  type ResourceAlert,
  type CostRecord,
  type CostForecast,
  type OptimizationRecommendation,
  type Budget,
} from './performance';

// Enterprise exports
export {
  // Webhooks
  WebhookEventCategory,
  DeliveryStatus,
  WebhookManager,
  WebhookEndpointSchema,
  WebhookEventSchema,
  WebhookEventTypes,
  type WebhookEndpoint,
  type WebhookEvent,
  type WebhookDelivery,
  type WebhookStats,
  // Partner API
  ApiKeyStatus,
  ApiScopeCategory,
  PartnerTier,
  DefaultApiScopes,
  TierRateLimits,
  PartnerApiManager,
  PartnerApplicationSchema,
  CreateApiKeySchema,
  type ApiScope,
  type PartnerApplication,
  type ApiKey,
  type ApiUsageRecord,
  type UsageQuota,
  type ApiVersion,
  // Custom Workflows
  WorkflowStatus,
  ExecutionStatus,
  TriggerType,
  ActionType,
  WorkflowTemplates,
  WorkflowEngine,
  CreateWorkflowSchema,
  type WorkflowDefinition,
  type WorkflowExecution,
  type WorkflowAction,
  type WorkflowTrigger,
  type WorkflowTemplate,
  type ExecutionContext,
} from './enterprise';

// HTTP exports (D9 — A3/A5 Tier-1 SSRF closure).
export {
  safeHttpFetch,
  assertUrlSafe,
  SafeHttpFetchError,
  type SafeHttpFetchOptions,
  type SafeHttpFetchResult,
  type SafeHttpFetchErrorCode,
  type AssertUrlSafeOptions,
} from './http';
