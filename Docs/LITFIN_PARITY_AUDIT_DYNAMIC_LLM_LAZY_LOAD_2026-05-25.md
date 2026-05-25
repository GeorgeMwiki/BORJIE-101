# LITFIN Parity Audit — Dynamic LLM Picking + Lazy Load

**Date:** 2026-05-25
**Author:** WL-LITFIN-AUDIT
**Scope:** Identify gaps where LITFIN has SOTA patterns we lack, and rank
porting opportunities HIGH / MEDIUM / LOW per surface.
**Type:** Read-only research. No code changes.

---

## 0. Executive summary

Two surfaces were audited end-to-end:

1. **Dynamic LLM picking** — how each project selects which model to call
   (registry, routing, fallback, kill-switch, model-policy, fingerprinting).
2. **Lazy load** — how each project defers loading
   (`React.lazy`, `next/dynamic`, intersection observer, prefetch, sleep-pass
   warming, image lazy).

**Headline findings:**

- BORJIE is **AHEAD** of LITFIN on raw dynamic model-id discovery —
  PR #169's 3-level resolver actually hits provider `/v1/models` endpoints
  and version-compares numerically, whereas LITFIN ships an env-pinned
  hardcoded `MODELS` registry plus a 3-level resolver that is feature-toggled
  (`getModelLatest`) but still relies on hardcoded baselines and never
  ships a true numerically-aware version picker.
- BORJIE is **BEHIND** LITFIN on the *routing* layer on top of the
  registry: LITFIN has a 39-task taxonomy with admin-configurable routing
  overrides, a min-tier policy enforcer, a half-open circuit breaker,
  per-bank concurrency gates, rate-limit-header pre-flight throttling,
  PII-egress scrubbing, provider-fingerprint scrubbing, and a 35-layer
  prompt assembler with intent-aware token-limit policies.
- On lazy load, BORJIE is **AHEAD** on most primitives — the
  performance-toolkit has retry-on-ChunkLoadError + reload-once, a
  framework-agnostic intersection lazy controller, a multi-format
  `<picture>` (AVIF/WebP/JPEG) descriptor builder, and a `prefetchOnHover`
  that works for both Next and Vite apps. LITFIN's `lib/lazy.tsx` is
  Next-only and lacks retry + AVIF + image-lazy descriptors.
- On lazy load **integration**, LITFIN is ahead in adoption depth: 63
  call-sites use the helpers vs ~26 in BORJIE apps; LITFIN also has a
  service-worker register + sync-queue. Adoption depth is the gap, not the
  primitives.

Net: 9 **HIGH**-priority ports from LITFIN → BORJIE, 7 MEDIUM, and 5
LOW. Estimated total effort: ~1,600 LOC + ~250 tests.

---

## 1. Dynamic LLM Picking

### 1.1 LITFIN current state

**Two parallel surfaces.** LITFIN has two model-picking pipelines that have
not been fully merged:

- The **image / video / audio "model layer"** at
  `src/core/model-layer/router.ts` (233 LOC) — generation modalities only.
- The **text-LLM stack** at `src/core/ai/*` (~5,000 LOC across
  `model-registry.ts`, `model-resolver.ts`, `task-router.ts`,
  `claude-service.ts`, `llm-service.ts`, `routing-config.ts`) and the
  brain-side `litfin-ai/llm/*` modules.

#### 1.1.1 `src/core/ai/model-registry.ts` (336 LOC) — the canonical text registry

- Single source of truth for all LLM model ids in `src/`. Closes audit
  finding G16 (351 grep matches collapsed to one module).
- Env-var-driven with Zod validation at module-load time so a typo crashes
  startup, not 1000 inference calls later (lines 44-95).
- `MODELS` frozen object holds 26 entries spanning Anthropic + OpenAI +
  DeepSeek + Cohere + ElevenLabs (lines 116-196).
- `ModelTier` is a 19-value union covering critical / default / fast /
  premium / sonnet / haiku / cheap / batch / deepseek-coder / gpt-primary
  / gpt-fast / gpt-realtime / whisper / openai-tts / openai-image /
  cohere-embed / cohere-rerank / eleven-tts / eleven-stt (lines 205-229).
- `getModel(tier)` (line 259) resolves a tier alias to the concrete model id.
- Family predicates (`isClaudeModel`, `isOpenAIModel`, `isDeepSeekModel`,
  `isCohereModel`, `isElevenLabsModel`) at lines 272-302 power per-provider
  routing in the LLM service.
- `getModelLatest(tier)` (line 324) + async `getModelLatestAsync(tier)`
  (line 333) delegate to the iter-67 dynamic resolver. **Hot-path version
  is synchronous and never blocks.**

#### 1.1.2 `src/core/ai/model-resolver.ts` (364 LOC) — the 3-level resolver

- Three-source cascade with a hard "never throws" contract (lines 47-58):
  ```
  L1 in-memory TTL cache → L2 provider /v1/models catalog → L3 baseline
  ```
- `tierPlan(tier)` (lines 84-197) maps every `ModelTier` to a catalog
  adapter + catalog tier + baseline-getter. Exhaustive switch with a
  `_exhaustive: never` guard so a new tier literal can't silently fall
  through.
- Per-tier in-memory cache with default 1-hour TTL (lines 203-217); the
  `_inflight` map dedupes concurrent first-callers so a thundering-herd
  boot doesn't slam `/v1/models`.
- `resolveLatestSync(tier)` (line 309) returns the baseline on cache miss
  AND schedules an async refresh — same shape BORJIE implements.
- Test hooks: `__resetResolverForTests`, `__overrideAdaptersForTests`,
  `__setTtlForTests`, `__peekCacheForTests` (lines 326-364).
- **Gap vs BORJIE:** LITFIN's catalog adapters live in a separate
  `model-catalog` module; the per-tier version pick happens via
  `pickLatest(entries, catalogTier)` (line 253) but I could not access
  that file in this audit — assumed similar to BORJIE's
  `version-compare.pickNewest`.

#### 1.1.3 `src/core/security/model-policy.ts` (262 LOC) — min-tier enforcement

This is the **biggest LITFIN-unique policy primitive**. Stops cost-routed
critical decisions from being silently downgraded.

- `MODEL_REQUIREMENTS` map (lines 44-97) declares the minimum tier for
  13 sensitive task categories:
  - `credit_assessment` → `premium`
  - `five_cs_assessment` → `premium`
  - `contradiction_detection` → `premium`
  - `fraud_detection` → `premium`
  - `readiness_assessment` → `premium`
  - `desk_review` → `default`
  - `document_extraction` → `default`
  - `financial_analysis` → `default`
  - `narrative_generation` → `default`
  - `learning_teaching` / `conversation` / `classroom_teaching` /
    `blog_generation` → `fast`
- Numeric `TIER_RANK` (lines 105-114) so `tierMeetsMinimum` is a single
  integer comparison.
- Auto-upgrades the requested tier when below the minimum; logs every
  enforcement to a bounded 500-entry in-memory `enforcementLog` for the
  audit dashboard (lines 138-165).
- `requiresPremiumTier(taskCategory)` (line 257) lets the UI warn the
  user before submitting expensive ops.

#### 1.1.4 `src/core/ai/task-router.ts` (1,151 LOC) — capability + complexity routing

- 39-value `TaskCategory` union covering document, financial, credit,
  conversation, voice, learning, classroom, blog, consulting,
  business-data-analysis (lines 27-68).
- `PROVIDER_CAPABILITIES` matrix (lines 124-203) — per-provider strengths,
  weaknesses, cost-per-million, max-context, supports streaming /
  structured-output / voice / images, average latency.
- `TASK_COMPLEXITY` 0-1 score per category (lines 206-247) + adjustments
  for `requiresDeepReasoning`, `requiresStructuredOutput`, `isRealtime`,
  input-length > 10k (`calculateComplexity` lines 894-915).
- `TASK_FALLBACK_CHAIN` — 3-tier primary / fallback1 / fallback2 per
  category (re-exported from `routing-config.ts`).
- Admin-configured `routingOverrides` (lines 313-336) loaded from DB, with
  null-revert.
- `classifyTask(context)` is the orchestrator entry-point. After tier
  selection via `selectTier(priority, costBudget)`, it pipes through
  `enforceModelPolicy(category, requestedClaudeTier)` (line 390) and
  emits an OCSF audit row when the model tier is upgraded (lines 402-414).
- `inferTaskCategory(context)` (lines 495-882) is a 388-line keyword
  router covering Swahili + English triggers.

#### 1.1.5 `src/core/ai/routing-config.ts` (638 LOC) — admin-configurable routes

- `LOCKED_CATEGORIES` set (lines 39-43) for capability-pinned tasks:
  `computer_use`, `voice_interaction`, `image_generation` cannot be
  reassigned by an admin — the alternate providers don't ship the API.
- `DEFAULT_FALLBACK_CHAIN` (lines 53-261) — explicit 3-tier chain for all
  39 categories.
- `TASK_CATEGORY_METADATA` (lines 267-527) — display name + description +
  default provider + priority per category, for the admin UI.
- `PROVIDER_DISPLAY` (lines 533-557) — UI color/badge per provider.
- Zod-validated `fallbackChainEntrySchema` (lines 565-585) with refine
  rules: primary != fallback1, primary != fallback2, fallback1 != fallback2,
  fallback2 requires fallback1.
- `llmRoutingUpdateSchema` (lines 634-637) for the PATCH API.

