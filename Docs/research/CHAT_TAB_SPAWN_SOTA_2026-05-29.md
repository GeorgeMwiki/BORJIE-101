# Chat-driven dynamic tab spawning + updating — SOTA scan, 2026-05-29

**Audience.** Borjie owner-cockpit (and mobile cockpit) — Mr. Mwikila has
to spawn / update / remove / propose tabs *from chat alone*, with
<500 ms cross-device sync and full evidence-cited proposals.

**Premise.** Existing `<spawn_tabs>` is one-shot "suggestion chip" only.
We need a richer protocol where four discrete brain-emitted SSE tags
drive real CRUD on the owner's tab strip across every device the owner
is signed in on.

## 1. Industry reference points (May 2026)

| Product                        | Mechanism                                                             | Notes                                                                                  |
| ------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Vercel v0 + AI SDK 3.0         | Streaming React Server Components ("Generative UI") emitted by tools  | Open-source — provides the streaming pattern but assumes RSC, not a thin descriptor.   |
| Notion AI (Apr 2026)           | "AI-assisted Dashboard" suggests chart / KPI cards from db properties | Closed source; programmatic Views API ships separately (CRUD on views).                |
| Linear Agent (Mar 2026)        | `@Linear` mentions, generates issues + applies labels                 | No client DSL — the agent calls the regular issue API. Custom views remain UI-driven.  |
| Anthropic SSE / Claude         | Typed events (`content_block_delta`, `message_stop`)                  | We sit on top: a *transcript* of XML tags inside the content stream.                   |
| LitFin "exploration" register  | Single `<ui_block>` per response                                      | We surpass by allowing multiple, additive tag types within one response.               |
| Retool AI / Glide AI           | LLM produces a JSON spec the host renders                             | We use the same shape but *evolve* (spawn → update → remove) within one conversation.  |

## 2. What we already ship

- `<spawn_tabs>` parser in `packages/owner-os-tabs/src/spawn-extractor.ts`
  catches one JSON blob with up to 3 candidate tabs (chip render only,
  *no auto-spawn*).
- `owner_tabs` jsonb store is a per-user key-value blob (`PUT /api/v1/
  owner/tabs`). The FE store (`apps/owner-web/src/lib/owner-tabs-store.
  ts`) owns the schema and has `spawnOrAugment` for dedupe.
- Cockpit SSE channel (`/api/v1/cockpit/stream`) multiplexes 23 event
  kinds (R6 + RT-1) — perfect substrate for cross-device tab pulses.
- 32 owner-OS tab types in `OWNER_OS_TAB_TYPES`.

## 3. SOTA delta for Borjie

We out-perform v0 / Notion / Linear by combining FOUR primitives the
others split across separate surfaces:

1. **`<tab_spawn>`** — async create. Idempotent via deterministic
   `(type | scoping-context)` id (matches existing dedup behaviour).
2. **`<tab_update>`** — partial PATCH of an existing tab. Brain emits
   when owner says *"actually, weekly view"*. No re-open, just patch.
3. **`<tab_remove>`** — soft-close. Brain may emit when owner says
   *"close that compliance tab"*.
4. **`<tab_proposal>`** — proactive, evidence-cited recommendation
   from pattern detection ("you drilled Mwadui royalties 3 times this
   week — pin it?"). Renders as accept/dismiss chip; one-tap accepts.

Each tag carries:
- `type` ∈ `OWNER_OS_TAB_TYPES` (33 today)
- `config` = JSON object validated per-type via zod (rejects
  hallucinated fields with a "doesn't apply" error chip).
- `title` (60 char cap, bilingual sw/en when supplied as `titleEn|titleSw`).
- For proposals: `reasonEn`, `reasonSw`, `evidenceIds` (cites LMBM /
  corpus chunk ids per CLAUDE.md grounding rule).

## 4. Multi-device sync architecture

`POST /api/v1/owner/tabs` (CRUD route) → publish `cockpit.tab.spawned`
on the in-process bus → every connected owner-web / cockpit-mobile gets
the event via the existing `/api/v1/cockpit/stream` SSE channel → store
reconciles by tabId. Reuses the bus we already have; no new
infrastructure. Target end-to-end latency: <500 ms.

Optimistic UI on the spawning device: dispatch a `spawn-or-augment`
action locally before the network round-trip; reconcile on confirm.
Failure path = local undo + toast.

## 5. Proactive suggestions

`tab_proposals_inbox` (migration 0141, tenant-RLS forced) is the
durable home. A `tab-suggester` service ticks hourly, scans owner
activity (search history, decision-journal drill-downs, mwikila-acted
patterns) and inserts proposals. The owner's next chat session
surfaces them as `<tab_proposal>` chips — accept binds to
`POST /api/v1/owner/tabs`, dismiss flips the row to `dismissed_at` so
it doesn't re-propose for 7 days.

Pattern detectors (v1):
- **drill-down repeat**: same `(type, focus)` opened ≥3 times in 7d.
- **navigation loop**: same `ui_navigate` route fired ≥4 times in 24h.
- **mwikila escalation**: ≥2 T0/T1 proposals on the same category in 7d.

All three cite specific row ids in `evidenceIds` so the proposal
chip is auditable per the Borjie grounding rule.

## 6. Hard rules honoured

- Pino logger only (no console.log).
- RLS forced on the new `tab_proposals_inbox` table.
- Zod-validated on every CRUD boundary.
- Audit chain row written via existing pattern on every tab CRUD.
- Bilingual sw/en for every owner-facing string (title, reason).
- Hallucinated fields → Pino warn + clean error chip (helps eval loop).

## 7. Out of scope (other agents own)

- Tab REORDER algorithm — Agent #201 (dynamic UI).
- Brain-tools orchestration mid-stream — Agent #202.
- We touch parsers + persistence + SSE + suggester ONLY.
