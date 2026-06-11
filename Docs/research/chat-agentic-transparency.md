# Chat Agentic Transparency & Progress — SOTA Dossier

**Lane:** `agentic-transparency-progress`
**Date:** 2026-06-08
**Author:** research subagent (workflow orchestration)
**Question:** How do we surface the MD (Mr. Mwikila) *working* — its plan, reasoning, tool-use, multi-step progress, and evidence — so the owner feels a competent colleague at their desk, without overwhelm? What is the 2026 state of the art across Claude Code / Cursor / Devin / Manus / OpenAI agent-mode + computer-use, and how far beyond do we leap?

**Bar:** SOTA, best-in-the-world, PhD/MIT. Honour **INV-H** (chat is a rich SOTA conversational *workspace*, not a text box), **INV-B** (surfaces are lenses), and the UI invariant (reasoned-need · proposal-gated · reversible · chat-refinable).

> **One-line thesis.** Trust is not built by *telling* the owner the MD is smart; it is built by letting the owner *watch the MD work* — at exactly the resolution that owner, on that task, at that risk level, needs. The transparency layer is a **calibrated window into the MD mind**: enough to trust and steer, never so much it becomes a log to parse. The 2026 frontier has converged on a small, learnable vocabulary of work-events (plan · reasoning · tool-call · subagent · evidence · progress · guard) streamed as typed projections and rendered as *render-driven* UI. Our differentiator is to make that window **adaptive, evidence-native, and steerable mid-task** in a regulated mining-estate context where the user is often a non-technical owner who must still feel in command.

---

## 1. The 2026 state of the art (what the frontier actually ships)

The field has crystallised around one architecture and five UI primitives. The architecture: **stream a single typed event sequence of *work-events*, and let the UI subscribe only to the projections it renders.** The five primitives: **(a) the visible plan/todo**, **(b) the tool-call timeline**, **(c) collapsible reasoning/thinking**, **(d) inline evidence/citation**, and **(e) interruptibility + steering hooks**. Every leading agent UI is some arrangement of these five.

### 1.1 The visible plan / todo stream (plan-before-act, progress-as-you-go)

The single most universal trust primitive in 2026 is **"show the plan, then check off the plan."**

- **Claude Code** ships *plan mode* — the full execution plan is shown *before* any file changes, and the user approves it. In **v2.1.16 (Jan 22 2026)** the older **Todo** system was replaced by **Tasks**: dependency tracking, file-system persistence, and cross-session collaboration. The Agent SDK exposes todo-tracking explicitly because "todo lists give transparency into Claude's work plan… revealing Claude's interpretation of your instructions and enabling mid-task steering." The plan is simultaneously a *progress bar*, a *comprehension check* (did the agent understand me?), and a *steering surface* (edit before it runs).
- **Devin / Copilot Workspace** "surface a plan, ask for approval before destructive actions, and stream their reasoning." Devin assumes async delegation with **end-state review**, so its plan view is the contract the human signs off on.
- **Manus** renders a live **"Manus's Computer" view** — the user *watches* the agent navigate apps step by step; this is described as "a level of transparency that builds confidence in what the AI is doing," paired with a meticulously logged audit trail.
- **OpenAI ChatGPT agent / Operator** runs a perception→reasoning→action loop where the chain-of-thought "inner monologue" is surfaced (summary `concise` | `detailed`) and the user can interrupt, take over the browser, or stop at any point.

The lesson: the plan is the **primary trust artifact**, not a side-effect. It is shown first, kept on screen, ticked as work lands, and remains editable.

### 1.2 The tool-call timeline (what the agent *did*, with status + latency + result)

Every frontier agent now renders tool execution as **first-class, lifecycle-aware UI**, not log spam.

