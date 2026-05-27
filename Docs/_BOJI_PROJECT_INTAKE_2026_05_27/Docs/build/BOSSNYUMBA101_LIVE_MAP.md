# BossNyumba101 Live Architecture Map
**Canonical Reference for Boji Adaptation**
Generated: 2026-05-25 | Source Repo: `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101`

---

## 1. Repo Topology

### Monorepo Tool: pnpm + Turbo
- **Root package.json**: `/packages/database/package.json/BOSSNYUMBA101/package.json`
  - Package manager: `pnpm@8.15.0` (workspaces in root `package.json`)
  - Node engine: `>=20.0.0`
  - Build tool: Turbo (implicit in `pnpm -r` scripts)
- **Root scripts** (key):
  - `pnpm build` — build all workspaces
  - `pnpm test`, `test:coverage`, `test:e2e` — Vitest + Playwright
  - `pnpm migrate` — Prisma DB migrations
  - `pnpm setup-env`, `gen-secrets` — environment setup

### Apps Directory (8 frontend/mobile applications)
| App | Framework | Purpose | Port |
|-----|-----------|---------|------|
| `admin-platform-portal` | Next.js | Admin ops + compliance | `3000` (inferred) |
| `admin-portal` | Next.js | Legacy admin UI | `3001` (inferred) |
| `customer-app` | Next.js + Liveblocks | Multi-tenant tenant SaaS | `3002` |
| `estate-manager-app` | Next.js | Property/estate management | `3003` |
| `owner-portal` | Next.js | Landlord/owner dashboard | `3004` |
| `tenant-portal` | Next.js | Tenant-facing portal | `3005` |
| `marketing` | Next.js | Public marketing site | `3006` |
| `bossnyumba_app` | React/React Native (?)| Mobile app | TBD |

**Frontend stack:**
- UI: `shadcn/ui` (Radix + Tailwind) + Lucide icons
- State: `@tanstack/react-query` v5, Zustand (inferred)
- Real-time collab: `@liveblocks/react` v2
- Vitest for unit tests, Playwright for E2E

### Packages Directory (130+ packages, highly modular)
**Core systems** (load-bearing):
- `central-intelligence` — The 13-step brain kernel (main AI engine)
- `ai-copilot` — Junior-AI factory, voice agents, background intelligence
- `database` — Prisma schema + migrations (Postgres primary)
- `agent-platform`, `agent-runtime`, `agent-orchestrator` — Agentic execution
- `domain-models` — Type definitions (TypeScript)
- `design-system` — UI component library (Radix/shadcn derived)

**AI/intelligence submodules**:
- `knowledge-graph` — Neo4j-backed entity/relationship graph
- `forecasting-engine`, `forecasting` — Predictive models
- `memory-v2` — Episodic, semantic, procedural, reflective tiers
- `brain-self-awareness`, `brain-llm-router` — Provider cascade logic
- `extended-reasoning`, `reasoning-substrate` — Chain-of-thought
- `document-ai`, `document-analysis`, `document-quality-guarantor` — Doc intelligence
- `observable`, `observability` — Metrics/tracing (OpenTelemetry implied)

**Domain-specific**:
- `acquisition-advisor`, `expansion-advisor` — Property acquisition
- `estate-auto-management`, `estate-manager-app` — Estate operations
- `estate-department-advisor` — Estate dept LLM logic
- `procurement-coordination`, `asset-management` — Vendor + asset workflows
- `forecasting-engine` — Revenue/occupancy forecasting
- `market-intelligence` — Real estate market signals
- `carbon-market` — ESG/sustainability
- `lifecycle-advisor` — Tenant lifecycle → actions
- `sustainability-advisor`, `green-angle-advisor` — Env initiatives

**Infrastructure/hardening**:
- `compliance-pack`, `compliance-plugins` — Regulatory (KYC, AML)
- `ethics-framework`, `fairness-eval` — Responsible AI
- `security-audit`, `security-hardening` — Sec posture
- `autonomy-governance` — Agent authority boundaries
- `anti-corruption-layer`, `aop-compiler` — Cross-cutting policies
- `realtime-adapter`, `realtime-rooms` — WebSocket coordination