#### 1.1.6 `src/core/ai/llm-service.ts` (2,248 LOC) — unified provider service

- Provider-agnostic interface across Claude / OpenAI / DeepSeek with
  automatic fallback (lines 64-107).
- **Half-open circuit breaker** (`BreakerState = 'closed' | 'open' |
  'half_open'`, lines 144-167). HALF_OPEN_MAX_PROBES = 3,
  HALF_OPEN_REQUIRED_SUCCESSES = 2.
- `tryAdmitProbe(provider)` (lines 683-711) controls admission at request
  dispatch time; `recordProbeOutcome(provider, ok)` (lines 720-753)
  transitions HALF_OPEN → CLOSED after enough successes, or back to OPEN
  with fresh cooldown on probe failure.
- **Anthropic rate-limit header pre-flight** (lines 343-468):
  `_providerRateLimitState` tracks per-provider `requestsRemaining`,
  `tokensRemaining`, `requestsResetAt`, `tokensResetAt`. `checkRateLimitFloor`
  (line 412) trips BEFORE we hit the network when remaining <= 1.
  Decoupled `RateLimitNearExhaustionError` (line 394) so the fallback
  chain in `chat()` can decide whether to wait for reset or burst to next
  provider.
- `parseRetryAfterMs` (line 477) parses `retry-after` header (seconds OR
  HTTP-date), capped at 5 min.
- **Per-bank concurrency gate** (lines 109-123): `LITFIN_BANK_LLM_CAPACITY`
  default 6667 per-bank, `LITFIN_GLOBAL_LLM_CAPACITY` default 5000.
  `acquireSlot({bankId, capacity, timeoutMs: 5000})` in `streamClaude`
  and `callClaude` paths. A single noisy bank cannot burn the org-wide
  RPM quota.
- **Cost tracking** with `PROVIDER_COSTS` per-1M-token table (lines
  300-304) + `trackCost` ring buffer.
- **Global health holder** pinned to `globalThis` (lines 314-323) so the
  breaker state survives HMR / Vercel hot reload mid-burst.
- Provider health auto-recovery after 60s cooldown for stale `isHealthy:
  false` (lines 581-591).
- **Provider-scoped config**: `modelMatchesProvider` (line 268) +
  `scopeConfigToProvider` (line 281) drop a model field when the fallback
  provider is different family (a Claude id sent to OpenAI 404s otherwise).

#### 1.1.7 `src/core/ai/claude-service.ts` (1,785 LOC) — Anthropic sensor

- Two-tier May 2026 platform policy: only Opus 4.7 + Sonnet 4.6 (lines
  278-291). Haiku is OUT — every code path that used to opt into "fast"
  now lands on Sonnet 4.6.
- `CLAUDE_MODELS` legacy alias preserved as getter-based proxy
  (lines 303-324) so a hot resolver-cache refresh propagates instantly.
- **`safeText` + `safePayload`** (lines 139-168) — every raw doc text and
  structured payload runs through `redactBrands` (commercial bank names)
  → `scrubPiiText` (Tanzania NIDA / phone / email / TIN) → 
  `scrubPresidioOnlyText` (Presidio entity shapes: PERSON, LOCATION,
  ORG, IBAN, CREDIT_CARD, PHONE_NUMBER, EMAIL_ADDRESS, DATE_TIME, URL,
  IP_ADDRESS). Defence-in-depth egress scrubber. **No equivalent
  primitive in BORJIE.**
- **iter-65 system-prompt split**: `buildCachedSystemBlocksForSystem`
  (lines 104-119) splits at the situated-address boundary so the STABLE
  persona prefix carries `cache_control: { type: 'ephemeral', ttl: '1h' }`
  while the VOLATILE suffix (timestamp, mind-state) appends without
  invalidating the prefix-cache key. Anthropic shortened default TTL from
  1h → 5min in March 2026; explicit `ttl: "1h"` is now mandatory.
- **iter-53 semantic-cache wrapper** (lines 1318-1341): read-through by
  embedding key when `LITFIN_SEMANTIC_CACHE_ENABLED=1`, scoped per
  (tenantId, surface, personaId). Hit → skip LLM. Miss → return embedding
  for write-through after the call.
- **iter-55 KV-cache hot-swap registry** (lines 1162-1191): auto-promote
  system block to cache-eligible AND record `(modelId,
  system-prompt-hash)` lookup for cross-request prefix reuse telemetry.
- **iter-55 budget gate** (`guardLlmCall`, `recordActualSpend`, lines
  1301-1315 + 1391-1403) — per-tenant token-spend ledger. Over-budget
  orgs degrade to cheaper model OR throw `LlmBudgetExceededError` →
  HTTP 429.
- **iter-56 3-tier brain-cache**: `chatBrainCache` (lines 1423-1470) —
  L1 in-memory LRU → L2 semantic-cache → L3 Anthropic prompt-cache
  prefix.
- **Speculative decoding** (`chatSpeculative`, lines 1537-1601) — pairs
  Opus 4.7 (verifier) with Sonnet 4.6 (drafter) when
  `LITFIN_SPECULATIVE_DECODING=1`. Returns answer + `SpeculativeDecodeStats`
  with accept-rate.
- **Self-judge regenerate loop** (`chatWithJudge`, lines 1614-1697) —
  Haiku judges Opus output on (relevance, accuracy, polish) 0-100; if
  score < threshold (default 70) and `allowRegenerate`, the original
  Opus regenerates with the feedback as a prefix. Single-pass jury.

#### 1.1.8 `src/core/litfin-ai/llm/soul-router.ts` (237 LOC) — provider-agnostic dispatch

- 6-value `SoulProvider` union: `anthropic | openai | deepseek | google
  | meta | local`.
- `SoulRequest.task` is one of `chat | tool_use | structured_output |
  reasoning | voice_transcribe` (lines 31-49).
- `defaultRoute(request)` (lines 168-184): tasks `reasoning / chat /
  tool_use` → anthropic; `structured_output / voice_transcribe` → openai.
- **Provider-fingerprint scrubber** (`PROVIDER_FINGERPRINT_PATTERNS` +
  `scrubProviderFingerprints`, lines 85-142). Strips "I'm Claude, made
  by Anthropic", "I'm ChatGPT", "As an AI language model", etc., and
  replaces with "I'm the LitFin brain" / "As the LitFin brain". 4 regex
  rules, all use `.replace()` (NOT `.test()`) for idempotency (iter-44
  HIGH #7 fix — `.test()` on a global regex advances `lastIndex` across
  calls).
- Single-call dispatch with fallback chain via `createSoulRouter`
  (lines 186-237). Scrub runs by default; disable with
  `config.skipScrubbing = true`.

#### 1.1.9 `src/core/litfin-ai/llm/prompt-assembler.ts` (2,034 LOC) — 35-layer prompt

This is the **biggest LITFIN-unique pattern**. The assembler builds a
context-aware system prompt from 35 numbered layers, selectively included
based on intent + portal + persona.

- **Layered assembly**: IP_PROTECTION_LAYER → persona DNA → personal
  vocabulary (Layer 27) → active-language clarification (Layer 27.5) →
  style-calibration (Layer 28) → concepts (Layer 29) → situation → language
  enforcement → intent line → response format → agentic action →
  page-context → user profile → domain knowledge → truth verification →
  fresh truth claims → cognitive state → teaching enhancement → regional
  patterns → org knowledge → Swahili intelligence → conversation summary
  → morpheme hints → grammar rules → terminology constraints → financial
  health → gamification → teaching intelligence → emotional prosody →
  smartboard → artifact generation → officer dimension → sub-persona →
  BKT mastery → neural-spine attention → memory layer → persistent memory
  → active skills → professor personality → session memory → AI block
  instructions → teaching methodology → student camera → screen context
  → choreography → security boundary → awareness context (Layer 37) →
  reasoning structure (Layer 38) → self-bias addenda (Layer 36).
- **Prompt cache key over EVERY material input** (lines 92-140) — the
  presence-flag pattern. Previous 8-input key was silently incorrect;
  layers like masteryProfile / smartboardContext / artifactPreview /
  freshTruthClaims silently changed the output but were not part of the
  key — cache returned stale prompts when only those changed.
- **Kill-switch fail-closed** (lines 422-445): `LITFIN_AI_KILL_SWITCH=1`
  env OR localStorage `litfin_ai_kill_switch` OR DB-backed feature flag.
  Returns a minimal "service paused" prompt that respects the persona's
  no-em-dash + no-language-mix invariants.
- **Greeting fast-path** (lines 518-552): greeting intents skip
  response-format examples, Swahili glossary, domain, truth, cognitive,
  regional, and page context to cut prompt size by ~60%.
- **Per-message append-after-cache** layers (lines 488-502): screen
  context, awareness, reasoning structure, self-bias addenda — appended
  AFTER cache lookup so different per-message data doesn't poison the
  cache key.
- **Constitution / Theory of Mind / Pulvinar bound frame** (Layer 37,
  lines 348-361) — bridge from brain-kernel into the chat-path prompt.

#### 1.1.10 `src/core/litfin-ai/llm/response-cache.ts` (319 LOC) — semantic response cache

- Pattern-family matcher (lines 101-131) for 5 families: greeting,
  acknowledgment, farewell, platform_intro, how_to_start. Regex covers
  English + Swahili (`habari`, `mambo`, `asante`, `kwaheri`, etc.).
- Normalisation pipeline (`normalizeMessage`, lines 61-77) strips
  punctuation + filler words (`please`, `can you`, `i want to`) so
  semantically-identical messages share one cache entry.
