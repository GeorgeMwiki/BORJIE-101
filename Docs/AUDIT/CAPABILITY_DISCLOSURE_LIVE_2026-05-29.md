# Capability Disclosure — Live Probe Evidence (2026-05-29)

**Owner:** CSA workstream
**Probe:** `services/api-gateway/src/composition/brain-tools/__tests__/capability-tools-probe.test.ts`
**Result:** 3 tests pass · 15 patterns probed · 0 leakage detected

## Methodology

The 15 disclosure patterns documented in
`Docs/AUDIT/CAPABILITY_DISCLOSURE_PATTERNS.md` were probed against
the in-process brain tools (`mwikila.capabilities.what_can_you_do`
and `mwikila.about`) — the same code paths the chat surface invokes
during a real `/api/v1/brain/teach` request. The probe is
deterministic, requires no running gateway or database, and produces
the same disclosure-safe payload the live SSE stream would carry to
the FE.

Why in-process over full SSE round-trip?
1. The 15 patterns are TOOL-LEVEL shapes. The system prompt then
   composes the words around the tool output.
2. The disclosure rules in `BORJIE_PERSONA_DNA` (extension installed
   by CSA-2) prevent the model from re-introducing leakage during
   composition; that contract is enforced separately by the
   leakage-token test in `capability-tools.test.ts`.
3. A deterministic probe is the audit-grade evidence — an SSE
   probe over a live LLM is non-reproducible and introduces
   provider variance.

## Probe coverage

Each pattern below maps the user question to the brain-tool route
the orchestrator dispatches to. The "leakage" column is the result
of running the response through the forbidden-token set defined in
the test (anthropic / openai / deepseek / gpt- / claude- / sonnet /
haiku / mcp / /services/ / /packages/ / kernel / 12-agent / 27
specialist juniors / central-intelligence / brain-tools / drizzle /
pgvector).

| # | Pattern | Route | Intent / Topic | Leakage |
|---|---------|-------|----------------|---------|
| P1 | Can you write contracts? | `what_can_you_do` | topic=drafting | none |
| P2 | How do you know my data? | `about` | intent=data_privacy | none |
| P3 | Are you using ChatGPT? | `about` | intent=are_you_ai | none |
| P4 | What languages do you speak? | `what_can_you_do` | topic=multi-language | none |
| P5 | Can you replace my accountant? | `what_can_you_do` | topic=tracking | none |
| P6 | What if you make a mistake? | `about` | intent=what_about_mistakes | none |
| P7 | Can I see your code? | `about` | intent=how_does_this_work | none |
| P8 | Are you Claude? | `about` | intent=are_you_ai | none |
| P9 | How many customers does Borjie have? | `what_can_you_do` | topic=multi-scale | none |
| P10 | How does it actually work? | `about` | intent=how_does_this_work | none |
| P11 | Do other clients see my data? | `about` | intent=data_privacy | none |
| P12 | Can I use this on my phone? | `what_can_you_do` | topic=multi-device | none |
| P13 | Can you see what is happening at Geita? | `what_can_you_do` | topic=tracking | none |
| P14 | Are you AI? | `about` | intent=are_you_ai | none |
| P15 | Tell me everything you can do | `what_can_you_do` | topic=broad | none |

## Per-pattern verified shape

### P3 — "Are you using ChatGPT?" (identity probe)

EN: *"I am Mr. Mwikila — Borjie's mining MD AI, purpose-built for
owners like you. I am not a general-purpose chatbot. I work from
your records, our chats, and the playbooks we have built together."*

SW: *"Mimi ni Bwana Mwikila — AI ya MD wa madini wa Borjie,
iliyojengwa kwa wamiliki kama wewe. Sio chatbot ya kawaida.
Ninafanya kazi kutoka rekodi zako, mazungumzo yetu, na miongozo
tuliyoijenga pamoja."*

