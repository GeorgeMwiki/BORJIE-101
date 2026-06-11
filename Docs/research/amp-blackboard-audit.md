# AMP — Blackboard Substrate Audit (read-only)

**Lane:** `blackboard-audit` · **Date:** 2026-06-08 · **Repo state:** READ-ONLY (no code, no commit)
**Owner directive under audit:** INV-H (amplified) — "THE BLACKBOARD … is the SHARED-STATE SPINE that
unifies (a) the Face two-views-of-one-state, (b) the Mind resident Current Situational Model, (c)
multi-agent/juniors coordination" (`Docs/research/MASTER_GAP_REGISTER.md:534-537`).

> **One-line verdict:** The blackboard is a beautifully-engineered, fully-tested, **completely
> dark** substrate. Two distinct, non-overlapping CRDT/Erman-style systems exist in
> `blackboard-sota` + `blackboard-intel`, but **nothing outside those packages imports them** —
> no gateway route, no app subscriber, no kernel tick, no junior. For ALL THREE roles the spine is
> **ABSENT in production** (PARTIAL only as built-but-unwired library code). This is exactly the
> BLOCKER the gap register already files as **EA-05**.

---

## 1. What IS the blackboard? (substrate inventory)

There are **three** things called "blackboard" in this repo; they are **not the same thing** and
do not talk to each other:

### A. `packages/blackboard-sota` — the SOTA Erman/Hayes-Roth board + a CRDT slot bus

A clean hexagonal package (`@borjie/blackboard-sota`). Two layers:

**A1. Classic blackboard (BLACKBOARD-CORE wave)** — 5 record types mirroring migration
`0073_blackboard_sota.sql` (`packages/blackboard-sota/src/types.ts:67-129`):
- **Regions** — named problem namespaces (`incident-investigation`, `royalty-filing-prep`,
  `buyer-deal-room`, …). Lifecycle `open→active→closed`, per-region **hash-chained audit**
  (`regions/region-manager.ts`, `audit/hash-chain.ts`).
- **Knowledge Sources** — registry of `junior | connector | tool | user | external-feed`, with
  per-region-kind filters + priority (`knowledge-sources/ks-registry.ts`).
- **Posts** (`blackboard_posts_v2`) — threaded, append-only, embedding-bearing, SSE-fanned-out,
  chained into the region audit (`posts/post-publisher.ts`, `posts/post-stream.ts`).
- **CrossReferences** — semantic `cites|contradicts|answers|supersedes|elaborates` links detected
  by cosine ≥ 0.85 (`crossref/crossref-detector.ts`).
- **Summaries** — rolling/final/digest token-budgeted condensation with a cron
  (`summary/summary-generator.ts`, `summary/rolling-summary-cron.ts`).