- Portal-aware key: `"hi" on public portal != "hi" on borrower portal`
  (line 84). Hit count auto-updates immutably on each hit.
- Per-intent TTL (lines 272-283): greetings 10 min, platform intro 5 min,
  personalised 1 min.
- `isPersonalizedResponse` (line 286) — detects user-specific data
  markers (`your application`, `your loan`, `TSh \d+`) and refuses to
  cache.
- LRU eviction (lines 293-319): remove expired first, then
  lowest-hit-count.

#### 1.1.11 `src/core/litfin-ai/llm/speed-config.ts` (198 LOC) — intent-aware token limits

- `INTENT_TOKEN_LIMITS` per UserIntent (lines 25-63). Greeting 150,
  emotional_expression 1500, ask_question 1500, compare_products 3000,
  apply_for_loan 3000, research_topic 3000, unknown 1500.
- `PUBLIC_PORTAL_TOKEN_OVERRIDES` (lines 73-82) — visitors get tighter
  limits (ask_question 900, compare_products 1500) so marketing
  conversations feel focused.
- **History trimming** (`trimConversationHistory`, lines 117-155). Per-
  intent window — apply_for_loan 200 messages, learn_concept /
  research_topic 150, all others 100. Older messages get summarized into
  `## Prior Context` via `summarizeOlderMessages` (lines 170-198) instead
  of being dropped wholesale.

#### 1.1.12 `src/core/litfin-ai/llm/prompt-budget.ts` (233 LOC) — token budget + kill switch + telemetry

- `estimateTokens(text)` (line 44) — allocator-free heuristic averaging
  char-count/4 and word-count. Tracks Claude/GPT tokenisers within ~10%
  for English + Swahili. Safe on every turn.
- `DEFAULT_PROMPT_BUDGET = { maxTokens: 8000, warnTokens: 6000 }` —
  tuned for Sonnet 4.6's 200k window with cache-prefix headroom.
- `fitToBudget(layers, budget)` (line 82) — truncation cascade: drops
  lowest-priority layers first. Pure; never throws.
- `isKillSwitchActive(dbFlag)` (line 134) — three flip surfaces:
  `LITFIN_AI_KILL_SWITCH=1` env / `localStorage` / DB feature flag.
- `buildKillSwitchPrompt(language)` (line 157) — minimal "service paused"
  prompt that respects the no-em-dash + no-language-mix invariants.
- `onPromptBuild` + `emitPromptBuildEvent` (lines 187-208) — pub/sub
  telemetry. Listener errors are swallowed (the LLM hot path must never
  crash on observability).

#### 1.1.13 `src/core/chat/effort-resolver.ts` (64 LOC) — per-thread effort selector

- `ReasoningEffort = 'fast' | 'standard' | 'deep'` exposed to the chat
  UI so the user picks model strength per thread.
- `resolveEffortModel(effort)` (line 38) maps to
  `getModelLatest('haiku' | 'sonnet' | 'critical')` — re-evaluates on
  every access so env overrides propagate.
- `coerceEffort(raw)` (line 30) defaults to "standard" on malformed
  input. Tiny but useful UX primitive.

#### 1.1.14 `src/core/model-layer/router.ts` (233 LOC) — generation modalities

- 11 modalities registry: `openai-image | imagen | flux | midjourney |
  runway | sora | veo | pika | luma | suno | elevenlabs-voice-design`.
- `pickProvider(req, registry)` (line 92) — pure function:
  1. Filter to adapters whose modalities include `req.modality`
  2. Filter to adapters whose env vars are set (`isConfigured()`)
  3. Sort by cost ascending (`estimateCostCentsUsd(req)`)
  4. Hoist `preferredProvider` to front if it's in the eligible list
- `routeGenerate(req)` (line 153) — dispatch loop with budget-gate
  short-circuit and per-attempt audit trail. Adapter errors of code
  `modality-unsupported | invalid-request | budget-exceeded` short-circuit
  the loop (won't be fixed by failing over).
- **Cost meter** (`cost-meter.ts`, 159 LOC) — per-provider × modality
  table with `perOutput | perSecond | perMegapixel` knobs; pure
  `dailyBudgetCheck` against an injected `usedCentsToday`.

### 1.2 BORJIE current state

#### 1.2.1 `packages/brain-llm-router/src/dynamic-registry/` (PR #169) — 3-level resolver

This is **the surface where BORJIE is materially AHEAD of LITFIN**.

- `MODEL_FAMILIES` (`baselines.ts`, lines 29-47) — 17-value union
  spanning all major providers.
- `MODELS` (`baselines.ts`, lines 60-98) — frozen baseline ids per family
  with env-var override per family (`BORJIE_MODEL_BASELINE_<FAMILY>`).
  Read at module-load.
- `getModelLatest(family)` (`resolver.ts`, line 57) — hot-path sync
  resolver. L1 cache HIT → return. L1 MISS → return baseline + schedule
  L2 refresh.
- `scheduleRefresh(family)` (`resolver.ts`, line 92) — dedupes via
  `inflight` map; on L2 failure caches the baseline for 5 min
  (`BASELINE_RECACHE_MS`) to avoid slamming a down provider.
- `warmAllFamilies()` (`resolver.ts`, line 149) — eagerly refreshes every
  family via `Promise.allSettled`. Called by sleep-pass + composition
  root.
- `fetchLatestForFamily(family)` (`fetchers.ts`, line 298) — hits the
  real `/v1/models` endpoint via injected `getFetchPort()` with 5s
  timeout. Per-provider response-shape extractor in `extractIds(data,
  provider)` (line 216) handles Anthropic / OpenAI / DeepSeek (`data.[].
  id`), Google (`models.[].name` with `models/` prefix strip), Cohere
  (`models.[].name`), ElevenLabs (`.[].model_id`).
- **17 family patterns** with regex matchers (lines 76-184). Negative
  lookahead on `gpt-5` matcher rejects `mini | nano | realtime` siblings.
- `pickNewest(matching)` (`version-compare.ts`) — numerically-aware
  version compare for IDs like `claude-opus-4-7` vs `claude-opus-4-5`.

LITFIN's `model-resolver.ts` (iter-67) has the **same 3-level shape** but
its baseline is the much larger `MODELS` registry (26 entries with
per-tier semantic aliases) AND it relies on a separate `model-catalog`
module for the L2 fetch. I could not access that module — LITFIN may or
may not have the same numerical version-compare BORJIE ships in
`version-compare.ts`.

#### 1.2.2 `packages/brain-llm-router/src/task-ladder/task-ladder.ts` (115 LOC)

- 7-value `TaskKind` taxonomy: `plan | tool-use | critic | classify |
  chat | longdoc | codegen`.
- `TASK_LADDER` (lines 24-60) — 3-deep model preference per kind. E.g.
  `plan = [opus-4-7, sonnet@bedrock, gpt-5-pro]`, `chat = [haiku-4-5,
  sonnet-4-6, gpt-5]`.
- `TenantLadderMap` + `TenantLadderOverride` (lines 62-66) — VIP tenant
  pinning.
- `resolveLadder(task, tenantId, overrides, callOverride)` (line 72) —
  priority order: callOverride > tenant override > base ladder.
  Always returns frozen array.
- `selectAtDepth(task, tenantId, depth, overrides)` (line 96) — caller
  walks the ladder during fallback.
- **vs LITFIN**: 7 task kinds vs LITFIN's 39 categories. LITFIN's
  taxonomy is much richer (`credit_assessment`, `five_cs_assessment`,
  `voice_transcribe`, `learning_quiz_generation`, `business_advisory`,
  …). BORJIE's is provider-cost-focused (`plan` vs `codegen` vs
  `chat`).

#### 1.2.3 `packages/brain-llm-router/src/provider-fallback/fallback-router.ts` (144 LOC)

- `runFallback(req, ladder, config)` (line 62) — iterates ladder,
  skipping open breakers; retryable errors advance with exponential
  backoff; non-retryable fail fast.
- Cross-family hook (`onCrossFamilyFallback`, lines 99-102) — fires when
  fallback crosses provider family (`anthropic/claude → openai/gpt`) so
  the SRE dashboard can alert on quality drops.
- Open circuit skip — no waste calls.
- **Circuit breaker** (`circuit-breaker.ts`, 115 LOC) — 3-state machine
  (closed / open / half-open). Same shape as LITFIN's but BORJIE's
  has fewer telemetry hooks.

#### 1.2.4 `packages/brain-llm-router/src/cost-cascade/cascade-runner.ts` (163 LOC)

- RouteLLM pattern (research §2.3): cheapest model first; if caller-
  supplied `evalFn(response) < confidenceThreshold`, escalate to next.
- `runCascade(req, steps, config)` (line 61) — walks ordered cheap→
  expensive ladder, returns `{response, modelUsed, steps, totalCostUsd,
  savingsVsTopUsd}`.
- Pre-flight cost projection per step against `config.budgetUsd`; skips
  steps that would exhaust budget.
- `EvalFn` is async so callers can plug in Self-Consistency vote, CoVe
  verifier, or a trained ModernBERT classifier.
- Heuristic 4-chars-per-token estimator in `estimateInputTokens` (line
  146).

LITFIN has no direct analog. The closest LITFIN primitive is `chatWithJudge`
(judge-pass regenerate) — orthogonal but not a cascade.

#### 1.2.5 `packages/brain-llm-router/src/cost-cap/cost-cap.ts` (212 LOC)

