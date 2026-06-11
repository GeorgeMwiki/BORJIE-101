# Kernel persona-simplicity + INV-D code audit

**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Lane:** persona-simplicity + code audit (repo read-only; light web on conversational-agent UX)
**Scope:** (A) How all the backend cognition hides behind ONE human chat. (B) Map central-intelligence kernel + ai-copilot personas + sensors + orchestrator + autonomy-controller against the INV-D continuous cognitive cycle (PERCEIVE → ORIENT → ORGANIZE → CREATE → EXECUTE-TO-CLOSURE → LEARN), stage-by-stage, PRESENT|PARTIAL|ABSENT with file:line. Plus: is there a continuous backend loop today or only request-driven turns? Same picture reasoned for BossNyumba (shared spine, BN repo not opened).

> **Companion to** `Docs/research/MASTER_GAP_REGISTER.md` (132 consolidated gaps). This dossier is the persona-front + INV-D cycle view; it cross-references the register's COG/AUT/EA/MEM rows rather than re-deriving them.

---

## Part A — Persona simplicity: one chat over heavy autonomy

### A.1 The product invariant

The user only ever **chats** a persona (Mr. Mwikila / Borjie owner-advisor). Behind that single thread the backend runs a 12-agent kernel (think-pipeline, LATS, debate, reflexion, sensors, modality-arbiter), ~50 juniors, an Auditor gate, memory-v2, a proactive loop, and a wake-loop. **None of that surfaces as knobs.** The "no modes, no blockers" promise is real today in three concrete ways:

1. **No user-selected mode.** Persona lens(es) are classified INTERNALLY from the message — `classifyLenses(message)` in `@borjie/ai-copilot` (consumed by `services/api-gateway/src/routes/mining/chat-orchestrator.ts:64-68`). The owner never picks a CEO mode; the brain derives its own `MasterBrainMode`. Portal→persona is an O(1) deterministic lookup (`packages/ai-copilot/src/personas/persona-router.ts:1-7`), so the human never sees a persona switcher either.
2. **Rails are enforced backend, not exposed.** The 9-hook chain, permission-mode, four-eye approval, kill-switch, and the modality arbiter's autonomy decider all run INSIDE `think()` (`main-loop.ts:665-783`), surfaced to the user only as an occasional "I need your sign-off on X" — never as a settings page.
3. **One SSE contract.** The chat surface streams a single typed event union (`turn_accepted` / `junior_call` / `message_chunk` / `done` / `error` — `chat-orchestrator.ts:76-102`). The junior fan-out, evidence-id union, and conformal-confidence wrap are computed server-side; the user sees text + (optionally) a citation panel.

### A.2 Where it maps to 2026 SOTA conversational-agent UX

The pattern we are building toward is exactly the industry's **"ambient agent"** shape: an always-on background worker that the user *monitors and steers through a chat/inbox*, rather than a turn-based tool they configure (LangChain "Introducing ambient agents"; Fuselab "UI design for AI agents 2026"; Walturn "Chat vs Ambient agents"). Concrete SOTA practices and how we line up:

- **Colleague simulation via an inbox/notify surface, not scattered toggles.** SOTA centralizes agent output in one priority-sorted inbox and uses three HITL touchpoints — **notify / question / review** (LangChain). We have the backend half (`proactive_nudge` rows, `tab_proposals_inbox`, cockpit `tab.proposed` events; `proactive-wiring.ts:36-39`) but the delivery is a tab-suggester drain, not a first-class "MD did X / MD asks Y / MD needs sign-off on Z" inbox.
- **"Silence while the agent works is the fastest path to user anxiety."** SOTA mandates proactive status ("searching 3 databases…") and a SEPARATE activity panel from the conversation (Fuselab). We stream `junior_call` running/done events (good), but the deep kernel work (LATS search, debate, world-model, reflexion) is invisible — there is no activity/timeline panel projecting *why* the MD chose an action.
- **Confidence signaling as binary, not a number.** SOTA found "confident / not sure" beats "73%" for decision speed (Fuselab). We compute a conformal confidence band server-side (`applyChatConformalConfidence`) but the brain hard-stamps `confidence: 1` on every orchestrator answer (`kernel.ts:3708-3717`), so the persona currently *cannot* honestly say "not sure" on the default path — it is overconfident by construction (register RSS-22).
- **Progressive delegation (earn autonomy over N clean approvals).** SOTA escalates from approve-each to auto-execute as the user approves consecutively (Fuselab cites ~40). We have autonomy posture but it is set manually; there is no earned/graduated-autonomy engine (register AUT-04).
- **Plan-and-execute step list + tool-use disclosure.** SOTA shows a vertical step list with checkmarks and surfaces tool name + payload at the decision moment. We have a `Plan` ADT and a `stage-event-bus` (intent→megaprompt→plan→step→outcome) inside the loop (`main-loop.ts:64-69, 662-734`) — the data exists, but it is an OTel/learning seam, not yet projected to a user-facing timeline.