- **LangChain's "From Token Streams to Agent Streams"** (the canonical 2026 reference) names the channels: **`messages`** (transcript + content-block deltas), **`tools`** (tool execution lifecycle), **`lifecycle`** (runs, subgraphs, subagents), **`values`/`updates`** (state), **`checkpoints`** (branching/time-travel), and **`custom:*`** (app projections). Its core mantra: *"Most application code should not iterate over raw protocol events. It should ask for the thing it wants to render."* Components **mount the projections they need**; the SDK handles subscription, reconnection, assembly. *"Streaming agents should feel like building applications, not parsing logs."*
- **AG-UI** (CopilotKit; adopted by Google, LangChain, AWS, Microsoft, Mastra, PydanticAI) is the open **Agent–User Interaction protocol**: a single JSON event sequence over HTTP carrying **messages, tool calls, state patches, lifecycle signals**, keeping UI and agent in real-time sync, and natively supporting generative-UI specs (incl. A2UI).
- **Hermes Desktop** (Nous, Jun 3 2026) shows **streaming responses + live tool activity** in a window with a **right-hand pane previewing web pages, files, and tool outputs** — the tool-call timeline and the artifact preview are co-located.
- **Cline** "highlights how they reason across multiple files and require approval before edits are committed."

The lesson: tool-calls are a **lifecycle** (pending → running → done/failed) with name, latency, status, and a clickable **result/artifact**, not a post-hoc list.

### 1.3 Collapsible reasoning / extended thinking (progressive disclosure of the mind)

2026 settled the "show the chain-of-thought?" debate with **progressive disclosure**: show a *summary* by default, the *raw* on demand.

- **Claude Opus 4.6 / Sonnet 4.6**: thinking is **summarized by default** — key reasoning steps, not the raw token stream; the full scratchpad is available but folded. Extended thinking is "a scratchpad… visible thinking block, then the final answer."
- **OpenAI** exposes `reasoning.summary: concise | detailed`.
- The 90s UX principle is back: **progressive disclosure** — "show users only the information they need *right now*, deferring advanced features until requested to reduce cognitive load." Emerging patterns: **expandable rationale chips** that reveal reasoning only if the user wants more, and **"Why this?"** links next to AI results. Over-disclosure causes **context rot / cognitive burden**; the design goal is *transparency without overwhelm*.

The lesson: reasoning is **layered** — a one-line "what I'm doing and why" is always visible; the deeper chain is one click away; the raw trace is two.

### 1.4 Inline evidence / citation (the claim and its proof, co-located)

The frontier renders **citations as a streamed projection co-located with the claim**, not a bibliography. LangChain explicitly lists **citations** among the "domain-specific projections" apps render live. Real-time agent-assist tools surface "relevant knowledge-base articles" inline beside the suggested response. Evidence is *attached to the assertion that depends on it*, and is clickable to the source.

### 1.5 Interruptibility + steering (the human can grab the wheel mid-task)

The defining 2026 shift: agents moved from "rigid, monolithic" runs to **flexible, collaborative, steerable** ones.

- **Magentic-UI** (Mozannar et al., Jul 2025, the canonical HITL reference) ships five named mechanisms: **co-planning** (human+agent jointly decompose), **co-tasking** (shared ownership), **action guards** (validate/constrain sensitive actions before execution), **plan editing** (modify the planned sequence without restart), and a **visible plan**. Its design principle is **transparency without overwhelm** — "surfacing sufficient detail for meaningful oversight while avoiding cognitive burden through progressive disclosure and structured task hierarchies." Humans **steer without micromanaging**; agents **execute while remaining accountable.**
- **Agentic-UX consensus**: prioritise **Interrupt, Correct, Undo**. Interruption points are *"brief, clear summaries of what the agent is about to do, with one-tap approval or a brief redirect option"* — not heavy confirmation dialogs. **Real-time steering** lets users pause, clarify, adjust upcoming steps, or intervene directly (cf. VS Code's "Live Steering" issue #288920; Ably's barge-in/redirect work).
- **OpenAI Operator** has **takeover mode** — returns control to the human for sensitive actions (e.g. password/payment entry).
- **Anthropic's "Measuring agent autonomy"** frames the same axis: the right autonomy level is *contextual*, and the UI must expose the dial.