**Integrations/adapters**:
- `mcp-server`, `mcp` — Model Context Protocol (Claude/tool interop)
- `lpms-connector` — LPMS (legacy PMS) sync
- `connectors` — External API bridge
- `storage-adapter` — S3/blob storage abstraction
- `audio-capture`, `audio-logics-litfin` — Voice/speech input

**Learning/evolution**:
- `prompt-evolution` (in kernel/) — Weekly DSPy GEPA/MIPROv2 optimizer
- `skill-library`, `skill-promotion` — Voyager-style skill registry
- `learning-loop` — Experiential improvement
- `reflexion` — Introspection + retrospective (NeurIPS 2023 impl)

### Services Directory (microservices / background workers)
- `api-gateway` — Hono + @anthropic-ai/sdk, primary entry point
- `consolidation-worker` — Memory consolidation cron (24h rolling window)
- `payments-ledger` — Financial transaction ledger

### Docker & Infrastructure
**docker-compose.yml** (local dev):
```yaml
postgres:15-pgvector  # Primary DB + embeddings
redis:7-alpine        # Cache/queue
neo4j:5-community     # Knowledge graph
minio              # S3-compatible storage
```

**k8s/** and **infrastructure/**:
- Consolidation worker cron job deployment (`consolidation-worker-cron.yaml`)
- Cloud-native config (likely GCP/AWS)

---

## 2. Tech Stack Inventory

### Languages & Runtimes
- **TypeScript 6.0.3** (strict mode) — 100% codebase
- **Node.js >=20.0.0** — backend services
- **Python** — likely in evals/ for benchmarking

### Frameworks & Core Libraries
| Component | Package | Version | Role |
|-----------|---------|---------|------|
| Web frontend | `next` | latest | All 8 apps use Next.js 14+ |
| API gateway | `hono` | >=4.12.18 | Lightweight edge-ready HTTP |
| Claude SDK | `@anthropic-ai/sdk` | latest | Primary LLM provider |
| Database ORM | `prisma` | latest | Postgres schema + migrations |
| State management | `zustand`, `jotai` | - | Client + server state |
| Real-time | `@liveblocks/react`, `socket.io` | - | Multiplayer coordination |
| Knowledge graph | `neo4j` driver | - | Entity relationships |
| Testing | `vitest`, `@playwright/test` | 4.1.6+ | Unit + E2E |

### Databases
- **PostgreSQL 15** (pgvector extension) — transactional storage, embeddings
- **Redis 7** — session cache, rate-limit, job queue
- **Neo4j 5** — knowledge/org graph, relationship queries
- **MinIO** — S3-compatible object storage (local dev)

### Authentication & Authorization
- Multi-tenant row-level security (RLS) in Postgres
- MFA methods: TOTP, SMS, email, WebAuthn, backup codes (schema enums)
- Session tokens with expiry tracking
- Role-based access control (RBAC) + per-tenant AuthZ policies

### LLM & AI Infrastructure
- **Primary provider**: Anthropic Claude (3.5 Sonnet inferred)
- **Fallback cascade**: OpenAI → DeepSeek (sensor-failover.ts)
- **Token budgeting**: LLM-budget-governor package + per-tenant cost tracking
- **Embeddings**: `createNullEmbedder`, `createOpenAiEmbedder` (interchangeable)
- **Prompt evolution**: Weekly DSPy optimizer (mutable prompt artifacts, A/B test promotion)

### Observability & Operations
- OpenTelemetry instrumentation (observability/)
- Decision-trace recorder (in-memory store, per-tenant, 200-trace cap)
- OCSF event emitter (security event standardization)
- Audit hash-chain (tamper-evident ledger)

---

## 3. The Agent / AI System (Boji's Cloning Target)

### The 13-Step BrainKernel Pipeline
**File**: `/packages/central-intelligence/src/kernel/kernel.ts`  
**README**: `/packages/central-intelligence/README.md` (lines 20–40)

| Step | Name | Module | Purpose | File:Line |
|------|------|--------|---------|-----------|
| 0 | **Killswitch** | `inviolable.ts`, `killswitch.ts` | Reject if env HALT/LOCKED state | `kernel.ts:0` |
| 1 | **Cache check** | `brain-cache.ts` | Short-circuit identical recent turns | Line 26 |
| 2 | **Inviolability gate** | `killswitch.ts` | Pause/lock policy enforcement | Line 27 |
| 3 | **Tier classification** | `risk-tier.ts` | Classify as read/mutate/destroy/billing/external-comm | Line 28 |
| 4 | **Memory recall** | `memory/` (4-tier hierarchy) | Episodic + semantic + procedural + reflective | Line 29 |
| 5 | **Cohort signal** | `cohort-signal.ts` | DP-bounded peer-tenant signal aggregation | Line 30 |
| 6 | **Persona binding** | `persona.ts`, `branding.ts` | Apply per-tenant voice + preamble | Line 31 |
| 7 | **Sensor failover** | `sensor-failover.ts` | Provider cascade: Claude → OpenAI → DeepSeek | Line 32 |
| 8 | **Normalize** | `normalizer.ts` | Strip PII, format unified prompt | Line 33 |
| 9 | **Judge/generate** | `sensors/` | LLM inference call (primary sensor) | Line 34 |
| 10 | **Drift detection** | `persona-drift/`, `drift-detector.ts` | Compare output to expected persona signature | Line 35 |
| 11 | **Policy gate** | `policy-gate.ts`, `four-eye-approval.ts` | Tier-aware approval (destroy/billing = 4-eye) | Line 36 |
| 12 | **Confidence scoring** | `confidence.ts`, `uncertainty-policy.ts` | Tag output uncertainty + critic verdicts | Line 37 |
| 13 | **Provenance audit** | `decision-trace.ts` | Hash-chain + episodic record writes | Line 38 |

**Control flow returns to orchestrator (agency executor) after step 13.**

### Core Kernel Exports
**File**: `/packages/central-intelligence/src/index.ts` (inferred from brain-kernel-wiring.ts imports)

Key types/factories:
```typescript
// Factories
createBrainKernel()           // Main kernel factory
createBrainToolRegistry()     // Tool spec + execution registry
createDecisionTraceRecorder() // In-memory decision log
createEnvKillswitchPort()     // Env-driven pause/halt gate
createApprovalGate()          // Four-eye approval enforcer
createInMemoryApprovalStore() // Approval record storage

// Types
type BrainKernel = ReturnType<typeof createBrainKernel>
type BrainToolSpec = { /* tool definition */ }
type BrainToolRegistry = { /* tool registry */ }
type DecisionTraceRecorder = { record(trace): void }
type EmbedderPort = { embed(text): Promise<Vector> }
type MultiLLMSynthesizerPort = { synthesize(...): Promise<Output> }
type KillswitchPort = { check(): 'active'|'paused'|'locked' }
```

### Junior AI Factory System
**File**: `/packages/ai-copilot/src/junior-ai-factory/types.ts` (lines 1–136)

**Purpose**: Self-service provisioning of narrow, domain-scoped junior agents.

**Key types**:
```typescript
interface JuniorAISpec {
  tenantId: string
  teamLeadUserId: string
  domain: AutonomyDomain           // E.g., 'arrears-collection'
  mandate: string                  // E.g., "contact tenants in arrears > 60d"
  policySubset: Partial<AutonomyPolicy>  // MUST be ⊆ tenant policy
  toolAllowlist: readonly string[]   // Explicit tool whitelist
  memoryScope: 'team' | 'personal'
  certificationRequired: boolean
  lifecycle: JuniorAILifecycle      // expiresAt, maxActionsPerDay
}

