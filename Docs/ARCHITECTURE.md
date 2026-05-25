# BORJIE Architecture

## Overview

BORJIE is a multi-tenant SaaS platform for property management. This document describes the system architecture, multi-tenant design, service layers, database schema, and event-driven patterns.

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT APPLICATIONS                                    │
├──────────────────┬──────────────────┬──────────────────┬───────────────────────┤
│   Admin Portal   │   Owner Portal   │   Customer App   │  Estate Manager App   │
│   (Vite, :3000)  │   (Vite, :3001)  │ (Next.js, :3002)  │ (Next.js, :3003)      │
└────────┬─────────┴────────┬─────────┴────────┬─────────┴───────────┬───────────┘
         │                  │                  │                    │
         └──────────────────┴──────────────────┴────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              API GATEWAY (:4000)                                  │
│  Express + Hono │ Auth (JWT) │ Rate Limit │ CORS │ Request Aggregation            │
└─────────────────────────────────────┬─────────────────────────────────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│  Auth / Policy  │       │ Domain Services  │       │  Event Bus       │
│  JWT + RBAC     │       │ (Business Logic) │       │  (Outbox/Kafka)  │
└────────┬────────┘       └────────┬────────┘       └────────┬────────┘
         │                         │                         │
         └─────────────────────────┼─────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ PostgreSQL  │  │   Redis     │  │  S3/Blob    │  │  Payments Ledger        │ │
│  │ (Drizzle)   │  │ (Cache)     │  │ (Documents) │  │  (Prisma)               │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Multi-Tenant Design

### Tenant Isolation

- **Row-level isolation**: Every core table has a `tenant_id` column. All queries are scoped by tenant.
- **Shared schema**: Single database, shared tables; tenant ID filters all reads/writes.
- **Platform vs tenant**: Platform admins use `tenantId: 'platform'`; tenant users are bound to a specific tenant.

### Tenant Scoping Flow

```
Request → JWT (tenantId, userId, role) → Repository/Service → WHERE tenant_id = :tenantId
```

### User Roles (Tenant-Scoped)

| Role | Scope | Typical Access |
|------|-------|----------------|
| SUPER_ADMIN | Platform | All tenants |
| ADMIN | Platform | All tenants (read/write) |
| SUPPORT | Platform | Read-only support |
| TENANT_ADMIN | Tenant | Full tenant config |
| PROPERTY_MANAGER | Tenant | Properties, units, leases |
| ACCOUNTANT | Tenant | Invoices, payments |
| MAINTENANCE_STAFF | Tenant | Work orders |
| OWNER | Tenant | Read-only portfolio |
| RESIDENT | Tenant | Own leases, payments, requests |

### Property-Level Access

Some roles (e.g. PROPERTY_MANAGER) may have `propertyAccess: ['prop-1', 'prop-2']` or `['*']` for all properties. Work orders, units, and reports are filtered by this list.

---

## Service Layers

### 1. API Gateway (BFF)

- **Location**: `services/api-gateway`
- **Stack**: Express, Hono, Pino
- **Responsibilities**:
  - Route requests to domain logic
  - JWT validation
  - Zod request validation
  - Response shaping
  - Webhook handling (e.g. M-Pesa callback)

### 2. Domain Services

- **Location**: `services/domain-services`
- **Responsibilities**:
  - Business rules (leases, maintenance, scheduling)
  - Event publishing
  - Orchestration across repositories

### 3. Repositories (Data Access)

- **Location**: `packages/database/src/repositories`
- **Pattern**: Repository per aggregate
- **Tenant scoping**: All methods accept `tenantId` and enforce it in queries

### 4. Supporting Services

| Service | Purpose |
|---------|---------|
| `payments-ledger` | Immutable payment ledger, reconciliation |
| `reports` | Report generation, exports |
| `notifications` | Email, SMS, push |

---

## Database Schema Overview

### Core Schemas (packages/database)

```
tenant.schema     → tenants, organizations, users, roles, user_roles, sessions, audit_events
property.schema   → properties, units
blocks.schema     → blocks (building/floor grouping)
customer.schema   → customer_accounts, owner_accounts
lease.schema     → leases, lease_amendments
payment.schema   → invoices, payments, payment_plans
maintenance.schema → maintenance_requests, work_orders, vendors
inspections.schema → inspections, inspection_items
messaging.schema → conversations, messages
scheduling.schema → appointments, schedules
documents.schema → documents, document_versions
cases.schema     → cases, case_events, notices, evidence
ledger.schema    → ledger_entries (double-entry)
```

### Key Entity Relationships

```
Tenant
  ├── Users (tenant_id)
  ├── Roles (tenant_id)
  ├── Properties (tenant_id)
  │     └── Units (property_id)
  ├── Customers (tenant_id)
  ├── Leases (tenant_id) → Unit, Customer
  ├── Invoices (tenant_id) → Lease, Customer
  ├── Payments (tenant_id) → Invoice, Customer
  ├── Work Orders (tenant_id) → Unit, Property, Vendor
  └── Cases (tenant_id)
```

### Tenant Schema (Simplified)

| Table | Key Columns |
|-------|-------------|
| tenants | id, name, slug, status, subscription_tier |
| users | id, tenant_id, email, role (via user_roles) |
| roles | id, tenant_id, name, permissions |
| user_roles | user_id, role_id, tenant_id |
| sessions | user_id, tenant_id, status, expires_at |
| audit_events | tenant_id, event_type, actor_id, target_id |