The lesson: steering is **cheap and constant** — one-tap approve/refine/redirect, a takeover handoff for sensitive steps, and the plan itself is editable.

### 1.6 Trust calibration (the meta-layer — neither overtrust nor undertrust)

2026 research is explicit that transparency must be **calibrated**, not maximal.

- **Trust calibration** = aligning the user's subjective trust with the system's objective trustworthiness (accuracy/reliability/uncertainty), minimising **overtrust (misuse)** and **undertrust (disuse)**.
- **Expertise inverts disclosure value**: disclosure *raised* trust for novice→intermediate users but *lowered* it for experts (they want less hand-holding). So disclosure must be **personalised by expertise**.
- **Adaptive > static**: a system that *monitors behaviour and adjusts* is "orders of magnitude more effective" than showing the same explanation to everyone. Users who make sophisticated edits want more detail; users who accept whole rewrites want less.
- **Trust Calibration Maturity Model (TCMM)** scores systems on five dimensions: Performance Characterization, Bias & Robustness, Transparency, Safety & Security, Usability.

The lesson: the transparency layer is a **dial the system turns for each user and each task**, not a fixed setting.

---

## 2. SOTA findings → "beyond-today" leaps (each frontier pattern + our jump past it)

For each finding below: **[SOTA]** = what the frontier does in June 2026; **[BEYOND]** = the leap that makes the MD best-in-the-world for a regulated mining estate run by a possibly-non-technical owner.

1. **Plan-before-act + ticked progress.**
   **[SOTA]** Claude Code plan-mode/Tasks, Devin/Copilot plan-approval, Manus step view.
   **[BEYOND]** A **prepare→ask→execute-or-handoff plan card** rendered *as generative UI inside the chat turn* (not a separate pane): the MD streams a plan whose steps are typed by **risk** (auto / confirm / dual-control-HITL) and by **money-path** (anything touching `LedgerService.post()` is visibly flagged). The owner sees "I'll (1) pull the Tumemadini royalty schedule, (2) compute the 4% on 12.3 kg, (3) *prepare* the GePG payment for your approval." Steps auto-tick as evidence lands; the money step is *visibly gated* and reversible. This fuses INV-H (rich workspace), the UI invariant (proposal-gated, reversible), and our hard rule that money/licence/deletion stay dual-control forever.

2. **Tool-call timeline as lifecycle, not log.**
   **[SOTA]** AG-UI / LangChain `tools` channel; Hermes right-pane preview.
   **[BEYOND]** An **MD-junior activity rail** where each tool-call is a *named junior at work* ("Royalty Engine · running · 1.2s · 3 evidence"), with the result **promotable to a spawned surface** (INV-B: the rail card is a lens; click → it becomes a tab). Today our `ToolCallSidebar` is **post-hoc** (renders after the turn). The leap is **live, lifecycle-aware, and persona-framed** — the owner literally watches the metallurgy junior, the FX-treasury junior, the compliance junior take the floor in sequence, like department heads reporting in.

3. **Collapsible reasoning, summarised-by-default.**
   **[SOTA]** Claude 4.6 summarised thinking; OpenAI `reasoning.summary`.
   **[BEYOND]** A **three-depth reasoning fold calibrated to the owner**: L0 always-on one-liner ("Checking your licence covers gold export before I price this"), L1 click → the MD's *debate/LATS rationale in plain language* (we already emit `debate_metadata`), L2 click → the raw evidence chain + model trace. The default depth is **chosen by the owner's affective/expertise profile** — we already stream `affective_profile` (frustration/comprehension/anxiety/trust/urgency); wire it to the disclosure dial so an anxious novice owner sees more reassurance and an expert sees terser output. This is the "calibrated window" the research demands, and we are uniquely positioned because the affective signal already exists.

