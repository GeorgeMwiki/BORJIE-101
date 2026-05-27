# BossNyumba Central Command / Junior Expert Agents Architecture — Verbatim Map

> **Source agent run:** Read-only exploration agent invoked 2026-05-17 against the BossNyumba repo. File paths and pattern names are verbatim and must be mirrored in Boji unless a deliberate divergence is documented. This is the engineering blueprint.

## 1. Directory Layout

```
apps/
├── admin-platform-portal/          # Admin surfaces (HQ-level operations)
├── estate-manager-app/             # Estate manager persona + admin chat
├── owner-portal/                   # Owner/landlord interface
├── customer-app/                   # Tenant-facing application  [Boji: NOT used — no tenant persona]
└── [marketing, bossnyumba_app, ...]

packages/
├── central-intelligence/           # Master AI kernel (orchestrator, 13-step pipeline)
├── ai-copilot/
│   ├── junior-ai-factory/          # Self-service junior provisioning
│   ├── task-agents/                # Lightweight domain-specific workers
│   ├── autonomy/types.ts           # Policy domain definitions
│   └── personas/                   # 8 persona implementations
├── agent-platform/                 # Agent auth, certification, card metadata
├── database/                       # Drizzle ORM schemas + repositories
├── domain-models/                  # Entity definitions
├── api-sdk/                        # Type-safe client SDK
└── [config, design-system, connectors, ...]

services/
├── api-gateway/
│   ├── composition/                # Composition root (kernel wiring, service injection)
│   ├── routes/junior-ai.router.ts  # HTTP endpoints for junior provisioning
│   ├── routes/hr.hono.ts           # HR domain (teams, employees, assignments)
│   └── middleware/
├── consolidation-worker/           # Nightly synthesis pipeline (9 stages)
│   ├── stages/                     # 01-ingest through 09-weekly-prompt-compile
│   └── prompt-compile/             # Weekly GEPA optimizer (Claude+Haiku)
├── document-intelligence/          # OCR, fraud detection, document extraction
└── [notifications, payments, reports, ...]

infra/
├── terraform/                      # IaC for AWS resources
└── alerts/                         # Monitoring rules
```

> **Boji deviation:** Boji has **no `customer-app`**. Boji uses **`owner-app` (mobile)**, **`worker-app` (mobile)**, **`owner-portal` (web)**, and **`internal-platform-portal` (web)**. See `BOJI_AI_SPEC.md` §15 for the surface architecture.

---

## 2. Central Command: Master AI Module

**Location & Core Files:**

- `packages/central-intelligence/src/kernel/kernel.ts` — Main orchestrator loop
- `packages/central-intelligence/src/kernel/compose.ts` — Kernel factory
- `packages/central-intelligence/src/agent/agent-loop.ts` — Core agentic reasoning
- `packages/central-intelligence/src/kernel/index.ts` — Kernel exports (20+ modules)

**Architecture:** The `BrainKernel` is a **13-step deterministic pipeline** that runs once per user turn:

1. **Identity & Scope** — Resolve tenant, user, persona from request scope
2. **Killswitch Gate** — Check env-driven `HALT`/`DEGRADED` state (step 0 short-circuit)
3. **Memory Recall** — Query semantic graph + episodic store with embedding
4. **Cohort Signals** — Aggregate tenant-wide context (market intelligence, aggregated metrics)
5. **Self-Awareness** — Drift detection, confidence scoring, awareness scopes
6. **Theory of Mind** — Model user state, intent recognition
7. **Tool Spec Resolution** — Load permitted tools for this persona
8. **Agent Loop** — Agentic reasoning (think → tool calls → reflect → stop)
9. **Decision Trace** — Record every step taken (200-trace in-memory cap per tenant)
10. **Confidence Gate** — If low confidence, invoke Opus advisor mid-turn
11. **Governance & Review** — Autonomy policy check, four-eye approval for sensitive actions
12. **Provenance Write** — Record fact to semantic memory with confidence
13. **Response Synthesis** — Return message + decision breadcrumbs

**Composition Root:**

