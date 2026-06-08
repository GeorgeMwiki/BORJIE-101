# MD Whole-Surface Perception · Actuation · Ambient Omnipresence — SOTA Dossier

**Date:** 2026-06-08
**Author:** Research subagent (frontier web + repo grounding)
**Audience:** Borjie brain-layer architects (Mr. Mwikila / the MD)
**Status:** Cited frontier survey + concrete wiring map onto the MD's existing body

---

## 0. The thesis — the MD *is* the OS, the project *is* its body

Borjie is "an AI-native mining estate operating system; Mr. Mwikila is its brain
layer" (`CLAUDE.md`). Most assistants are an *app inside* an OS. The MD must be
the *kernel*: the four product surfaces (`admin-web`, `owner-web`,
`workforce-mobile`, `buyer-mobile`), every screen, tab, route, and the brain
kernel itself are **organs of one body the MD inhabits**, not external tools it
talks to.

That demands three faculties, each with a deep frontier literature:

1. **Perception** — the MD must *see* the state of every surface (what tab is
   open, what the owner is staring at, what a manager just typed, what a
   buyer's bid screen shows) the way a body feels its own limbs
   (proprioception), plus the world beyond (camera, voice, documents).
2. **Actuation** — the MD must *act on any organ*: render a tab, fill a form,
   post a ledger entry, file a compliance return, move a decision from chat
   into the owner cockpit — unified action across every app/portal.
3. **Ambient omnipresence** — the MD must be *present everywhere at once*,
   always-on, proactive, anticipatory, and able to **carry a thing — a doc, a
   task, a decision — between surfaces and devices** without losing context.

The architecture that unifies all three already has a name in the literature:
**the LLM-as-operating-system** (MemGPT, AIOS). Borjie is the first place this
pattern gets a literal body to inhabit.

---

## 1. Perception — the MD sees its whole body and the world

### 1.1 GUI / screen perception (computer-use agents)

The frontier moved from "LLM that types text" to "agent that perceives a screen,
grounds UI elements, and executes bounded actions" in ~18 months.

| System | Perception | Action space | Benchmark (2026) | Source |
|---|---|---|---|---|
| Anthropic Computer Use | screenshot + bash + text-edit | mouse/keyboard/coords | Claude Sonnet 4.6 ≈ **72.5% OSWorld-Verified** | UNVERIFIED (search-summarized; not fetched) |
| OpenAI CUA / Operator | screenshot, set-of-marks | click/type/scroll | ~38% OSWorld, ~58% WebArena | UNVERIFIED (search-summarized) |
| **UI-TARS** (ByteDance) | **screenshots only**, no DOM/AX-tree | unified mouse/kbd/scroll | OSWorld 24.6@50, AndroidWorld 46.6 | https://arxiv.org/html/2501.12326v1 |
| Browser-Use (OSS) | **hybrid** DOM+AX-tree+screenshot | click/type | **89.1% WebVoyager** | https://medium.com/@learning_37638/state-of-the-art-autonomous-web-agents-2024-2025-3d9d93a5dde2 |
| Agent-S / S2 (OSS) | screenshot + grounding | human-like | beats CUA + Claude 3.7 CU | https://github.com/simular-ai/Agent-S |

**The 2026 consensus is the HYBRID action model** (verified, fetched):
Microsoft UFO² extracts controls from the accessibility tree, finds
custom-rendered controls via vision (OmniParser-v2), deduplicates by
bounding-box overlap. "Browser-Use (hybrid) scored 89.1% on WebVoyager … while
Agent-E (accessibility-only) reached 73.1%." Production systems prefer
"DOM/accessibility-tree reasoning by default … fall back to vision for
non-standard layouts, canvas UIs, and image-heavy interfaces."
(https://zylos.ai/research/2026-02-08-computer-use-gui-agents)

**What makes a GUI agent reliable** (fetched, load-bearing): verification is
mandatory — (1) pre-action logic-based check, (2) post-action visual
re-screenshot, (3) multi-factor confirmation for irreversible ops; sandbox in a
VM with minimal privileges; constrain scope. The hard truth: "agents demonstrate
70-80% capability in demos but lack the 99%+ reliability production systems
require." (https://zylos.ai/research/2026-02-08-computer-use-gui-agents)

**How it makes the MD's body actuatable:** Borjie owns its own surfaces, so the
MD should NOT pixel-click its own apps like a stranger. Instead, **internal
surfaces get a first-class semantic API (the cheap, deterministic path) and
computer-use becomes the fallback for the long tail** (a third-party regulator
portal, a vendor SCADA dashboard, a legacy bank site with no API). The hybrid
DOM-first / vision-fallback pattern maps exactly: *semantic-action-first /
computer-use-fallback*. UI-TARS' "screenshots-only, no API" model is the
reference design for the **external** organs of the body (portals the MD
doesn't own); the repo's own `power-tools` are the reference for the **internal**
organs.

### 1.2 Proprioception — the MD feeling its own surfaces

Project Astra's universal-assistant work shows the perception target: it
"controls the phone, uses Google tools, remembers context across sessions and
devices, and can act proactively," with "on-screen highlights to show you what's
important," processing "unified streams of video, audio, and text with near-zero
latency." (https://deepmind.google/models/project-astra/)

For the MD, proprioception = a **live, structured stream of UI state** from every
open surface: active tab, focused entity, scroll position, last user action,
form draft state. This is the screen-perception problem turned *inward* — the MD
reads its own DOM/component tree (which it authored via generative UI), so it
gets the precise, low-token accessibility-tree path "for free" rather than
screenshotting itself. **The MD's apps should emit their state to the brain
exactly the way an accessibility tree exposes a screen** — that is the cheapest,
most reliable perception channel in the literature, and Borjie can have it by
construction.

### 1.3 World perception — multimodal, beyond the screen

Project Astra (DeepMind) is the reference for always-on multimodal sensing:
real-time camera + audio + screen-share, "intuitively start conversations …
without interrupting or time lag," noise filtering, environmental identification
via Maps/Lens. (https://deepmind.google/models/project-astra/) For Borjie this is
the **field perception** layer: a workforce-mobile user points a phone at a
crusher or a drill core; the MD perceives it (metallurgy/machinery juniors), not
just chats about it.

### 1.4 Predictive / world-model perception (active inference)

The deepest frontier reframes perception and action as ONE process. A world
model is "an internal model … that captures the dynamics of environmental
states, their responses to the actions of the agent, and their relationships
with sensory inputs." Under the free-energy principle / active inference,
"both perception and action can be considered as processes of minimizing
prediction errors," and "actions are chosen … to align with preferences and
reduce uncertainty, thereby unifying perception, action, and learning."
(https://arxiv.org/pdf/2505.19867 — Deep Active Inference Agents; survey
context https://arxiv.org/pdf/2510.20668) DeepMind Genie 3, NVIDIA Cosmos, Meta
V-JEPA 2, DreamerV3 are the 2024–2025 world-model exemplars.

**Why this matters for the MD:** an estate OS that merely *reacts* to clicks is
a dumb terminal. An MD with a world model of the estate (royalty cycles, FX
exposure, licence-renewal clocks, equipment-failure curves) *predicts the next
state of its own body* and acts to reduce surprise — it renders the licence-
renewal tab *before* the owner asks because its world model said the deadline is
near. This is the rigorous formalism behind "proactive."

---

## 2. Actuation — the MD acts on any organ and moves things between them

### 2.1 The LLM-as-OS substrate (MemGPT → AIOS)

This is the structural backbone for "MD = OS."

**MemGPT — LLMs as Operating Systems** (Berkeley, Oct 2023). Borrows OS virtual
memory: **main context (RAM)** = active window; **recall storage (disk)** =
searchable past messages; **archival storage (cold)** = vector store. The LLM
*pages* data between tiers via self-issued function calls, and uses interrupts to
manage control flow. (https://arxiv.org/abs/2310.08560) → The MD's memory of the
*entire estate* exceeds any context window; MemGPT is the proven pattern for the
MD to feel like it "remembers everything" about every surface while paging.

**AIOS — LLM Agent Operating System** (Rutgers, COLM 2025). An **AIOS kernel**
isolates LLM/tool resources from agent apps and provides OS services:
**agent scheduler, context manager, memory manager, storage manager, tool
manager, access manager**, exposed via an **LLM system-call interface** and an
AIOS-Agent SDK; up to **2.1× faster** multi-agent serving. The core insight
(fetched): "treat the LLM as a privileged service provider rather than a
directly-accessed resource … multiple agents can efficiently share computational
resources." (https://arxiv.org/abs/2403.16971)

**Mapping AIOS kernel modules onto the MD's body:**

| AIOS module | Borjie organ that already exists / should exist |
|---|---|
| agent scheduler | `central-intelligence` orchestrator + `power-tools/schedule` |
| context manager | brain-kernel think-pipeline + `context-budget.ts` |
| memory manager | durable cognitive memory (MEMORY.md notes it shipped) + MemGPT tiers |
| storage manager | `packages/database` (Drizzle, RLS, pgvector) |
| tool manager | typed **power-tools registry** (`power-tools/registry.ts`) + MCP |
| access manager | policy-gate / inviolable / RLS / kill-switch |
| **system-call interface** | the power-tools call surface = the MD's "syscalls" into its own body |

Borjie has, by accident of good architecture, **already built ~80% of an AIOS
kernel**. The dossier's recommendation is to *name it that way* and close the
gaps — the MD's actuation should be modeled as syscalls against its own OS.

### 2.2 Universal actuation across every app/portal (MCP)

Anthropic's **Model Context Protocol** (Nov 2024) is "USB-C for AI" — each tool
implements an MCP server once; each agent implements the client once; N×M
integration collapses to N+M. Adopted across Notion, Slack, Linear, GitHub,
Salesforce, Stripe; OpenAI adopted it Mar 2025. (https://www.anthropic.com/news/model-context-protocol;
https://en.wikipedia.org/wiki/Model_Context_Protocol)

**Code execution with MCP** (Anthropic engineering, fetched) is the scaling key
when the body has *hundreds* of organs: present tools as a **filesystem of code
APIs**; the model reads tool defs **on-demand** (progressive disclosure) instead
of loading all upfront — "**150,000 tokens → 2,000 tokens, a 98.7% saving**";
filter data in-code before it hits context; keep PII out of the model via
tokenization; persist reusable skills to a filesystem.
(https://www.anthropic.com/engineering/code-execution-with-mcp)

**For the MD:** the estate has far more than a chat-window's worth of tools
(every route, every junior, every connector under `packages/connectors/`).
Progressive-disclosure-over-MCP is the only way the MD can wield its whole body
without drowning in tool tokens. Internal surfaces = MCP servers the MD owns;
external portals = computer-use behind an MCP-tool facade — one uniform syscall
surface either way.

### 2.3 Generative UI — the MD actuates by *materializing* surfaces

The MD shouldn't only *fill* existing screens; it should **conjure them**.
Generative UI lets an LLM "go beyond text and generate UI" by binding tool-call
results to React components; React Server Components stream UI from the model
with no heavy client JS; schemas become LLM tool definitions the agent "calls
like functions and renders the result" (Tambo, Vercel AI SDK 3, LangGraph
generative-UI, CopilotKit). Notably: users preferred AI-generated HTML/CSS/JS
over markdown **83% of the time**; UI generation is "an emergent capability
requiring no UI-specific training"; the vision is "infinite ephemeral
interfaces."
(https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces;
https://docs.langchain.com/langsmith/generative-ui-react;
https://github.com/narrowin/awesome-generative-ui)

**This is already Borjie's flagship.** MEMORY.md: "dynamic tabs were two
unconnected systems … now wired end-to-end (49dc23ac)"; the latest commit is
"owner-web: truly chat-first — genui tabs spawn in the background from chat."
The repo has `dynamic-sections/DynamicTabBar`, `portal-tabs.schema`,
`portal-layouts.schema`, and brain-kernel `tools/render-blocks/`. Generative-UI
is the MD's primary *actuation-into-its-own-body* verb: it doesn't navigate the
owner cockpit, it **grows new organs on demand**. The frontier validates this is
the right bet, not a gimmick.

### 2.4 The actuation primitives the MD already has (repo-grounded)

`packages/central-intelligence/src/kernel/power-tools/` is the MD's syscall
table. Each maps to a frontier concept:

- `handoff.ts` — escalate a turn to a higher tier (verified in source: estate-
  manager mid-eviction lacks org-admin scope → typed handoff contract, escalate
  UP only). **= AIOS access-manager + multi-agent handoff.**
- `blackboard-stream.ts` — emit `progress|decision|observation|warning` onto a
  per-session **blackboard** channel with monotonic sequence numbers; UI renders
  a live timeline (verified in source). **= the blackboard architecture below.**
- `compose.ts` — compose tools. **= MCP code-execution composition.**
- `schedule.ts` — schedule future actions. **= ambient/proactive scheduler.**
- `sandbox.ts` — isolated execution. **= computer-use VM sandboxing.**
- `self-modification.ts` — the MD edits itself. **= self-modeling agents (§4).**
- `registry.ts` / `types.ts` — typed tool registry with tiers. **= AIOS tool
  manager + the `power-tools-registry-shape.yml` CI gate.**

---

## 3. Cross-surface shared state — carrying a thing between organs

This is the heart of the brief: *move a doc/task/decision from chat → a tab →
mobile.* Two frontier pillars.

### 3.1 The blackboard (shared workspace for many agents/surfaces)

"A blackboard is a shared, structured workspace where heterogeneous agents post
partial results, hypotheses, constraints, and goals for others to observe,
refine, or refute." Modern realizations span "tuple-space designs, append-only
event logs … **CRDT-backed shared documents for eventual consistency**, and
vector-indexed memories." A concrete design (AISAC): "a shared agent workspace
(blackboard) … scoped by user, task, and named slot, through which agents can
**write, read, append, patch, and search** shared content during execution …
without inflating agent prompts."
(https://arxiv.org/html/2510.14312v1 — Terrarium;
https://arxiv.org/pdf/2511.14043 — AISAC;
https://arxiv.org/abs/2507.01701 — Blackboard MAS)

**For the MD:** the blackboard is the *medium through which a thing travels
between surfaces.* A decision the MD makes in chat is **posted to a named slot**;
the owner-cockpit tab and the workforce-mobile screen are both **subscribers** to
that slot. The thing isn't "copied" from chat to tab to phone — it lives once on
the blackboard and every organ projects it. Borjie's `blackboard-stream` power-
tool is the seed; today it streams *progress events*. The recommendation:
**promote it from a progress firehose to the canonical cross-surface state bus** —
add write/read/append/**patch**/search verbs (the AISAC verb set), make slots
durable + tenant-scoped (RLS), and let every surface subscribe.

### 3.2 CRDTs — conflict-free shared state across surfaces & devices

When the same doc/task/decision is edited on a tab AND a phone (and by the MD
itself) concurrently, you need conflict-free convergence. CodeCRDT applies CRDT
principles to "observation-driven coordination for multi-agent LLM code
generation," and CRDT-backed shared documents are cited as a first-class
blackboard substrate for "eventual consistency."
(https://arxiv.org/pdf/2510.18893; https://arxiv.org/html/2510.14312v1)

**For the MD:** a shared decision/task object should be a CRDT so that
owner-web, the two mobile apps, and the MD can all mutate it offline-then-merge
without a lock or a lost update — the rigorous foundation under "carry a task
from chat to a tab to mobile and keep editing on the train."

### 3.3 Cross-DEVICE handoff & continuity (the omnipresence transport)

The consumer-OS reference designs for moving a live task between devices:

- **Apple Handoff** — start on iPhone, resume on Mac/iPad with near-perfect
  continuity via the same iCloud account.
- **Google "Continue On" (Android 17, I/O 2026)** — system-level, **bidirectional**
  ("switch back and forth at any moment"), works across Workspace + Chrome:
  "takes a snapshot of your app's current state, finds nearby devices on the same
  account, and transfers that info securely," with sensitive state kept local via
  Private Compute Core.
  (https://www.androidauthority.com/how-android-handoff-will-work-3601801/;
  https://www.tech2geek.net/android-17-introduces-continue-on-googles-answer-to-apple-handoff/)
- **Project Astra cross-device memory** — "switch devices and carry on the same
  conversation." (https://deepmind.google/models/project-astra/)

**For the MD:** the MD's own session/blackboard state *is* the snapshot. Because
the body is one brain, "handoff" is not a device-to-device file transfer — it's
**re-projecting the same live blackboard state onto whichever surface the human
is now looking at.** An owner mid-decision on owner-web walks to a site; the
workforce-mobile app opens on the same decision because both are views of one MD
state. The repo's `power-tools/handoff.ts` is a *tier* handoff today; the
recommendation is a sibling **surface/device handoff** primitive that re-renders
the active blackboard slot onto the destination surface via generative UI.

---

## 4. Ambient omnipresence — always-on, proactive, anticipatory, everywhere

### 4.1 Ambient agents (the always-on, event-driven paradigm)

LangChain's Harrison Chase (Sequoia AI Ascent 2025) named it: ambient agents
"operate continuously in the background, responding to events rather than direct
human prompts," "surface information and recommendations before a human thinks to
look," are "multi-threaded" (one agent handles dozens of concurrent events),
maintain memory/system state, and keep **human-in-the-loop checkpoints**
(notify / ask / review). LangChain's production email agent has run for months.
(https://venturebeat.com/ai/whats-next-for-agentic-ai-langchain-founder-looks-to-ambient-agents)
Change-driven architecture (Microsoft) is the enabling pattern: agents subscribe
to event streams, not chat turns.
(https://techcommunity.microsoft.com/blog/linuxandopensourceblog/beyond-the-chat-window-how-change-driven-architecture-enables-ambient-ai-agents/4475026)

**For the MD:** the MD must not wait to be asked. It subscribes to the estate's
event streams (event_outbox, ledger posts, licence clocks, FX ticks, KYC state)
and acts on its own surfaces — the blackboard-stream `warning`/`decision` events
are the human-in-the-loop checkpoints. MEMORY.md confirms partial wiring: "live
follow-up schedulers," "real proactive notification sink." `power-tools/schedule`
+ change-driven subscriptions = the ambient runtime.

### 4.2 Proactive / anticipatory agents (predict intent, pre-compute)

The 2026 benchmark literature defines and measures this precisely:

- **ProAgentBench**: a proactive agent "perceives environmental context, infers
  user intentions without explicit prompts, and autonomously suggests actions."
  (https://arxiv.org/html/2602.04482v1)
- **ProAct / "Anticipate and Learn"**: exploit **idle-time compute** to
  "anticipate and fulfill likely upcoming user needs," analyzing dialogue +
  persistent memory to predict needs and pre-acquire information.
  (https://arxiv.org/abs/2605.25971)
- **PASK**: intent-aware proactive agents with long-term memory predicting needs
  in real time. (https://arxiv.org/html/2604.08000v1)
- **PIRA-Bench**: the transition "from reactive GUI agents to GUI-based
  proactive intent recommendation agents." (https://arxiv.org/pdf/2603.08013)
- **π-Bench**: proactive personal assistants in long-horizon workflows.
  (https://arxiv.org/abs/2605.14678v3)

**For the MD:** idle-time compute is the unlock. Between owner sessions, the MD
should *pre-render* the tabs the owner will likely want (world-model + intent
prediction), pre-draft the compliance return, pre-stage the bid response — so the
surface is already warm when the human arrives. This is "spawn-on-need UI"
(`SPAWN_ON_NEED_UI_SOTA_2026.md`) upgraded to **spawn-before-need**.

### 4.3 Universal assistant omnipresence (Astra synthesis)

Astra is the integrated proof that perception + memory + proactivity + action +
multi-device can co-exist in one assistant "on the way to a universal AI
assistant" (Gemini I/O 2025). (https://blog.google/innovation-and-ai/models-and-research/google-deepmind/gemini-universal-ai-assistant/;
https://deepmind.google/models/project-astra/) The MD's differentiator: Astra is
omnipresent across Google's *consumer* surfaces; the MD is omnipresent across an
*entire enterprise's operating fabric* — and it *owns* those surfaces, so it can
do what Astra can't: rewrite them.

### 4.4 Self-modeling — the MD knows itself well enough to inhabit itself

To be the OS of its own body, the MD needs a model *of itself*. The 2024–2026
introspection literature is now substantial: "self-awareness requires a system to
recognize itself, model its own decision-making processes, and adjust behavior
based on that self-model"; LLMs "can quantitatively report the internal decision
weights guiding their choices," and "introspection training" improves it; models
show "behavioral self-awareness … articulating properties of their own learned
policies."
(https://arxiv.org/pdf/2508.14802 — Privileged Self-Access;
https://arxiv.org/pdf/2601.01828 — Emergent Introspective Awareness;
https://arxiv.org/html/2505.17120v1 — Self-Interpretability;
https://arxiv.org/html/2501.11120v1 — "Tell me about yourself")

**For the MD:** `power-tools/self-modification.ts` + the durable cognitive
memory + audit-chain are the substrate for an explicit **self-model**: a live
representation of which organs (surfaces, juniors, tools) it has, their health,
its own confidence/uncertainty, and its tier/permission map. A body that can
sense and modify itself — within the inviolable kill-switch/policy-gate guardrails
— is the literal realization of "the MD is the OS whose body is the project."

---

## 5. Synthesis — the architecture that makes the MD become the OS

```
                       ┌──────────────────────────────────────────┐
   WORLD (camera,      │            THE MD  (AIOS-style kernel)     │
   voice, docs, field)─┼─▶ PERCEPTION ──▶ WORLD MODEL ──▶ ACTUATION │──▶ BODY
                       │   (Astra-grade   (active        (power-tools │    (4 apps,
   BODY proprioception─┼─▶  multimodal +  inference,      = syscalls; │     every tab,
   (each surface emits │    self AX-tree) predict next    genUI =     │     route, junior)
   its UI state) ──────┘    + introspect) estate state)   grow organs)│
                            │                                  │       │
                            └────────── BLACKBOARD ◀───────────┘       │
                              (CRDT slots, write/read/append/patch/    │
                               search; every surface subscribes;       │
                               the medium a thing travels through)     │
                            ▲                                          │
            AMBIENT RUNTIME │ (event-driven subscriptions, idle-time   │
            (always-on,     │  pre-compute, schedulers, HITL warnings) │
            proactive) ─────┘                                          │
                              MCP + code-execution = uniform syscall   │
                              surface over internal organs AND external│
                              portals (computer-use behind MCP facade) │
                       └──────────────────────────────────────────────┘
```

**Seven moves that turn Borjie's existing pieces into a literal OS-with-a-body:**

1. **Name the kernel.** Re-frame `central-intelligence` + `power-tools` as the
   AIOS kernel (scheduler/context/memory/storage/tool/access managers). The
   power-tools registry *is* the LLM system-call table. (AIOS, MemGPT)
2. **Proprioception by construction.** Every surface emits its UI state (active
   tab, focused entity, form drafts) as a structured stream — the MD reads its
   own accessibility tree instead of screenshotting itself. (GUI-agent hybrid
   perception, Astra)
3. **Promote the blackboard** from a progress firehose to the canonical
   cross-surface state bus with CRDT slots and the write/read/append/patch/search
   verb set; every surface subscribes. This is *the* mechanism for "carry a
   doc/task/decision between surfaces." (Blackboard MAS + CRDT)
4. **Surface/device handoff primitive** beside the existing tier `handoff`:
   re-project the active blackboard slot onto wherever the human now is, via
   generative UI. (Apple Handoff / Google Continue-On / Astra cross-device)
5. **Generative UI as the primary actuation verb** into the MD's own body — grow
   organs on demand; already the flagship, validated by the 83%-preference and
   "emergent capability" findings. (Vercel AI SDK / LangGraph / Tambo)
6. **MCP + code-execution** as the uniform syscall surface over hundreds of
   organs; internal organs are MCP servers the MD owns, external portals are
   computer-use (UI-TARS-style, hybrid DOM-first/vision-fallback) behind an MCP
   facade. Progressive disclosure keeps it token-survivable. (MCP, Anthropic
   code-execution, Browser-Use/UFO² hybrid, UI-TARS)
7. **Ambient + proactive runtime:** subscribe to estate event streams, spend
   idle-time compute to *spawn-before-need* (pre-render tabs, pre-draft
   filings), with blackboard `warning`/`decision` events as HITL checkpoints,
   governed by kill-switch/policy-gate. Add a live **self-model** via
   `self-modification` + audit-chain. (LangChain ambient, ProAct/PASK,
   active-inference, introspection literature)

The result: a brain that **sees every part of its body and the world, acts on any
organ, moves a thing through the blackboard from chat to tab to phone, and is
present everywhere at once, anticipating before it is asked** — Jarvis-grade, and
beyond, because unlike Jarvis the MD *owns the body it inhabits and can grow new
organs at will.*

---

## 6. Sources (every URL was fetched or returned by live search this session)

**Fetched in full (load-bearing):**
- AIOS — LLM Agent Operating System — https://arxiv.org/abs/2403.16971
- Anthropic — Code execution with MCP — https://www.anthropic.com/engineering/code-execution-with-mcp
- DeepMind — Project Astra — https://deepmind.google/models/project-astra/
- Zylos — Computer Use & GUI Agents 2026 SOTA — https://zylos.ai/research/2026-02-08-computer-use-gui-agents

**Returned by live web search (summarized, not individually fetched):**
- MemGPT: LLMs as Operating Systems — https://arxiv.org/abs/2310.08560
- MCP announcement (Anthropic) — https://www.anthropic.com/news/model-context-protocol
- MCP — Wikipedia — https://en.wikipedia.org/wiki/Model_Context_Protocol
- UI-TARS (native GUI agent) — https://arxiv.org/html/2501.12326v1
- UI-TARS-2 technical report — https://arxiv.org/html/2509.02544v1
- Browser-Use / SOTA web agents 2024-2025 — https://medium.com/@learning_37638/state-of-the-art-autonomous-web-agents-2024-2025-3d9d93a5dde2
- Agent-S (open agentic framework) — https://github.com/simular-ai/Agent-S
- WebArena — https://arxiv.org/pdf/2307.13854
- OSWorld-Human (efficiency) — https://arxiv.org/html/2506.16042v1
- Vercel AI SDK — Generative UI — https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces
- LangGraph generative UI — https://docs.langchain.com/langsmith/generative-ui-react
- awesome-generative-ui — https://github.com/narrowin/awesome-generative-ui
- LangChain ambient agents (VentureBeat) — https://venturebeat.com/ai/whats-next-for-agentic-ai-langchain-founder-looks-to-ambient-agents
- Microsoft — change-driven ambient agents — https://techcommunity.microsoft.com/blog/linuxandopensourceblog/beyond-the-chat-window-how-change-driven-architecture-enables-ambient-ai-agents/4475026
- Terrarium — blackboard for multi-agent safety — https://arxiv.org/html/2510.14312v1
- AISAC — shared-workspace blackboard verbs — https://arxiv.org/pdf/2511.14043
- Blackboard MAS — https://arxiv.org/abs/2507.01701
- CodeCRDT — CRDT multi-agent coordination — https://arxiv.org/pdf/2510.18893
- Deep Active Inference Agents — https://arxiv.org/pdf/2505.19867
- World Models survey ("From Masks to Worlds") — https://arxiv.org/pdf/2510.20668
- ProAgentBench — https://arxiv.org/html/2602.04482v1
- ProAct / Anticipate and Learn — https://arxiv.org/abs/2605.25971
- PASK (intent-aware proactive) — https://arxiv.org/html/2604.08000v1
- PIRA-Bench — https://arxiv.org/pdf/2603.08013
- π-Bench — https://arxiv.org/abs/2605.14678v3
- Privileged Self-Access (introspection) — https://arxiv.org/pdf/2508.14802
- Emergent Introspective Awareness — https://arxiv.org/pdf/2601.01828
- Self-Interpretability — https://arxiv.org/html/2505.17120v1
- "Tell me about yourself" (behavioral self-awareness) — https://arxiv.org/html/2501.11120v1
- Gemini universal AI assistant (I/O 2025) — https://blog.google/innovation-and-ai/models-and-research/google-deepmind/gemini-universal-ai-assistant/
- Google "Continue On" handoff — https://www.androidauthority.com/how-android-handoff-will-work-3601801/
- Android 17 Continue On — https://www.tech2geek.net/android-17-introduces-continue-on-googles-answer-to-apple-handoff/

**Marked UNVERIFIED** (figures came from search-result summaries, not a fetched
primary page): Anthropic Computer Use OSWorld ≈72.5% and OpenAI Operator
OSWorld/WebArena figures. Treat the *direction* (Anthropic ≈ frontier on
OSWorld; Operator strong on WebArena, weaker on OSWorld) as reliable; treat exact
percentages as needing a primary-source check before quoting externally.
