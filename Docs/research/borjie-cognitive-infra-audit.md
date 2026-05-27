# Borjie cognitive infrastructure — code audit

**Date:** 2026-05-27
**Audit type:** Code-only (no online research). Source: this repo.
**Scope:** every package matching the patterns `central-intelligence`,
`cognitive-*`, `brain-*`, `ai-copilot`, `persona-runtime`, `graph-privacy`,
`persistent-memory`, `memory-*`, `blackboard-*`, `agent-orchestrator`,
`agent-runtime`. Database schemas + api-gateway call sites included.

---

## 1. Executive summary

Borjie has a **massive but lopsided** cognitive stack. The brain that
actually answers `/api/v1/brain/turn` today is `@borjie/ai-copilot`'s
`BrainRegistry` + per-tenant `createBrain()` (610 LOC orchestrator, 293
LOC factory), backed by `BrainThreadRepository` in Postgres. It calls
Anthropic directly via the `AnthropicProvider`, with prompt-prefix
caching wired (`anthropic-prefix-cache.ts`), the per-tenant AI cost
ledger checked at request time, and a Drizzle-backed
`kernel_memory_semantic` table mirroring every appended turn for
durable semantic recall.

Underneath, three layers exist on disk that are **not in the live
request path**:

- `@borjie/central-intelligence` (70,714 LOC, 235 test files) — the
  big "13-step kernel" with sensors, debate, LATS, reflexion, world-
  model, sub-MDs, etc. It is **partially wired**: the consolidation
  worker uses it (`runConsolidationCycle`), and `sovereign.ts`
  composes a `BrainKernel` with the 4 kernel-memory services
  (episodic/semantic/procedural/reflective). The hot turn path through
  `brain.hono.ts` does NOT touch this kernel — only via
  `ai-copilot`'s thinner orchestrator.
- `@borjie/cognitive-engine` + `@borjie/cognitive-memory` +
  `@borjie/cognitive-composition` (Wave 18T/18AA/NEURO-WIRING) —
  spec-complete, exported, but **zero call sites in `services/`**.
  Only consumed internally by `cognitive-composition.types.ts` and a
  few downstream packages (`work-cycle`, `tacit-knowledge`,
  `loop-quality-gates`, `swarm-coordination`) that are themselves
  unwired. They are "library-in-waiting".
- `@borjie/persistent-memory` (1,409 LOC, 8 tests) — session
  memory + skills + pending-threads + thread-summaries. Has its
  schema (`persistent-memory.schema.ts`), exports in-memory reference
  repos, but the gateway never imports it. It's wired internally by
  `memory-port-extensions` and `user-followup` (a downstream pkg).

`@borjie/persona-runtime` is the bright spot: 1,309 LOC, 5 test files,
and **the one cognitive package wired into all four app surfaces**
(admin-web, owner-web, workforce-mobile, buyer-mobile each import
`BUILT_IN_PERSONAS`, `setActivePersona`, `validateBindingTier
Compatibility`). It is pure TypeScript with zero node-builtin imports;
already mobile-safe today.

There is **no person-spanning memory namespace** anywhere. Every
memory store keys by `(tenant_id, user_id [or persona_id, project_id,
module_id])`. The closest existing primitive is
`CrossPersonaMemoryService` in `ai-copilot/intelligence-orchestrator/`
which is session-scoped (`tenant + sessionId` keyed), not user-spanning.

---

## 2. Per-package audit table

LOC = production .ts (excluding `__tests__`). Tests = `*.test.ts`
file count under `src/`. Wired call sites = files in
`services/api-gateway/src` + `services/consolidation-worker/src`
that import `@borjie/<pkg>`.