**Verdict (Part A):** The *philosophy* is correct and largely built — internal lens classification, backend rails, single SSE contract make the "talk to a veteran MD" illusion structurally sound for the request path. The **gaps are presentation-of-autonomy**: (i) no unified colleague inbox over notify/question/review, (ii) no activity/timeline panel that lets the deep cognition *show its work* like a colleague narrating, (iii) honest binary confidence is blocked by the `confidence=1` stamp, (iv) no earned-autonomy ramp. These are the difference between "a chatbot that sometimes does things" and "a colleague quietly running the estate and reporting back."

---

## Part B — INV-D cycle: code audit, stage by stage

**Headline answer to "continuous backend loop or only request-driven turns?":**
**BOTH exist, but the continuous loop is shallow.** There IS a real always-on backend cognitive cadence today — the **wake-loop** — cluster-locked and started in production. But it is bounded to ~3 hardcoded triggers and a stall scan; it is NOT the general "recognise any situation-type, decompose, create missing organs, drive every loop to closure" engine INV-D describes. The DEEP cognition (LATS, debate, world-model, reflexion, modality arbiter, learning loop) lives almost entirely on the **request-driven** `think()` path and is mostly NOT invoked by the continuous loop.

### The two live loops today

| Loop | Driver | Cadence | What it runs | File:line |
|---|---|---|---|---|
| **Wake-loop** (the real continuous cognitive cadence) | `wakeLoopCron.start()` | 15 min, `pg_try_advisory_lock` cluster-locked | per-tenant: `createRealWakeTriggers` detect → `goals.open` → `executor.executeGoal`; plus stall-detection scan | `index.ts:3602`; `composition/wake-loop-cron.ts:333-365`; `agency/initiative/wake-loop.ts:67-133` |
| **Proactive scheduler** (signal + delivery) | `proactiveScheduler` | signal 5 min / delivery 1 h | delivery cadence runs (tab-suggester + inbox drain). **Signal cadence IDLES** — wired with NO `orchestrator`/`signalSource` | `index.ts:3149-3152`; `proactive-wiring.ts:290-348, 449-455` |
| Request turn (`think()`) | HTTP `/brain/turn`, `/mining/chat` | per request | the deep kernel main-loop (search, hooks, modality arbiter, memory) | `chat-orchestrator.ts:51-59`; `brain-orchestrator-turn.ts:77` |

So the "always-on senses" exist (wake-loop detectors + ambient-brain middleware), but the **ambient sensing is request-triggered** (the BehaviorObserver fires on every authenticated request and only logs — `middleware/ambient-brain.middleware.ts:25-41, 49-55`; "SSE wiring is a later wave"), and the **deep brain is request-triggered**. The continuous loop and the deep brain are two different engines that do not yet meet.

### Stage-by-stage map

#### PERCEIVE (always-on senses; surface loops/needs the user has no idea about) — **PARTIAL**
- **Present:** wake-loop runs real per-tenant detectors on a cluster-locked 15-min cadence (`real-detectors.ts:120-179` arrears, lease-expiring, vacancy; HQ triggers subscription-churn / ai-cost / webhook-DLQ / persona-drift wired in `wake-loop-cron.ts:347-362`). Stall-detection scans active goals each tick (`wake-loop-cron.ts` stallDetector). Sensors exist (`kernel/sensors/anthropic-sensor.ts`, `anthropic-judge.ts`).
- **Missing:** detector set is ~3 domain triggers + 4 HQ triggers, NOT a general always-on sensorium. Ambient-brain observer is request-driven and log-only — no event-stream subscriber consuming `event_outbox`/ledger/licence/FX/KYC for "spawn-before-need" (register EA-07). Regulatory-change sensor not scheduled (register KI-17). The proactive **signal** cadence is wired idle (no source). So the system perceives a fixed, small set of loops on a clock — it does not yet "identify loops/needs the user has no idea about" generally.

#### ORIENT (recognise situation-type via expert schemas/playbooks) — **ABSENT**
- **Missing:** there is no situation-type recognizer. No `awareness/` dir (confirmed absent), no `SituationalSelfModel`, no schema/playbook classifier in the kernel. "Playbook" appears only as static knowledge content in ai-copilot case-studies (`knowledge/case-studies/*`) and a prompt-layer string — never as a runtime ORIENT step. The closest is the persona **lens** classifier (`classifyLenses`) which picks a voice, not a situation schema. Register COG-15 ("no unified situational self-state / blind-spots model") and ORCH-situation capture this; `supervisor/` types exist (`kernel/supervisor/types.ts`) but have zero consumers. **This is the single biggest cognitive gap vs INV-D:** the MD does not first ask "what kind of situation is this, and what does a veteran do here?"

