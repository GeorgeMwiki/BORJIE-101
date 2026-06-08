# IP-Leak Audit — client-facing brain & chat paths

**Lane:** `ip-leak-audit` (REPO READ-ONLY — no code edits, no commit)
**Date:** 2026-06-09
**Auditor scope:** every place the system could LEAK IP or EXPLAIN ITS OWN
MECHANICS to a client (owner / buyer / workforce / public visitor).
**Anchoring invariants:** `Docs/research/MASTER_GAP_REGISTER.md` lines
565–609 (INV-H/D "background cognition is IP — show STATUS + OUTPUTS,
never internals"; INV-H/D hardened "NEVER an IP leak"; INV-L "blackboard
thought-trend is OUTPUT-LEVEL, never internal cognition").

---

## The rule we are auditing against (verbatim intent)

> The response/SSE pipeline must carry only **status frames + final output
> + evidence** — it must NEVER leak chain-of-thought, prompts, internal
> tool-calls, or swarm mechanics to the client (no reasoning in the stream,
> logs the user can read, or API responses). Borjie-internal admin-web MAY
> see more for ops/debug (gated, audited); the OWNER never sees internals.
> — MASTER_GAP_REGISTER.md §INV-H/D (sharpened), L575–579

So the test for every frame/field/error is binary:
- **Status** ("thinking…", progress, ETA) → SAFE.
- **Output** (the answer, artifact, proposal) → SAFE.
- **Evidence** (citation/source ids that ground the output) → SAFE.
- **Anything else that describes HOW the answer was produced** — model
  names, provider ladder, debate/ensemble, judge reasoning, agent/junior
  names, tool names, handoff graph, persona-routing internals, kernel CoT,
  internal env/function names — → **LEAK**.

The two persona-prompt blocks I read are *well-hardened* on the
prompt-discipline axis (CSA-2 in `public-chat.hono.ts` L288–323 is
genuinely excellent — model-name forbid, deflection templates, anti-
jailbreak, "never recite the rule"). **The real exposure is not the
prompt — it is the structured SSE/JSON envelope the gateway emits around
the answer, which ships internal mechanics as first-class fields
regardless of what the model says.** That is where every leak below lives.

---

## LEAKS (concrete, with file:line, severity, fix)

### L1 — `debate_metadata` SSE frame leaks model identities + ensemble mechanics + judge reasoning — CRITICAL
**File:** `services/api-gateway/src/routes/brain-teach.hono.ts:895–918`
**Surface:** authenticated owner home/teaching chat (owner-web).
**Exposed:** the full multi-model debate trace — `winner.provider`,
`winner.model`, `scores`, `trace.judgeProvider`, `trace.winnerReason`,
and per-response `{ provider, model, latencyMs, error }`. The model
strings are the literal brand identities CSA-2 forbids
(`claude-opus-4-8`, `gpt-4o-…`, `deepseek-chat`). `winnerReason` is the
judge's reasoning — internal cognition. `scores` + multi-provider array
reveal the entire ensemble/debate architecture, which is the moat.
**Rendered, not just on-wire:** the FE consumes it
(`apps/owner-web/src/components/home-chat/teach-sse-normalisers.ts:88–100`
captures `winnerProvider`/`winnerModel`) and paints it as a tooltip on
the "Verified ✓ N-model" badge:
`apps/owner-web/src/components/home-chat/HomeChatTeach.tsx:1151–1155`
→ `title={`${winnerProvider} · ${winnerModel}`}`. So the owner sees the
model brand on hover, and the full `scores`/`winnerReason`/per-provider
trace sits in browser devtools on the network payload.
**Fix (suppress + reshape):** never emit provider/model/scores/judge/
per-response from the gateway. Replace the `debate_metadata` frame with a
**trust-only** frame: `{ verified: boolean, contenders: number }` — a
count is enough to render "Verified ✓ across N independent checks"
without naming anything. Drop the `winner`, `trace`, `scores` keys
entirely. On the FE, remove `winnerProvider`/`winnerModel` from
`DebateBadge` and delete the tooltip `title`. "N-model" copy is itself
borderline (it hints at the ensemble) — prefer "independently verified"
to "N-model".

### L2 — `tool_call` SSE frames + `toolCalls`/`handoffs` JSON fields leak internal tool/junior names + the multi-agent handoff graph — HIGH
**Files:**
- SSE projector: `services/api-gateway/src/routes/brain.hono.ts:317–325`
  (`tool: evt.name`, `args: evt.args`, and
  `tool: \`handoff:${evt.from}->${evt.to}\``).
- SSE emitter: `services/api-gateway/src/routes/brain.hono.ts:1553–1568`
  (`tool: tc.tool`; `tool: \`handoff:${h.from}->${h.to}\``).
- JSON turn response: `services/api-gateway/src/routes/brain.hono.ts:1436–1438`
  and `1468–1470` ship `handoffs`, `toolCalls`, `advisorConsulted`
  straight to the client.
**Surface:** owner-web ("Ask" + home) and buyer-mobile both consume them
(`apps/buyer-mobile/src/chat/brainTurn.ts:303–309`,
`apps/owner-web/src/lib/brain-api.ts:63–67`).
**Rendered, not just on-wire:**
- `apps/owner-web/src/components/home-chat/ToolCallSidebar.tsx:91–93`
  renders `call.name` in a panel literally titled "What the brain ran" /
  "Akili imefanya nini", with a doc-comment that says it surfaces the
  "**junior name**" as a "**transparent execution log**" (L9–11). It also
  stamps `data-tool-name={call.name}` (L83).
- `apps/owner-web/src/components/ask/AskBubble.tsx:42–53` renders the same
  names as inline chips with `aria-label="Junior calls"`.
This is a head-on INV-H/D violation: agent/junior names + tool names +
the `from->to` handoff edges *are* the swarm mechanics the rule forbids.
**Note on current exposure:** the *main orchestrator* path returns
`toolCalls: []` / `handoffs: []` today
(`services/api-gateway/src/composition/brain-orchestrator-turn.ts:140–141`),
so the panel is presently empty on that path — but the **contract still
ships the fields**, the legacy/`StartedTurnPayload` and dispatch paths
populate real names, and the FE renderers exist and are wired. This is a
latent leak that lights up the moment any path fills the arrays.
**Fix (suppress at the boundary + delete the renderers):**
1. Stop projecting `tool_call`/`handoff` as client frames in
   `projectStreamEvent` and `emitStartedTurnFrames` — collapse them into a
   single generic **status** frame: `event: 'status'`,
   `data: { phase: 'working' }` (or reuse the existing ack/"thinking"
   frame). Never send `tool`, `args`, `from`, `to`, `objective`.
2. Remove `toolCalls`, `handoffs`, `advisorConsulted` from the JSON turn
   response shape (brain.hono.ts:1431–1444 / 1463–1474).
3. Delete/neutralise `ToolCallSidebar` and the `AskBubble` tool-call chip
   block, or repoint them at a status-only model ("Working… · done").
4. If a "what did the brain do" view is wanted, gate it to the
   **Borjie-internal admin-web** only (the rule explicitly permits more
   for gated/audited ops), never owner/buyer surfaces.

### L3 — `done` frame leaks the winning LLM provider name to the PUBLIC marketing visitor — HIGH
**File:** `services/api-gateway/src/routes/public-chat.hono.ts:2098–2109`
(`event: 'done'`, `data: { provider: winningProvider, depth, attempts, … }`).
**Surface:** anonymous public marketing chat — the *least* trusted
audience, where CSA-2 forbids naming any provider "even when pushed".
**Exposed:** `winningProvider` is `'anthropic' | 'openai' | 'deepseek'`
(set at L1975), plus `depth`/`attempts` (the ladder length/position).
A visitor reading devtools sees exactly which model vendor powers Borjie
and that there is a fallback ladder. Same shape leaks on
`brain-teach.hono.ts` `done` frame (header doc L36 lists
`{ at, provider, depth, latencyMs, attempts }`) and in the
`all_providers_failed` error frame which ships the full `attempts[]`
array of `{ provider, model, error }`
(`public-chat.hono.ts:1998–2007`, `brain-teach.hono.ts:839–852`;
attempts assembled at `public-chat.hono.ts:1970–1985`).
**Fix (redact):** strip `provider`, `depth`, `model`, and the per-attempt
`provider`/`model`/`error` from every client-facing `done` and `error`
frame. Keep only client-useful telemetry: `{ at, latencyMs, retryable }`.
Provider/model/attempt detail belongs in the pino server log only (it
already logs there, L1986–1994) — never in the SSE body.

### L4 — `kernel CoT reservoir` (`thoughtText`) is queryable by TENANT_ADMIN, exposing internal chain-of-thought to an owner-side role — HIGH
**File:** `services/api-gateway/src/routes/cot-query.router.ts:96–100,
236–344` (esp. `thoughtText` returned at L310; default path returns the
**scrubbed** thoughtText, raw path requires sovereign scope).
**Why it is a leak:** the role gate `ADMIN_ROLES` includes
`UserRole.TENANT_ADMIN` (L99). TENANT_ADMIN is an **owner-side** admin,
not a Borjie-internal operator. The default response still returns
`thoughtText` (the kernel's chain-of-thought, merely PII-scrubbed, not
mechanics-scrubbed) plus `stakes`, `promptHash`, `responseHash`. Per
INV-H/D the OWNER never sees internals — and CoT is the canonical
internal. PII-scrubbing removes *personal data*; it does **not** remove
*IP* (the reasoning text, prompt/response hashes, stakes labels are all
internal-mechanics signal).
**Mitigating context:** raw text needs the `cot:read:raw` sovereign scope
(L107, four-eye provisioned) and the route is JWT-gated; this is a
compliance/DSAR surface by design. The exposure is the *default scrubbed*
read reaching a tenant admin, not an open hole.
**Fix (restrict the audience):** drop `TENANT_ADMIN` from the roles that
can read `thoughtText` — restrict CoT reads to Borjie-internal
`SUPER_ADMIN`/`ADMIN` (platform) only, matching the "admin-web MAY see
more, owner never" rule. If a tenant *must* exercise a DSAR over CoT,
return only a redacted **existence + category** view (counts,
scrubbedCategories, timestamps), never the `thoughtText` body, to a
tenant-side caller. Keep the full-text path platform-internal + audited
(the audit emission at L321 is already correct).

### L5 — error/503 messages name the model provider + internal env-vars/function names — MEDIUM
**Files:**
- `services/api-gateway/src/routes/mining/brain-vision.hono.ts:388–390`
  ("Anthropic vision capability is disabled. Set
  `ANTHROPIC_VISION_ENABLED=true` to enable.") → names the provider
  (Anthropic) and an internal env-var to the buyer/owner client.
- Same file L411 ("…must call `setBrainResolver(...)` before this
  endpoint is reachable") → leaks an internal function name.
- Same file L496–503 returns raw `startResult.error.code`
  (`VISION_UNSUPPORTED_MODEL`) + raw `error.message` to the client.
- `brain.hono.ts:489` (no-provider message names
  `ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY`) — reachable on
  the SSE `error` frame when nothing is configured.
**Why:** these are operator-facing diagnostics that escaped onto the
client envelope. They name the provider and internal wiring — exactly the
"how I'm built" signal the rule forbids in "any … error message" path
(MASTER_GAP_REGISTER §INV-H/D hardened, L587).
**Fix (deflect via generic copy):** replace with a vendor-neutral
client message ("Photo analysis is temporarily unavailable. Please try
again shortly.") + a stable `code` for the FE to branch on
(`VISION_UNAVAILABLE`). Keep the provider/env-var/function detail in the
pino log only. The codebase already has the right primitive —
`scrubMessage`/`safeInternalError`/`routeCatch`
(`services/api-gateway/src/utils/safe-error.ts:40–118`) returns a generic
literal in prod; these hand-rolled 503s simply bypass it. Route them
through `safeInternalError` / a constant.

### L6 — JSON turn + SSE `done` ship `finalPersonaId` / `advisorConsulted` — MEDIUM
**Files:** `services/api-gateway/src/routes/brain.hono.ts:1434, 1438,
1467, 1470` (JSON) and `:344–353, 1593–1603` (SSE `done`
`finalPersonaId`, `advisorConsulted`).
**Why:** `finalPersonaId` (e.g. `mr-mwikila`, `owner_strategist`,
`borjie`, `compliance`) exposes the internal persona-routing layer — that
the system *switches personas* and which one "won" the turn is swarm/
routing mechanics. `advisorConsulted: true/false` reveals an internal
advisor-consultation step. Consumed in
`apps/owner-web/src/lib/brain-api.ts:264–269`.
**Severity nuance:** `mr-mwikila` alone is the *public brand face* (safe);
the leak is the *routing* signal — that there are multiple personas and a
selection among them, and the internal ids (`owner_strategist`,
`compliance`) that are not the public face.
**Fix (redact):** drop `finalPersonaId` and `advisorConsulted` from
client envelopes. If the FE needs the avatar/name, send a single fixed
public identity (`"Mr. Mwikila"`) decoupled from the internal persona id —
never the internal routing result.

### L7 — `brain_state` "degraded mode" pill reveals a fallible LLM-ladder underneath — LOW
**File:** `services/api-gateway/src/routes/brain-teach.hono.ts:544–551`
("Brain operating in degraded mode" / "Ubongo umepungua nguvu"), rendered
at `HomeChatTeach.tsx:1167–1175`.
**Why:** an honest reliability signal, but "degraded mode" + the
`consecutiveFailures` count hints the product is an LLM stack with a
provider ladder that can fail — a small crack in the "deterministic
service" posture. It does not name a model, so it is LOW, not HIGH.
**Fix (soften copy, drop count):** keep a status pill but make it
outcome-shaped, not internals-shaped: "Some answers may be delayed —
working on it." Remove `consecutiveFailures` from the client payload
(keep it in logs). This preserves honesty without narrating the ladder.

### L8 — `proposed_action.description` is built from internal verb/object + `executionHeld` exposes the hold mechanic — LOW
**File:** `services/api-gateway/src/routes/brain.hono.ts:326–339` and
`1578–1591` (`description: \`${verb} ${object}\``, `executionHeld`,
`reviewRequired`).
**Why:** `executionHeld`/`reviewRequired` are output-level governance
status (the user genuinely needs to know an action awaits confirmation) —
mostly SAFE. The only risk is if `verb`/`object` are *internal* tool/verb
identifiers rather than human phrasing. Verify the verb/object are the
human-readable action ("file royalty draft"), not an internal opcode
(`ledger.post`, `licence_watcher.renew`).
**Fix (validate, not necessarily remove):** ensure the description is
domain language, not an internal symbol. `reviewRequired`/`executionHeld`
are fine to keep (governance status = output-level).

### NON-LEAKS verified (so they are not "fixed" by mistake)

- **Vision `reasoning` field**
  (`brain-vision.hono.ts:158, 243, 251`, rendered as the photo-advisor's
  domain explanation) is **OUTPUT-LEVEL** reasoning *about the ore/defect*
  — the model explaining the domain finding, not its own cognition. SAFE
  per INV-L. (Same for `MarketIntelligencePanel` `reasoning` — causal
  buy/sell rationale is output-level.)
- **`auditor` SSE frame**
  (`brain.hono.ts:1524–1539`: `verdict`, `evidenceCount`, `auditLogId`,
  `evidenceWarning`, `enforced`, `mode`) is **evidence/trust metadata** —
  it grounds the output, does not narrate cognition. SAFE.
- **Citations / `evidence_ids`** across all surfaces — SAFE (evidence is
  explicitly the one internal-adjacent thing the rule blesses).
- **`/api/v1/mining/internal/decision-log`**
  (`decision-log.hono.ts:29`) exposes `branches`, `chosenRationale`
  (internal cognition) but is **SUPER_ADMIN/ADMIN-only** = Borjie-internal
  admin-web — explicitly permitted ("admin-web MAY see more, gated,
  audited"). SAFE as long as it never widens to tenant roles. (Contrast
  L4, where TENANT_ADMIN crosses the line.)
- **Persona-prompt CSA-2 block** (`public-chat.hono.ts:288–323`) and
  `INJECTION_RESISTANCE_INSTRUCTION` (`prompt-shield.ts:323–332`) are
  strong defenses, not leaks. (One stale-domain bug: prompt-shield L331
  still says "here to help with **property management**" — a BossNyumba
  leftover that mis-identifies the product; not an IP leak but a
  cross-domain identity bug worth fixing.)

---

## Blackboard "thought-trend" — is it a leak? (the INV-L question)

**Verdict: SAFE BY DESIGN if it carries OUTPUT-LEVEL artifacts only, and
the *current* wiring is on the safe side — but two guardrails must hold.**

What I checked: the blackboard is `packages/blackboard-sota` (CRDT slots,
0% wired / orphan per memory + EA-05 in this register), and the live
teaching path emits `board_element` SSE frames
(`brain-teach.hono.ts:966–975`) parsed from the model's own
`<board_add>` tags (`parseBoardElements`). So today the blackboard
accumulates **model-authored output blocks** (decisions, insights,
teaching steps, metrics) — these are *work-products*, not cognition.
That matches INV-L exactly: "the curated thread of DECISIONS, INSIGHTS,
work-products, and teaching steps over time — NEVER the internal
chain-of-thought/cognition" (MASTER_GAP_REGISTER L597–598).

The trend stays OUTPUT-LEVEL **iff**:
1. **The router that decides "blackboard-worthy" routes on OUTPUT
   semantics, never on cognition.** Route a *decision/insight/artifact/
   teaching-step* to the board; never route a *reasoning step / tool-call
   / agent-handoff / CoT fragment*. The board element must be the
   conclusion ("Royalty filing set for the 7th — gold 6%, TZS X"), never
   the derivation ("Geology junior queried, FX junior disagreed, judge
   picked…").
2. **No leaky frame is allowed to land on a board slot.** Specifically:
   the L1 `debate_metadata`, L2 `tool_call`/`handoff`, and the kernel
   `thoughtText` (L4) must be structurally barred from ever being written
   as a board element. The board's append API should accept only the
   curated artifact schema (decision/insight/metric/teaching-step/doc),
   not arbitrary brain frames.

**Engineering keystone for keeping it output-level:** make the board's
write-contract a *typed artifact union* (DecisionCard | Insight | Metric |
TeachingStep | DocRef) with NO field for reasoning/tool/agent/model. If a
value cannot be expressed as one of those output types, it does not belong
on the board. That makes "output-level only" a *compile-time* property of
the trend, not a reviewer's judgement call — which is the only way it
survives contact with the live ensemble (cf. the localization
"zero-mixing-by-construction" pattern in memory). The trend then becomes a
genuine moat asset (the owner's reviewable work-history) with the cognition
kept entirely behind it.

---

## SOTA deflection / redaction patterns (the fix toolkit)

1. **Status-not-mechanics frame contract.** The client SSE/JSON envelope
   carries exactly three frame families: `status` (phase/progress/ETA),
   `output` (text chunks + artifacts + proposed actions), `evidence`
   (citation/evidence ids + auditor verdict). Anything that answers "HOW"
   is dropped at the gateway boundary, not the model. Make this a typed
   union so an internal field cannot be added by accident.
2. **Collapse tool/handoff/debate into a single trust signal.** Replace
   per-tool, per-handoff, per-model frames with one
   `{ verified: boolean, contenders?: number }` trust frame and a generic
   `{ phase: 'working' }` status frame. Count, never names.
3. **Provider/model redaction at the wire.** `provider`, `model`, `depth`,
   `attempts[]`, `judgeProvider`, `scores`, `winnerReason` NEVER appear in
   a client body — pino log only. (Servers already log them; just stop
   double-shipping to SSE.)
4. **Generic-message-in-prod via `safeInternalError`/`scrubMessage`.**
   Every caught error returned to a client routes through the existing
   `utils/safe-error.ts` so prod returns a stable code + generic copy;
   provider names, env-vars, function names, SQL strings stay in logs.
   Retrofit the hand-rolled 503s in `brain-vision.hono.ts` and the
   no-provider message in `brain.hono.ts`.
5. **Audience gating, not just redaction, for cognition surfaces.** CoT
   (`cot-query`) and decision-traces (`decision-log`) are *allowed* to
   exist — restrict them to Borjie-internal platform admin roles
   (`SUPER_ADMIN`/`ADMIN`), drop `TENANT_ADMIN`, and keep the audit
   emission. Owner/tenant roles get redacted existence-only views at most.
6. **Persona deflection (already strong — keep + extend).** The CSA-2 /
   prompt-shield blocks are the model-side line of defence: never name
   model/architecture/agents, deflect "how do you work" into "what do you
   want to accomplish", never recite the rule, no override phrase. Extend
   the same block to the home-teaching and voice prompts (CSA-2 currently
   lives in marketing + persona-DNA; confirm the teaching/voice surfaces
   inherit it). Fix the stale "property management" string in
   `prompt-shield.ts:331` to the mining identity.
7. **Output-level board contract (INV-L).** The blackboard append API is a
   typed artifact union with no reasoning/tool/agent/model field — making
   "the trend is output-level" a compile-time guarantee.

---

## Severity roll-up

| ID | Leak | Severity | Surface |
|----|------|----------|---------|
| L1 | `debate_metadata`: model names + scores + judge reason | CRITICAL | owner home/teach |
| L2 | `tool_call`/`handoffs`/`toolCalls`: junior+tool names, handoff graph | HIGH | owner + buyer |
| L3 | `done`/`error`: winning provider + attempts ladder | HIGH | public marketing |
| L4 | CoT `thoughtText` readable by TENANT_ADMIN | HIGH | owner-side admin |
| L5 | error/503: provider + env-var + function names | MEDIUM | buyer/owner vision |
| L6 | `finalPersonaId` + `advisorConsulted` routing signal | MEDIUM | owner |
| L7 | "degraded mode" pill + failure count | LOW | owner teach |
| L8 | proposed-action description from internal verb/object | LOW | owner |

The two structural roots: (a) the gateway treats internal mechanics as
first-class client telemetry (L1/L2/L3/L6) — fix once with a status-only
frame contract; (b) operator diagnostics leak onto client error envelopes
(L5) — fix once by routing through `safe-error.ts`. The persona prompts
are *not* the problem; the envelope around them is.