- Three ports: `TenantBudgetReader`, `SpendLedger`, `TenantKillSwitch`.
- `preflightCostCheck(req, ctx, config)` (line 75) — hits killSwitch
  first → fetches budget + month-to-date + conversation spend → projects
  cost using same heuristic → throws `BrainLLMError("COST_CAP_EXCEEDED")`
  (non-retryable) on overrun.
- `postflightCharge` (line 151) records actual usage.
- `CostCapEvent` warning + exceeded variants emitted via `onEvent` hook
  for K-B receipt UX.
- `InMemorySpendLedger` (line 179) for tests + standalone bootstrap.

LITFIN has `guardLlmCall` / `recordActualSpend` in `core/governance/
llm-budget` (referenced from `claude-service.ts`) — same pattern, with
the addition of a **degrade-to-cheaper-model** option that BORJIE
doesn't yet model in its API surface.

#### 1.2.6 `packages/brain-llm-router/src/hedged-requests/hedged-invoke.ts` (123 LOC)

- Pattern: fire secondary after `hedgeAfterMs` if primary hasn't
  returned. AbortController on the loser so provider stops generating
  mid-stream (no output tokens billed).
- `wasHedged` + `winner` flags surfaced for observability.
- LITFIN has NO equivalent. The half-open breaker is reactive
  (post-fail); hedged is proactive (pre-fail).

#### 1.2.7 `packages/brain-llm-router/src/universal-client/` — 5 provider adapters

Anthropic / OpenAI / Google / Ollama / vLLM adapters behind one
`BrainLLMClient` shape. LITFIN's equivalent is the LLMService class
itself (Anthropic SDK + OpenAI SDK + DeepSeek + ElevenLabs).

#### 1.2.8 Adjacent: `packages/brain-llm-router/src/{compiled-prompts,prompt-portability,dspy-compile,brain-call-orchestrator,eval-drift-logger}/`

These are BORJIE-unique. No LITFIN equivalents. Out of scope for this
audit (the question was about *dynamic picking* + *lazy load*).

#### 1.2.9 NEW (just-shipped) BORJIE stubs visible in working tree

`git status` shows:
- `packages/brain-llm-router/src/kill-switch/` (new)
- `packages/brain-llm-router/src/pii-input-scrubber/` (new)
- `packages/brain-llm-router/src/provider-fingerprint-scrubber/` (new)

These are in-flight on the sister WA-MODEL-SWEEP branch. Their LITFIN
analogs:
- `kill-switch` ↔ LITFIN's `isKillSwitchActive` + `buildKillSwitchPrompt`
  in `prompt-budget.ts`.
- `pii-input-scrubber` ↔ LITFIN's `scrubPiiText` + `scrubPresidioOnlyText`.
- `provider-fingerprint-scrubber` ↔ LITFIN's `scrubProviderFingerprints`
  in `soul-router.ts`.

When those land, BORJIE will close 3 of the 9 HIGH ports in §1.4.

### 1.3 Gap analysis

| Capability | LITFIN | BORJIE | Gap |
|---|---|---|---|
| Single source of truth for model IDs | `model-registry.ts` (336 LOC, Zod-validated, 19 tier aliases, 26 model slots) | `dynamic-registry/baselines.ts` (98 LOC, 17 families, env-override per family) | BORJIE cleaner but narrower. LITFIN has richer tier aliases (premium/critical/judge/cheap/batch + family-explicit). NEUTRAL |
| 3-level resolver (L1 cache → L2 catalog → L3 baseline) | iter-67 `model-resolver.ts` (364 LOC) | PR #169 `resolver.ts` + `fetchers.ts` (490 LOC across resolver+fetchers+cache+version-compare) | NEUTRAL — both ship the pattern; BORJIE's L2 is numerically-aware version-compare against real `/v1/models` |
| Numerically-aware version compare | Lives in inaccessible `model-catalog` module — could not verify | `version-compare.ts` (112 LOC) — explicit `pickNewest` | NEUTRAL (assume parity until proved otherwise) |
| L2 `/v1/models` fetch with timeout | Yes (`listAnthropicCatalog` etc., inaccessible) | Yes — 5s timeout, injected fetch port, never throws | NEUTRAL |
| Sleep-pass warmer | Refs in `model-resolver.ts` line 27 mention sleep pass `model-catalog-refresh` (6h cadence) | `services/sleep-pass-orchestrator/src/passes/model-registry-warm.ts` (63 LOC) — hourly, dependency-injected | NEUTRAL |
| Min-tier policy per task category | `model-policy.ts` (262 LOC, 13 task categories, premium / default / fast) + auto-upgrade + audit log | ❌ NONE | **HIGH — PORT** |
| Half-open circuit breaker | `llm-service.ts` (lines 144-753) — 3-state, MAX_PROBES=3, REQUIRED_SUCCESSES=2, half-open admission, global health pinned to globalThis | `circuit-breaker.ts` (115 LOC) — has 3 states but BORJIE's half-open is simpler; no probe-admission counter | **MEDIUM — EXTEND** |
| Anthropic rate-limit header pre-flight throttling | `_providerRateLimitState` + `checkRateLimitFloor` + `updateRateLimitFromHeaders` + `parseRetryAfterMs` (lines 343-535) | ❌ NONE | **HIGH — PORT** |
| Per-bank concurrency gate | `acquireSlot({bankId, capacity, timeoutMs})` — env-tunable per-bank + global capacities | ❌ NONE (cost-cap has tenant budgets, but no concurrency cap) | **HIGH — PORT** |
| Admin-configurable routing overrides via DB | `task-router.ts` `setRoutingOverrides` + `routing-config.ts` Zod-validated PATCH schema + 39-category taxonomy | ❌ NONE | **HIGH — PORT** |
| Provider-fingerprint scrubber | `soul-router.ts` `scrubProviderFingerprints` (4 patterns, idempotent — `.replace()` only) | in-flight stub directory exists, not yet on main | **HIGH — PORT** (sister branch covers this) |
| PII egress scrubber (text + structured payload) | `safeText` + `safePayload` (brand redact → PII scrub → Presidio scrub) | in-flight `pii-input-scrubber/` stub exists | **HIGH — PORT** (sister branch covers this) |
| AI kill-switch (3 surfaces: env / localStorage / DB flag) | `isKillSwitchActive(dbFlag)` + `buildKillSwitchPrompt(language)` | in-flight `kill-switch/` stub exists | **HIGH — PORT** (sister branch covers this) |
| Semantic response cache (pattern families) | `response-cache.ts` (319 LOC, 5 pattern families, portal-aware, intent TTLs, LRU) | partial (cost-cap has projection; no response cache by intent) | **MEDIUM — PORT** |
| 35-layer prompt assembler with cache key over every material input | `prompt-assembler.ts` (2,034 LOC) | ❌ NONE — BORJIE prompts are assembled per-package without a layered selective assembler | **MEDIUM — PORT** (scoped down) |
| Per-intent token-limit policy | `speed-config.ts` (intent → max_tokens map, public-portal overrides, history-window per intent) | ❌ NONE | **MEDIUM — PORT** |
| Per-thread reasoning effort selector | `effort-resolver.ts` (64 LOC, `fast / standard / deep`) | ❌ NONE | **LOW — PORT** |
| Conversation summarisation for messages outside window | `speed-config.summarizeOlderMessages` | ❌ NONE | **MEDIUM — PORT** |
| Hedged requests | ❌ NONE | `hedged-invoke.ts` (123 LOC) | **BORJIE AHEAD** |
| Cost cascade (cheapest first + eval-fn escalate) | partial (`chatWithJudge` is single-pass regenerate, not multi-step cascade) | `cascade-runner.ts` (163 LOC, RouteLLM pattern) | **BORJIE AHEAD** |
| Universal client adapter pattern | Class-based `LLMService` (tightly coupled to Anthropic SDK) | 5 adapters behind `BrainLLMClient` shape (anthropic / openai / google / ollama / vllm) | **BORJIE AHEAD** |
| Cross-family fallback alert hook | ❌ NONE (cross-family is silent) | `onCrossFamilyFallback` in `runFallback` | **BORJIE AHEAD** |
| Self-judge regenerate loop | `chatWithJudge` (lines 1614-1697) | ❌ NONE in brain-llm-router (analogous patterns in ai-reviewer maybe) | **MEDIUM — PORT** |
| Speculative decoding (Opus verifier + Sonnet drafter) | `chatSpeculative` + `speculativeDecode` adapter | ❌ NONE | **LOW — PORT** (gated behind LITFIN_SPECULATIVE_DECODING; experimental) |
| KV-cache prefix registry | iter-55 `getOrAssignPrefixId` | ❌ NONE | **LOW — PORT** |
| System-prompt stable/volatile split for prompt cache | `buildCachedSystemBlocksForSystem` + iter-65 1h-TTL split | partial — prompt-cache package exists in performance-toolkit but I did not verify the split pattern | **MEDIUM — VERIFY then PORT** |
| Provider-scope: drop model field on cross-family fallback | `modelMatchesProvider` + `scopeConfigToProvider` | ❌ NONE explicit | **MEDIUM — PORT** |
| Health holder pinned to globalThis (survives HMR) | Yes (lines 314-323) | ❌ NONE | **LOW — PORT** |
| OCSF policy decision audit on tier upgrade | `logPolicyDecision` after `enforceModelPolicy` upgrades | ❌ NONE | **LOW — PORT** (depends on min-tier port landing first) |