#### ORGANIZE (decompose, rank by consequence × reversibility, delegate) — **PARTIAL**
- **Present:** `Plan` ADT + plan-store drive the loop (`main-loop.ts:477, 662-734`). Wake-loop decomposes a detected need into a multi-step goal with action-tool steps and opens it (`real-detectors.ts:150-175`; `wake-loop.ts:91-118`). The CEO→6-dept→task-agent supervisor pattern is typed (`supervisor/types.ts`). The modality arbiter carries explicit `reversibility` × `consequenceTier` per modality (`modality-arbiter.ts:73-94`) — the consequence×reversibility ranking primitive EXISTS.
- **Missing:** the consequence×reversibility ranking is NOT used to order/triage perceived loops — the wake-loop processes triggers in registration order, not by consequence. The supervisor types have no live consumer. No hierarchical/HTN decomposition — planning is flat (register COG-14). Delegation to juniors on the deep path is a fan-out (`executeJuniors`), not a ranked, consequence-aware org.

#### CREATE (synthesize missing tools/organs, INV-C) — **PARTIAL (built, mostly dark)**
- **Present (as code, gated/unwired):** self-extension keystone exists — `detectRecurringGap` → `proposeNewSubMd` → four-eye → `compileAndDeploySubMd` (`orchestrator/self-extension.ts:1-33`), routed through the body-change inviolable (`checkBodyChangeInviolable`, imported at `self-extension.ts:37-41`). Modality arbiter is the 7-way head skills/workflows are meant to land on (`modality-arbiter.ts:1-31`) and it routes capability-growth through the body-change syscall.
- **Missing:** self-extension has **no scheduler/worker caller** — `detectRecurringGap`/`proposeNewSubMd`/`compileAndDeploySubMd` are referenced only by the package barrel + VP base, never by a cron (register AUT-02). The modality arbiter is **DEFAULT-OFF** (`brain-kernel-wiring.ts:420-428` — `BORJIE_MODALITY_ARBITER` canary flag, off unless set), so SKILL/WORKFLOW/LOOP modalities are unreachable on a normal turn (register COG-07/AUT-14). Runtime tool synthesis (`synthesize_tool`/ToolMaker) does not exist (register EA-06). **So the MD cannot yet grow its own organs in production** — the machinery is built but not turned on or scheduled.

#### EXECUTE-TO-CLOSURE (drive every loop to confirmed closure, never stop at "proposes") — **PARTIAL**
- **Present:** the agency executor walks goal steps `running → done|failed|awaiting-approval`, routes high-stakes through four-eye (does NOT block), and writes hash-chained sovereign-ledger rows fail-closed for irreversible ops (`agency/executor/executor.ts:1-41, 17-40`). The wake-loop calls `executeGoal` immediately after opening a goal (`wake-loop.ts:119-127`) — it does drive to action, not just propose. The Auditor gate rejects empty-evidence recommendations before they reach the owner (`juniors/auditor-agent.ts:1-15, 48-56`).
- **Missing:** "confirmed closure" is not a first-class loop. On tool-error the deep main-loop retries but has no plan-repair/replanner node (register COG-13). There is no outcome-reconciliation feedback that confirms the *business* loop closed (royalty actually paid, licence actually renewed) and reopens if not — `outcome-reconciliation-worker.ts` exists but is not joined to the wake-loop's goals. The executor bails out of a goal on first failure leaving later steps `pending` (`executor.ts` header) — a veteran MD would re-route, not abandon. So we EXECUTE, but do not guarantee CLOSURE.

#### LEARN + REPEAT (get better every cycle) — **ABSENT on the live loop**
- **Missing:** the main-loop has **zero** references to learning-loop, reflexion, or replay (grep over `main-loop.ts` = none). Metacognition modules exist (`metacognition/recursive-hot.ts`, `defection-probe.ts`, `autobiography.ts`, `activation-probe.ts`) but are orphaned from the kernel (register COG-04). No replay→eval→update nightly loop; no machine-checkable fitness; Voyager skill-capture has no runtime caller (register AUT-06, AUT-03). The wake-loop does not feed its outcomes back into anything that changes future behaviour. Memory-v2 durability was only just closed (tasks MEM-01/02/05) so prior to that the substrate was wiped on restart — learning had nowhere to persist. **The cycle does not yet close on itself.**

### Persona-front vs always-on backend loop — summary table

