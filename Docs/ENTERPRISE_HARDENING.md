# Enterprise Hardening Guide

This document provides comprehensive guidance for the BORJIE enterprise hardening capabilities, including compliance controls, resilience patterns, performance optimization, and enterprise integrations.

## Table of Contents

1. [Compliance](#compliance)
   - [SOC 2 Type II Controls](#soc-2-type-ii-controls)
   - [Privacy Controls (GDPR/CCPA)](#privacy-controls)
   - [Data Retention Policies](#data-retention-policies)
2. [Resilience](#resilience)
   - [Circuit Breaker Pattern](#circuit-breaker-pattern)
   - [Rate Limiting](#rate-limiting)
   - [Health Checks](#health-checks)
   - [Disaster Recovery](#disaster-recovery)
3. [Performance](#performance)
   - [Caching Strategies](#caching-strategies)
   - [Resource Monitoring](#resource-monitoring)
   - [Cost Management (FinOps)](#cost-management)
4. [Enterprise Integrations](#enterprise-integrations)
   - [Webhooks](#webhooks)
   - [Partner API Gateway](#partner-api-gateway)
   - [Custom Workflows](#custom-workflows)

---

## Compliance

### SOC 2 Type II Controls

The platform implements controls aligned with AICPA Trust Service Criteria for Security, Availability, Processing Integrity, Confidentiality, and Privacy.

#### Key Controls

| Control ID | Category | Description |
|------------|----------|-------------|
| CC6.1-ACCESS-CONTROL | Security | Logical access security with RBAC and tenant isolation |
| CC6.2-USER-REGISTRATION | Security | User provisioning with approval workflows |
| CC6.6-ENCRYPTION-AT-REST | Security | AES-256 encryption for sensitive data |
| CC6.7-ENCRYPTION-IN-TRANSIT | Security | TLS 1.3 for all communications |
| CC7.1-SYSTEM-MONITORING | Availability | Comprehensive observability stack |
| CC7.4-BACKUP-RECOVERY | Availability | Automated backups with PITR |
| CC8.1-PROCESSING-VALIDATION | Processing Integrity | Input validation and ledger reconciliation |

#### Usage

```typescript
import { SOC2ComplianceManager, SOC2Category, ControlStatus } from '@borjie/enterprise-hardening';

const complianceManager = new SOC2ComplianceManager();

// Record evidence for a control
complianceManager.recordEvidence({
  id: 'evidence-001',
  controlId: 'CC6.1-ACCESS-CONTROL',
  type: 'AUTOMATED_TEST',
  collectedAt: new Date().toISOString(),
  collectedBy: 'ci-pipeline',
  description: 'Automated tenant isolation test passed',
});

// Get compliance summary
const summary = complianceManager.getComplianceSummary();
console.log(`Compliance: ${summary.compliancePercentage}%`);
```

### Privacy Controls

Implements GDPR, CCPA, and other privacy regulation requirements.

#### Data Subject Rights (DSR) Management

```typescript
import { PrivacyManager, DSRType, PrivacyRegulation } from '@borjie/enterprise-hardening';

const privacyManager = new PrivacyManager();

// Create a data subject request
const dsr = privacyManager.createDSR(
  'tenant-123',
  'user-456',
  'john@example.com',
  DSRType.ACCESS,
  [PrivacyRegulation.GDPR]
);

// Get urgent DSRs approaching deadline
const urgentDSRs = privacyManager.getUrgentDSRs(7); // Within 7 days
```

#### Personal Data Inventory

```typescript
import { DataCategory, LegalBasis } from '@borjie/enterprise-hardening';

privacyManager.registerDataInventory([
  {
    fieldPath: 'users.email',
    dataCategory: DataCategory.IDENTIFIER,
    sensitivity: 'high',
    legalBasis: LegalBasis.CONTRACT,
    retentionPeriodDays: 365,
    encryptedAtRest: true,
    encryptedInTransit: true,
    thirdPartyShared: false,
    crossBorderTransfer: false,
    purpose: 'User account identification and communication',
  },
]);
```

### Data Retention Policies

Automated data lifecycle management with legal hold support.

#### Pre-defined Policies

| Policy | Classification | Retention | Trigger |
|--------|---------------|-----------|---------|
| Financial Records | FINANCIAL | 7 years | Time-based |
| Lease Documents | LEGAL | 6 years | Event-based (lease end) |
| Audit Logs | AUDIT | 3 years | Time-based |
| PII Data | PII | 1 year | Relationship end |
| Maintenance Records | OPERATIONAL | 2 years | Time-based |

#### Usage

```typescript
import { DataRetentionManager, DefaultRetentionPolicies } from '@borjie/enterprise-hardening';

const retentionManager = new DataRetentionManager();

// Create a legal hold
const hold = retentionManager.createLegalHold({
  name: 'Litigation Hold - Case 2024-001',
  matter: 'Smith vs. Property LLC',
  custodianId: 'legal-team',
  scope: {
    tenantIds: ['tenant-123'],
    entityTypes: ['Lease', 'Payment', 'Communication'],
    dateRangeStart: '2023-01-01',
    dateRangeEnd: '2024-12-31',
  },
});
```

---

## Resilience

### Circuit Breaker Pattern

Protects services from cascading failures with automatic recovery.

```typescript
import { CircuitBreaker, CircuitBreakerPresets } from '@borjie/enterprise-hardening';

const paymentCircuit = new CircuitBreaker({
  name: 'payment-provider',
  ...CircuitBreakerPresets.PAYMENT_PROVIDER,
});

// Execute with circuit breaker protection
try {
  const result = await paymentCircuit.execute(async () => {
    return await paymentProvider.processPayment(payment);
  });
} catch (error) {
  if (error instanceof CircuitOpenError) {
    // Circuit is open, use fallback
    return handlePaymentFallback(payment);
  }
  throw error;
}

// Monitor circuit health
const metrics = paymentCircuit.getMetrics();
console.log(`Circuit state: ${metrics.currentState}, Hit rate: ${metrics.successfulCalls / metrics.totalCalls}`);
```

### Rate Limiting

Multiple algorithms for API protection with tenant-aware limits.

```typescript
import { RateLimiter, RateLimitPresets, RateLimitScope } from '@borjie/enterprise-hardening';

const apiLimiter = new RateLimiter({
  name: 'api-standard',
  ...RateLimitPresets.STANDARD_API,
  scope: RateLimitScope.USER,
});

// Check rate limit
const result = await apiLimiter.check({
  userId: 'user-123',
  tenantId: 'tenant-456',
  endpoint: '/api/properties',
});

if (!result.allowed) {
  return new Response('Too Many Requests', {
    status: 429,
    headers: result.headers,
  });
}
```

### Health Checks

Kubernetes-compatible health probes for liveness, readiness, and startup.

```typescript
import { HealthCheckManager, HealthCheckBuilders } from '@borjie/enterprise-hardening';

const healthManager = new HealthCheckManager({
  serviceName: 'api-gateway',
  version: '1.0.0',
  environment: 'production',
  checks: [
    HealthCheckBuilders.memory(90),
    HealthCheckBuilders.database('postgres', () => db.ping()),
    HealthCheckBuilders.cache('redis', () => redis.ping()),
    HealthCheckBuilders.externalApi('stripe', 'https://api.stripe.com/v1/health'),
  ],
});

healthManager.start();

// Kubernetes probes
app.get('/health/live', async (req, res) => {
  const health = await healthManager.getLiveness();
  res.status(HealthStatusCodes[health.status]).json(health);
});

app.get('/health/ready', async (req, res) => {
  const health = await healthManager.getReadiness();
  res.status(HealthStatusCodes[health.status]).json(health);
});
```

### Disaster Recovery

Multi-region failover coordination with RTO/RPO tracking.

```typescript
import { DisasterRecoveryManager, RegionStatus, FailoverMode } from '@borjie/enterprise-hardening';

const drManager = new DisasterRecoveryManager();

// Register regions
drManager.registerRegion({
  id: 'us-east-1',
  name: 'US East (Primary)',
  provider: 'aws',
  location: 'us-east-1',
  isPrimary: true,
  priority: 1,
  endpoints: { ... },
  healthEndpoint: 'https://us-east-1.api.example.com/health',
  status: RegionStatus.ACTIVE,
  lastHealthCheck: new Date().toISOString(),
});

// Initiate failover
const failover = drManager.initiateFailover(
  'us-west-2',
  FailoverMode.MANUAL,
  'admin@example.com',
  'Primary region experiencing elevated error rates'
);

// Get recovery metrics
const metrics = drManager.getRecoveryMetrics('us-east-1');
console.log(`RPO: ${metrics.currentRpo}min (target: ${metrics.targetRpo}min)`);
```

---

## Performance

### Caching Strategies

Multi-layer caching with L1 (in-memory) and L2 (distributed) support.

```typescript
import { CacheManager, CachePresets, TenantCacheManager } from '@borjie/enterprise-hardening';

// Create a tenant-aware cache
const propertyCache = new TenantCacheManager(
  { name: 'properties', ...CachePresets.API_RESPONSE },
  redisStore,
  'tenant-123'
);

// Get or load pattern
const properties = await propertyCache.getOrLoad(
  `list:${page}`,
  async () => propertyService.list(page),
  { ttl: 300000, tags: ['properties'] }
);

// Invalidate by tag
await propertyCache.invalidateByTag('properties');
```

### Resource Monitoring

Track resource utilization and receive alerts.

```typescript
import { ResourceMonitorManager, DefaultResourceThresholds } from '@borjie/enterprise-hardening';

const monitor = new ResourceMonitorManager();
monitor.setThresholds(DefaultResourceThresholds);

// Record metrics
monitor.recordMetric({
  resourceType: ResourceType.DATABASE,
  resourceId: 'primary-db',
  name: 'connection_utilization',
  value: 75,
  unit: 'percent',
  timestamp: new Date().toISOString(),
});

// Listen for alerts
monitor.addAlertListener((alert) => {
  notificationService.send({
    channel: 'ops',
    message: `[${alert.status}] ${alert.resourceType} ${alert.metric}: ${alert.value}`,
  });
});
```

### Cost Management

Track costs by tenant, service, and resource for FinOps.

```typescript
import { CostManager, CostDimension } from '@borjie/enterprise-hardening';

const costManager = new CostManager();

// Create a budget
costManager.createBudget({
  id: 'tenant-123-monthly',
  name: 'Tenant 123 Monthly Budget',
  amount: 10000,
  currency: 'USD',
  period: 'monthly',
  alertThresholds: [50, 75, 90, 100],
  dimension: CostDimension.TENANT,
  dimensionValue: 'tenant-123',
});

// Generate cost report
const report = costManager.generateCostReport({
  start: '2024-01-01',
  end: '2024-01-31',
});
console.log(`Total cost: $${report.totalCost}`);
console.log(`Potential savings: $${costManager.getTotalPotentialSavings()}`);
```

---

## Enterprise Integrations

### Webhooks

Reliable webhook delivery with retries and signature verification.

```typescript
import { WebhookManager, WebhookEventTypes } from '@borjie/enterprise-hardening';

const webhookManager = new WebhookManager();

// Register endpoint
webhookManager.registerEndpoint({
  id: 'endpoint-001',
  tenantId: 'tenant-123',
  url: 'https://partner.example.com/webhooks',
  secret: 'whsec_...',
  events: ['payment.*', 'lease.signed'],
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// Emit event
await webhookManager.emit({
  id: 'evt-001',
  tenantId: 'tenant-123',
  type: WebhookEventTypes.PAYMENT_RECEIVED,
  category: 'payment',
  timestamp: new Date().toISOString(),
  data: { paymentId: 'pay-123', amount: 1500 },
});
```

### Partner API Gateway

API key management with scopes and usage tracking.

```typescript
import { PartnerApiManager, PartnerTier } from '@borjie/enterprise-hardening';

const apiManager = new PartnerApiManager();

// Register application
const app = apiManager.registerApplication({
  partnerId: 'partner-001',
  name: 'Property Analytics App',
  description: 'Analytics integration for property data',
  callbackUrls: ['https://app.example.com/callback'],
  tier: PartnerTier.PROFESSIONAL,
  scopes: ['properties:read', 'analytics:read'],
});

// Approve and create API key
apiManager.approveApplication(app.id);
const { key, plainTextKey } = await apiManager.createApiKey(
  app.id,
  'Production Key',
  ['properties:read', 'analytics:read']
);

// Validate incoming request
const validation = await apiManager.validateApiKey(requestApiKey);
if (!validation.valid) {
  return new Response('Unauthorized', { status: 401 });
}
```

### Custom Workflows

Visual workflow engine for enterprise automation.

```typescript
import { WorkflowEngine, TriggerType, ActionType, WorkflowStatus } from '@borjie/enterprise-hardening';

const workflowEngine = new WorkflowEngine();

// Create from template
const workflow = workflowEngine.createFromTemplate(
  'lease-renewal-reminder',
  'tenant-123',
  'admin@example.com',
  { variables: { reminderDays: 60 } }
);

// Activate workflow
workflowEngine.updateWorkflow(workflow.id, { status: WorkflowStatus.ACTIVE });

// Or create custom workflow
const customWorkflow = workflowEngine.createWorkflow({
  tenantId: 'tenant-123',
  name: 'Custom Payment Alert',
  description: 'Alert on large payments',
  status: WorkflowStatus.ACTIVE,
  trigger: {
    id: 't-1',
    type: TriggerType.EVENT,
    config: { eventType: 'payment.received' },
  },
  actions: [
    {
      id: 'a-1',
      name: 'Check Amount',
      type: ActionType.CONDITIONAL,
      config: {},
      conditionalBranches: [
        { condition: '{{event.amount}} > 10000', nextAction: 'a-2' },
      ],
    },
    {
      id: 'a-2',
      name: 'Send Alert',
      type: ActionType.SEND_NOTIFICATION,
      config: {
        to: 'finance@example.com',
        message: 'Large payment received: ${{event.amount}}',
      },
    },
  ],
  startActionId: 'a-1',
  createdBy: 'admin@example.com',
});
```

---

## Configuration Checklist

### Production Readiness

- [ ] SOC 2 controls mapped and evidence collection automated
- [ ] Privacy policies configured for applicable regulations
- [ ] Data retention policies aligned with legal requirements
- [ ] Circuit breakers configured for all external dependencies
- [ ] Rate limits set for all API endpoints
- [ ] Health checks implemented for all critical dependencies
- [ ] DR plan documented with RTO/RPO targets
- [ ] Backup verification automated
- [ ] Caching strategy optimized for access patterns
- [ ] Resource monitoring thresholds configured
- [ ] Cost tracking enabled for all resources
- [ ] Webhook retry policy configured
- [ ] API key rotation schedule established
- [ ] Workflow templates customized for business processes

### Monitoring Dashboards

1. **Compliance Dashboard**: Control status, evidence gaps, upcoming assessments
2. **Resilience Dashboard**: Circuit states, rate limit utilization, health status
3. **Performance Dashboard**: Cache hit rates, latencies, resource utilization
4. **Cost Dashboard**: Spend by tenant/service, budget utilization, savings opportunities
5. **Integration Dashboard**: Webhook delivery rates, API usage, workflow executions

---

## Support

For enterprise support, contact: enterprise@borjie.com