interface JuniorAIRecord extends JuniorAISpec {
  id: string
  status: 'provisioning'|'active'|'suspended'|'revoked'
  actionsToday: number              // Daily rate-limit counter
  actionsTodayDate: string | null
  // ... audit fields
}

interface JuniorAIRepository {
  insert(record): Promise<JuniorAIRecord>
  findById(tenantId, id): Promise<JuniorAIRecord | null>
  list(tenantId, filters): Promise<readonly JuniorAIRecord[]>
  update(tenantId, id, patch): Promise<JuniorAIRecord>
}

// Errors
class PolicySubsetViolationError   // Junior policy > tenant policy
class DailyActionCapExceededError  // Rate limit hit
class JuniorAINotActiveError       // Suspended/revoked check
```

**Service contract** (`service.ts`):
- Factory wiring at `api-gateway` composition root
- Postgres persistence (via Drizzle bindings in follow-up)
- Per-junior audit trail emission

### Consolidation Worker (Memory Learning)
**File**: `/services/consolidation-worker/src/consolidation.ts` (lines 1–200+)

**Purpose**: 24h rolling window consolidation of CoT-reservoir entries into semantic facts.

**Key abstractions**:
```typescript
interface ReservoirEntry {
  thoughtId: string
  tenantId: string | null
  userId: string
  threadId: string
  summary: string
  capturedAt: string
}

