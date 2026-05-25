# Agent PhL-AI-DEEPER — AI-native capabilities (PROPOSE > SETTLE)

Four AI-native capabilities layered on top of Agent PhG's 8. Each is a
pipeline of `budget-guard → LLM → citation-rich output → approval/queue`,
never a rules engine disguised as "AI."

## Capability table

| Capability | Contract | Citation integration | Budget-guard | Global dispatch |
|---|---|---|---|---|
| Dynamic rent optimizer | `DynamicRentOptimizer.propose(inputs, opts)` | Market-signal id + occupancy hash + churn id + inspection id + statute ref on clamp | `ledger.assertWithinBudget` pre-LLM; `recordUsage` post | `RentControlLookup(countryCode)` — composition root binds to `resolvePlugin(country).leaseLaw.rentIncreaseCap` |
| Doc-intelligence extractor | `DocumentIntelligence.extract(input, opts)` | `document_span` citations with char offsets for every entity + obligation | `assertWithinBudget` + `recordUsage` | Any language — LLM detects per call; `countryCode` hint drives "missing standard clauses" flag |
| Legal draftsperson | `LegalDrafter.draft({ documentKind, context, facts })` | `statute` citation for every `requiredClause` cited | `assertWithinBudget` + `recordUsage` | `LeaseLawDispatchPort.resolve(countryCode, kind, subdivision)` — binds to compliance-plugins registry |
| Voice-first agent | `VoiceAgent.turn(input)` | `toolCalls[]` log + STT transcript + brain promptHash | `assertWithinBudget` + `recordUsage`. Degrades to `VOICE_NOT_CONFIGURED` when STT missing | Language is LLM/STT-detected per turn; response TTS'd in same ISO-639 code |

## Endpoints added