| Package | LOC | Tests | Gateway calls | Worker calls | App calls | Storage | Status |
|---|---|---|---|---|---|---|---|
| `central-intelligence` | 70,714 | 235 | 28 | 7 | 4 (AG-UI types only) | Postgres via `database` services | **partially-live** — consolidation + sovereign-kernel wiring; not in `brain.hono.ts` turn path |
| `cognitive-engine` | 2,932 | 9 | 0 | 0 | 0 | none (ports only) | **shelf-ware** — exported, not called outside cognitive-composition + 4 downstream pkgs |
| `cognitive-memory` | 1,841 | 5 | 0 | 0 | 0 | `cognitive_memory_cells`, `cognitive_memory_reinforcements`, `platform_memory_cells` (migration 0029) | **shelf-ware** — tables exist; ports designed; in-memory ref impls present; no composition |
| `cognitive-composition` | 1,107 | 2 | 0 | 0 | 1 (admin-web type-import) | `cognitive_wiring_health` (migration 0076) | **shelf-ware** — composer + 12-wire probe written; no concrete deps bound |
| `brain-llm-router` | 6,534 | 23 | 3 | 2 | 3 | n/a (in-memory ledgers + dynamic-registry only) | **live in consolidation + multi-llm-router**; not yet on brain.hono.ts hot path (still uses `AnthropicProvider`) |
| `ai-copilot` | 110,095 | 156 | **61** | 1 | 1 | Postgres via `BrainThreadRepository` + `kernel_memory_semantic` | **PRIMARY brain runtime** — `BrainRegistry` + `createBrain()` |
| `persona-runtime` | 1,309 | 5 | 2 | 0 | **14** | none (callers wire seed port) | **live across all 4 apps** + worker bridges |
| `graph-privacy` | 745 | 3 | 1 | 0 | 3 | `platform_privacy_budget` (migration 0116) | **wired for DP cohort aggregation** in `kernel-cohort.service.ts` |
| `persistent-memory` | 1,409 | 8 | 0 | 0 | 0 | `persistent_memory.schema.ts` (sessions, skills, pending_threads, thread_summaries) | **schema-only** — tables exist; in-memory ref repos exist; no concrete adapter wired |
| `blackboard-intel` | 2,654 | 12 | 0 | 0 | 0 | `blackboard_intel.*` (migration 0074) | **shelf-ware** |
| `blackboard-sota` | 3,586 | 8 | 0 | 0 | 0 | `blackboard_sota.*` (migration 0073) | **shelf-ware** |
| `agent-orchestrator` | 3,457 | 17 | 2 | 0 | 0 | none (ports + in-mem) | **light-wired** in 2 gateway files |
| `agent-runtime` | 2,497 | 9 | 2 | 0 | 0 | reads `.claude/*` files | **light-wired** — Claude-Code-compat runtime; gateway picks it up at boot |
| `memory-v2` | 999 | 7 | 1 | 0 | 0 | none (in-memory only) | **shelf-ware-plus** — 1 gateway file references it |
| `memory-port-extensions` | 699 | 5 | 0 | 0 | 0 | none | **shelf-ware** |
| `memory-tool-wire-adapter` | 269 | 1 | 1 | 0 | 0 | none | **light-wired** — 1 gateway adapter |

Totals: ~210 KLoC of cognitive code; **~52 KLoC unused in `services/`** today.

### Storage layer summary

- `cognitive_memory_cells` — pgvector(1536), tenant-scoped, RLS
  (migration 0029). Spec for the "27+ specialisations are ONE mind"
  thesis. **Not written to by any live writer.**
- `kernel_memory_episodic|semantic|procedural|reflective` — Wave
  18AA/LITFIN-port, tenant+user scoped (`tenant_id` + `user_id`).
  semantic has pgvector(1536) + `<=>` cosine retrieval (migration
  0125). **Live** — written by `conversation-memory-drizzle-adapter`
  on every appended turn AND by the consolidation worker's
  reflective cycle.
- `intelligence_corpus_chunks` — pgvector(1024), Cohere embed-v3
  multilingual. `tenant_id IS NULL` ⇒ global Borjie corpus; else
  private. RLS on tenant or NULL. **Live** — populated by the
  borjie-corpus-ingest task.
- `persistent_memory.*` — designed; in-memory repos only.
- `cognitive_wiring_health` — designed; no writes.
- `blackboard_sota.*` + `blackboard_intel.*` — tables exist; no
  writers.

---

## 3. Cognitive data flow — `POST /api/v1/brain/turn`

Real path today, drawn from `services/api-gateway/src/routes/brain.hono.ts`
(line-numbered references below).

```
                ┌──────────────────────────────────┐
HTTP POST   ──► │ brain.hono.ts                    │
/api/v1/brain   │  1. extractBearer                │
/turn           │  2. verifySupabaseJwt   ◄─ REAL  │
                │  3. principalToBrainContexts     │
                │  4. rate-limit check    ◄─ REAL  │
                │  5. assertWithinBudget  ◄─ REAL  │
                │     (aiCostLedger)               │
                │  6. bindTenantGuc       ◄─ REAL  │
                │     (RLS GUC set_config)         │
                └──────────────────────────────────┘
                                │
                                ▼
                ┌──────────────────────────────────┐
                │ BrainRegistry.for(tenantId)      │
                │  → cached per tenant             │
                └──────────────────────────────────┘
                                │
                                ▼
                ┌──────────────────────────────────┐
                │ Brain (ai-copilot/brain.ts)      │
                │  ┌────────────────────────────┐  │
                │  │ Orchestrator               │  │
                │  │  - PersonaRegistry         │◄─ REAL: DEFAULT_PERSONAE
                │  │  - ThreadStore             │◄─ REAL: PostgresThreadStoreBackend
                │  │  - ToolDispatcher          │◄─ REAL: registerDefaultSkills + extraSkills (persona-aware)
                │  │  - AdvisorExecutor         │  │
                │  │  - AnthropicProvider       │◄─ REAL: with prompt prefix cache
                │  │     (anthropic-prefix-cache)│
                │  │  - ReviewService           │  │
                │  │  - AIGovernanceService     │  │
                │  └────────────────────────────┘  │
                │   .startThread() | .handleTurn() │
                └──────────────────────────────────┘
                                │
                                ▼
                ┌──────────────────────────────────┐
                │ Anthropic /v1/messages           │
                │  (model: from BORJIE_MODEL_...)  │
                └──────────────────────────────────┘
                                │
                                ▼
                ┌──────────────────────────────────┐
                │ Response composition             │
                │  - finalPersonaId                │
                │  - responseText                  │
                │  - handoffs[]                    │
                │  - toolCalls[]                   │
                │  - advisorConsulted              │
                │  - proposedAction                │
                │  - tokensUsed                    │
                └──────────────────────────────────┘
                                │
                                ▼
                ┌──────────────────────────────────┐
                │ conversation-memory-drizzle      │
                │ -adapter mirrors the turn into   │
                │ kernel_memory_semantic           │◄─ REAL: durable semantic recall
                │ (best-effort, fire-and-forget)   │
                └──────────────────────────────────┘
                                │
                                ▼
                ┌──────────────────────────────────┐
                │ JSON response back to client     │
                └──────────────────────────────────┘
```