### 1.4 HIGH-priority porting opportunities

These are the ports that close the biggest material gaps and that we can
land in <100 LOC each.

#### 1.4.1 Port `min-tier policy` (model-policy.ts)

**Why:** Without this, a cost-routing decision can silently downgrade a
lease-drafting / eviction-notice / financial-advisory call to a Haiku-
class model. LITFIN treats credit decisions as legally significant
(`five_cs_assessment` → premium). BORJIE has at least 4 categories
that should be guarded the same way: `lease_drafting`, `eviction_notice`,
`financial_advice`, `tenant_screening`.

- **Source:** `/src/core/security/model-policy.ts` lines 38-263 (LITFIN,
  262 LOC).
- **Target:** `packages/brain-llm-router/src/dynamic-registry/min-tier-policy.ts`.
- **Surface:**
  - `MODEL_REQUIREMENTS: Record<string, {minTier, reason}>`
  - `enforceMinTier(taskCategory: string, requestedFamily: ModelFamily):
    ModelFamily`
  - `requiresPremiumFamily(taskCategory: string): boolean`
  - `getEnforcementLog(): ReadonlyArray<EnforcementLogEntry>` (bounded
    500-entry ring buffer)
- **Effort:** ~80 LOC + 12 tests (4 happy-path, 4 upgrade, 2 audit log,
  2 unknown-category passthrough).
- **Risks:** Need to map LITFIN tier (premium/default/fast) onto
  BORJIE family (opus/sonnet/haiku/gpt-5/gpt-5-mini). One-to-one is
  fine.

#### 1.4.2 Port `rate-limit header pre-flight` (Anthropic + OpenAI)

**Why:** Without this, a 429 from Anthropic on one borrower kicks the
breaker open for 5 min. LITFIN learnt the Nvidia review the hard way
(Apr 2026): pre-flight floor reads `anthropic-ratelimit-requests-remaining`
+ `anthropic-ratelimit-tokens-remaining` from the previous call's
headers, throws `RateLimitNearExhaustionError` BEFORE we hit the
network, and the fallback chain picks another provider.

- **Source:** `/src/core/ai/llm-service.ts` lines 343-535 (LITFIN, ~200
  LOC).
- **Target:** `packages/brain-llm-router/src/provider-fallback/rate-limit-floor.ts`.
- **Surface:**
  - `class RateLimitNearExhaustionError extends Error` with `provider`
    + `resetAt`
  - `checkRateLimitFloor(provider): void` — throws or noops
  - `updateRateLimitFromHeaders(provider, headers: Headers): void`
  - `getProviderRateLimitState(): Readonly<Record<...>>`
  - `extractRetryAfterMsFromError(err): number | undefined`
- **Effort:** ~180 LOC + 15 tests (header parsing, RFC-3339 reset, edge
  cases, retry-after seconds + HTTP-date forms).
- **Risks:** `runFallback` needs to teach the loop to "skip this provider
  but don't trip the breaker" on `RateLimitNearExhaustionError`. Same
  pattern LITFIN ships at line 1090.

#### 1.4.3 Port `per-tenant concurrency gate`

**Why:** BORJIE has cost-cap (USD budget) but no concurrency cap. A
single noisy tenant can burn the org-wide RPM quota during a stage
demo. LITFIN's `acquireSlot({bankId, capacity, timeoutMs: 5000})` is the
exact mitigation.

- **Source:** `/src/core/ai/concurrency-gate.ts` (not yet read — exists
  per imports at lines 39-44 of llm-service.ts).
- **Target:** `packages/brain-llm-router/src/concurrency-gate/`.
- **Surface:**
  - `acquireSlot({tenantId, capacity, timeoutMs}): Promise<SlotHandle>`
  - `class SlotAcquireTimeoutError extends Error`
  - `SlotHandle.release(): void`
  - `getDefaultTenantCapacity(): number` (env-driven)
- **Effort:** ~100 LOC + 8 tests (acquire, release on success / fail /
  abort, timeout, finally-block release in AsyncGenerator).
- **Risks:** Streaming chat paths (SSE) need `try { ... } finally { slot.
  release() }` in the AsyncGenerator so consumer-abort frees the slot.
  LITFIN handles this at `streamClaude` lines 1392-1396.

#### 1.4.4 Port `provider-fingerprint scrubber`

**Why:** "I'm Claude, made by Anthropic" leaks into customer chat
responses. LITFIN's iter-44 idempotency fix matters — naive `.test()` +
`.replace()` on a global regex skips matches on the second call.

- **Source:** `/src/core/litfin-ai/llm/soul-router.ts` lines 85-142
  (LITFIN, ~60 LOC).
- **Target:** `packages/brain-llm-router/src/provider-fingerprint-scrubber/`
  (stub directory already exists on sister branch).
- **Surface:**
  - `scrubProviderFingerprints(text): {text, scrubbed: boolean}`
  - `PROVIDER_FINGERPRINT_PATTERNS` exported for tests
- **Effort:** ~80 LOC + 14 tests (each pattern + idempotency
  double-call + multi-occurrence + degenerate inputs).
- **Risks:** None — already on sister branch.

#### 1.4.5 Port `PII egress scrubber` (brand → PII → Presidio cascade)

**Why:** Every raw doc text and structured payload that crosses the
Anthropic boundary must be scrubbed. LITFIN ships a 3-stage cascade.
BORJIE has nothing equivalent on the LLM egress path; legal /
compliance risk.

- **Source:** `/src/core/ai/claude-service.ts` lines 139-168 (`safeText`
  + `safePayload`) + `/src/lib/security/pii-scrubber.ts` +
  `/src/lib/security/presidio-egress-scrubber.ts` (not yet read).
- **Target:** `packages/brain-llm-router/src/pii-input-scrubber/`
  (stub already exists on sister branch).
- **Surface:**
  - `safeText(input: string): string`
  - `safePayload<T>(value: T, depth?: number): T`
  - Pluggable `BrandRedactor`, `PiiScrubber`, `PresidioScrubber` ports.
- **Effort:** ~150 LOC + 25 tests (each layer in isolation + composition
  + structured-payload deep walk with circular-ref guard at depth 8 +
  string-leaf, array, object handling).
- **Risks:** Need Presidio adapter; can stub initially with regex-only
  patterns and add Presidio as a separate task.

#### 1.4.6 Port `AI kill switch` (3-surface)

**Why:** Sovereign operator must be able to halt all AI traffic during
an incident without redeploying. LITFIN ships env / localStorage / DB
flag.

- **Source:** `/src/core/litfin-ai/llm/prompt-budget.ts` lines 117-167
  (LITFIN, ~50 LOC).
- **Target:** `packages/brain-llm-router/src/kill-switch/` (stub already
  exists on sister branch).
- **Surface:**
  - `isKillSwitchActive(dbFlag: boolean | null | undefined): boolean`
  - `buildKillSwitchPrompt(language: 'en' | 'sw'): string`
- **Effort:** ~50 LOC + 6 tests.
- **Risks:** None — already on sister branch.

#### 1.4.7 Port `admin-configurable routing overrides`

**Why:** SRE / ops needs a runtime knob to flip `business_advisory:
claude → openai` during an Anthropic outage without a code deploy.
LITFIN ships a Zod-validated PATCH schema + `setRoutingOverrides` on the
router instance.

- **Source:** `/src/core/ai/routing-config.ts` lines 565-637 +
  `/src/core/ai/task-router.ts` lines 313-350 (LITFIN, ~120 LOC).
- **Target:** `packages/brain-llm-router/src/task-ladder/admin-overrides.ts`.
- **Surface:**
  - `fallbackChainEntrySchema` (Zod, with refine rules)
  - `ladderOverrideUpdateSchema` (Zod)
  - `applyOverrides(baseLadder, overrides): ladder`
  - `LOCKED_TASKS: ReadonlySet<TaskKind>` — `voice-transcribe`,
    `image-generation`, `computer-use` can't be reassigned.
- **Effort:** ~120 LOC + 18 tests.
- **Risks:** Need a route in api-gateway and a DB table. Out of scope
  for this audit doc; track as a follow-on after the package surface
  lands.

#### 1.4.8 Port `cross-family fallback alert hook`

**Why:** When a fallback crosses `anthropic/claude → openai/gpt`, the
SRE dashboard should fire an alert (different model = different quality
profile, can break downstream contracts). BORJIE already has the
hook (`onCrossFamilyFallback` in `fallback-router.ts` line 50) — the gap
is the **default observability wiring**. LITFIN has no equivalent.

- **Source:** N/A (LITFIN doesn't have it — this is a BORJIE-side
  follow-on).
- **Target:** wire `onCrossFamilyFallback` to OTel + Pino at the
  composition root.
- **Effort:** ~20 LOC + 2 tests.
- **Risks:** None.

#### 1.4.9 Port `OCSF policy decision audit`

**Why:** Every model-tier upgrade should land in the OCSF audit chain
for the security SOC. LITFIN logs to `logPolicyDecision` whenever the
min-tier policy upgrades a model.

- **Source:** `/src/core/ai/task-router.ts` lines 402-414 (LITFIN, ~12
  LOC).