interface ConsolidatedFact {
  key: string          // E.g., 'recent-topic'
  value: unknown       // Semantic summary + sourceTurnId
  confidence: number   // 0.0–1.0
}

interface ReservoirSource {
  fetchUnconsolidated(since: Date, limit?): Promise<ReservoirEntry[]>
  markConsolidated(thoughtIds): Promise<void>
}

interface SemanticSink {
  upsertFact(tenantId, userId, key, value, confidence, 'consolidated'): Promise<void>
}

interface ConsolidatorPort {
  consolidate(tenantId, userId, entries): Promise<ConsolidatedFact[]>
}

async function runConsolidationTick(deps: ConsolidationDeps): Promise<ConsolidationTickResult>
  // Returns: { entriesProcessed, groupsProcessed, factsUpserted, thoughtIdsMarked, errors }
```

**Design**:
- Default 24h window, 5000-row fetch limit per tick
- Groups by (tenantId, userId)
- Idempotent on (tenantId, userId, key) — upsert handles duplicates
- Hard errors degrade gracefully per scope (tenant A failure ≠ block tenant B)
- Stub consolidator: 1 fact per N turns (default N=5)
- Production: Haiku call via `services/api-gateway/src/composition/consolidation-runner.ts`

### Multi-Tenant Isolation
**Boundary enforcement** (scattered across kernel):
- `req.scope` on every kernel call carries `(kind: 'tenant', tenantId)`
- Memory recall scoped to tenant (episodic, semantic layers)
- Cohort signals DP-bounded to prevent cross-tenant inference
- RLS policies in `packages/database/prisma/schema.prisma` enforce row-level access
- Audit chain writes include tenantId + hash chain for tamper-evidence

**Middleware integration** (api-gateway):
- Extract tenantId from auth token → attach to request scope
- All downstream calls inherit scope automatically

---

## 4. Data Model

### Primary Entities (Prisma Schema)
**File**: `/packages/database/prisma/schema.prisma`

**Core tables** (lines 676+):
```sql
-- Tenancy
Tenant (id, name, slug, status, subscriptionTier, settings, billingSettings, ...)
User (id, tenantId, email, userType, status, mfaEnabled, ...)
Session (id, userId, status, expiresAt, ...)
Role, RolePermission (RBAC)

-- Property Domain (PROPERTY-SPECIFIC)
Property (id, tenantId, name, propertyType, status, coordinates, PostGIS geom)
Unit (id, propertyId, tenantId, unitType, status, rentAmount, ...)
Customer (id, tenantId, status, kycStatus, idDocumentType, ...)
Lease (id, unitId, customerId, tenantId, status, startDate, endDate, rentFrequency, ...)
Occupancy (id, leaseId, tenantId, status, moveInDate, moveOutDate, ...)
Invoice (id, leaseId, tenantId, type, amount, dueDate, status, ...)
Payment, Transaction (id, invoiceId, tenantId, method, status, ...)
Arrears (id, customerId, tenantId, amount, status, ...)

-- Maintenance
WorkOrder (id, unitId, tenantId, priority, category, status, ...)
MaintenanceRequest (id, customerId, tenantId, status, ...)
Dispatch (id, workOrderId, vendorId, tenantId, status, ...)
Vendor (id, tenantId, status, rating, ...)