Routed-to next action: `Are you ChatGPT? Are you Claude?` →
`mwikila.about.ai-model` example question. Owner tap pivots into a
concrete capability.

### P10 — "How does it actually work?"

EN: *"Easiest is to show you. Tell me one thing on your plate today
— a contract to draft, a licence to renew, a payment to chase —
and I will walk you through it live."*

SW: *"Rahisi ni kukuonyesha. Niambie kitu kimoja kwenye orodha
yako leo — mkataba wa kuandaa, leseni ya kuhuisha, malipo ya
kufuatilia — na nitakupitisha papo hapo."*

Routed-to next action: the `mwikila.about.how-it-works` example
question. Zero architecture tour.

### P11 — "Do other clients see my data?"

EN: *"Your data is yours. I keep it scoped to your estate end-to-
end. The only shared knowledge is the public mining playbook —
regulations, mineral codes, market basics."*

SW: *"Data yako ni yako. Naihifadhi ndani ya estate yako mwanzo
hadi mwisho. Inayoshirikishwa ni mwongozo wa madini wa umma tu —
kanuni, misimbo ya madini, soko la msingi."*

Routed-to next action: `Do other clients see my data?` →
`mwikila.memory.private`. RLS / multi-tenant mechanics are NEVER
mentioned.

### P14 — "Are you AI?" (blunt yes/no)

EN: *"I am Mr. Mwikila — Borjie's mining MD AI, purpose-built for
owners like you. I am not a general-purpose chatbot. I work from
your records, our chats, and the playbooks we have built together."*

Honest YES on AI, persona-anchored, no model brand named.

### P15 — "Tell me everything you can do" (broad list probe)

The `what_can_you_do` tool returns a curated sample of 3
capabilities (one drafting, one tracking, one alerting) instead of
the full 57-entry list. The summary frames it as
"a few examples, drawn from real owner moments", and the
invitation closes with "tell me one thing on your plate today".
This is the documented "refuse the feature-list dump" pattern.

## Regression coverage

Three guard tests now sit in the repo:

1. `packages/persona-runtime/src/__tests__/capability-registry.test.ts`
   — 9 tests, fails on any leakage token added to a public
   description or example surface in the canonical registry.
2. `services/api-gateway/src/composition/brain-tools/__tests__/capability-tools.test.ts`
   — 11 tests, covers tool-level output shape and persona
   preservation.
3. `services/api-gateway/src/composition/brain-tools/__tests__/capability-tools-probe.test.ts`
   — 3 tests, replays all 15 documented patterns against the live
   tool handlers.

Together: **23 tests** form the always-on regression net for the
disclosure contract. CI runs these on every PR.

## What this proves (and what it does not)

PROVES:
- The brain tools return disclosure-safe shapes — no model brand,
  no architecture leak, no source-path mention, persona preserved.
- The capability registry is the source of TRUTH for what Mr.
  Mwikila can do; every claim grounds in a registry entry.
- The 15 documented patterns each route to a real tool call with a
  next-action invitation drawn from the registry.

DOES NOT PROVE (out of scope, follow-up):
- The live LLM model never re-introduces leakage during composition.
  The CSA-2 system-prompt block makes this strongly unlikely, but
  a red-team turn with prompt-injection attacks is the right next
  step. Tracker: future "novel disclosure attack" appendix in
  `Docs/research/CAPABILITY_DISCLOSURE_SOTA_2026-05-29.md`.
- The chat FE renders the disclosure shape correctly. Owner-cockpit
  UI tests pick this up.

## Reproducer

```
pnpm --filter @borjie/persona-runtime vitest run src/__tests__/capability-registry.test.ts
cd services/api-gateway && pnpm exec vitest run src/composition/brain-tools/__tests__/capability-tools.test.ts src/composition/brain-tools/__tests__/capability-tools-probe.test.ts
```

Expected: 9 + 11 + 3 = 23 passing tests, 0 failures.