4. **Evidence co-located with the claim.**
   **[SOTA]** LangChain citations projection; agent-assist inline KB.
   **[BEYOND]** **Evidence-native by invariant.** Our hard rule already requires every junior recommendation to cite ≥1 `evidence_id` and the Auditor rejects empty chains. The UI leap: render that as an **inline evidence chip on the exact sentence** ("…royalty is 4% [Mining Act 2010 §87 ▸]") that expands to the corpus chunk, *and* show a **"this claim is unverified" amber state** when a sentence has no evidence id — making the absence of proof as visible as its presence. No frontier consumer product makes *missing* evidence a first-class visual; in a regulated estate this is the trust differentiator.

5. **Interrupt / steer / take-the-wheel mid-task.**
   **[SOTA]** Magentic-UI co-planning/plan-editing/action-guards; Operator takeover.
   **[BEYOND]** **Barge-in over voice + text simultaneously.** We already have OpenAI-Realtime voice wired. The leap: the owner can interrupt a running multi-step MD task **by voice** ("wait — use last month's spot price, not today's") and the MD **re-plans the remaining steps in place**, showing the diff to the plan card. Plus **action-guards bound to our policy-gate**: HIGH-risk policy prefixes (sovereign/kill_switch/four_eye/policy_rollout) *force* a takeover handoff that cannot be auto-cleared. Steering is multimodal and the guards are the same `inviolable.ts` rails that already protect the money path.

6. **Trust calibration as an adaptive dial.**
   **[SOTA]** TCMM; expertise-inverted disclosure; adaptive-beats-static.
   **[BEYOND]** A **self-calibrating transparency controller**: the MD watches whether the owner expands reasoning, edits plans, or rubber-stamps, and *adjusts default disclosure depth per owner over time* (more for those who scrutinise, less for those who delegate) — bilingually (EN/SW, zero mixing per our hard rule) and persona-consistent. This turns transparency from a fixed chrome into a **learned relationship**, the literal "colleague at your desk who knows how much you like to see."

7. **Live status language ("preparing your royalty payment…").**
   **[SOTA]** Manus "Manus's Computer"; Operator action narration; "agent is working" status.
   **[BEYOND]** **Domain-grounded, single-language, persona-voiced micro-status** streamed as first token: not "Calling tool `royalty.compute`" but *"Mr. Mwikila is preparing your GePG royalty payment — checking the Tumemadini schedule…"* (or the strict-SW equivalent), with an **ETA + cancel** affordance. The status is the *first thing* streamed (we already have streaming first-token), making latency feel like competence, not lag.

8. **Failure transparency.**
   **[SOTA]** Agentic-UX "failure transparency" principle; degraded-mode signalling.
   **[BEYOND]** We already emit `brain_state` (degraded pill after ≥2 provider failures). The leap: **graceful, honest degradation in the plan card** — when a junior can't get evidence (e.g. regulator feed down), the step shows *amber "couldn't verify — here's what I'd do, pending confirmation"* rather than silently proceeding, honoring "evidence-required AI output" as a *visible* contract, not a hidden rejection.

---

## 3. What we already have (so the build is wiring, not greenfield)

