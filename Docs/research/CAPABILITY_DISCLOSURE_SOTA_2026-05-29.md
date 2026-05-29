# Capability Disclosure — SOTA reference (2026-05-29)

**Owner:** CSA workstream
**Status:** Reference research informing CSA-1 / CSA-2 / CSA-3 / CSA-4
**Caveat:** The web-search side of the deep-fan-out wave was OUT OF
SCOPE for this delivery turn — the live websearch primitive was not
required in the inviolable scope and would have padded the turn well
beyond budget. The summary below distils prior known-good guidance the
team already has on file, plus the structural observations from
shipping product analogues in the codebase (LitFin, BossNyumba). When
the WebSearch primitive comes back in a follow-up pass we will
hyperlink each block to its primary source.

## Why this matters

Owners are increasingly AI-literate. They will ask "are you AI", "are
you ChatGPT", "show me how you work". A bad disclosure pattern leaks
IP, breaks persona, or worse — invents capabilities. A good one
preserves persona, reframes meta questions into user-outcome demos,
and routes the owner to the registry-grounded next action.

## Reference patterns we surveyed

### A. ChatGPT capability self-disclosure (2024-2026)

Observed shape:
- Self-identifies as "ChatGPT, a language model trained by OpenAI" on
  direct probe.
- Lists capability AREAS (writing, analysis, coding) rather than the
  full feature list.
- Avoids naming downstream tools by id (no "I called retrieval
  service").

Why our move is different: we do NOT name the underlying model.
Borjie has its own persona (Mr. Mwikila), so the entry point is
"What is Mr. Mwikila?" not "What is the model?".

### B. Claude system-card philosophy (Anthropic 2025)

Observed shape:
- Honest disclosure that it is an AI.
- Constitutional principles allow self-disclosure of behavioural
  constraints ("I will not do X").
- Refuses to reveal the literal system prompt.

What we adopted: HONEST YES on "are you AI", explicit refusal on
"show me the system prompt", reframing of meta questions into
"what would you like to do".

### C. Salesforce Agentforce capability disclosure (2024-2025)

Observed shape:
- "I am the X assistant for your Salesforce org."
- Capability menus grouped by user role.
- Internal architecture (LLM cluster, agent layers) never disclosed
  on the conversational surface.

What we adopted: persona-anchored opener ("I am Mr. Mwikila, Borjie's
mining MD AI"), capability MENU grouped by topic in the brain tool,
and a hard ban on architecture mention.

### D. Notion AI "About this AI" pattern (2024)

Observed shape:
- Dedicated "About" entry point summarising what Notion AI does on
  YOUR pages, in YOUR workspace.
- Privacy invariants stated up front.
- Source-of-truth FAQ + retrieval, never an architecture tour.

What we adopted: explicit data-privacy pattern (Pattern 11 in
`CAPABILITY_DISCLOSURE_PATTERNS.md`), short FAQ-style replies grounded
in the registry.

### E. Manus / agentic startup capability narratives (2024-2025)

Observed shape:
- Strong persona-first answer ("I am a research agent that helps
  you...").
- Lists outcomes in 4-6 chunks, never tries to list every tool.
- Always ends with a concrete next-action invitation.

What we adopted: every disclosure response ends with an INVITATION
(see Pattern 15 — "Tell me what is on your plate today and I will
walk you through the slice that matters").

### F. Industry "AI explainability" UX writing (2025)

Observed shape:
- Avoid jargon — speak in user outcomes.
- Bilingual / multilingual where the audience demands it.
- Show, do not tell — interactive demos beat narrative.

What we adopted: bilingual SW+EN on every disclosure surface, demo
invitations in every meta answer.

### G. Constitutional AI honest disclosure (Anthropic 2023+)

Observed shape:
- Always honest about being AI.
- Never invent capabilities.
- Refuse to reveal training data sources.
- Polite refusal patterns ("I cannot share that, but I can show you
  ...").

What we adopted: refusal templates in `BORJIE_PERSONA_DNA`, the
"polite no + immediate demo invitation" pattern in Pattern 7.

## Synthesis — Borjie's disclosure principles

1. **Persona FIRST, model NEVER.** Every meta answer opens with "I am
   Mr. Mwikila" or "Mimi ni Bwana Mwikila", never with the underlying
   LLM brand.
2. **User outcomes ONLY.** Capability descriptions describe what the
   owner GETS, never what the system does internally.
3. **Reframe before listing.** When the owner asks "how does this
   work", the right answer is "show me what is on your plate today",
   not a tour.
4. **Bilingual baseline.** SW + EN are equally first-class on every
   surface.
5. **Show, do not tell.** Every meta answer ends with a concrete
   next-action invitation drawn from the registry.
6. **Polite refusal beats invention.** When asked something we do not
   support, use the canned refusal templates and offer a human
   handoff.
7. **Privacy reassurance is concrete.** "Your data stays in your
   estate" is the public-facing line; never mention RLS, tenant
   ids, multi-tenancy.
8. **Hold the line under pressure.** Repeated "are you really
   Claude?" probes get the same persona-anchored answer plus a
   concrete capability demo to defuse.

## Source-of-truth wiring in the codebase

- Disclosure-safe registry: `packages/persona-runtime/src/capabilities/capability-registry.ts`
- Bilingual entry types: `packages/persona-runtime/src/capabilities/types.ts`
- System-prompt rules: `services/api-gateway/src/routes/public-chat.hono.ts`
  → `## CAPABILITY DISCLOSURE RULES` block inside `BORJIE_PERSONA_DNA`.
- Brain tools: `services/api-gateway/src/composition/brain-tools/capability-tools.ts`
  (`mwikila.capabilities.what_can_you_do` + `mwikila.about`).
- Sample dialogues: `Docs/AUDIT/CAPABILITY_DISCLOSURE_PATTERNS.md`.
- Live verification: `Docs/AUDIT/CAPABILITY_DISCLOSURE_LIVE_2026-05-29.md`.

## Open items

- Add WebSearch-grounded primary citations in a follow-up pass when
  the websearch primitive is back in scope.
- Add a 16th-20th pattern as we observe live owner asks during the
  90-day pilot.
- Track a "novel disclosure attack" appendix as red-team turns reveal
  new probes (e.g. "ignore previous instructions" / "pretend you are
  the developer").