All mounted at `/api/v1/ai-native` via shared router
`services/api-gateway/src/routes/ai-native.router.ts` (extended — PhG's
endpoints preserved above PhL's block).

| Method | Path | Handler |
|---|---|---|
| POST | `/ai-native/dynamic-pricing/:unitId/propose` | `aiNative.dynamicPricing.propose` |
| POST | `/ai-native/doc-intelligence/:documentId/extract` | `aiNative.docIntelligence.extract` |
| GET  | `/ai-native/doc-intelligence/:documentId/entities` | `aiNative.docIntelligenceRepo.listEntities` |
| GET  | `/ai-native/doc-intelligence/:documentId/obligations` | `aiNative.docIntelligenceRepo.listObligations` |
| POST | `/ai-native/legal-draft` | `aiNative.legalDrafter.draft` |
| GET  | `/ai-native/legal-drafts` | `aiNative.legalDraftRepo.list` |
| POST | `/ai-native/voice/turn` | `aiNative.voiceAgent.turn` |

Status codes: `402 BUDGET_EXCEEDED`, `422 VALIDATION`, `503
{VOICE_NOT_CONFIGURED,ADAPTER_NOT_CONFIGURED,LLM_NOT_CONFIGURED}`, `409
GUARDRAIL_VIOLATION`, `502` upstream errors, `200` happy path.

## Migrations applied

| File | Tables |
|---|---|
| `0107_rent_recommendations.sql` | `rent_recommendations` (indexes on tenant+unit, status, cap_breach) |
| `0108_document_entities.sql` | `document_entities`, `document_obligations` (GIN idx on `risk_flags`) |
| `0109_legal_drafts.sql` | `legal_drafts` + CHECK constraint `legal_drafts_eviction_must_review` |
| `0110_voice_turns.sql` | `voice_turns` (per-session index) |

Every row carries `model_version`, `prompt_hash`, `confidence`,
`explanation`, and FK-like citation columns. Check constraints enforce the
safety invariants in the DB layer (eviction notices MUST require human
review regardless of application-level autonomy policy).

## What's stubbed vs fully integrated

| Piece | Status |
|---|---|
| Pricing LLM (`PricingLLMPort`) | **Port** — composition root injects Anthropic/OpenAI wrapper. Optimizer logic fully implemented. |
| `RentControlLookup` | **Port** — bound to `resolvePlugin(country).leaseLaw.rentIncreaseCap`. Caller decides. |
| `ApprovalQueuePort` | **Port** — binds to existing `ApprovalService` (services/domain-services/src/approvals). |
| Doc-intelligence LLM (`DocIntelligenceLLMPort`) | **Port** — same wiring pattern. |
| `SemanticMemoryPort` | **Port** — optional; degrades to `embeddingRef: null`. |
| Legal drafter LLM (`LegalDrafterLLMPort`) | **Port** |
| `LeaseLawDispatchPort` | **Port** — binds to compliance-plugins registry. |
| `AutonomyPolicyLookup` | **Port** — optional; absent = always queue for review. |
| Voice STT (`VoiceSttPort`) | **Port** — nullable; returns `VOICE_NOT_CONFIGURED` when absent. |
| Voice TTS (`VoiceTtsPort`) | **Port** — nullable; degraded mode preserves text reply. |
| `VoiceBrainPort` | **Port** — the existing `brain.ts` is the target wire-up; tool-call loop lives behind the port. |
| `CustomerResolverPort` | **Port** — mirrors `resolveCustomerIdForSelf` pattern used in credit-rating router. |
| All pipelines | **Fully integrated** — validation, budget-guard, citation assembly, persistence, approval routing all implemented end-to-end. Stubs are the external adapters only. |

## Why each is AI-native vs SaaS-1.0

- **Dynamic pricing** — SaaS-1.0 rents are set manually once a year; this
  proposes continuously with per-unit citations and a jurisdiction-aware
  regulatory clamp, so no "raise 20%" spreadsheet macro can escape the law.
- **Doc-intelligence** — SaaS-1.0 treats uploads as opaque blobs; this
  extracts obligations with char-level spans in ANY language, so "which
  vendor agreements auto-renew in the next 60 days" becomes a query, not a
  legal-review project.
- **Legal drafter** — SaaS-1.0 ships static templates; this composes
  jurisdiction-specific first drafts with statute citations, and a CHECK
  constraint in the DB PLUS `FORBIDDEN_AUTO_SEND` in code enforces "eviction
  notices never auto-send" even if a customer misconfigures autonomy.
- **Voice agent** — SaaS-1.0 has a phone tree; this is a multilingual
  conversational agent that dispatches to the Mr. Mwikila brain, executes
  tool calls mid-conversation, and synthesizes replies in the SAME language
  the caller spoke — not a hardcoded en/sw pair.

## Verification results

- `pnpm --filter @borjie/ai-copilot typecheck` — **PASS**
- `pnpm --filter @borjie/api-gateway typecheck` — **PASS**
- `pnpm --filter @borjie/ai-copilot test -- --run src/ai-native/__tests__/`
  — **PASS**, 46/46 (12 files; PhL contributed 12 new tests across 4 files,
  3 per capability: happy + degraded + guardrail-violation).

## Source paths

- `packages/ai-copilot/src/ai-native/phl-common/` — shared types + budget helpers
- `packages/ai-copilot/src/ai-native/dynamic-pricing/` — optimizer + ports
- `packages/ai-copilot/src/ai-native/doc-intelligence/` — extractor + ports
- `packages/ai-copilot/src/ai-native/legal-drafter/` — drafter + ports + `FORBIDDEN_AUTO_SEND`
- `packages/ai-copilot/src/ai-native/voice-agent/` — agent loop + ports
- `packages/ai-copilot/src/ai-native/__tests__/{dynamic-pricing,doc-intelligence,legal-drafter,voice-agent}.test.ts`
- `services/api-gateway/src/routes/ai-native.router.ts` — PhL endpoints appended
- `packages/database/src/migrations/{0107,0108,0109,0110}*.sql`

## Composition-root status

Composition root injection on the `services.aiNative` object:

- `dynamicPricing`, `docIntelligence`, `docIntelligenceRepo`,
  `legalDrafter`, `legalDraftRepo` — **still pending** the Agent-Z5
  Postgres-repo work; routers continue to 503 until those slots land.
- `voiceAgent` — **WIRED + REAL BRAIN** as of commits `f3f02d2`
  (registry slot) and `eb21991` (BrainKernel composition root).
  `services/api-gateway/src/composition/voice-agent-wiring.ts`
  constructs `createVoiceAgent` against a Drizzle-backed
  `VoiceTurnRepository` (commit `e33cebc`,
  `packages/database/src/services/voice-turns.service.ts`) and exposes
  it on `ServiceRegistry.voiceAgent`. The new
  `services/api-gateway/src/composition/brain-kernel-wiring.ts`
  constructs the central-intelligence kernel against the
  budget-guarded Anthropic client + `cot-reservoir` / `brain-cache` /
  `sensor-failover` in-memory adapters; the voice agent's
  `VoiceBrainPort` is now bound to `kernel.think`. When
  `ANTHROPIC_API_KEY` is set, every voice turn round-trips through
  the kernel's 13-step pipeline (cache → inviolable → tier → memory →
  cohort → persona → sensor failover → normalize → judge → drift →
  policy → confidence → provenance). When unset, transparently falls
  back to the heuristic-language-detection stub (sw / es / fr / en —
  never hardcodes 'en'). `VoiceSttPort`, `VoiceTtsPort`, and
  `CustomerResolverPort` still pass as `null` (the agent's degraded
  mode preserves text-only behaviour). When `DATABASE_URL` is unset
  the wiring returns `null` so the existing 503 contract still holds.

Each remaining slot depends on: concrete Postgres repositories (TODO
Agent Z5), a budget-guarded Anthropic/OpenAI LLM port (`withBudgetGuard`
from providers/), a `LeaseLawDispatchPort` binding to compliance-plugins,
and (for voice) real STT/TTS adapters bound to `VoiceSttPort` /
`VoiceTtsPort`.
