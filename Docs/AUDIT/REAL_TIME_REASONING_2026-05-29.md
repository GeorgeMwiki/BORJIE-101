# Real-Time Reasoning — Mr. Mwikila Thinks, Does Not Recite

**Owner:** RT workstream (real-time reasoning sharpening)
**Date:** 2026-05-29
**Status:** Shipped (RT-1 → RT-7), regression net green

## Principle

Mr. Mwikila CAN think, reason, strategise, research in real time —
full intelligence, NOT hardcoded. The 57 capability registry entries,
15 disclosure patterns, and jurisdiction-prompt blocks that landed in
#222 / #223 / #224 are **reasoning GUIDELINES / EXAMPLES /
GUARDRAILS** — NOT scripts he returns verbatim.

Variation across turns is EXPECTED and DESIRED — it proves the AI is
thinking, not retrieving.

## What changed

| Tag | Scope | File(s) | Status |
|-----|-------|---------|--------|
| RT-1 | Registry reframed as reasoning guidelines | `packages/persona-runtime/src/capabilities/` (capability-registry.ts, types.ts, index.ts) | shipped |
| RT-2 | REAL-TIME REASONING directive in BORJIE_PERSONA_DNA | `services/api-gateway/src/routes/public-chat.hono.ts` (inherited by brain-teach.hono.ts) | shipped |
| RT-3 | Jurisdiction prompt reasoning-aware reframe | `services/api-gateway/src/services/jurisdiction-resolver/prompt.ts` + `services/api-gateway/src/services/brain/jurisdiction-prompt.ts` | shipped, coordinated with #224 |
| RT-4 | Disclosure patterns doc — variation note | `Docs/AUDIT/CAPABILITY_DISCLOSURE_PATTERNS.md` | shipped |
| RT-5 | Brain tools return CONTEXT not pre-composed strings | `services/api-gateway/src/composition/brain-tools/capability-tools.ts` | shipped |
| RT-6 | Variation probe + live audit doc | `services/api-gateway/src/composition/brain-tools/__tests__/capability-tools-variation.test.ts` + `Docs/AUDIT/CAPABILITY_DISCLOSURE_LIVE_2026-05-29.md` | shipped |
| RT-7 | `mwikila.reason.strategize` multi-step strategic scaffold | `services/api-gateway/src/composition/brain-tools/reason-strategize-tool.ts` | shipped |

## RT-1 — Registry as reasoning guidelines

The canonical capability registry's file-level doc now opens with:

> Mr. Mwikila reasons FRESH per turn. He pulls from this registry to:
>  - Verify a capability EXISTS before claiming it (guardrail)
>  - Ground his response in user OUTCOMES (not internal mechanics)
>  - Stay on-topic and on-persona
>
> He does NOT return these strings verbatim. Each turn produces fresh,
> context-aware language using live tenant data + current conversation
> + tool calls.

`types.ts` now annotates each field's intent:
- `public_description` is semantically a `reasoning_hint` — GUIDANCE
  for the model, not copy to recite.
- `example_response_pattern` is semantically an `example_reasoning_trace`
  — ONE valid shape, not THE shape.

New semantic accessors `reasoningHint(entry)` and
`exampleReasoningTrace(entry)` let NEW call sites use the
GUIDELINE-not-SCRIPT names without disturbing the canonical registry
or its 23 existing regression tests.

Storage names preserved to avoid invasive churn across 1,400+ line
registry + 6 consumer files; the semantic reframe lives at the
JSDoc + accessor layer.

## RT-2 — REAL-TIME REASONING directive

A new top-level block in `BORJIE_PERSONA_DNA` outranks any single
canned example:

> You are a thinking AI Managing Director. NEVER return canned text.
> Every response is REASONED FRESH using:
>  - Current owner conversation context
>  - Live tenant data via the brain tools
>  - Real-time brain tools (entity search, scope query, jurisdiction
>    lookup, web search where relevant)
>  - Multi-turn reasoning
>
> The capability registry, disclosure patterns, and jurisdiction
> examples are REFERENCE MATERIAL. They are NOT scripts. NEVER paste
> them verbatim. Variation across turns is EXPECTED and DESIRED.
>
> You also have STRATEGIC REASONING capabilities. When the owner asks
> "what should I do?": lay out the current state, identify constraints,
> generate 2-4 plausible strategies with tradeoffs, cite evidence,
> recommend with explicit "why" + retrospective grade plan.
>
> You are NOT a FAQ-bot. You are an MD who happens to be AI.