| INV-D stage | Persona-front (request `think()`) | Always-on backend loop (wake-loop) | Verdict | Key evidence |
|---|---|---|---|---|
| PERCEIVE | request-triggered (ambient middleware, log-only) | real detectors, 15-min, cluster-locked | **PARTIAL** | `ambient-brain.middleware.ts:49-55`; `wake-loop-cron.ts:333-365` |
| ORIENT | lens = voice only, no situation schema | none | **ABSENT** | `classifyLenses` (chat-orchestrator.ts:64); no `awareness/` dir; `supervisor/types.ts` unused |
| ORGANIZE | `Plan` ADT + junior fan-out | detect→goal-decompose→open | **PARTIAL** | `main-loop.ts:662-734`; `real-detectors.ts:150-175`; ranking primitive unused (`modality-arbiter.ts:73-94`) |
| CREATE | modality arbiter DEFAULT-OFF | self-extension has no caller | **PARTIAL (dark)** | `brain-kernel-wiring.ts:420-428`; `self-extension.ts:1-33` (no cron) |
| EXECUTE-TO-CLOSURE | executor + four-eye + auditor | wake-loop `executeGoal` | **PARTIAL** | `agency/executor/executor.ts:1-41`; no replanner (COG-13); closure not confirmed |
| LEARN+REPEAT | none in main-loop | none | **ABSENT** | `main-loop.ts` grep: no reflexion/replay/learning-loop; metacognition orphaned (COG-04) |

### Two cross-cutting honesty defects (block the "veteran MD" feel)
1. **Overconfidence by construction.** `translateOrchestratorResponse` hard-stamps `confidence{groundedness/stability/review/numericalConsistency/overall}=1` and `gates=all pass` on EVERY orchestrator answer (`kernel.ts:3708-3723`). The conformal calibrator and uncertainty policy exist but are not in the default loop — so the persona cannot honestly hedge. (register RSS-22 / COG-03).
2. **Deep deliberation not on the default turn.** Default consequential turns run a single-shot router call, not the disciplined kernel with LATS/debate/world-model (register COG-01, COG-02, COG-06). The veteran-MD "thinks before it speaks" property is built but flag-gated/dark.

---

## BossNyumba parity (reasoned from shared spine; BN repo NOT opened)

BN and Borjie share the SAME central-intelligence kernel + ai-copilot spine; only the domain layer differs. Therefore the INV-D verdict is **structurally identical**, with these spine-level inferences:

- **PERCEIVE/ORGANIZE/EXECUTE wake-loop:** the wake-loop primitive and its three default triggers are literally property-named in the shared kernel (`wake-loop.ts:142-167` ARREARS_30D / LEASE_EXPIRING_30D / VACANCY_30D return `[]`). BN inherits the SAME loop; its real-detectors would bind property read-ports. So BN's continuous loop is at the **same PARTIAL** maturity — same ~3 triggers, same stall scan.
- **ORIENT:** ABSENT in the shared kernel → ABSENT in BN. Neither product recognises situation-type via schemas/playbooks.
- **CREATE:** self-extension + modality arbiter live in the shared kernel → BN has the same built-but-dark CREATE. BN additionally lacks the body-model layer entirely (register EA-10: BN has actuators but ZERO system-graph/blackboard/mutation-authority), so BN's body-change rail for capability growth is weaker than Borjie's.
- **LEARN:** ABSENT in the shared loop → ABSENT in BN.
- **Persona-front:** BN reuses the persona/lens/SSE machinery; the same "no modes, internal classification" property holds, and the same presentation gaps (no colleague inbox, no activity panel, confidence=1 stamp) apply.
- **Domain juniors:** BN's real-estate junior set is essentially UNBUILT (register DM-12: `ai-copilot/src/` has no `juniors/` dir in BN) — so even where Borjie has DEEP domain organs, BN's EXECUTE stage has far fewer organs to delegate to.

**Net BN parity:** the cognitive *cycle* is at parity (same spine, same gaps) but BN is **behind on embodiment (no body-model)** and **far behind on domain depth (junior set unbuilt)** — so BN's EXECUTE-TO-CLOSURE has less to execute, and its CREATE has a weaker rail.

---

## What "today" looks like in one line

A real continuous backend loop exists and fires (wake-loop, 15-min, cluster-locked, real detectors, executes to action with rails + audit) — but it is a **shallow, ~3-trigger reflex arc**, not the general PERCEIVE→ORIENT→ORGANIZE→CREATE→EXECUTE-TO-CLOSURE→LEARN cognition INV-D demands. The DEEP brain (situation-orientation, deliberate search, self-creation, honest confidence, learning) is built mostly as request-path code that is flag-gated, default-off, orphaned, or unscheduled. The persona-front successfully hides all of it behind one chat with no knobs — but it cannot yet *narrate its work like a colleague* (no activity/inbox surface) and cannot *honestly hedge* (confidence=1 stamp). Closing ORIENT (situation schemas), turning the loops on (modality arbiter, self-extension cron, deep `think()` default), and wiring LEARN (replay→eval→update) are the path from "reflex arc behind a friendly chat" to "veteran MD behind a laptop."