- `services/api-gateway/src/composition/brain-kernel-wiring.ts` — Wires kernel at startup
- Env vars control killswitch, embedding provider (null fallback for degraded mode), uncertainty policy
- Per-tenant `req.scope.tenantId` ensures data never fans across boundaries
- Optional debate/counter-model port plugged for multi-perspective synthesis

---

## 3. Junior Agent Pattern

**Definition & Types:**

- `packages/ai-copilot/src/junior-ai-factory/types.ts` — JuniorAIRecord, JuniorAILifecycle
- `packages/ai-copilot/src/junior-ai-factory/service.ts` — JuniorAIFactoryService (core logic)

**Lifecycle:**

```typescript
// Provision
const junior = await factoryService.provision({
  tenantId,
  teamLeadUserId,
  domain: 'leasing' | 'maintenance' | 'finance' | 'compliance' | 'communications',
  mandate: "Manage arrears for ward 3",
  policySubset: { finance: { collectPayment: true } },  // ⊆ tenant's AutonomyPolicy
  toolAllowlist: ['payment_collect', 'send_notice'],    // Explicit allow-list
  memoryScope: 'team' | 'personal',
  certificationRequired: boolean,
  lifecycle: {
    expiresAt?: string,           // ISO timestamp in future
    maxActionsPerDay?: number,    // 1..10,000
  }
});

// Mutate scope
await factoryService.adjustScope(tenantId, juniorId, {
  mandate: "Updated mandate",
  policySubset: { ... },
  toolAllowlist: [...],
  lifecycle: { ... }
});

// Record action (before dispatch)
const updated = await factoryService.recordAction(tenantId, juniorId);
// Throws DailyActionCapExceededError if cap breached

// Suspend / revoke
await factoryService.suspend(tenantId, juniorId, "Policy violation");
await factoryService.revoke(tenantId, juniorId);  // Terminal, no undo
```

**State Transitions:**

- `provisioning` → `active` (immediate)
- `active` → `suspended` (policy breach, manual action cap) + reason logged
- `suspended` | `active` → `revoked` (terminal, via audit trail)

**Validation:**

1. `policySubset` is validated as ⊆ tenant AutonomyPolicy (prevents privilege escalation)
2. `toolAllowlist` is pure string array (no tool discovery from junior)
3. Daily action cap enforced on per-UTC-day counter (`actionsToday`, `actionsTodayDate`)
4. Expiry checked at provision time (must be future)

**Repository Abstraction:**

```typescript
interface JuniorAIRepository {
  insert(record: JuniorAIRecord): Promise<JuniorAIRecord>;
  findById(tenantId: string, id: string): Promise<JuniorAIRecord | null>;
  list(tenantId: string, filters: ListJuniorAIFilters): Promise<readonly JuniorAIRecord[]>;
  update(tenantId: string, id: string, patch: Partial<JuniorAIRecord>): Promise<JuniorAIRecord>;
}
```

- In-memory implementation ships for testing
- Postgres adapter wired at `api-gateway` composition root

---

## 4. Task Agents (Worker Pattern)

**Type Definition:**

- `packages/ai-copilot/src/task-agents/types.ts` — TaskAgent interface
- `packages/ai-copilot/src/task-agents/executor.ts` — Runtime executor
- `packages/ai-copilot/src/task-agents/agents/` — 15+ domain agents (e.g., `rent_reminder_agent`)

**Contract:**

```typescript
interface TaskAgent<Schema extends ZodTypeAny> {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly trigger: CronTrigger | EventTrigger | ManualTrigger;
  readonly guardrails: GuardrailsSpec;
  readonly payloadSchema: Schema;
  readonly execute: (ctx: AgentRunContext<z.infer<Schema>>) => Promise<AgentRunResult>;
}

// e.g., rent_reminder_agent.ts
export const rentReminderAgent: TaskAgent = {
  id: 'rent_reminder',
  trigger: { kind: 'cron', cron: '0 6 * * *', description: 'Daily 6 AM' },
  guardrails: {
    autonomyDomain: 'communications',
    autonomyAction: 'send_notice',
    invokesLLM: true,
  },
  execute: async (ctx) => {
    // Find tenants 3 days before rent due
    // Call notification service
    return { outcome: 'executed', summary: '42 notices sent', data: {}, affected: [] };
  }
};
```

**Execution Model:**