Because `BORJIE_PERSONA_DNA` is the shared baseline composed into the
home teaching prompts AND the marketing prompts, `brain-teach.hono.ts`
inherits this directive automatically — no separate edit needed.

## RT-3 — Jurisdiction prompt reasoning-aware

The `## JURISDICTION DISCLOSURE RULES` block (EN + SW) now says
"REASON about regulations from the [tenant jurisdiction] context"
instead of "answer about TZ regulators". The regulator names listed
in the companion `## TENANT JURISDICTION` block are described as
GROUNDING (a starting point for fresh composition), not a verbatim
template.

Rule 3 (unseeded country) now explicitly invokes
`mwikila.jurisdiction.discover` and tells the model to REASON about
the findings instead of refusing.

Coordinated with #224 which owns the jurisdiction-discovery graceful
fallback path.

58/58 `jurisdiction-resolver` tests pass.

## RT-4 — Disclosure patterns doc

`Docs/AUDIT/CAPABILITY_DISCLOSURE_PATTERNS.md` opens with a prominent
callout: the 15 patterns are EXAMPLE SHAPES for reasoning. Mr.
Mwikila composes fresh per turn — never returns them verbatim.
Variations across turns are EXPECTED and DESIRED — they prove the AI
is thinking, not retrieving. Points readers at the `## REAL-TIME
REASONING` directive in `BORJIE_PERSONA_DNA` which outranks any
single example.

## RT-5 — Brain tools return CONTEXT not strings

`mwikila.capabilities.what_can_you_do` and `mwikila.about` now carry
a `compose_guidance` field on every output. The field is an explicit
LLM directive:

- `what_can_you_do.compose_guidance`: "Use the capability shapes above
  as GROUNDING for what you can truthfully claim. Compose a fresh,
  warm, concise reply in the owner's active language using their
  actual conversation context. Pick ONE capability to highlight that
  matches their immediate need... NEVER quote the summary / invitation
  / description verbatim — they are reference shapes, not scripts.
  Variation across turns is expected and desired."