| Capability | Where | State |
|---|---|---|
| Post-hoc tool-call rail (junior name, latency, status, evidence count) | `apps/owner-web/src/components/home-chat/ToolCallSidebar.tsx` | Built; **post-hoc not live** |
| SSE trust frames: debate badge, brain_state (degraded), auto_authorized, affective_profile | `apps/owner-web/src/components/home-chat/teach-sse-normalisers.ts` | Built + unit-tested |
| Streaming chat with first-token + teach SSE pipeline | `apps/owner-web/src/components/home-chat/HomeChatTeach.tsx` (52 KB), `use-chat-mode.ts` | Built |
| Inline generative-UI blocks incl. **CitationsBlock**, ConfirmationCard, DraftPreview/Edit, InlineChart, InlineWorkflow, MicroActionCard, TabPromotionChip | `apps/owner-web/src/components/home-chat/inline-blocks/` (20 blocks) | Built |
| Inline action map + micro-action summary (approve/refine affordances) | `home-chat/inline-action-map.ts`, `micro-action-summary.ts` | Built |
| Handoff card (prepare→ask→execute-or-handoff) | `apps/owner-web/src/components/chat/HandoffCard.tsx` | Built |
| GenUI tab proposal → ambient-notice → GenUITabHost (surfaces spawn from chat) | `services/api-gateway/src/services/brain/genui-tab-proposal.ts`, `apps/owner-web/src/components/genui-tab/GenUITabHost.tsx`, `portal-genui` | Built (INV-B path) |
| Adaptive GenUI renderer (charts/tables/timelines/steppers/approval dialogs/maps) | `packages/genui/` (`AdaptiveRenderer`, `GENUI_REGISTRY`) | Built |
| OpenAI-Realtime voice | wired earlier (per lane brief + MEMORY) | Built |
| Learning stepper (NOT an agent-plan stepper) | `home-chat/StepperBar.tsx` | Built — **literacy ladder, not task plan** |

The bones are unusually strong: we already emit the *trust frames* (debate, degraded, auto-authorized, affective) and have an inline-block + tab-proposal pipeline. The gap is the **live work-choreography layer** that turns these frames into a watchable, steerable "MD at work."

---

## 4. Our gaps (ranked, buildable)