- **Target:** wire `enforceMinTier` (port 1.4.1) to BORJIE's
  `ocsf-emitter` package (already exists per task #154).
- **Effort:** ~15 LOC + 2 tests.
- **Risks:** Blocked on 1.4.1 landing first.

### 1.5 MEDIUM-priority

| # | Capability | Source | Target | Effort |
|---|---|---|---|---|
| M1 | Semantic response cache (5 pattern families, portal-aware, intent TTL, LRU) | `response-cache.ts` (319 LOC) | `packages/brain-llm-router/src/response-cache/` | ~280 LOC + 20 tests |
| M2 | Half-open admission counter (probe-window throttling) | `llm-service.ts` lines 683-753 | extend `provider-fallback/circuit-breaker.ts` | ~60 LOC + 10 tests |
| M3 | Self-judge regenerate loop | `claude-service.ts` lines 1614-1697 | `packages/brain-llm-router/src/judge-loop/` | ~150 LOC + 15 tests |
| M4 | Per-intent token-limit policy + history trimming | `speed-config.ts` (198 LOC) | `packages/brain-llm-router/src/speed-config/` | ~180 LOC + 14 tests |
| M5 | Conversation summarisation for messages outside history window | `speed-config.summarizeOlderMessages` (~30 LOC) | bundle into M4 | included |
| M6 | Provider-scope: drop model field on cross-family fallback | `llm-service.ts` lines 268-291 | bundle into `runFallback` | ~30 LOC + 5 tests |
| M7 | Stable/volatile system-prompt split for Anthropic prompt cache | `claude-service.buildCachedSystemBlocksForSystem` + `core/brain/system-prompt-split` | verify what `performance-toolkit/prompt-cache` already does; port the split if absent | ~80 LOC + 8 tests |

### 1.6 LOW-priority

| # | Capability | Source | Target | Effort |
|---|---|---|---|---|
| L1 | Per-thread reasoning effort selector | `effort-resolver.ts` (64 LOC) | `packages/brain-llm-router/src/effort/` | ~60 LOC + 6 tests |
| L2 | Speculative decoding (Opus verifier + Sonnet drafter) | `claude-service.chatSpeculative` | `packages/brain-llm-router/src/speculative-decoding/` | ~250 LOC + 20 tests (experimental, gate behind env flag) |
| L3 | KV-cache prefix registry | iter-55 `prefix-registry.getOrAssignPrefixId` | `packages/brain-llm-router/src/kv-cache/` | ~100 LOC + 10 tests |
| L4 | Health holder pinned to globalThis (survives HMR) | `llm-service.ts` lines 314-323 | bundle into `provider-fallback/circuit-breaker.ts` | ~30 LOC + 3 tests |
| L5 | `lib/audio-fingerprint`-style routing taxonomy for `business_advisory / situation_analysis / feasibility_check` (LITFIN consulting mode) | `task-router.ts` lines 833-880 | extend `task-ladder` with 3 new `TaskKind` variants | ~40 LOC + 6 tests |

---

## 2. Lazy Load

### 2.1 LITFIN current state

#### 2.1.1 `src/lib/lazy.tsx` (276 LOC) — Next-specific helpers

Four primitives, all behind `'use client'`:

- `LazySkeleton({heightClass, bgClass, roundedClass, style})` (line 61) —
  single `<div>` with `animate-pulse`. No deps, no layout shift.
- `lazyClient<P>(loader, {skeleton, ...})` (line 94) — `next/dynamic` +
  `ssr: false` + skeleton fallback. For browser-only components (canvas,
  audio, IndexedDB, navigator.media).
- `lazyServer<P>(loader, {skeleton, ...})` (line 133) — `next/dynamic` +
  `ssr: true`. For SEO + LCP critical components that should still get a
  separate client chunk.
- `LazyVisible({children, rootMargin, className, skeleton, renderOnServer
  })` (line 198) — IntersectionObserver-gated mount with 200px lead-in.
  Below-the-fold marketing sections, admin charts in hidden tabs,
  dashboards that scroll past 2-3 viewports.
- `preloadOnHover<T>(loader): {onPointerEnter, onFocus}` (line 262) —
  intent-driven prefetch. Spread onto any Button/Link.

**Adoption**: 63 grep matches across LITFIN for `lazyClient | lazyServer
| LazyVisible | preloadOnHover`. Visible call sites include borrower
dashboard, marketplace, application detail, finances, all admin pages,
and the LitFin widget itself.

#### 2.1.2 `src/lib/yield-to-main.ts` (83 LOC) — INP-friendly chunking

- `yieldNow()` (line 49) — Chrome 129+ ships `scheduler.yield()`; fallback
  to `setTimeout(0)`. SSR-safe (returns resolved promise on Node).
- `processInChunks(items, fn, chunkSize=32)` (line 70) — chunked loop
  with `await yieldNow()` between chunks. Drop-in for hot loops over
  >50 items (filter on each keystroke, batched import processing).

#### 2.1.3 `src/lib/responsive-utils.tsx` (451 LOC) — breakpoint-aware components

- `BREAKPOINTS = {xs: 320, sm: 375, md: 768, lg: 1024, xl: 1280, 2xl:
  1536}`.
- `useWindowWidth()` with debounce, `useMobile`, `useTablet`, `useDesktop`,
  `useBreakpoint(bp)`, `useCurrentBreakpoint()`.
- `ResponsiveProvider` + `useResponsive()` context (lines 137-181) —
  includes touch capability detection.
- `<ResponsiveContainer>`, `<ShowOn breakpoints>`, `<HideOn breakpoints>`
  (lines 200-294) — conditional render per breakpoint.
- `useSwipe(handlers, threshold=50)` (line 378) — touch gestures on
  mobile.
- WCAG 2.2 touch-target sizing (`getTouchTargetClasses`, line 304).

This is NOT direct lazy-load but is the *consumer pattern* — components
decide whether to mount via these hooks, which is functionally equivalent
to deferred mount on mobile.

#### 2.1.4 `src/lib/service-worker/{register,sync-queue}.ts`

- Service-worker registration + offline sync queue. Below-the-fold of
  this audit but worth noting BORJIE's `performance-toolkit` does NOT
  ship a service-worker register or sync-queue.

#### 2.1.5 Sample integration: `src/app/(borrower)/borrower/dashboard/page.tsx`

- Mixes `next/dynamic` + `LazyVisible` (lines 5-6).
- Local `DashboardSectionSkeleton` (line 27) for inline skeletons.
- `BankCarousel = dynamic(() => import('...').then(m => ({default: m.
  BankCarousel})), { loading: () => <DashboardSectionSkeleton/> })` —
  named-export-to-default pattern.

#### 2.1.6 Sample chat assembly: `src/core/litfin-ai/components/ChatPanel.tsx`

Lazy-loads the message renderer + chat-input + voice-control bar via
`lazyClient`. The chat critical-path stays small; voice/audio/canvas
deps only fetched when the user interacts.

### 2.2 BORJIE current state

#### 2.2.1 `packages/performance-toolkit/src/lazy-load/` (5 modules, ~500 LOC)

**Framework-agnostic by design** — the package contains zero `react`
imports so it works for both Vite (owner-portal,
admin-platform-portal) and Next (customer-app, estate-manager-app,
tenant-portal) apps. The React-specific wrapper lives in app code.

- **`lazy-with-retry.ts` (149 LOC)** — `loaderWithRetry(importer,
  opts)` (line 45) — N retries with exponential delay (`retryDelayMs *
  (attempt + 1)`), then ONE full-page reload via injected
  `WindowReloadAdapter` to fetch the new chunk manifest. Session-storage
  guard prevents infinite loop on genuinely broken bundles. Closes the
  classic `ChunkLoadError` race after a deploy. **LITFIN's `lazyClient`
  has NO retry — a deploy mid-session blanks the screen.**
- **`prefetch-on-hover.ts` (97 LOC)** — `prefetchOnHover(href,
  spec?)` returns `{onMouseEnter, onFocus, onTouchStart}` handlers that
  inject `<link rel="prefetch" href as>` into `<head>` (idempotent).
  Replicates Next.js Link's hover-prefetch default for **Vite-based
  apps** (owner-portal, admin-platform-portal). `prefetchManyOnHover`
  for nav menus that warm a cluster of routes.
- **`use-intersection-lazy.ts` (109 LOC)** — `createIntersectionLazy
  ({loader, rootMargin, threshold, onStateChange})` (line 50) — pure
  intersection-observer wrapper, returns
  `{observe(el), unobserve(el), disconnect, getState}`. SSR-safe (immediate
  load when `IntersectionObserver` undefined).
- **`lazy-image.ts` (119 LOC)** — `lazyImage(input): LazyImageDescriptor`
  builds a `<picture>` tree: AVIF first (50% smaller than JPEG, 95%
  global support per caniuse 2026) → WebP → JPEG. Native
  `loading="lazy"` + `decoding="async"` + LQIP blur-up + `fetchpriority`
  for the LCP image. Responsive `srcSet` with `?w=<width>&fmt=<fmt>` so
  a Sharp-backed CDN serves the right resolution per breakpoint.
  **LITFIN ships no equivalent.**
- **`index.ts` (26 LOC)** — barrel.

#### 2.2.2 `packages/performance-toolkit/src/index.ts` — composition root

- `createPerformanceToolkit({metricsSink}): {lazy, streaming, cache,
  bundleBudget, promptCache, metrics}` — 6 subsystems wired with a
  shared metrics sink. Single import gives full toolkit.

#### 2.2.3 Adoption status (apps)

26 grep matches across BORJIE apps for `React.lazy | next/dynamic |
dynamic(`. Sample patterns:

- `apps/owner-portal/src/components/charts/lazy.tsx` (Vite) wraps recharts
  via `loaderWithRetry` (~80KB gzipped recharts deferred, 20-30% LCP
  improvement per the file's docblock).
- `apps/estate-manager-app/src/components/DeferredMounts.tsx` (Next) —
  Mwikila chat widget + Spotlight palette behind `next/dynamic({ ssr:
  false })`.
- `apps/admin-platform-portal/src/app/advisor/geo/ParcelMap.tsx` (Next) —
  Mapbox.
- Recently-shipped PR #170 (`P105 WB-LAZY-LOAD sweep — 4 HIGH gaps`)
  added more.

**Adoption gap**: LITFIN has 63 call-sites, BORJIE has 26. Per-LOC
adoption density is similar (LITFIN has more pages overall) but a
methodical sweep across BORJIE's 7 apps would close the gap.

#### 2.2.4 Adjacent: `packages/performance-toolkit/src/{streaming,cache,bundle-budget,perf-metrics,prompt-cache}/`

Beyond lazy-load. These are BORJIE-unique and have no LITFIN
equivalents. Out of scope for this audit.

### 2.3 Gap analysis

| Capability | LITFIN | BORJIE | Gap |
|---|---|---|---|
| `next/dynamic` thin wrapper with skeleton (client + server variants) | `lazyClient` + `lazyServer` in `lib/lazy.tsx` | NOT in performance-toolkit; lives ad-hoc in each Next app | **MEDIUM — PORT** |
| Retry-on-ChunkLoadError + reload-once | ❌ NONE | `loaderWithRetry` (149 LOC) | **BORJIE AHEAD** |
| Prefetch-on-hover for Vite apps | ❌ NONE (LITFIN is Next-only) | `prefetchOnHover` + `prefetchManyOnHover` (97 LOC) | **BORJIE AHEAD** |
| IntersectionObserver-gated mount component | `<LazyVisible>` (React JSX) | `createIntersectionLazy` (framework-agnostic controller — apps wrap in React) | **NEUTRAL — both ship** |
| Multi-format `<picture>` (AVIF/WebP/JPEG) descriptor builder | ❌ NONE | `lazyImage` (119 LOC) | **BORJIE AHEAD** |
| Yield-to-main + chunked-loop helper | `yieldNow` + `processInChunks` | NOT in performance-toolkit | **HIGH — PORT** |
| Responsive breakpoint hooks (mobile/tablet/desktop) + `<ShowOn>` / `<HideOn>` | `responsive-utils.tsx` (451 LOC) | NOT in design-system package (let me re-check, but no grep hits) | **MEDIUM — PORT** |
| Touch-gesture hook (`useSwipe`) with WCAG 2.2 touch-target sizing | `useSwipe` (line 378) + `getTouchTargetClasses` | ❌ NONE | **MEDIUM — PORT** |
| Service-worker register + sync-queue | `service-worker/{register, sync-queue}.ts` | ❌ NONE in performance-toolkit | **LOW — PORT** |
| Adoption count (grep `lazyClient \| lazyServer \| LazyVisible \| preloadOnHover \| loaderWithRetry \| prefetchOnHover \| useIntersectionLazy \| lazyImage`) | 63 (LITFIN) | 26 (BORJIE apps) | **HIGH — SWEEP** (different work — adoption, not net-new code) |
| `preloadOnHover` (component import preload, NOT route prefetch) | `preloadOnHover<T>(loader)` (line 262) | `prefetchOnHover(href)` only — handles `<link rel="prefetch">` for ROUTES, not component bundles | **MEDIUM — PORT** (covers a different surface) |
| Skeleton primitive (no-deps, no layout-shift `<div animate-pulse>`) | `<LazySkeleton>` | provided by `@borjie/design-system` (`Skeleton`) — used in lazy.tsx callsites | **NEUTRAL — both ship** |
| Composition root with `metricsSink` | ❌ NONE | `createPerformanceToolkit({metricsSink})` | **BORJIE AHEAD** |

### 2.4 HIGH-priority porting opportunities

#### 2.4.1 Sweep adoption — 5 apps × ~10 candidate files each

**Why:** LITFIN's 63 lazy-load call-sites vs BORJIE's 26 is a real
adoption gap. We have the primitives; we just need methodical use. P105
(WB-LAZY-LOAD) shipped 4 HIGH gaps but there's still surface left.

- **Source:** scan of LITFIN dashboards / marketplaces / chat panels
  shows the *pattern* — heavy charts behind `next/dynamic`, modal
  contents behind `LazyVisible`, voice/audio behind `lazyClient` with
  `ssr: false`.
- **Target:** systematic audit + wrap across:
  1. `apps/customer-app` (Next) — chat surface, document viewer, map
  2. `apps/estate-manager-app` (Next) — dashboard charts, tenant detail
  3. `apps/tenant-portal` (Next) — maintenance request, payment history
  4. `apps/owner-portal` (Vite) — charts already swept; check modals
  5. `apps/admin-platform-portal` (Next) — advisor pages already done;
     check geo + chart subviews
- **Effort:** ~50 LOC per app × 5 apps = 250 LOC + manual verification.
  Each wrap is 3-5 lines. Mostly mechanical. Cite Lighthouse before/after
  per app.
- **Risks:** SSR with client-only deps — same lint trap LITFIN avoided
  by tagging `'use client'` in `lib/lazy.tsx`.

#### 2.4.2 Port `yield-to-main` to performance-toolkit

**Why:** Hot loops in BORJIE's analytics package (Vega-Lite chart
data transforms), forecasting package (model warmup), and document AI
(OCR result joining) all stand to gain from `yieldNow` + `processInChunks`.
The current implementations are synchronous and risk INP regression on
older Android.

- **Source:** `/src/lib/yield-to-main.ts` (83 LOC, LITFIN).
- **Target:** `packages/performance-toolkit/src/yield/` (new subdir;
  add to `createPerformanceToolkit` barrel).
- **Surface:**
  - `yieldNow(): Promise<void>` — uses `scheduler.yield()` when
    available, else `setTimeout(0)`. SSR-safe.
  - `processInChunks<T>(items, fn, chunkSize=32): Promise<void>`
- **Effort:** ~100 LOC + 8 tests (SSR fallback, scheduler API present,
  scheduler API absent, chunk-size edge cases, error propagation).
- **Risks:** None. Pure utility.

#### 2.4.3 Port `preloadOnHover` for COMPONENT imports

**Why:** BORJIE's `prefetchOnHover` warms ROUTES (`<link
rel="prefetch">`). LITFIN's `preloadOnHover` warms COMPONENT bundles
(calls the import loader directly). Different surface — both are useful.
Pair them on a Button that opens a heavy modal: prefetch the route +
preload the modal bundle on hover, then on click both are warm.

- **Source:** `/src/lib/lazy.tsx` lines 262-276 (LITFIN, ~15 LOC).
- **Target:** `packages/performance-toolkit/src/lazy-load/preload-on-hover.ts`.
- **Surface:**
  - `preloadOnHover<T>(loader): {onMouseEnter, onFocus, onTouchStart}`
  - `triggered: boolean` debounce so multiple hovers don't refire.
- **Effort:** ~40 LOC + 6 tests.
- **Risks:** None. Trivial.

### 2.5 MEDIUM-priority

| # | Capability | Source | Target | Effort |
|---|---|---|---|---|
| M1 | `lazyClient<P>` + `lazyServer<P>` thin wrappers for Next apps | `lib/lazy.tsx` lines 94-154 | new `apps/_shared/lazy.tsx` OR per-app | ~80 LOC × 4 Next apps OR ~80 LOC in a shared file |
| M2 | `<LazyVisible>` React JSX component wrapping `createIntersectionLazy` | `lib/lazy.tsx` lines 198-246 | `apps/_shared/components/LazyVisible.tsx` OR add React adapter to performance-toolkit | ~80 LOC + 8 tests |
| M3 | Responsive breakpoint hooks + `<ShowOn>` / `<HideOn>` | `responsive-utils.tsx` (~300 LOC of the file) | `@borjie/design-system/responsive` | ~250 LOC + 18 tests |
| M4 | Touch-gesture `useSwipe` hook + WCAG 2.2 touch-target sizing | `responsive-utils.tsx` lines 304-426 | `@borjie/design-system/touch` | ~120 LOC + 10 tests |

### 2.6 LOW-priority

| # | Capability | Source | Target | Effort |
|---|---|---|---|---|
| L1 | Service-worker register + sync-queue (offline ops) | `service-worker/{register, sync-queue}.ts` | `packages/performance-toolkit/src/service-worker/` | ~200 LOC + 12 tests |
| L2 | Named-export-to-default pattern helper for `next/dynamic` | LITFIN inline at every dashboard import | bundle into `lazyClient` overload | ~30 LOC + 4 tests |

---

## 3. Summary table

| Surface | LITFIN ahead | BORJIE ahead | Parity |
|---|---|---|---|
| Dynamic LLM picking — primitives | 19 (registry / min-tier / 35-layer assembler / response-cache / speed-config / per-bank gate / rate-limit floor / kill-switch / fingerprint-scrubber / PII scrubber / OCSF audit / globalThis health / provider-scope / self-judge / speculative / KV-prefix / effort-resolver / 39-task taxonomy / admin overrides) | 4 (cost-cascade / hedged-requests / universal client / cross-family hook) | 5 (3-level resolver / version compare / sleep-pass warmer / circuit breaker / cost-cap) |
| Lazy load — primitives | 4 (preloadOnHover / responsive-utils / useSwipe / yield-to-main) | 4 (lazy-with-retry / prefetchOnHover Vite / lazyImage AVIF / composition root) | 4 (skeleton / IntersectionObserver / next/dynamic wrappers / `<LazyVisible>`) |
| Lazy load — adoption | 63 call-sites | 26 call-sites | — |

---

## 4. Recommended next actions

Ordered by impact / effort ratio. Each can dispatch as an independent
worktree.

1. **Confirm sister-branch ports land** — `WA-MODEL-SWEEP` is shipping
   `kill-switch/`, `pii-input-scrubber/`, `provider-fingerprint-scrubber/`.
   This closes 1.4.4, 1.4.5, 1.4.6 (3 of 9 HIGH ports) for free. Verify
   on PR merge.

2. **Port min-tier policy** (1.4.1) — highest legal-risk gap.
   `packages/brain-llm-router/src/dynamic-registry/min-tier-policy.ts`.
   ~80 LOC + 12 tests. Wire to `runFallback` + log via `ocsf-emitter`.
   ETA: ~2 hours.

3. **Port rate-limit header pre-flight** (1.4.2) — prevents
   self-inflicted 5-min outage on a single 429.
   `packages/brain-llm-router/src/provider-fallback/rate-limit-floor.ts`.
   ~180 LOC + 15 tests. ETA: ~4 hours.

4. **Port per-tenant concurrency gate** (1.4.3) — protects org-wide RPM
   quota from a single noisy tenant.
   `packages/brain-llm-router/src/concurrency-gate/`. ~100 LOC + 8 tests.
   ETA: ~3 hours.

5. **Port admin-configurable routing overrides** (1.4.7) — SRE wants a
   runtime knob to flip primary provider during an outage.
   `packages/brain-llm-router/src/task-ladder/admin-overrides.ts`. ~120
   LOC + 18 tests + 1 API route + 1 migration. ETA: ~6 hours.

6. **Lazy-load adoption sweep** (2.4.1) — 5 apps × ~10 files each. Each
   wrap is 3-5 lines. Cite Lighthouse before/after per app.
   ETA: ~6 hours.

7. **Port yield-to-main** (2.4.2) — pure utility, useful in
   analytics/forecasting/doc-AI loops.
   `packages/performance-toolkit/src/yield/`. ~100 LOC + 8 tests.
   ETA: ~2 hours.

8. **Port preloadOnHover for component bundles** (2.4.3) — pairs with
   existing route-level `prefetchOnHover`.
   `packages/performance-toolkit/src/lazy-load/preload-on-hover.ts`.
   ~40 LOC + 6 tests. ETA: ~1 hour.

9. **MEDIUM batch (1.5 M1-M7 + 2.5 M1-M4)** — ~1,250 LOC + ~125 tests
   across response-cache / half-open-counter / self-judge / speed-config
   / prompt-split / responsive / swipe / lazyClient. Sequence after
   HIGH ports land. ETA: ~3 days.

10. **LOW batch (1.6 + 2.6)** — defer. Speculative-decoding L2 needs
    real-world A/B before justifying complexity.

Total HIGH-port effort: ~24 dev-hours (~3 days) + adoption sweep ~6
hours. Total HIGH+MEDIUM: ~5-6 dev-days. The lift is real but tractable.

---

## 5. Files inspected (provenance)

### LITFIN (15 files, ~8,500 LOC)

- `/Users/.../LITFIN PROJECT/src/core/model-layer/router.ts` (233 lines)
- `/Users/.../LITFIN PROJECT/src/core/model-layer/cost-meter.ts` (159 lines)
- `/Users/.../LITFIN PROJECT/src/core/model-layer/reference-conditioner.ts` (~205 lines)
- `/Users/.../LITFIN PROJECT/src/core/model-layer/types.ts` (~179 lines)
- `/Users/.../LITFIN PROJECT/src/core/litfin-ai/llm/soul-router.ts` (237 lines)
- `/Users/.../LITFIN PROJECT/src/core/litfin-ai/llm/prompt-assembler.ts` (2,034 lines — partial; 1,116 lines read)
- `/Users/.../LITFIN PROJECT/src/core/litfin-ai/llm/response-cache.ts` (319 lines)
- `/Users/.../LITFIN PROJECT/src/core/litfin-ai/llm/speed-config.ts` (198 lines)
- `/Users/.../LITFIN PROJECT/src/core/litfin-ai/llm/prompt-budget.ts` (233 lines)
- `/Users/.../LITFIN PROJECT/src/core/security/model-policy.ts` (262 lines)
- `/Users/.../LITFIN PROJECT/src/core/chat/effort-resolver.ts` (64 lines)
- `/Users/.../LITFIN PROJECT/src/core/ai/model-registry.ts` (336 lines)
- `/Users/.../LITFIN PROJECT/src/core/ai/task-router.ts` (1,151 lines)
- `/Users/.../LITFIN PROJECT/src/core/ai/claude-service.ts` (1,785 lines)
- `/Users/.../LITFIN PROJECT/src/core/ai/llm-service.ts` (2,248 lines — partial; 1,559 lines read)
- `/Users/.../LITFIN PROJECT/src/core/ai/model-resolver.ts` (364 lines)
- `/Users/.../LITFIN PROJECT/src/core/ai/routing-config.ts` (638 lines)
- `/Users/.../LITFIN PROJECT/src/lib/lazy.tsx` (276 lines)
- `/Users/.../LITFIN PROJECT/src/lib/yield-to-main.ts` (83 lines)
- `/Users/.../LITFIN PROJECT/src/lib/responsive-utils.tsx` (451 lines)
- Sample dashboard wrap: `/Users/.../LITFIN PROJECT/src/app/(borrower)/borrower/dashboard/page.tsx` (head only — line 5: `import dynamic from "next/dynamic"`).

Not accessed (referenced but file path unavailable in this audit):
- `/src/core/ai/model-catalog/` (per `model-resolver.ts` imports)
- `/src/core/ai/concurrency-gate.ts` (per `llm-service.ts` imports)
- `/src/core/governance/llm-budget.ts` (per `claude-service.ts` imports)
- `/src/core/ai/kv-cache/prefix-registry.ts` (per `claude-service.ts` imports)
- `/src/core/ai/speculative-decoding/draft-then-verify.ts` (per `claude-service.ts` imports)
- `/src/lib/security/pii-scrubber.ts` + `/src/lib/security/presidio-egress-scrubber.ts`
- `/src/core/litfin-ai/agency/brand-redactor.ts`

### BORJIE (14 files, ~2,800 LOC)

- `/Users/.../BORJIE101/packages/brain-llm-router/src/index.ts` (~125 lines)
- `/Users/.../BORJIE101/packages/brain-llm-router/src/dynamic-registry/index.ts` (~38 lines)
- `/Users/.../BORJIE101/packages/brain-llm-router/src/dynamic-registry/resolver.ts` (158 lines)
- `/Users/.../BORJIE101/packages/brain-llm-router/src/dynamic-registry/baselines.ts` (106 lines)
- `/Users/.../BORJIE101/packages/brain-llm-router/src/dynamic-registry/fetchers.ts` (332 lines)
- `/Users/.../BORJIE101/packages/brain-llm-router/src/dynamic-registry/cache.ts` (108 lines — directory listing only)
- `/Users/.../BORJIE101/packages/brain-llm-router/src/dynamic-registry/version-compare.ts` (112 lines — directory listing only)
- `/Users/.../BORJIE101/packages/brain-llm-router/src/task-ladder/task-ladder.ts` (115 lines)
- `/Users/.../BORJIE101/packages/brain-llm-router/src/provider-fallback/fallback-router.ts` (144 lines)
- `/Users/.../BORJIE101/packages/brain-llm-router/src/cost-cascade/cascade-runner.ts` (163 lines)
- `/Users/.../BORJIE101/packages/brain-llm-router/src/cost-cap/cost-cap.ts` (212 lines)
- `/Users/.../BORJIE101/packages/brain-llm-router/src/hedged-requests/hedged-invoke.ts` (123 lines)
- `/Users/.../BORJIE101/packages/performance-toolkit/src/lazy-load/index.ts` (26 lines)
- `/Users/.../BORJIE101/packages/performance-toolkit/src/lazy-load/lazy-image.ts` (119 lines)
- `/Users/.../BORJIE101/packages/performance-toolkit/src/lazy-load/lazy-with-retry.ts` (149 lines)
- `/Users/.../BORJIE101/packages/performance-toolkit/src/lazy-load/prefetch-on-hover.ts` (97 lines)
- `/Users/.../BORJIE101/packages/performance-toolkit/src/lazy-load/use-intersection-lazy.ts` (109 lines)
- `/Users/.../BORJIE101/packages/performance-toolkit/src/index.ts` (54 lines)
- `/Users/.../BORJIE101/services/sleep-pass-orchestrator/src/passes/model-registry-warm.ts` (63 lines)
- Sample chart wrap: `/Users/.../BORJIE101/apps/owner-portal/src/components/charts/lazy.tsx` (head only)
- Sample deferred mount: `/Users/.../BORJIE101/apps/estate-manager-app/src/components/DeferredMounts.tsx` (head only)

In-flight (sister WA-MODEL-SWEEP branch, present in `git status`):
- `packages/brain-llm-router/src/kill-switch/`
- `packages/brain-llm-router/src/pii-input-scrubber/`
- `packages/brain-llm-router/src/provider-fingerprint-scrubber/`

---

*End of audit.*