- Triggered by cron, domain event, or manual invocation
- Autonomy policy checked **before** execute() — if policy rejects, run marked `skipped_policy` (no cost)
- LLM-invoking agents wrapped with budget-guard
- Every run audited to `audit_events` + emits `TaskAgentRan` platform event
- Run result includes optional `affected` array (entity refs for audit trail)

---

## 5. Worker-Facing UI & Data Collection

**HTTP API (Junior Provisioning):**

- `services/api-gateway/src/routes/junior-ai.router.ts` — Hono v4 router

```
POST   /api/v1/junior-ai/provision       # Team lead spins up new junior
GET    /api/v1/junior-ai/mine             # List my juniors
GET    /api/v1/junior-ai/:id              # Fetch one junior
PATCH  /api/v1/junior-ai/:id/scope        # Adjust mandate, tools, policy
POST   /api/v1/junior-ai/:id/suspend      # Suspend with reason
POST   /api/v1/junior-ai/:id/revoke       # Terminal revocation
```

Gated with `requireRole(TEAM_LEAD)` → accepts TENANT_ADMIN | PROPERTY_MANAGER | SUPER_ADMIN

**Task Agent Dispatch:**

- `packages/ai-copilot/src/task-agents/registry.ts` — Agent registry (register, lookup by id)
- `packages/ai-copilot/src/task-agents/executor.ts` — ExecuteTaskAgentCommand wraps run in context

Workers (team members) don't directly provision agents; **team leads (admins) do** via `/junior-ai/provision`, then workers interact with the junior through the persona chat interface (estate-manager-app).

**Results Collection:**

- Junior actions recorded via `recordAction(tenantId, juniorId)` before dispatch
- Every action flows through the kernel's 13-step pipeline
- Results written to semantic memory (temporal-entity-graph) + decision trace
- Task agent runs emit `TaskAgentRan` event → subscribed services (webhooks, observability)

---

## 6. Synthesis Step: Master Combines Junior Outputs

**Consolidation Worker (Nightly Pipeline):**

- `services/consolidation-worker/src/index.ts` — Composition root
- `services/consolidation-worker/src/consolidation.ts` — Abstract orchestrator
- `services/consolidation-worker/src/stages/` — 9-stage pipeline

**Stages:**

1. **01-ingest.ts** — Read `kernel_cot_reservoir` (raw thoughts from last 24h)
2. **02-cluster.ts** — Group related facts by entity/topic
3. **03-reflect.ts** — Constitutional criticism (Haiku evaluator)
4. **04-promote.ts** — Fact promotion heuristic (keep high-confidence, decay low)
5. **05-decay.ts** — Age-based confidence decay
6. **06-consolidate.ts** — Deduplicate + merge contradictions
7. **07-re-embed.ts** — Re-embed consolidated facts for recall
8. **08-publish.ts** — Emit consolidation events
9. **09-weekly-prompt-compile.ts** — **Weekly only (Sundays)** — GEPA prompt optimization

**How Juniors Feed Into This:**

- Each junior's actions append rows to `kernel_cot_reservoir` during agentic reasoning
- Consolidation worker aggregates 24h of junior turns
- Stage 03 evaluates junior decisions for constitutional alignment
- Stage 04 promotes validated junior facts to semantic memory
- Stage 07 re-embeds so future juniors can recall what siblings learned

**Multi-Perspective Synthesis (Counter-Model Hoist):**

- `packages/central-intelligence/src/kernel/kernel.ts` — `composeSovereign()`
- Optional counter-model port (Phase C-1, commit 18c3f908)
- When wired, kernel can invoke a secondary Haiku model to challenge primary Opus reasoning
- Advisor pattern: Sonnet executor consults Opus advisor when confidence is low
- Counter-model hoisted to kernel composition for on-demand debate

---

## 7. Persistent Business-State / Knowledge Graph

**Temporal Entity Graph (Bi-Temporal):**

- `packages/database/src/schemas/temporal-entity-graph.schema.ts`
- Three tables (migration 0140):
  - `temporal_entities` — Typed nodes (tenant, unit, lease, payment, maintenance-ticket)
  - `temporal_relationships` — Typed edges (LIVES_IN, PAYS, OWNS, REPORTS_FAULT_IN)
  - `temporal_communities` — Nightly community-detection output (Louvain modularity)