### What's stubbed / dormant in this flow

- **Cognitive-engine 6 disciplines** (deliberate reason, grounding,
  calibration, scoping, relevance, ingest): not in the path. The
  `wrapWithCognitiveEngine` helper in `cognitive-engine/runtime/
  kernel-integration.ts` exists — never called from `brain.hono.ts`.
- **Cognitive-memory's 5 ops** (observe/reinforce/recall/cite/
  contradict): not in the path. `cognitive_memory_cells` is empty.
- **Persistent-memory's 4 substrates**: not in the path. Session-
  memory + skills + pending-threads + thread-summaries are never
  loaded or written.
- **The "13-step" central-intelligence kernel** (`createBrainKernel`):
  composed in `sovereign.ts` for a separate "sovereign" surface (voice
  agent path) — `brain.hono.ts` /turn does NOT route through it.
- **Brain-LLM-router `brainCall`**: wired into the multi-LLM router
  (`service-registry.ts:1945`) and consolidation worker, but
  `brain.hono.ts` /turn still uses `AnthropicProvider` directly.
- **Blackboard-SOTA + Blackboard-Intel**: zero writes.
- **Memory-v2 7 stores**: zero composition.

### What IS real

- Auth → Brain registry → Persona resolver (DEFAULT_PERSONAE in
  ai-copilot, NOT persona-runtime's BUILT_IN_PERSONAS) →
  Postgres thread store → Anthropic with prompt prefix cache →
  semantic mirror.

---

## 4. Memory layer deep-dive

### 4.1 What each memory schema stores

`packages/database/src/schemas/`:

- **`kernel-memory-episodic.schema.ts`** (60 LOC) — concrete events:
  one row per user-message and per agent-action. Fields: `id`,
  `tenantId`, `userId`, `threadId`, `turnId`, `kind` (enum: user-
  message | agent-action | tool-result), `summary`, `payload`, TTLed
  via `expiresAt`. Default retention: 90 days. **Live writer:**
  the kernel writes here at step 13. **Live reader:** the reflective
  consolidation cycle.
- **`kernel-memory-semantic.schema.ts`** (133 LOC) — extracted facts:
  `(tenantId, userId, key)` unique. `embedding vector(1536)` for cosine
  recall. `confidence`, `evidenceCount`, `expiresAt`,
  `lastEmbeddedAt`. `userId NULL` ⇒ tenant-scoped facts. **Live writer:**
  `conversation-memory-drizzle-adapter` mirrors every appended turn.
  **Live reader:** kernel step 4.
- **`kernel-memory-procedural.schema.ts`** (55 LOC) — learned
  patterns: "when the user asks X, prefer tool Y". TTLed.
- **`kernel-memory-reflective.schema.ts`** (58 LOC) — daily / weekly
  digests written by the consolidation cycle. Read by the kernel for
  long-horizon context.
- **`cognitive-memory.schema.ts`** (187 LOC) — 3 tables:
  `cognitive_memory_cells`, `cognitive_memory_reinforcements`,
  `platform_memory_cells` (cross-tenant, no RLS, PII-stripped). Spec'd
  for unified semantic memory; **not yet written**.
- **`persistent-memory.schema.ts`** (207 LOC) — 4 tables for the
  Wave-18GG temporal-continuity stack. **No writers**.
- **`ai-semantic-memory.schema.ts`** (55 LOC) — older ai-copilot
  memory store. Limited use.
- **`memory.schema.ts`** (184 LOC) — yet another memory schema.
  Cross-referenced from ai-copilot.
- **`core-memory-blocks.schema.ts`** (45 LOC) — letta-style core blocks
  for the kernel.

### 4.2 Keying — namespace strategy

Every memory store today keys by:

| Schema | Required keys | Optional keys |
|---|---|---|
| `kernel_memory_episodic` | `tenant_id`, `user_id`, `thread_id`, `turn_id` | TTL |
| `kernel_memory_semantic` | `tenant_id`, `user_id`, `key` (unique) | embedding |
| `kernel_memory_procedural` | `tenant_id`, `user_id` | |
| `kernel_memory_reflective` | `tenant_id`, `user_id` | period |
| `cognitive_memory_cells` | `tenant_id`, `scope_id`, `kind` | embedding |
| `persistent_memory_*` | `tenant_id`, `actor_id` | |
| `intelligence_corpus_chunks` | `tenant_id` (NULL ⇒ global) | language, metadata |

**Persona-runtime memoryNamespaceTemplate** templates (`seeds.ts`):

```
T1_owner_strategist    → tenant:{tenant_id}:persona:{persona_slug}:project:{project_id}
T2_admin_strategist    → tenant:{tenant_id}:persona:{persona_slug}:project:{project_id}
T3_module_manager      → tenant:{tenant_id}:persona:{persona_slug}:module:{module_id}:project:{project_id}
T4_field_employee      → tenant:{tenant_id}:persona:{persona_slug}:module:{module_id}:user:{user_id}
T5_customer_concierge  → tenant:{tenant_id}:persona:{persona_slug}:user:{user_id}
T_auditor              → tenant:{tenant_id}:persona:{persona_slug}:project:{project_id}
T_vendor               → tenant:{tenant_id}:persona:{persona_slug}:user:{user_id}
```

These are STRINGS rendered from `renderMemoryNamespaceKey()` and used
as cache keys. NO database table currently scopes memory by these
keys — they are advisory.

### 4.3 Person-spanning memory — does any exist?

**No.** Three near-misses:

1. **`CrossPersonaMemoryService`** at
   `packages/ai-copilot/src/intelligence-orchestrator/cross-application
   -memory.ts`. Keys by `(tenantId, sessionId)`. Lets `Manager`
   persona hand off scratchpad to `Owner-Advisor` *within the same
   session*. NOT durable across sessions, NOT cross-tenant, NOT keyed
   to a stable person identifier.
2. **`platform_memory_cells`** in `cognitive-memory.schema.ts` — cross-
   tenant federation of patterns (PII-stripped). Designed but
   unwritten. Not person-scoped — pattern-scoped.
3. **`MemoryNamespaceSchema`** in persona-runtime has a `personaId`
   field but no `personId`. Person ≠ persona here — the codebase
   uses "persona" to mean the role/title.

Conclusion: a "Mr. Mwikila switches from Owner cockpit (tenant A) to
buyer marketplace (tenant B) and keeps his knowledge" use case has no
existing storage. Adding it requires either a NEW table or a
universal-id column.

### 4.4 Where intelligence_corpus_chunks lives

`packages/database/src/schemas/intelligence-corpus.schema.ts`. `vector
(1024)` Cohere embed-v3. RLS: SELECT allowed when `tenant_id =
current_tenant_id()` **OR** `tenant_id IS NULL` (global Borjie
corpus). Migration 0029 (cognitive memory) and a corpus-specific
migration set the unique index `(source_file, section)` so the
consolidation worker can do upsert.

---

## 5. Brain-LLM-router audit

### 5.1 Providers wired

`packages/brain-llm-router/src/universal-client/index.ts` exports 5
adapters: **AnthropicAdapter**, **OpenAIAdapter**, **GoogleAdapter**,
**OllamaAdapter**, **VLLMAdapter**. All implement `BrainLLMClient`.

### 5.2 Cascade logic

`packages/brain-llm-router/src/cost-cascade/cascade-runner.ts`:
`runCascade(steps, options)` walks the `CascadeStep[]` in order. Each
step runs a model, evaluates the response with `evalFn`, and either
returns or escalates to the next step. The README documents the
intended ladder: **Haiku → Sonnet → Opus** gated by
`evalFn(response) >= threshold`. The orchestrator (`brainCall`) does
NOT itself bind the ladder — that's the caller's job. The current
on-disk default `task-ladder/` has per-task preferences but no
project-wide single-LLM default beyond the env-driven baselines.

Default baselines (`dynamic-registry/baselines.ts`):

| Family | Default |
|---|---|
| opus | `claude-opus-4-7` |
| sonnet | `claude-sonnet-4-6` |
| haiku | `claude-haiku-4-5-20251001` |
| gpt-5 | `gpt-5.4` |
| gpt-5-mini | `gpt-5.4-mini` |
| gemini-pro | `gemini-2.5-pro` |
| gemini-flash | `gemini-2.5-flash` |
| cohere-embed | `embed-v4.0` |
| cohere-rerank | `rerank-3.5` |

Operator override via `BORJIE_MODEL_BASELINE_<FAMILY>` env var.

The `brain.hono.ts` /turn path does NOT use the cascade. It uses
`ai-copilot`'s `AnthropicProvider` directly with a configured default
model (`ANTHROPIC_MODEL_DEFAULT`).

### 5.3 Prompt caching

Prompt caching is in `ai-copilot`, not `brain-llm-router`:

- `packages/ai-copilot/src/providers/anthropic-prefix-cache.ts` — wraps
  Anthropic requests with `cache_control: { type: 'ephemeral' }`
  markers. Policy:
  1. System prompt — always marked
  2. Tools array — marked when stable
  3. Long historical messages — marked when > threshold AND
     advertised stable by caller
- Pure-function rewrite (immutable), 4 cache blocks max per request.
- Wired into the `AnthropicProvider` in `providers/anthropic.ts` (per
  test file `anthropic-prefix-cache.test.ts`).

### 5.4 Budget guard

`packages/brain-llm-router/src/cost-cap/index.ts` exports
`preflightCostCheck`, `postflightCharge`, `InMemorySpendLedger`. The
gateway uses a Drizzle-backed cost ledger (`createCostLedger` in
`services/api-gateway/src/composition/service-registry.ts`) and
exposes `aiCostLedger.assertWithinBudget(tenantId)` to every code
path. `brain.hono.ts` calls it at line 287 BEFORE the brain
orchestrator fires. On `AiBudgetExceededError`, it returns 429 with
`code: 'BUDGET_EXCEEDED'`. This is the universal budget gate; the
multi-LLM router and voice router use the same `aiCostLedger`.

### 5.5 Caller summary

- `brain.hono.ts` /turn — uses `ai-copilot`'s `AnthropicProvider`
  (NOT `brain-llm-router`). Has caching + budget.
- multi-LLM router (`service-registry.ts:1945`) — uses
  `brain-llm-router`'s cascade.
- consolidation worker — uses `brain-llm-router`'s `getModelLatest`
  + brain-llm-router for Haiku-evaluator + Claude-mutator stages.
- voice agent — uses `central-intelligence`'s sovereign-kernel
  pipeline (separate path).

---

## 6. Mobile-readiness audit

Mobile = React Native bundle (Hermes / JSC). The constraints:

- NO node-only builtins (`fs`, `child_process`, raw `net`/`http`,
  `worker_threads`).
- `node:crypto` is polyfillable via `expo-crypto` / `react-native-
  quick-crypto`. `randomUUID()` is polyfilled.
- NO Postgres / Drizzle imports (`drizzle-orm/postgres-js`,
  `pg-core`, `postgres`).
- Pure-TS, port-based packages are fine.

### 6.1 Per-package mobile assessment

| Package | Node builtins | DB imports | Mobile-ready? | Refactor cost |
|---|---|---|---|---|
| `persona-runtime` | none | none | **Yes — today** | 0 |
| `cognitive-memory` (types + ops only) | none | none (ports only) | **Yes — today** | 0; in-mem repos work in RN |
| `cognitive-engine` (types + 6 disciplines) | none | none | **Yes — today** | 0; same shape |
| `cognitive-composition` | none | none | **Yes** | 0 |
| `persistent-memory` | none | none | **Yes** | 0 |
| `memory-v2` | none | none | **Yes** | 0 |
| `memory-port-extensions` | none | none | **Yes** | 0 |
| `memory-tool-wire-adapter` | none | none | **Yes** | 0 |
| `blackboard-sota` | `node:crypto` (audit hash) | none | **Polyfill needed** | trivial — swap `node:crypto` for `@borjie/audit-hash-chain` shared shim |
| `blackboard-intel` | none | none | **Yes** | 0 |
| `graph-privacy` | `node:crypto` (noise source) | none | **Polyfill needed** | trivial — `createCryptoNoiseSource` exposes a port; pass an RN-compatible noise source from the caller |
| `brain-llm-router` | `fetch` (already universal) | none | **Yes for client adapters** | 0 for adapter use; cost ledger needs RN storage adapter |
| `agent-orchestrator` | none | none | **Yes** | 0 for in-memory; durable-store needs adapter |
| `agent-runtime` | `fs`, reads `.claude/*` | none | **No** | high — entire `.claude/*` discovery layer is node-fs; mobile would need a CDN-fetch variant |
| `central-intelligence` (full) | `isolated-vm` optional, `node:crypto` | none | **Partial** | medium — kernel is pure; sandbox + some kernel sub-modules use node features. Tree-shake to a `kernel-core` sub-export. |
| `ai-copilot` | Anthropic SDK | none (uses ports for thread store) | **Yes for client** | medium — 532 files; the `Brain` factory itself is pure; the provider adapters use fetch; would split into `client` + `server` entry points |

### 6.2 Concrete refactor recipes

1. **Easiest mobile win:** persona-runtime, cognitive-memory (in-mem),
   cognitive-engine, persistent-memory (in-mem), memory-v2 (in-mem)
   are all already bundle-safe. The 4 mobile apps could load
   `BUILT_IN_PERSONAS` + a tiny `MemoryV2` instance and have a local
   scratchpad TODAY with zero changes.
2. **Tier-1 cleanup (1 day each):** swap `node:crypto` imports in
   `blackboard-sota`, `graph-privacy` for a port handed in by the
   caller. Adds an `EmbedderPort`-style `HasherPort`.
3. **Tier-2 (1 week each):** split `central-intelligence` into
   `central-intelligence-core` (kernel pipeline, types, policy-gate,
   metacognition) and `central-intelligence-node` (sandbox, durable
   functions, isolated-vm). Mobile bundles core only.
4. **Tier-3 (1 month):** make `ai-copilot/brain` accept a non-Drizzle
   `ThreadStoreBackend`. Today the `PostgresThreadStoreBackend` is
   the only persisted one; the in-memory variant exists for tests.
   Add a mobile-side `AsyncStorageThreadStoreBackend` + `httpThread
   SyncBackend` and mobile becomes a real client.

---

## 7. Graph-privacy package

**Public surface** (`packages/graph-privacy/src/index.ts`):

- `createDpAggregator({ noiseSource, budgetLedger })` — the main
  factory. Applies differentially-private noise to cross-tenant graph
  aggregates.
- `createCryptoNoiseSource()` — production Laplace/Gaussian noise
  using `node:crypto`.
- `UNSAFE_createSeededNoiseSource(seed)` — deterministic for tests.
- `createInMemoryBudgetLedger(opts)` — tracks ε-budget per cohort.

**Storage:** `platform_privacy_budget` schema (migration 0116). Live
in `packages/database/src/services/platform-budget-ledger.service.ts`.

**Consumers** (in `services/` and `apps/`):

- `services/api-gateway/src/composition/...` — DP cohort signal in
  the sovereign kernel pipeline.
- `packages/database/src/services/kernel-cohort.service.ts` —
  produces the cohort signal the kernel reads at step 5.

**Documentation:** README absent in package, but the codemap exists
at `Docs/CODEMAPS/graph-privacy.md` (already in `git status`).

**Status:** Live, ~745 LOC, 3 tests. Working in production.

---

## 8. Unification migration path

Goal: a single coherent intelligence surface where (a) the kernel
pipeline routes every turn, (b) memory layers actually fire, (c)
mobile apps can call the brain with the same primitives the web does,
and (d) a person identity spans the surfaces they hold roles in.

### Phase A — Memory schema dedupe + read-path consolidation

**Touch:**
- `packages/database/src/schemas/cognitive-memory.schema.ts`
- `packages/database/src/schemas/kernel-memory-*.schema.ts`
- `packages/database/src/schemas/ai-semantic-memory.schema.ts`
- `packages/database/src/schemas/memory.schema.ts`
- `packages/database/src/schemas/persistent-memory.schema.ts`

**Actions:**
1. Write `Docs/CODEMAPS/memory.md` mapping every memory table to its
   writer/reader, intended purpose, current row count, and live
   status. Surfaces the duplication.
2. Mark deprecated schemas in-file: `@deprecated use kernel_memory_*`
   on `ai_semantic_memory` and `memory.*` if redundant.
3. Pick ONE canonical durable layer:
   - **Episodic** = `kernel_memory_episodic` (live)
   - **Semantic** = `kernel_memory_semantic` (live)
   - **Procedural** = `kernel_memory_procedural`
   - **Reflective** = `kernel_memory_reflective`
   - **Session** = `persistent_memory_session` (wire it up)
   - **Cross-tenant patterns** = `platform_memory_cells` (wire the
     promoter)

**Tests required:** schema-level — one zod fixture per surface table
proving the writer + reader round-trip. **RLS implications:**
existing tables already FORCE-enable RLS. New deprecation comments
only.

### Phase B — `person_links` table + identity resolver

**Touch:**
- `packages/database/src/schemas/identity-link.schema.ts` (NEW)
- `packages/database/src/services/identity-link.service.ts` (NEW)
- `packages/database/drizzle/<next>_person_links.sql` (NEW)
- `services/api-gateway/src/middleware/identity-link.middleware.ts` (NEW)

**Actions:**

1. Add a `person_links` table:

   ```sql
   CREATE TABLE person_links (
     person_id text PRIMARY KEY,           -- stable across tenants
     primary_user_id text NOT NULL,        -- user this person 'is'
     created_at timestamptz DEFAULT now()
   );
   CREATE TABLE person_link_members (
     person_id text REFERENCES person_links(person_id),
     tenant_id text NOT NULL,
     user_id text NOT NULL,
     persona_slug text,                    -- role they hold in this tenant
     PRIMARY KEY (tenant_id, user_id)
   );
   ```

   `tenant_id` + `user_id` is the lookup; `person_id` is the universal
   handle. NO RLS on `person_links` (cross-tenant by definition); RLS
   on `person_link_members` only allows the tenant's own row.
2. Identity resolver service: `resolvePersonId(tenantId, userId)
   → person_id`. Caching key.
3. Backfill: most tenants will have 1 user per person; resolver
   defaults to creating a new `person_id` on first lookup if no
   member row exists. Email match upgrade later.

**Tests required:** unit on resolver, integration on RLS isolation
(member rows scoped by tenant).

### Phase C — Extend persona-runtime memoryNamespaceTemplate

**Touch:**
- `packages/persona-runtime/src/seeds.ts`
- `packages/persona-runtime/src/types.ts`
- `packages/persona-runtime/src/__tests__/seeds.test.ts`

**Actions:**

1. Add an optional `person:{person_id}` layer to every template:

   ```
   T1_owner_strategist → tenant:{tenant_id}:persona:{persona_slug}:person:{person_id}:project:{project_id}
   T4_field_employee   → tenant:{tenant_id}:persona:{persona_slug}:person:{person_id}:user:{user_id}
   ```

2. Extend `MemoryNamespaceSchema`: add optional `personId: z.string().optional()`.
3. `renderMemoryNamespaceKey` accepts a new `person_id` arg; backwards-
   compatible (omits when undefined).

**Tests required:** snapshot test of each rendered key with and
without `person_id`. **RLS implications:** none — namespace is an
in-memory cache key, not a column.

### Phase D — Brain orchestrator queries both layers

**Touch:**
- `services/api-gateway/src/routes/brain.hono.ts` (lines ~127–138 in
  `authenticate`)
- `services/api-gateway/src/composition/conversation-memory-drizzle
  -adapter.ts`
- `packages/ai-copilot/src/orchestrator/orchestrator.ts`

**Actions:**

1. `authenticate(c)` resolves `personId = identityLink.resolve(tenantId,
   userId)` and adds it to the BrainContext.
2. The semantic-recall path in `conversation-memory-drizzle-adapter`
   does TWO queries:
   - `WHERE tenant_id = $tenant AND user_id = $user` (existing, tier 1)
   - `WHERE tenant_id IN (SELECT tenant_id FROM person_link_members
     WHERE person_id = $person)` (NEW, tier 2 — cross-tenant for the
     same person)
   Results union'd, dedup'd by `key`, sorted by `lastSeenAt`.
3. Confidence penalty (-0.1) on cross-tenant matches so the orchestrator
   weights tenant-local facts higher.

**Tests required:** integration — create 2 tenants with 1 person, prove
the recall is union'd. **RLS implications:** the cross-tenant join is
done in a single SQL statement via a service-role connection
(`identity-link.service.ts` is service-role-only). Application code
never sees rows from a tenant the person isn't in.

### Phase E — UI persona switcher gets "All my roles" view

**Touch:**
- `apps/admin-web/src/lib/persona.ts`
- `apps/owner-web/src/lib/persona.ts`
- `apps/workforce-mobile/src/roles/persona.ts`
- `apps/buyer-mobile/src/auth/persona.ts`
- `services/api-gateway/src/routes/identity.hono.ts` (NEW)

**Actions:**

1. New gateway route `GET /api/v1/identity/me/roles` returns the
   `person_link_members` rows for the calling user's person_id.
2. Each app's persona shim adds a `listAllMyRoles(): Promise<RoleRow[]>`.
3. Web sidebar / mobile drawer adds an "All my roles" section that
   deep-links into the right tenant + persona combo.

**Tests required:** Playwright across web; Detox on mobile; unit on
shim. **RLS:** none — the resolver runs service-role.

### Phase F — Live-wire the dormant memory layers

**Touch:**
- `services/api-gateway/src/composition/sovereign.ts` (memoryHierarchy
  block, lines ~321–328)
- `services/api-gateway/src/composition/persistent-memory-wiring.ts`
  (NEW)
- `services/api-gateway/src/composition/cognitive-memory-wiring.ts`
  (NEW)

**Actions:**

1. Persistent-memory: bind `createSessionMemoryUpsert`, `create
   SkillObserve`, `createPendingThreadInsert`, `createSummarise` to
   Drizzle-backed repositories. Wire into `Brain` as optional skills.
2. Cognitive-memory: bind `createObserve`, `createRecall`, `createCite`
   to `cognitive_memory_cells`. Run them parallel to the kernel-memory
   path; A/B against semantic recall for ranking quality.
3. Cognitive-composition: build the 12-wire health probe; expose a
   `/cognitive/health` route in admin-web.

**Tests required:** per-wire health probe must pass; A/B recall
comparison must show non-regression on existing test prompts.

### Phase G — Mobile bundle

**Touch:**
- `packages/persona-runtime` (no changes — works today)
- `packages/cognitive-memory/src/storage/*` (use as-is for in-mem)
- `packages/memory-v2` (use as-is)
- `apps/workforce-mobile/src/intel/` (NEW)
- `apps/buyer-mobile/src/intel/` (NEW)

**Actions:** ship a "mobile brain shim" that runs a local in-memory
`memoryV2` for offline turns; on reconnect, syncs to gateway via the
new `/api/v1/brain/sync` endpoint.

---

## 9. What to ship FIRST

**The smallest concrete change that unlocks the most intelligence today
is Phase B + Phase D's recall query, scoped to read-only.**

Steps (one PR):

1. Add `person_links` + `person_link_members` (migration only).
2. Add `identity-link.service.ts` (resolver, lookup-only).
3. In `conversation-memory-drizzle-adapter.semanticRecall`, do the
   union query with `-0.1` confidence penalty on cross-tenant rows.
4. Add a unit test: 2 tenants, 1 person, both have semantic facts —
   recall from tenant A returns BOTH with tenant A's facts ranked
   higher.

Estimated effort: 1–2 days. Effect: every turn through `brain.hono.ts`
*for users registered as the same person across tenants* immediately
benefits from cross-role context. Zero UI changes required. Backward-
compatible: people without a `person_link_members` row see no change.

The biggest open question: **how is the person identity asserted?**
Options in order of difficulty:

1. Manual admin-web UI: "link these 2 user_ids to the same person".
2. Email-match auto-link at signup (if the same email signs up to a
   2nd tenant, propose linking).
3. Phone number + Supabase identity.

Pick option 1 first — it gives ops the lever without auto-linking
risk.

---

## 10. Hard blockers

1. **`ai-copilot/brain.ts` is the live brain, not `central-intelligence`.**
   Any "unify everything" work has to either re-route `brain.hono.ts`
   through `central-intelligence`'s kernel OR keep both paths and
   share memory underneath. The latter is what Phase F implicitly
   does; the former is a much larger refactor.

2. **Persona ≠ person in current type system.** `persona-runtime`
   uses `personaId` to mean "role/slug". Adding a person concept
   requires a new field (`personId`) and a new table (`person_links`).
   You cannot reuse `personaId` for this without breaking 14 app
   call sites.

3. **`agent-runtime` reads `.claude/*` from disk.** This package
   cannot ever bundle into a mobile app. Mobile must reach the
   gateway for slash commands, hooks, MCP, etc. — or skip them.

4. **RLS on `cognitive_memory_cells` + `kernel_memory_semantic`** is
   FORCE-enabled. The cross-tenant person-spanning recall MUST run
   via a service-role connection that bypasses RLS — there is no
   per-row policy that lets a user see another tenant's row even via
   a `person_id` join. This means Phase D's union query needs an
   internal service that NEVER hands raw rows to a tenant-scoped HTTP
   handler. Add a "person-recall" projection service that returns
   ONLY a small fact summary (key + value + confidence), no row IDs,
   no embeddings, no `tenant_id`.

5. **The 12-wire health probe (`cognitive-composition`)** depends on
   ports that have no concrete adapters yet:
   `InferencePort`, `MemoryTierPort`, `CotPort`, `SubstratePort`,
   `KernelPort`, `CalibrationPort`, `ConformalPort`, `AuditChainPort`,
   `BrainRouterPort`, `WireHealthStore`. Wiring it requires
   constructing 10 adapters first. Doable but real work.

6. **Two memory schemas have NULL `user_id` semantics that overlap.**
   `kernel_memory_semantic.user_id NULL` = tenant-scope fact;
   `cognitive_memory_cells` has no `user_id` at all (uses `scope_id`
   which is `'tenant_root' | <org_unit_id>`). Phase A must reconcile
   these into a single shape before Phase F can wire a unified
   reader.

7. **Mobile shipping a "brain shim" requires** a sync endpoint
   (`/api/v1/brain/sync`) the gateway doesn't have. That's a new
   route. Without it, mobile turns lose offline observations.

8. **`brain-llm-router` is NOT in the `brain.hono.ts` /turn path.**
   `ai-copilot/AnthropicProvider` is. To get cascade + provider
   fallback + DSPy compile on the hot path, we must either (a) re-
   route `Brain` through `brainCall`, or (b) port the cache + cascade
   into `ai-copilot`. Option (a) is cleaner but touches 100+
   `AnthropicProvider` test sites.

---

## Appendix A — File paths referenced

Absolute paths for the caller's convenience.

- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/services/api-gateway/src/routes/brain.hono.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/services/api-gateway/src/composition/brain-kernel-wiring.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/services/api-gateway/src/composition/brain-extensions.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/services/api-gateway/src/composition/conversation-memory-drizzle-adapter.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/services/api-gateway/src/composition/consolidation-runner.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/services/api-gateway/src/composition/sovereign.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/ai-copilot/src/brain.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/ai-copilot/src/providers/anthropic-prefix-cache.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/ai-copilot/src/intelligence-orchestrator/cross-application-memory.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/central-intelligence/src/index.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/cognitive-engine/src/index.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/cognitive-memory/src/index.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/cognitive-composition/src/index.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/persistent-memory/src/index.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/persona-runtime/src/seeds.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/persona-runtime/src/types.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/brain-llm-router/src/index.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/brain-llm-router/src/dynamic-registry/baselines.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/graph-privacy/src/index.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/database/src/schemas/cognitive-memory.schema.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/database/src/schemas/kernel-memory-episodic.schema.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/database/src/schemas/kernel-memory-semantic.schema.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/database/src/schemas/intelligence-corpus.schema.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/database/src/schemas/persistent-memory.schema.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/apps/admin-web/src/lib/persona.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/apps/buyer-mobile/src/auth/persona.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/apps/workforce-mobile/src/roles/persona.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/apps/owner-web/src/lib/persona.ts`