-- Intelligence
RiskProfile (id, customerId, tenantId, riskLevel, riskType, ...)
Action (id, customerId, tenantId, type, status, ...)
Segment (id, tenantId, type, status, ...)

-- Case/Legal
Case (id, tenantId, type, status, severity, ...)
Evidence (id, caseId, type, ...)
Notice (id, caseId, tenantId, type, status, deliveryMethod, ...)

-- Document & Verification
Document (id, tenantId, type, status, source, ...)
Badge (id, customerId, badgeType, ...)
DocumentVerification (id, documentId, status, ...)

-- Audit
AuditLog (id, tenantId, eventType, actor, resource, changes, ...)
```

### Property-Specific Schema Fields (Boji Needs Replacement)
- `PropertyType` enum: apartment_complex, single_family, multi_family, townhouse, commercial, mixed_use, **estate**, other
  - **Boji**: mining_concession, processing_plant, pit, tailings_facility, exploration_zone, refinery, ...
- `WorkOrderCategory` enum: plumbing, electrical, hvac, appliance, structural, pest_control, **landscaping**, cleaning, security, other
  - **Boji**: equipment_maintenance, safety_inspection, environmental_monitoring, ore_extraction, ...
- `ActionType` enum: send_reminder, offer_payment_plan, schedule_call, send_renewal_offer, service_recovery, **proactive_maintenance**, loyalty_reward, ...
  - **Boji**: equipment_inspection, production_alert, safety_review, ore_quality_flag, ...
- `CaseType` enum: arrears, **deposit_dispute**, damage_claim, lease_violation, noise_complaint, **maintenance_dispute**, eviction, ...
  - **Boji**: equipment_failure, safety_incident, regulatory_violation, ore_quality_dispute, ...

### Generic Foundation (Cloneable Verbatim for Boji)
- User/auth tables (`User`, `Session`, `Role`, `Permission`)
- Multi-tenant envelope (`Tenant`, `subscriptionTier`)
- Audit logging infrastructure
- Status enums (active, suspended, pending, etc.)
- RLS policy structure
- Document + verification framework

### PostGIS & pgvector
- `Property` likely has a `geom PostGIS geometry` column for spatial queries
- Embeddings tables (`embedding_*` likely in ai-copilot layer) use pgvector for vector similarity

---

## 5. Frontend Surfaces

### App Routes (High-Level)
All apps use Next.js 14+ with App Router (inferred from build scripts).

**customer-app** (`/apps/customer-app`):
- `/` — Dashboard
- `/tenancy` — Lease/occupancy info
- `/maintenance` — Work request portal
- `/payments` — Invoice + payment history
- `/messages` — Support/landlord chat
- `/documents` — Move-in/move-out reports
- `/community` — Estate community board

**owner-portal** (`/apps/owner-portal`):
- `/dashboard` — Portfolio overview
- `/properties` — Property management
- `/tenants` — Tenant directory + screening
- `/income` — Revenue reports + forecasts
- `/maintenance` — Work order dispatch
- `/legal` — Cases + notices
- `/ai-brief` — AI executive summary

**estate-manager-app**:
- `/operations` — Daily tasks, inspections
- `/fleet` — Vehicle/equipment tracking (if applicable)
- `/staff` — Team management
- `/compliance` — Regulatory checklists
- `/budget` — Capex/opex planning

**admin-platform-portal**:
- `/tenants` — Tenant management + KYC
- `/compliance` — Audit logs, RLS policies
- `/ai-ops` — Kernel health, decision traces
- `/billing` — Usage metrics, invoicing

### UI Library & Styling
- **Component library**: shadcn/ui (Radix + Tailwind)
- **Styling**: Tailwind CSS v4 + OKLCH color system (inferred from latest)
- **Icons**: Lucide React
- **Animations**: GSAP (optional, via performance-toolkit)
- **Accessibility**: WCAG 2.2 AA (audit compliance checked)
- **Design system package**: `/packages/design-system` (reusable across all 8 apps)

---

## 6. Infra & Ops

### CI/CD Workflows
**Location**: `/.github/workflows/`

| Workflow | Trigger | Purpose | File |
|----------|---------|---------|------|
| `ci.yml` | PR, push | Lint + typecheck + unit tests | ci.yml |
| `ci-monorepo.yml` | PR | Turbo task cache, workspace deps | ci-monorepo.yml |
| `cd.yml` | merge to main | Build + push images | cd.yml |
| `cd-staging.yml` | push to staging/* | Deploy to staging | cd-staging.yml |
| `cd-production.yml` | release tag | Deploy to production | cd-production.yml |
| `audit-coverage.yml` | schedule | Coverage reports + SCA | audit-coverage.yml |
| `codeql.yml` | PR, schedule | SAST via CodeQL | codeql.yml |
| `backup-restore-test.yml` | schedule | RTO/RPO validation | backup-restore-test.yml |
| `db-migrations-check.yml` | PR | Migration safety + forward-compat | db-migrations-check.yml |
| `decision-trace-coverage.yml` | schedule | Kernel trace collection + replay tests | decision-trace-coverage.yml |
| `csrf-eslint-rule.yml` | PR | Custom ESLint rule for CSRF protection | csrf-eslint-rule.yml |
| `defection-probe.yml` | schedule | Proactive alert if observability goes silent | defection-probe.yml |

### Key Ops Directories
- **`.planning/`**: Roadmap + phase docs (wave planning)
- **`.audit/`**: Migration safety reports, SOTA reviews, architecture decisions
- **`.research/`**: Proof-of-concepts, vendor comparisons
- **`infrastructure/`, `k8s/`**: Cloud-native deployments (Kustomize/Helm inferred)
- **`Docs/RUNBOOKS/`**: Operational guides (4-eye approval, cron debugging, etc.)

### Environment Setup
- `.env.example` — full reference (22KB, lines enumerate all 150+ vars)
- `scripts/setup-bossnyumba-env.mjs` — guided env builder
- `scripts/generate-bossnyumba-secrets.mjs` — secret provisioning

---

## 7. Property-Specific vs. Generic vs. Domain-Coupled Code

### PROPERTY DOMAIN-COUPLED (Requires Replacement for Boji Mining)
**High coupling** (literal field/enum names):
- `PropertyType` enum values (apartment, estate, commercial)
- `UnitType` enum (studio, bedroom counts, retail, warehouse — OK for mining sites with discrete facilities)
- `WorkOrderCategory` (plumbing, HVAC, landscaping — need mining equivalents: compressor, excavator, etc.)
- `ActionType` (proactive_maintenance on units, loyalty_reward for tenants)
- `CaseType` (deposit_dispute, lease_violation — OK to repurpose as equipment/environmental disputes)
- Tenant onboarding flow (`OnboardingState`: move-in, utilities, orientation)

**Package names** (low coupling, but semantically property-focused):
- `estate-auto-management`
- `estate-manager-app`
- `estate-department-advisor`
- `lifecycle-advisor` (tenant lifecycle)
- `market-intelligence` (real estate markets)
- `acquisition-advisor` (property acquisition)
- `green-angle-advisor` (property sustainability)

**Schema references**:
- Lease, Occupancy, Customer (tenant-centric)
- Unit type hierarchy (studio → penthouse assumes vertical residential)
- Rent, invoice, payment (property finance model)

### GENERIC / DOMAIN-AGNOSTIC (Clone Verbatim for Boji)
**No property coupling**:
- BrainKernel 13-step pipeline (pure cognition architecture)
- Junior AI Factory (pure agent provisioning)
- Consolidation Worker (pure memory consolidation)
- Multi-tenant RLS (tenant isolation pattern)
- Audit hash chain (tamper-evidence)
- Decision trace recorder (observability)
- Memory hierarchy (episodic, semantic, procedural, reflective)
- Persona drift detection (domain-neutral)
- Confidence scoring + uncertainty policy (domain-neutral)
- Knowledge graph (Neo4j entity-relationship layer — reusable)
- Skills library + Voyager-style promotion (domain-neutral)
- Reflexion (NeurIPS 2023 retrospective — domain-neutral)

**Package structure**:
- `central-intelligence` — 100% cloneable
- `ai-copilot` — 100% cloneable (except junior-ai-factory domain filters)
- `agent-*` (platform, runtime, orchestrator) — cloneable
- `autonomy-governance` — domain-neutral (authority boundaries)
- `observability`, `security-audit`, `compliance-pack` — mostly cloneable (adjust regulatory refs)
- `document-ai`, `document-analysis` — cloneable
- `anti-corruption-layer`, `aop-compiler` — cloneable

### MIXED (Partial Coupling)
- `forecasting-engine` — uses rent/occupancy; for Boji: production/ore grades, equipment utilization
- `knowledge-graph` — entity types OK, relationship types property-specific (Tenant→Unit→Lease)
- `risk-profile` — payment risk for Boji → equipment risk, safety risk, production disruption risk
- `analytics` — KPIs (avg rent, occupancy %) → KPIs (avg ore grade, equipment uptime %)

---

## 8. Summary: Cloning Strategy for Boji

### Clone Entirely (Core Scaffolding)
✅ `packages/central-intelligence` — Brain kernel 13-step
✅ `packages/agent-platform`, `agent-runtime`, `agent-orchestrator`
✅ `packages/ai-copilot` (junior-ai-factory, voice, ambient-brain)
✅ `packages/memory-v2` (4-tier hierarchy)
✅ `packages/knowledge-graph` (base structure)
✅ `packages/autonomy-governance`
✅ `packages/observability`, `security-audit`
✅ `services/consolidation-worker`
✅ `services/api-gateway` (composition root pattern)

### Adapt (Domain Schema + UI)
⚠️ `packages/database/prisma/schema.prisma`
   - Keep: Tenant, User, Role, RLS, audit
   - Replace: Property → Site, Unit → Facility, Lease → Contract, Customer → Stakeholder
   - Add: Equipment, MiningZone, OreGrade, SafetyIncident, RegulatoryEvent

⚠️ Frontend apps (estate-manager-app → site-manager-app, customer-app → worker-app)
   - Repurpose dashboards/workflows
   - Keep: real-time updates, multi-user coordination (Liveblocks)
   - Replace: route structure, domain language

⚠️ Domain-specific advisors
   - `lifecycle-advisor` → `contract-lifecycle-advisor`
   - `expansion-advisor` → `capacity-expansion-advisor`
   - `market-intelligence` → `mining-commodity-intelligence`

### Replace Entirely (Non-Applicable)
❌ Real estate-specific connectors (LPMS sync)
❌ Property onboarding flow
❌ Tenant screening/deposit logic
❌ Lease templates, eviction workflows

---

## Appendix: Key File References

### Brain Kernel
- `/packages/central-intelligence/README.md` — Pipeline overview
- `/packages/central-intelligence/src/kernel/kernel.ts` — Step implementation
- `/services/api-gateway/src/composition/brain-kernel-wiring.ts` — Composition root (lines 1–150+)

### Junior AI Factory
- `/packages/ai-copilot/src/junior-ai-factory/types.ts` — Types + contracts (lines 1–136)
- `/packages/ai-copilot/src/junior-ai-factory/service.ts` — Service logic

### Consolidation Worker
- `/services/consolidation-worker/src/consolidation.ts` — Core logic (lines 1–200+)
- `/services/api-gateway/src/composition/consolidation-runner.ts` — Haiku integrator

### Data Model
- `/packages/database/prisma/schema.prisma` — Full schema (lines 1–2000+)
- `/packages/domain-models` — TypeScript type exports

### Frontend
- `/apps/customer-app` — Reference Next.js app (port 3002)
- `/packages/design-system` — UI component library

### Docs
- `/Docs/ARCHITECTURE.md` — High-level system design
- `/Docs/ARCHITECTURE_BRAIN.md` — Kernel rationale
- `/Docs/ARCHITECTURE_CENTRAL_COMMAND.md` — Distributed governance
- `/Docs/CODEMAPS/` — Package-level walkthroughs

### Workflows
- `/.github/workflows/ci.yml` — Build/test entry point
- `/.github/workflows/cd-production.yml` — Production release