**Bi-Temporal Model:**

```sql
CREATE TABLE temporal_entities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  entity_type TEXT NOT NULL,          -- 'tenant' | 'unit' | 'lease' | ...
  entity_key TEXT NOT NULL,           -- stable business key
  attributes JSONB NOT NULL DEFAULT {},
  valid_from TIMESTAMP NOT NULL,      -- world truth window
  valid_to TIMESTAMP,                 -- NULL = currently valid
  recorded_at TIMESTAMP DEFAULT NOW(),
  invalidated_at TIMESTAMP,           -- soft-invalidation marker
  community_id TEXT,                  -- back-ref to temporal_communities.id
  UNIQUE(tenant_id, entity_type, entity_key, valid_from)
);
```

**Semantic Memory (Flat KV Store):**

- `packages/database/src/schemas/ai-semantic-memory.schema.ts`
- Fallback for non-graph facts
- Key structure: `<domain>:<entity-id>:<fact-label>` → value + confidence score

**Retrieval:**

- `createSemanticMemoryService` — `upsertFact(tenantId, key, value, confidence)`
- Query embedding-based recall for unstructured context
- Consolidation worker calls `upsertFact()` for every promoted fact

**Example Flow:**

```
Junior arrears agent records action:
  → kernel.think() → 13-step pipeline
  → decision-trace: "paid arrears for unit-4B"
  → writes to kernel_cot_reservoir

Consolidation worker (next night):
  Stage 04: evaluates "unit-4B arrears paid"
  → confidence=0.95 (high)
  Stage 06: consolidates with prior "unit-4B owes 2M"
  → invalidates old fact, writes new validity window
  Stage 07: re-embeds new fact
  Stage 09 (Sunday): if improved prompts, updates global system prompt
```

---

## 8. Document Intake / OCR / Chat with Documents

**Document Intelligence Service:**

- `services/document-intelligence/src/` — Standalone service (Module G from spec)

**Submodules:**

- `OCRExtractionService` — AWS Textract / Google Vision integration
- `DocumentCollectionService` — Multi-channel upload validation
- `FraudDetectionService` — Document integrity checks, anomaly detection
- `ValidationConsistencyService` — Cross-document validation
- `EvidencePackBuilderService` — Legal evidence compilation

**Routes:**

- `services/api-gateway/src/routes/` — Document intelligence endpoints
- Consumed by compliance junior (document review) + estate manager chat
- Results surface in `chat-ui` (packaged in `packages/chat-ui`)

**Integration with Brain:**

- Documents uploaded → extracted text + metadata stored in database
- Retrieval during kernel 13-step: memory recall pulls document context
- Junior agents can invoke `validateDocument()`, `generateEvidencePack()` tools

---

## 9. Multi-Tenant Boundaries

**Isolation Pattern:**

Every request carries `req.scope.tenantId` (type: `'tenant'`):

```typescript
interface TenantScope {
  readonly kind: 'tenant';
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly surface: string;
}
```

**Enforcement Points:**

1. **Kernel** (`kernel.ts:40`) — Extracts tenantId from scope, passes to memory queries
2. **Junior Factory** — All repository queries parameterized: `repository.findById(tenantId, id)`
3. **Database Schemas** — Every major table has `tenant_id` FK + indexes for scoped queries
4. **Authorization** — `authMiddleware` → `req.scope` set from JWT sub + tenant claim
5. **Consolidation Worker** — Processes only reservoir entries matching the deployed tenant

**Policy Isolation:**

- `AutonomyPolicy` loaded per-tenant: `await autonomyPolicyLoader(tenantId)`
- Junior's `policySubset` must be ⊆ tenant policy (validated at provision)
- Task agents' guardrails checked against tenant's autonomy domain

---

## 10. Specs & Documentation

**Location:** `Docs/` folder

**Key Specs:**

- `Docs/BOSSNYUMBA_SPEC.md` — Full feature spec
- `Docs/ARCHITECTURE.md` — System-level overview
- `Docs/ARCHITECTURE_BRAIN.md` — Brain kernel + persona taxonomy
- `Docs/DOMAIN_MODEL.md` — Entity definitions
- `Docs/API_SPEC.yaml` — OpenAPI definition