---

## Event-Driven Patterns

### Outbox Pattern

Domain writes and event publication happen in a single transaction:

```
1. Write to domain table
2. Insert into outbox table (same transaction)
3. Outbox processor polls → publishes to event bus → marks delivered
```

### Event Envelope

```json
{
  "id": "evt_abc123",
  "type": "lease.activated",
  "version": "1.0",
  "timestamp": "2026-02-13T12:00:00Z",
  "tenantId": "tnt_xyz",
  "correlationId": "corr_def",
  "actor": { "type": "user", "id": "usr_123" },
  "data": { ... },
  "metadata": { "source": "lease-service" }
}
```

### Key Event Types

| Domain | Event | Consumers |
|--------|-------|-----------|
| Lease | lease.created, lease.activated, lease.terminated | Unit, Payments, Notifications |
| Payment | payment.initiated, payment.succeeded, payment.failed | Ledger, Notifications |
| Maintenance | request.created, workorder.completed | SLA, Notifications |
| Case | case.escalated, case.resolved | Notifications, Audit |

### In-Memory Event Bus (Development)

`services/domain-services` uses an `InMemoryEventBus` for local development. Production can swap to Kafka or similar.

---

## Security Model

### Authentication

1. User logs in via `POST /auth/login`
2. JWT issued with `userId`, `tenantId`, `role`, `permissions`, `propertyAccess`
3. Token validated on each request via `Authorization: Bearer <token>`

### Authorization

1. `authMiddleware` extracts and validates JWT
2. `requireRole(...)` enforces role checks
3. Repositories enforce `tenantId` and `propertyAccess` in queries

### Audit

- `audit_events` table records actor, action, target, and metadata
- Append-only, immutable

---

## Deployment Model

- **Containers**: Docker images for API Gateway and web apps
- **Orchestration**: Kubernetes (ECS/EKS)
- **Database**: PostgreSQL (RDS), Redis (ElastiCache)
- **Storage**: S3 for documents
- **Infrastructure**: Terraform in `infrastructure/terraform`

---

## Package Dependencies

```
apps/*           → packages/design-system, packages/api-client, packages/domain-models
api-gateway      → packages/database, packages/authz-policy
domain-services  → packages/database, packages/domain-models
```

---

## AI-native agent wirings (composition root)

Four AI-native agents are wired into `services/api-gateway/src/composition/`
and exposed as typed optional slots on `ServiceRegistry`. Each returns
`null` when `DATABASE_URL` is unset so the existing degraded-mode router
contract holds.

| Agent | Wiring file | Registry slot | Persistence (Drizzle) | Migration |
|-------|-------------|---------------|------------------------|-----------|
| Monthly Close Orchestrator | `monthly-close-wiring.ts` | `monthlyClose` | `monthly_close_runs` + `monthly_close_run_steps` | `0099` |
| Voice Agent (Mr. Mwikila) | `voice-agent-wiring.ts` | `voiceAgent` | `voice_turns` | `0110` |
| Market-Rate Surveillance | `market-surveillance-wiring.ts` | `marketSurveillance` | `market_rate_snapshots` | `0103` |
| Predictive Interventions | `predictive-interventions-wiring.ts` | `predictiveInterventions` | `tenant_predictions` + `predictive_intervention_opportunities` | `0106` |

### What's wired vs what's stubbed

| Capability | Wired today | Stubbed (follow-up adapter) |
|------------|-------------|------------------------------|
| Monthly Close — RunStorePort (Postgres run + step audit trail) | LIVE | Reconciliation, Statement, Disbursement, Notification, Event ports are graceful no-op stubs that warn-once. AutonomyPolicy stub returns `autonomousModeEnabled=false` so batches park as `awaiting_approval`. |
| Voice Agent — VoiceTurnRepository (append-only voice-turn log) | LIVE | STT / TTS / customer-resolver = null. Brain port is a heuristic-language stub (sw / es / fr / en — never hardcodes 'en'). |
| Market Surveillance — snapshot persistence | LIVE | `MarketRatePort` is a stub with `adapterId='stub-not-configured'`; `listActiveUnits` returns `[]` until the units adapter lands. |
| Predictive Interventions — prediction + opportunity persistence | LIVE | LLM port = undefined → heuristic-baseline mode. `listActiveTenants` returns `[]` until the occupancy/leases adapter lands. |

The follow-up adapters (concrete Reconciliation/Statement/Disbursement
port adapters; Anthropic-backed `VoiceBrain`; Zillow / Rentometer
`MarketRatePort`; occupancy / lease join for `listActive*`) are flagged
inline with `TODO` comments in each wiring file.

### Drizzle schemas + services

The four agents' persistence ports route through typed Drizzle schemas
in `packages/database/src/schemas/` and consumer-shaped services in
`packages/database/src/services/`:

- `voice-turns.schema.ts` + `voice-turns.service.ts`
- `market-rate-snapshots.schema.ts` + `market-rate-snapshots.service.ts`
- `tenant-predictions.schema.ts` + `tenant-predictions.service.ts`
- `monthly-close-runs.schema.ts` + `monthly-close-runs.service.ts`

Services are duck-typed at the boundary so `@borjie/database` does
NOT compile-time-depend on `@borjie/ai-copilot`. Composition roots
adapt the database service shape onto the consumer's port.