- **Control shell** — the **Hayes-Roth 1985 metalevel scheduler**: a PURE `pickNext()` that scores
  every eligible KS by `priority × freshness(exp-decay) × competence` and emits a
  `ControlActivation` envelope (it does NOT call the KS — "the agent-runtime listens to these
  events and dispatches", `control/control-shell.ts:9-11,74-150`). **No agent-runtime listener
  exists.**

**A2. Cross-surface CRDT slot bus (MD-as-Body capstone)** — the part that is supposed to be the
"two views of one state" spine (`types.ts:262-449`, `slots/`, `handoff/`):
- **Named slots** (`Slot`, `types.ts:331-348`): a **proper CRDT** = Last-Writer-Wins register over
  an arbitrary JSON value, paired with a **version vector** (per-actor Lamport counters). Merge is
  the **lattice join** (element-wise max of vectors + a TOTAL-order LWW tie-break:
  `clock → wallClockMs → actorId`), proven commutative/associative/idempotent and **unit-tested**
  (`slots/slot-crdt.ts:41-180`, `__tests__/slot-crdt.test.ts`). So: **CRDT, not last-write** — and
  it is real, not a stub.
- **Slot kinds** drive how a surface renders: `decision|document|task|draft|dataset|note`
  (`types.ts:280-288`). **Slot surfaces**: `chat|owner-web|workforce-mobile|buyer-mobile|admin-web`
  (`types.ts:294-301`) — i.e. the design intends all four product surfaces + chat to project the
  same slot.
- **SlotStore** (`slots/slot-store.ts`): writes persist via the CRDT merge AND broadcast a
  `SlotDelta` on the tenant-scoped `state-bus` realtime channel; inbound deltas feed back through
  the SAME merge (loop-suppressed by `originSurface`). This is the "lives once, every surface
  converges" front door.
- **HandoffService** (`handoff/handoff.ts`): the Apple-Handoff / Continue-On primitive —
  re-projects the LIVE slot onto another surface (does NOT copy), records a provenance breadcrumb,
  broadcasts `slot-handoff`.

### B. `packages/blackboard-intel` — the self-improving / search layer over posts

`@borjie/blackboard-intel` (BLACKBOARD-INTEL wave, migration `0074`). Three-axis post quality
scoring (groundedness/calibration/utility), capability-catalogue registration, meta-curator
feedback, and **hybrid FTS+dense+RRF search** over the entire posting history, plus a per-score
audit chain (`packages/blackboard-intel/src/index.ts`). It depends on `blackboard-sota` only at the
doc/comment level (`blackboard-intel/src/types.ts:9,53`) via a `BlackboardCorePort` seam.

### C. `packages/chat-ui/src/blackboard/Blackboard.tsx` — a TEACHING CANVAS (false friend)

This is **NOT** the slot bus. It is a presentational React "teaching surface" (a dark panel with a
canvas slot + a freeform notes textarea) that opens when a tutoring concept is introduced
(`packages/chat-ui/src/blackboard/Blackboard.tsx:28-127`). Same name, totally different concept. The
owner-web chat uses a SEPARATE local copy of this idea —
`apps/owner-web/src/components/blackboard/` with a module-level `useReducer` store
(`use-blackboard-store.ts`) "parity with LitFin's `smartboardReducer`, but local rather than
provider-based" — i.e. **in-browser ephemeral board state, no CRDT, no realtime, no persistence,
single-surface.** This is what is actually mounted in chat (`OwnerOSChatPanel.tsx:18,180`).

### D. Two MORE legacy "blackboard" namesakes (for completeness)
- `packages/central-intelligence/src/kernel/power-tools/blackboard-stream.ts` — a kernel power-tool
  that emits `progress|decision|observation|warning` **progress events** onto a per-thread channel
  for human-in-the-loop monitoring. In-process seq counter; **refuses with `NOT_IMPLEMENTED` when no
  publisher is bound** (`blackboard-stream.ts:162-169`) — and **no production publisher is bound**
  (only `createInMemoryBlackboardPublisher` is exported; grep finds no composition-root binding).
- `packages/database/src/schemas/swarm-coordination.schema.ts:116` — a legacy `blackboard_postings`
  pgTable from the old Wave-18HH primitive (superseded by `blackboard_posts_v2`).

**Persistence reality:** Drizzle schema `packages/database/src/schemas/blackboard-sota.schema.ts`
defines pgTables for the **5 core tables only** (`blackboardRegions`, `blackboardKnowledgeSources`,
`blackboardPostsV2`, `blackboardCrossReferences`, `blackboardSummaries`) + RLS in
`drizzle/0073_*.sql` / `0297_*.sql`. There is **NO `blackboardSlots` pgTable and no slots
migration** — the CRDT slot bus (the actual spine) has **zero production persistence**, and there
is **no SQL/Drizzle repository adapter for ANY blackboard repo** (grep of
`blackboard-sota/src/repositories` for `createSql|Drizzle` = empty; only `in-memory-*` adapters
exist). The package comments repeatedly say "production wires Drizzle" — **production never did.**

---

## 2. Is it on the MAIN chat, or only LITFIN/credit?

**Neither, in production — and the MAIN chat uses a different board entirely.**

- The owner-web MAIN chat (`OwnerOSChatPanel.tsx`) mounts the **teaching-canvas** board
  (§1.C: local `useBlackboardStore` reducer). That board has **no connection** to `blackboard-sota`
  slots/handoff/control/posts. It is "parity with LitFin's `smartboardReducer`" — a UI port of the
  LitFin smartboard pattern, kept **local** (the comment is explicit).
- The `blackboard-sota` / `blackboard-intel` packages are **not imported by any app or service.**
  Outside the two packages themselves, the ONLY references are:
  - one **deferred-work comment** in `services/api-gateway/src/composition/cognitive-wiring.ts:115`
    ("`@borjie/blackboard-intel` + `@borjie/blackboard-sota` — complex parallel-agent coordination
    boards. **Not on the core /turn path.**"),
  - a schema-export comment (`packages/database/src/schemas/index.ts:1027`).
  - **No `package.json` anywhere declares `@borjie/blackboard-sota` or `-intel` as a dependency**
    (grep across all `package.json` = empty). They are orphan workspace packages.
- **No `blackboard.hono.ts` route exists** (the gap register's prescribed fix, EA-05). No
  `/slot`, `/handoff`, region, or post endpoint in `services/api-gateway/src/routes`.
- **No app has a `use-slot` hook** or subscribes to the `state-bus` channel. The only thing that
  names `state-bus` is `packages/realtime-adapter` itself, which merely reserves the topic string
  (`realtime-adapter/src/types.ts:23`) + tests it — nobody broadcasts or subscribes.

So it is **not LITFIN-only**; it is **nobody's.** The LitFin lineage shows up only as (i) the
teaching-board UI port that the main chat actually uses, and (ii) doc references in
`MD_AS_BODY_ARCHITECTURE.md`. (No `LP-` backlog item names the blackboard specifically — searched
`Docs/` for `LP-####…blackboard`, none.)

---

## 3. Can it serve as the SHARED-STATE SPINE for the three roles? Per-role verdict

The substrate is, by design, **capable** of all three — the CRDT slot bus is genuinely SOTA and the
control-shell/posts give real multi-agent coordination primitives. But **all three are unwired**, so
the truthful status is PARTIAL (library exists, tested) → **ABSENT in the running system.**

### Role (a) — The Face: "two views of one state" (chat + surfaces render the SAME slots)
**Verdict: ABSENT (library PARTIAL).**
- BUILT: `SlotStore` write/broadcast/merge (`slots/slot-store.ts:79-146`), `HandoffService`
  re-projection (`handoff/handoff.ts:74-128`), 5 surfaces enumerated (`types.ts:294-301`),
  render-hint `slotKind` (`types.ts:280-288`). The CRDT guarantees convergence across surfaces
  (`slots/slot-crdt.ts`).
- WIRING GAP (the whole chain is missing):
  1. **No gateway slot route** — no `blackboard.hono.ts` to set/read/handoff a slot (EA-05).
  2. **No SlotDelta broadcaster bound** to the realtime topic — `SlotStore` is never constructed at
     a composition root; `state-bus` is reserved but unused.
  3. **No app subscriber** — owner-web + workforce-mobile + buyer-mobile have **no `use-slot`** /
     no `connect(tenantId)` call; the chat mounts the unrelated local teaching board instead
     (`OwnerOSChatPanel.tsx:180`).
  4. **No persistence** — no `blackboardSlots` pgTable, no migration, no SQL `SlotsRepository`; only
     `createInMemorySlotsRepository` exists (`repositories/in-memory-slots-repository.ts`). A slot
     would not survive a process restart even if wired.
- RESULT (gap register EA-05, **BLOCKER**): "Cross-surface state bus (blackboard) reaches no surface
  — decision can't project to 2nd screen" (`MASTER_GAP_REGISTER.md:176`).

### Role (b) — The Mind: resident Current Situational Model (kernel reads/writes each tick)
**Verdict: ABSENT (no integration at all).**
- The slot bus could hold the persistent situational state, and posts/summaries could be the
  per-tick working memory — but the **brain kernel never imports `blackboard-sota`.** Grep of
  `packages/central-intelligence/src` for `blackboard` finds only the unrelated `blackboard-stream`
  progress-event power-tool and a doc string. The kernel's `/turn` path is enriched by
  `cognitive-memory` (memory-v2), **not** by any blackboard slot.
- WIRING GAP: there is **no "read the situational model first each tick" hook.** The control-shell
  (`pickNext`) — which is the natural metalevel-scheduler heartbeat — has **zero callers**; nothing
  ticks it. There is no resident model that the kernel writes a slot to and reads back next turn.
- RELATED OPEN GAP: **COG-15 / ORCH-situation** (`MASTER_GAP_REGISTER.md:290`) — "No unified
  situational self-state / blind-spots model (world-model/goal-tracker/stall-detector disjoint;
  supervisor types unused)". The prescribed six-facet `SituationalSelfModel`
  (happened/doing/todo/future/blind-spots/caveats) is **not built**; the blackboard slot bus is the
  obvious substrate for it but is not connected. INV-J (`:514-516`) asserts the MD has a "resident
  Current Situational Model" — today that is **aspirational**, not implemented.

### Role (c) — Multi-agent / juniors coordination (handoff / control / posts)
**Verdict: ABSENT (juniors never touch it).**
- BUILT: the FULL classic-blackboard coordination kit — KS registry (juniors registerable as
  knowledge sources, `ks-registry.ts`), opportunistic control shell that schedules KS activations
  (`control/control-shell.ts`), append-only posts with threading + SSE + cross-reference detection
  (`posts/`, `crossref/`), `HandoffService` for agent→agent/surface handoff. blackboard-intel adds
  KS competence scoring (`measure/`) which feeds the control-shell `CompetenceLookupPort` — a
  genuinely closed self-improving loop **on paper.**
- WIRING GAP: **the juniors do not post to / read from the blackboard.** Grep of
  `packages/ai-copilot/src/juniors` for `blackboard|handoff|postToRegion|knowledge-source|control-shell`
  = **empty.** No junior is registered as a `KnowledgeSource`; nothing calls `pickNext()`; no
  `ControlActivation` listener dispatches a junior; no junior `publish()`es a post. The kernel's own
  handoff (`brain.hono.ts:321` `case 'handoff'`) is a separate orchestrator construct, unrelated to
  the blackboard `HandoffService`.
- RELATED: **EA-07** (`:179`) wants ambient/idle pre-render to land in a "blackboard slot" — also
  blocked on the same missing bus. **EA-10** (`:183`) flags BossNyumba has **zero** body-model layer
  and needs `blackboard-sota` ported — i.e. cross-repo parity is also absent.

---

## 4. Summary table

| Role | Spine intent | Built (library) | Wired (prod) | Blocking gap |
|---|---|---|---|---|
| (a) Face: two views of one state | chat + surfaces render same slots | YES — CRDT slot bus + handoff, tested | **NO** | EA-05 BLOCKER: no route, no subscriber, no broadcaster, no persistence |
| (b) Mind: resident Current Situational Model | kernel reads/writes a slot each tick | PARTIAL — slots/posts could host it | **NO** | kernel never imports blackboard; control-shell has 0 callers; COG-15 model unbuilt |
| (c) Juniors coordination | handoff/control/posts between agents | YES — KS registry + control shell + posts + xref + intel scoring | **NO** | juniors never post/handoff; no `ControlActivation` dispatcher |

**Net:** the blackboard is the **right substrate, fully present as a library, zero percent
integrated.** It is an orphan workspace package pair (no dependents) plus a same-named-but-unrelated
teaching canvas that the real chat actually uses. To become the spine it needs, at minimum:
a `blackboardSlots` Drizzle table + migration + SQL `SlotsRepository`; a `blackboard.hono.ts`
gateway route; a `SlotStore` broadcaster bound to the `state-bus` realtime topic; a `use-slot`
subscriber in owner-web + both mobiles (replacing/augmenting the local teaching board); a kernel
per-tick read/write of a situational slot; and junior registration + a `ControlActivation`
dispatcher. All of this is captured by the gap register as **EA-05 (BLOCKER), EA-07, EA-10,
COG-15** — this audit confirms those entries are accurate and nothing has since been wired.

### Key file:line anchors
- CRDT slot core: `packages/blackboard-sota/src/slots/slot-crdt.ts:41-180`
- Slot bus front door: `packages/blackboard-sota/src/slots/slot-store.ts:79-146`
- Handoff primitive: `packages/blackboard-sota/src/handoff/handoff.ts:74-128`
- Control shell (no callers): `packages/blackboard-sota/src/control/control-shell.ts:74-150`
- Slot/surface/kind types: `packages/blackboard-sota/src/types.ts:280-449`
- In-memory-only slots repo (no SQL): `packages/blackboard-sota/src/repositories/in-memory-slots-repository.ts:20`
- Core Drizzle schema (no slots table): `packages/database/src/schemas/blackboard-sota.schema.ts:87-244`
- Only external mention (deferred): `services/api-gateway/src/composition/cognitive-wiring.ts:115`
- Real-chat board (unrelated): `apps/owner-web/src/components/blackboard/use-blackboard-store.ts`, mounted at `apps/owner-web/src/components/owner-os/OwnerOSChatPanel.tsx:180`
- Teaching-canvas namesake: `packages/chat-ui/src/blackboard/Blackboard.tsx:28-127`
- Kernel progress-event namesake (NOT_IMPLEMENTED when unbound): `packages/central-intelligence/src/kernel/power-tools/blackboard-stream.ts:162-169`
- Gap register: EA-05 `:176`, EA-07 `:179`, EA-10 `:183`, COG-15 `:290`, INV-H spine directive `:534-537`