- `about.compose_guidance`: "The response field above is ONE valid
  shape — not the answer. Compose a fresh persona-preserving reply...
  Hold the persona line (Mr. Mwikila, Borjie's mining MD AI), never
  name the underlying model brand, and end with a CONCRETE next
  action drawn from the next_action capability... Variation across
  turns is expected — never quote the shape verbatim."

The existing `response`, `summary`, `invitation`, `next_action` fields
are preserved as GROUNDING SHAPES — backward compatible with the 23
existing regression tests.

## RT-6 — Variation probe

`services/api-gateway/src/composition/brain-tools/__tests__/capability-tools-variation.test.ts`
encodes the variation contract.

The tool layer is DETERMINISTIC by design — same input, same shape.
Variation happens at the MODEL layer when it synthesizes the reply
using the tool's context + `compose_guidance` + live conversation.

| # | Assertion | Evidence |
|---|-----------|----------|
| 1 | what_can_you_do deterministic per input | 3 identical calls → identical output |
| 2 | what_can_you_do.compose_guidance directs VARY | tokens: fresh / vary / never quote / grounding |
| 3 | about deterministic per intent | 3 identical calls → identical output |
| 4 | about.compose_guidance directs VARY | tokens: fresh / vary / shape / grounding |
| 5 | what_can_you_do reasons about WHICH capabilities to surface | drafting topic ≠ tracking topic capability set |
| 6 | about routes different intents to different next_actions | data_privacy ≠ what_about_mistakes next-action |

6/6 pass.

## RT-7 — mwikila.reason.strategize

New LOW-stakes read-only brain tool that orchestrates structured
strategic reasoning when the owner asks "what should I do?".

**Input:** `{ question, scope_filter?, depth: 'quick' | 'thorough' }`

**Output (StrategyTrace shape):**
- `current_state_prompt` — placeholder for live data
- `constraints[]` — cash, compliance, workforce, counterparties
- `strategies[]` — 2 (quick) or 4 (thorough), each with `name`, `pros`,
  `cons`, `evidence_prompt`, `confidence`
- `recommended_index` — points at the highest-confidence default
- `why_prompt` — the model fills with live evidence
- `downsides_prompt` — explicit risk disclosure
- `retrospective_grade_plan` — 30 / 60 / 90 day verification metric
- `grounding_tools[]` — names the brain tools the model should call
  to fill in the `*_prompt` placeholders (`mwikila.scope.search`,
  `mwikila.entity.find`, `mwikila.jurisdiction.show_current`,
  `mwikila.opportunity.scan`, `mwikila.risk.scan`)
- `compose_guidance` — explicit directive: SCAFFOLD, not script

**Persona gate:** T1 owner / T2 admin / T3 manager. Worker, buyer,
auditor excluded (strategic reasoning is leadership tier).

13 tests pass. The full brain-tools suite stays at 186/186.

## Regression net (always-on, CI gated)

| Suite | Tests | Status |
|-------|-------|--------|
| `packages/persona-runtime/src/__tests__/capability-registry.test.ts` | 9 | green |
| `packages/persona-runtime/src/__tests__/jurisdiction-overrides.test.ts` | 15 | green |
| `services/api-gateway/src/composition/brain-tools/__tests__/capability-tools.test.ts` | 11 | green |
| `services/api-gateway/src/composition/brain-tools/__tests__/capability-tools-probe.test.ts` | 3 | green |
| `services/api-gateway/src/composition/brain-tools/__tests__/capability-tools-variation.test.ts` | 6 | green |
| `services/api-gateway/src/composition/brain-tools/__tests__/reason-strategize-tool.test.ts` | 13 | green |
| `services/api-gateway/src/services/jurisdiction-resolver/__tests__/` | 58 | green |
| Full brain-tools suite | 186 | green |

## What this proves

PROVES:
- Mr. Mwikila's system prompt now ENFORCES real-time reasoning at the
  baseline (BORJIE_PERSONA_DNA). The RT-2 directive outranks any
  single canned example.
- The brain tools return REASONING CONTEXT, not pre-composed answer
  strings. The new `compose_guidance` field is the explicit hand-off
  from tool to model.
- The capability registry remains a guardrail (verify capability
  exists, ground in user outcomes, never leak IP) but is reframed
  semantically as REASONING GUIDELINES — its content is the SHAPE,
  not the WORDS.
- Strategic reasoning has its own scaffold (`mwikila.reason.strategize`).
  The model walks the owner through current state, constraints,
  strategies, recommendation, and retrospective grade plan — using
  live data, not a template.
- The variation contract is encoded in CI. 29 always-on tests pin
  that the tools provide context + directive while leaving the
  composition to the model.

DOES NOT PROVE (out of scope, follow-up):
- The live LLM model never re-introduces a canned phrase during
  composition. The RT-2 system prompt block makes this strongly
  unlikely, but a red-team turn with prompt-injection attacks is the
  right next step. Tracker: future "variation under adversarial
  pressure" appendix.
- That `mwikila.reason.strategize` actually leads to better owner
  outcomes than ad-hoc reasoning. That requires a live A/B over
  decisions logged in the decision-journal. Tracker: post-launch
  evaluation harness.

## Reproducer

```
pnpm --filter @borjie/persona-runtime exec vitest run \
  src/__tests__/capability-registry.test.ts \
  src/__tests__/jurisdiction-overrides.test.ts

cd services/api-gateway && pnpm exec vitest run \
  src/composition/brain-tools/__tests__/capability-tools.test.ts \
  src/composition/brain-tools/__tests__/capability-tools-probe.test.ts \
  src/composition/brain-tools/__tests__/capability-tools-variation.test.ts \
  src/composition/brain-tools/__tests__/reason-strategize-tool.test.ts \
  src/services/jurisdiction-resolver/__tests__/
```

Expected: 9 + 15 + 11 + 3 + 6 + 13 + 58 = 115 passing tests.