**Phase Findings:**

- `Docs/PHASES_FINDINGS/` — Phase A/B post-mortems
- `Docs/WAVE*/FINDINGS/` — Lightweight findings from 27+ waves

---

## 11. Weekly Prompt Compiler (Commit 18c3f908)

**Location:** `services/consolidation-worker/src/prompt-compile/`

**Files:**

- `weekly-compiler.ts` — Orchestrator (default 5 iterations, not 100)
- `claude-mutator.ts` — Opus 4.7 system prompt acts as prompt engineer
- `haiku-evaluator.ts` — Haiku 4.5 scorer (scores 0.5±0.1 to prevent heuristic overfitting)

**GEPA Loop:**

```
for iteration in 1..5:
  candidate = mutator.mutate(basePrompt, iteration)
  score = evaluator.evaluate(candidate, goldenSet)
  if score >= baselineScore:
    basePrompt = candidate  # Pareto improvement

promote(newPrompt) if:
  goldenSet score ≥ baseline (no regression)
  AND newTraces score > baseline (strictly better)
```

**Trigger:** Stage 09, Sundays only (UTC). Orchestrator's `weekday()` guard short-circuits on non-Sunday ticks.

**Cost Justification:**
- 5 iterations × 5 capabilities = 25 Opus calls/week (cheap, Pareto gate)
- Heuristic: 1 Opus call ≈ 25–50 Haiku scorers (inside GEPA loop)
- Weekly cadence matches DSPy GEPA tuning; nightly produces noisy mutations

**Retention Purge Worker:**

- `services/consolidation-worker/src/consolidation.ts` — Mentions session-replay retention
- Default: 90-day retention, 1-hour purge interval
- Deletes rows where `received_at < NOW() - 90 days`
- Supervisors logged on missing DATABASE_URL; no-op graceful degradation

---

## 12. Counter-Model Hoist (Commit 18c3f908, Phase C-1)

**Production wiring added:**

- Optional counter-model port on kernel (formerly stub, now production-ready)
- When wired, kernel can invoke secondary Haiku to challenge primary Opus
- Hoisted to composition root so debate runs on every turn (not just special cases)
- Four-eye approval + counter-model fires automatically thanks to this hoist

**Use Case:** Sensitive actions (large financial, legal interpretation) — Opus proposes, Haiku challenges, gate decides.

---

## Summary Table

| Aspect | Location | Key Files |
|--------|----------|-----------|
| **Master Orchestrator** | `packages/central-intelligence/src/kernel/` | `kernel.ts`, `compose.ts`, `agent-loop.ts` |
| **Junior Factory** | `packages/ai-copilot/src/junior-ai-factory/` | `types.ts`, `service.ts` |
| **Task Agents** | `packages/ai-copilot/src/task-agents/` | `types.ts`, `executor.ts`, `agents/` |
| **HTTP Routes** | `services/api-gateway/src/routes/` | `junior-ai.router.ts`, `hr.hono.ts` |
| **Consolidation** | `services/consolidation-worker/src/` | `consolidation.ts`, `orchestrator.ts`, `stages/` |
| **Prompt Compiler** | `services/consolidation-worker/src/prompt-compile/` | `weekly-compiler.ts`, `claude-mutator.ts`, `haiku-evaluator.ts` |
| **Knowledge Graph** | `packages/database/src/schemas/` | `temporal-entity-graph.schema.ts`, `ai-semantic-memory.schema.ts` |
| **Document Intake** | `services/document-intelligence/src/` | `services/` (OCR, fraud, evidence) |
| **Composition Root** | `services/api-gateway/src/composition/` | `brain-kernel-wiring.ts`, `consolidation-runner.ts` |
| **Docs & Specs** | `Docs/` | `ARCHITECTURE_BRAIN.md`, `BOSSNYUMBA_SPEC.md` |

---

This architecture is production-ready for cloning into Boji AI. The key pattern: **Master kernel + provisioned subordinates + nightly synthesis + weekly self-improvement**, all gated by declarative autonomy policies and multi-tenant boundary enforcement.