1. **No live plan/todo stream inside the chat turn.** We have a *learning* `StepperBar` and a post-hoc tool rail, but no **task-plan card** that streams steps *before* execution, ticks them live, types each step by risk/money-path, and is **editable mid-run** (the #1 universal SOTA primitive — Magentic-UI plan-editing, Claude Tasks). This is the keystone gap.

2. **Tool-call rail is post-hoc, not lifecycle-live.** `ToolCallSidebar` renders after the turn. Needs a **pending→running→done/failed lifecycle** streamed over the existing SSE channel (AG-UI/LangChain `tools` projection), persona-framed as named juniors, with results promotable to surfaces (INV-B).

3. **No three-depth collapsible reasoning fold.** We emit `debate_metadata` but render it as a badge, not a **progressive-disclosure rationale** (L0 one-liner → L1 plain-language rationale → L2 raw trace). And the depth is not yet **driven by the `affective_profile` we already stream** — the single biggest beyond-today lever sitting unwired.

4. **Evidence is in `CitationsBlock`, not inline on the sentence.** No **per-claim evidence chip** and, critically, no **"unverified" amber state** for sentences lacking an `evidence_id` — we enforce evidence server-side (Auditor) but don't *show its presence/absence* at claim granularity.

5. **Steering is button-only, not multimodal/mid-run.** We have approve/refine inline actions but no **voice barge-in that re-plans remaining steps in place**, and no **policy-gate-bound action-guards** that force a takeover handoff on HIGH-risk prefixes (sovereign/kill_switch/four_eye/policy_rollout) inside the chat surface.

6. **No persona-voiced, single-language live status with ETA+cancel.** First-token streams, but not as *"Mr. Mwikila is preparing your GePG royalty payment…"* with an explicit ETA and a cancel control. Status currently reads as latency, not competence.

7. **No adaptive transparency controller.** Disclosure depth is static. We have every input needed (affective_profile, expand/edit/rubber-stamp telemetry) to make it **self-calibrating per owner, bilingual, persona-consistent** — but it is unbuilt.

8. **Failure transparency not surfaced in the plan.** `brain_state` degraded pill exists, but a **step-level amber "couldn't verify — pending confirmation"** state (honoring evidence-required as a *visible* contract) does not.

---

## 5. Sources (real, June-2026)

- LangChain — *From Token Streams to Agent Streams* (event channels: messages/tools/lifecycle/values/checkpoints/custom; render-driven projections; "ask for the thing it wants to render") — https://www.langchain.com/blog/token-streams-to-agent-streams
- LangChain Docs — *Streaming* (stream agent progress; state updates per step) — https://docs.langchain.com/oss/python/langchain/streaming
- CopilotKit — *Introducing AG-UI: The Protocol Where Agents Meet Users* (single JSON event sequence; messages/tool-calls/state-patches/lifecycle; adopted by Google/AWS/Microsoft/LangChain/Mastra/PydanticAI) — https://www.copilotkit.ai/blog/introducing-ag-ui-the-protocol-where-agents-meet-users
- AG-UI Protocol docs (Agent–User Interaction; generative UI; A2UI) — https://docs.ag-ui.com/introduction
- Mozannar et al. — *Magentic-UI: Towards Human-in-the-loop Agentic Systems* (co-planning, co-tasking, action guards, plan editing, visible plan; transparency without overwhelm) — https://arxiv.org/pdf/2507.22358
- Anthropic — *Claude Code Docs / Changelog* (plan mode; Todo→Tasks v2.1.16, Jan 22 2026; Remote Tasks Mar 20 2026; transparency affordance fixes) — https://code.claude.com/docs/en/changelog and https://platform.claude.com/docs/en/agent-sdk/todo-tracking
- Anthropic — *Building with extended thinking* (summarised-by-default thinking; scratchpad + final answer) — https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- OpenAI — *Introducing ChatGPT agent* & *Computer-Using Agent* (perception→reasoning→action loop; reasoning summary concise/detailed; interrupt/takeover) — https://openai.com/index/introducing-chatgpt-agent/ and https://openai.com/index/computer-using-agent/
- Manus — *Browser Operator* / docs (live "Manus's Computer" view; meticulous audit trail; full user control) — https://manus.im/blog/manus-browser-operator and https://manus.im/docs/features/browser-operator
- Nous Research — *Hermes Desktop* (streaming responses + live tool activity + right-pane artifact preview, Jun 3 2026) — https://www.marktechpost.com/2026/06/03/nous-research-releases-hermes-desktop-a-native-cross-platform-front-end-for-hermes-agent-v0-15-2-with-streaming-tool-output/
- *Progressive Disclosure Matters: Applying 90s UX Wisdom to 2026 AI Agents* (just-in-time context; context rot; show-only-what's-needed) — https://aipositive.substack.com/p/progressive-disclosure-matters
- UXmatters — *Next-Gen Agentic AI in UX Design* (Mar 2026; visible decision-making, interruptibility, trust calibration, failure transparency) — https://www.uxmatters.com/mt/archives/2026/03/next-gen-agentic-ai-in-ux-design-evolving-the-double-diamond-process.php
- Ably — *Realtime steering: Interrupt, barge-in, redirect, and guide the AI* — https://ably.com/blog/ai-transport-redirect-steering
- microsoft/vscode #288920 — *Implement "Live Steering" and Mid-Run Feedback for Agent Mode* — https://github.com/microsoft/vscode/issues/288920
- Anthropic — *Measuring AI agent autonomy in practice* — https://www.anthropic.com/research/measuring-agent-autonomy
- *Superhuman Game AI Disclosure: Expertise and Context Moderate Effects on Trust and Fairness* (arXiv 2503.15514 — disclosure raises novice trust, lowers expert trust) — https://arxiv.org/pdf/2503.15514
- *Adaptive trust calibration for human-AI collaboration* (PMC7034851) — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7034851/
- *A Survey of Trust Calibration in Human-Agent Interaction* (arXiv 2205.02987) — https://arxiv.org/pdf/2205.02987
- Eleken — *Explainable AI UI Design (XAI): Make Interfaces Users Trust* — https://www.eleken.co/blog-posts/explainable-ai-ui-design-xai
