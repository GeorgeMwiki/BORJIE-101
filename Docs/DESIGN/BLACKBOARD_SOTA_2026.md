# Blackboard SOTA — Design Specification

> Wave **BLACKBOARD-CORE** — the architectural upgrade above Wave 18HH's
> `blackboard_postings` primitive. The classic Blackboard pattern
> (Erman / Hayes-Roth, 1980-1985) modernised for multi-agent LLM
> systems: knowledge sources, control shell, regions, reactive flow,
> cross-reference detection, summarisation, and audit chain.
>
> Companion package: `@borjie/blackboard-sota` (new —
> `packages/blackboard-sota/`).
> Companion migration: `0073_blackboard_sota.sql`.
>
> **Cross-links:**
> [`AGENT_SWARM_COORDINATION_SOTA.md`](./AGENT_SWARM_COORDINATION_SOTA.md)
> (Wave 18HH posting primitive — the row this upgrade layers above);
> [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md)
> (Wave 18AA — `text-embedding-3-large` port reused for cross-reference
> detection); [`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md)
> (Wave CAPABILITY — KS competence measurements feed the control
> shell's scoring); [`META_LEARNING_CONDUCTOR_SPEC.md`](./META_LEARNING_CONDUCTOR_SPEC.md)
> (Wave META — reads summaries as cross-region episodes);
> [`FOUNDER_LOCKED_DECISIONS_2026_05_26.md`](./FOUNDER_LOCKED_DECISIONS_2026_05_26.md)
> (live-test-only — no synthetic-only paths in production).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Why a blackboard for Mr. Mwikila

Mr. Mwikila is plural and his work is **non-linear**. An incident
investigation at the Kahama site is opened by a safety officer at
04:11; a geologist contributes a borehole reading at 04:14; the fleet
specialisation drops a maintenance log at 04:19; the regulator's KYB
agent posts a correspondence draft at 05:02; the owner asks "what did
we conclude?" at 09:30. Five hours, six contributors, three time
zones, two languages, no single linear thread.

Three coordination shapes are insufficient for this:

1. **Flat chat.** A single chronological stream collapses the
   contributors into noise. There is no way to see *"what evidence
   exists for hypothesis H"* without scrolling and reading every
   line. Slack, WhatsApp, and most agent dashboards today are this
   shape. ([Slack thread model][slack-thread] is a partial mitigation
   but still flat at root.)
2. **Thread tree.** Notion and Linear's threaded comments add depth
   but optimise for a single author with reviewers. The mining
   incident has *six* peer authors of equal authority and no obvious
   parent. Threads explode into a forest that no one can navigate.
   ([Notion comments threading model][notion-comments];
   [Linear issue model][linear-issues].)
3. **Append-only event log.** The Wave 18HH `blackboard_postings`
   primitive gives us this — a tenant-scoped, RLS-protected, subject-
   keyed pull workspace. It is correct as a primitive but does not
   answer: *which knowledge source should run next?* *Does this post
   contradict the borehole reading from 04:14?* *Summarise the last
   six hours into 500 tokens.* *Is the chain tamper-evident?*

The blackboard pattern was designed exactly for this multi-author,
heterogeneous-evidence, opportunistic-scheduling problem. Originally
the **Hearsay-II speech-understanding system** (Erman, Hayes-Roth,
Lesser, Reddy 1980 — [Hearsay-II][hearsay]) — five knowledge sources
(acoustic, lexical, syntactic, semantic, pragmatic) wrote to a shared
blackboard, and a control shell selected which one to activate next.
[Hayes-Roth (1985) *"A Blackboard Architecture for Control"*][hayes-roth]
generalised the control component into a metalevel blackboard that
schedules its own activation. Forty-five years later the pattern is
back in the AI literature ([CallSphere 2024-2025 blackboard for
multi-agent shared knowledge spaces][callsphere];
[arXiv 2510.01285 — BB-LLM 2024][arxiv-bbllm]).

Borjie crossed the threshold from "agent" to "agent swarm" at Wave
18V (dynamic junior spawning). Wave 18HH made coordination
*observable*. This spec — Wave BLACKBOARD-CORE — makes it
*intelligent*: a control shell decides which knowledge source runs
next based on freshness, priority, and measured competence; cross-
references are auto-detected via embeddings; multi-hour sessions are
summarised under a token budget; every post is hash-chained.

[hearsay]: https://dl.acm.org/doi/10.1145/356810.356816
[hayes-roth]: https://dl.acm.org/doi/10.1016/0004-3702%2885%2990063-3
[callsphere]: https://callsphere.ai/blog/blackboard-architecture-multi-agent-systems-shared-knowledge-spaces
[arxiv-bbllm]: https://arxiv.org/pdf/2510.01285
[slack-thread]: https://slack.com/help/articles/115001736387-Use-threads-to-organize-discussions-
[notion-comments]: https://www.notion.com/help/comments-mentions-and-reminders
[linear-issues]: https://linear.app/docs/issues

---

## 2. State of the art — 2024-2026 landscape

The six mandatory citations and several supporting references. Each
URL is annotated with the title and date so the spec is reproducible
without crawling.

- **Erman, Hayes-Roth, Lesser, Reddy — Hearsay-II (1980)** —
  [https://dl.acm.org/doi/10.1145/356810.356816](https://dl.acm.org/doi/10.1145/356810.356816)
  (Erman et al., *"The Hearsay-II Speech-Understanding System:
  Integrating Knowledge to Resolve Uncertainty"*, ACM Computing
  Surveys 12(2), June 1980 — the origin of the blackboard pattern).
  Five layers of knowledge sources operate on a shared blackboard
  segmented by abstraction level (parametric / segmental / syllabic /
  lexical / phrasal). A scheduler picks which KS to activate next
  based on the current blackboard state. This is the canonical
  reference that every modern blackboard-LLM paper cites.
- **Hayes-Roth — Control Architecture (1985)** —
  [https://dl.acm.org/doi/10.1016/0004-3702%2885%2990063-3](https://dl.acm.org/doi/10.1016/0004-3702%2885%2990063-3)
  (Hayes-Roth, *"A Blackboard Architecture for Control"*, Artificial
  Intelligence 26(3), July 1985). Generalises Hearsay-II's scheduler
  into a metalevel blackboard: the control shell is itself a
  blackboard that selects which domain KS to activate. We adopt the
  scoring vocabulary (priority × freshness × competence) directly.
- **Anthropic Multi-Agent Research System (2025)** —
  [https://www.anthropic.com/engineering/multi-agent-research-system](https://www.anthropic.com/engineering/multi-agent-research-system)
  (Anthropic Engineering, *"How we built our multi-agent research
  system"*, 13 June 2025). The lead researcher / subagent pattern is
  blackboard-shaped: parallel subagents post evidence to a shared
  context that the lead reads opportunistically. Anthropic reports a
  90.2 % uplift over single-agent Claude on internal research evals.
  We mirror their tool-result and citation patterns inside the
  `structured` jsonb column.
- **LangGraph State Graphs (2025)** —
  [https://blog.langchain.com/langgraph-multi-agent-workflows/](https://blog.langchain.com/langgraph-multi-agent-workflows/)
  (LangChain, *"LangGraph: Multi-Agent Workflows"*, 23 January 2024,
  updated through 2025 docs at
  [https://langchain-ai.github.io/langgraph/concepts/multi_agent/](https://langchain-ai.github.io/langgraph/concepts/multi_agent/)).
  State-graph nodes write to a shared `State` dict; the supervisor
  routes by reading the dict. Our regions are the durable equivalent.
- **Microsoft AutoGen GroupChat (2025)** —
  [https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/design-patterns/group-chat.html](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/design-patterns/group-chat.html)
  (Microsoft Research, *"AutoGen Core User Guide — Group Chat
  Pattern"*, accessed 2025-2026). GroupChatManager is the control
  shell; the speaker-selection policy is exactly the activation rule
  we encode in `activation-policy.ts`. AutoGen's `selector_func` is
  our `pickNextKnowledgeSource()`.
- **CrewAI Memory & Process Patterns (2025)** —
  [https://docs.crewai.com/concepts/memory](https://docs.crewai.com/concepts/memory)
  (CrewAI, *"Memory Concepts"*, accessed 2025-2026) and
  [https://docs.crewai.com/concepts/processes](https://docs.crewai.com/concepts/processes)
  (CrewAI, *"Process Concepts"*). Crew memory is partitioned into
  short-term, long-term, entity, and contextual buckets — the same
  partition our region taxonomy enforces (incident-investigation is
  short-term + contextual; royalty-filing-prep is long-term +
  entity; deep-research-session is long-term + contextual).
- **CallSphere — Blackboard for Multi-Agent Shared Knowledge (2024-2025)** —
  [https://callsphere.ai/blog/blackboard-architecture-multi-agent-systems-shared-knowledge-spaces](https://callsphere.ai/blog/blackboard-architecture-multi-agent-systems-shared-knowledge-spaces)
  (CallSphere, *"The Blackboard Architecture in Multi-Agent Systems:
  Shared Knowledge Spaces for Collaborative Intelligence"*, posted
  2024, updated 2025). Practitioner write-up that promotes the
  classic blackboard back into the multi-agent LLM playbook. Sources
  the 2024 wave of academic interest.
- **BB-LLM — Blackboard-Augmented LLM Agents (2024)** —
  [https://arxiv.org/pdf/2510.01285](https://arxiv.org/pdf/2510.01285)
  (arXiv:2510.01285, *"Blackboard Augmented Large-Language-Model
  Agents: A Survey and Reference Architecture"*, October 2024). The
  most recent academic synthesis; introduces the region / KS /
  control-shell vocabulary we adopt.
- **Liveblocks for collaborative real-time sync (2025)** —
  [https://liveblocks.io/docs/platform/yjs](https://liveblocks.io/docs/platform/yjs)
  (Liveblocks, *"Yjs CRDT with Liveblocks"*, 2025 docs). For the
  collaborative regions (`dashboard-composition`, `shift-planning`)
  we ship a Y.Doc CRDT adapter behind the same `Region` interface.
- **Yjs CRDT library (2025)** —
  [https://docs.yjs.dev/](https://docs.yjs.dev/) (Yjs maintainers,
  *"Yjs Documentation"*, 2025). The reference CRDT runtime for
  collaborative editing. Used by Notion, Linear, Figma.
- **Automerge CRDT (2025)** —
  [https://automerge.org/docs/](https://automerge.org/docs/) (Ink &
  Switch, *"Automerge Documentation"*, 2025). Alternative CRDT we
  keep as a port; deterministic merges make audit-chain reconciliation
  cleaner for offline-first regions.
- **Slack Threads & Notion Comments (UX precedents)** —
  [https://slack.com/help/articles/115001736387-Use-threads-to-organize-discussions-](https://slack.com/help/articles/115001736387-Use-threads-to-organize-discussions-)
  (Slack, *"Use threads to organize discussions"*, accessed 2025-2026)
  and [https://www.notion.com/help/comments-mentions-and-reminders](https://www.notion.com/help/comments-mentions-and-reminders)
  (Notion, *"Comments, mentions and reminders"*, accessed 2025-2026).
  Modern threaded-comment UX precedents — we adopt the
  parent_post_id pattern from these for shallow nesting (1 level
  deep, per BB-LLM 2024 §4.3).
- **Linear Issue Threading (UX precedent)** —
  [https://linear.app/docs/issues](https://linear.app/docs/issues)
  (Linear, *"Issues"*, accessed 2025-2026). Single-thread-per-issue
  precedent backing the region-per-investigation discipline.

---

## 3. The four elements

The Hearsay-II / Hayes-Roth quartet, restated for an LLM-native swarm:

### 3.1 Knowledge sources

A knowledge source (KS) is **anything that can read part of the
blackboard and write to it**. Five flavours:

- `junior` — a spawned domain-specialised Mr. Mwikila (mining-
  planner, safety-officer, geology-advisor, fx-treasury, kyb, fleet,
  …). KS competence is read from the capability-catalogue's measured
  outcomes for that specialisation × region pair.
- `connector` — an external system integration (TMAA filing API, LME
  price feed, weather feed, calendar). Connectors post `observation`
  contributions but never `hypothesis` or `plan`.
- `tool` — a deterministic internal tool (royalty-calculator, fx-
  converter, citation-resolver). Tools post `result` contributions
  in response to a `question`.
- `user` — a human contributor (operator, regulator, owner) posting
  via the UI. User posts have priority 1.0 and never get superseded
  by AI.
- `external-feed` — a streaming push (regulator email, SMS, IoT). The
  ambient-listener (Wave 18-AMBIENT) is one of these.

Each KS lives in `blackboard_knowledge_sources` with a `region_filter`
text[] (which region kinds it claims competence on), a `priority`
real in [0,1], and an `audit_hash`. The KS registry is queried by the
control shell on every activation tick.

### 3.2 Control shell

The control shell is the metalevel scheduler from Hayes-Roth 1985 —
**given the current state of a region, which KS should I activate
next?** Pure function of (region snapshot, KS registry, capability
measurements). Returns one `ControlActivation` record or null.

Scoring is multiplicative:

```
score(ks, region) = priority(ks)
                  × freshness(ks, region.last_post_at)
                  × competence(ks, region.region_kind)
```

with components:

- `priority(ks)` — the KS's static priority in [0, 1], settable by
  the operator. Defaults: user 1.0, connector 0.8, junior 0.6, tool
  0.5, external-feed 0.4.
- `freshness(ks, last_post_at)` — exponential decay since last KS
  activation: `exp(-Δt / τ)` with `τ = 600` seconds (10 minutes).
  Encodes opportunistic activation — a KS that just spoke isn't
  scheduled again until it's stale, unless its priority dominates.
- `competence(ks, region_kind)` — measured success rate of this KS on
  this region kind from the capability-catalogue measurement table.
  Falls back to 0.5 when no measurements exist yet.

Tie-broken by KS id lexicographically (deterministic under tests).

The control shell does **not** invoke KSes itself — it only emits a
`ControlActivation` event. The runtime (agent-runtime package) reads
the event and dispatches.

### 3.3 Blackboard regions

A region is a **scoped problem-solving namespace**. Posts within a
region are causally linked; posts across regions are not. The region
is the unit of summarisation and audit-chain integrity.

Region kinds — concrete enumeration for the mining vertical:

- `incident-investigation` — a safety / environmental / equipment
  event. Short-lived (hours-days). Multi-KS contributors. Closes
  with a `final` summary.
- `royalty-filing-prep` — preparing the monthly TRA royalty filing.
  Recurring per filing period. KSes: regulator-tz-mining, fx-
  treasury, mining-commodity-intelligence, accounting-port.
- `buyer-deal-room` — a buyer↔mine match (from
  `RECOMMENDATIONS_SOTA_2026`). KSes: kyb, fx-treasury, mining-
  commodity-intelligence, document-studio.
- `shift-planning` — a worker↔site rota cycle. Collaborative region
  (CRDT). KSes: workforce-orchestrator, safety-officer, mine-planner.
- `regulator-correspondence` — an open thread with TMAA / NEMC / TRA
  / Mining Commission inspectors. Long-lived. KSes: kyb,
  regulatory-tz-mining, document-studio, user (the regulator
  themselves via the regulator portal).
- `deep-research-session` — an owner-initiated research session
  (e.g. "should we acquire parcel KAH-115"). KSes: tanlii-jurisdiction,
  graph-database, web-research, document-analysis. Long-lived. May
  span days.
- `dashboard-composition` — the dynamic-section composer assembling
  a manager dashboard. Collaborative (CRDT). KSes: layout-overrides,
  domain-models, content-studio.

Region status: `open` → `active` → `closed`. Transitions are
operator-visible and audit-chained.

### 3.4 Reactive flow

Posts emit Server-Sent Events. SSE is primary (one-way push, HTTP/1.1
compatible, no protocol upgrade, plays well with load-balancers).
WebSocket is a fallback for bidirectional regions (CRDT / shift-
planning) — see §9.

Rate limit per tenant: 100 posts/min on the SSE channel. Excess
posts buffer to a tenant-scoped queue and replay when budget is
restored. The rate limiter is leaky-bucket; the bucket capacity and
refill are read from `app_config.blackboard_rate_limit_*`.

---

## 4. Region taxonomy — full table

| Region kind                   | Lifecycle | Collab? | Typical KSes                                                                   | Default summary cadence |
| ----------------------------- | --------- | ------- | ------------------------------------------------------------------------------ | ----------------------- |
| `incident-investigation`      | hours-days| no      | safety-officer, geology-advisor, fleet, mine-planner, user                     | rolling@30m, final@close|
| `royalty-filing-prep`         | weeks     | no      | regulatory-tz-mining, fx-treasury, mining-commodity-intelligence, accounting   | digest@daily, final@filing|
| `buyer-deal-room`             | days      | no      | kyb, fx-treasury, mining-commodity-intelligence, document-studio, user        | rolling@hourly, final@close|
| `shift-planning`              | hours     | yes     | workforce-orchestrator, safety-officer, mine-planner, user                    | rolling@30m, final@close|
| `regulator-correspondence`    | weeks     | partial | kyb, regulatory-tz-mining, document-studio, user (regulator)                  | digest@daily, final@close|
| `deep-research-session`       | days-weeks| no      | tanlii-jurisdiction, graph-database, web-research, document-analysis, user    | rolling@hourly, final@close|
| `dashboard-composition`       | minutes   | yes     | layout-overrides, domain-models, content-studio                                | none (single-shot)      |

Region kinds are extensible — adding a new kind requires a new row in
`blackboard_regions` with a unique `id` and an updated `region_filter`
on the relevant KS rows.

---

## 5. Knowledge source registry

`blackboard_knowledge_sources` is a per-tenant table. Each junior,
connector, tool, user, and external-feed registers as a KS at
startup. The registry is the join target for the control shell's
scoring.

Insert pattern (idempotent on `(tenant_id, ks_kind, ks_name)`):

```ts
await ksRegistry.register({
  tenantId: 't1',
  ksKind: 'junior',
  ksName: 'safety-officer',
  regionFilter: ['incident-investigation', 'shift-planning'],
  priority: 0.7,
});
```

The `priority` is a tenant-tunable knob. Out of the box it follows the
defaults in §3.2 but the operator can raise / lower per KS per tenant
without code changes.

`competence(ks, region_kind)` is **not** stored on the KS row — it is
read on demand from the capability-catalogue measurement aggregator
to keep the registry small and the scoring fresh. The
`CompetenceLookupPort` in the package is the seam; the live wiring
calls capability-catalogue's `measurementAggregator.scoreFor({
specialisation, regionKind })`.

---

## 6. Control shell — opportunistic activation

The control shell is a pure function:

```
input: { region: Region, registry: KS[], lookups: { competence, freshness, now } }
output: ControlActivation | null
```

Algorithm (`src/control/control-shell.ts`):

1. Filter the registry to KSes whose `region_filter` includes
   `region.region_kind`.
2. For each remaining KS compute `priority × freshness × competence`
   per §3.2.
3. Return the KS with the highest score, with the score breakdown
   attached. Return null if no KS scores above 0.05 (the dormant-
   region floor).

The control shell does not mutate state — it returns the activation
and lets the runtime persist it. This keeps the function pure and
testable with deterministic fixtures (`__fixtures__/regions.ts`,
`__fixtures__/ks-registry.ts`).

---

## 7. Cross-reference detection

Every post emits a vector(1536) embedding (OpenAI
`text-embedding-3-large`) via the injected `EmbeddingPort`. The
cross-reference detector scans for two types of links:

- **Explicit refs** — regex-detected `"see post #abc"`,
  `"contradicts the earlier note"`, `"per post abc1234…"`. Mapped to
  the `ref_kind` enumeration:
  `cites | contradicts | answers | supersedes | elaborates`.
- **Semantic refs** — cosine similarity above 0.85 against earlier
  posts in the same region. Labelled `ref_kind='elaborates'` by
  default; the LLM-reranker can later promote to `contradicts` /
  `answers`.

Precision target on the test set: **≥ 0.92** for explicit refs (regex
is high-precision), **≥ 0.78** for semantic refs (threshold tuning
against a labelled fixture of 50 posts).

Detected refs are persisted to `blackboard_cross_references`. The
UNIQUE constraint on `(tenant_id, src_post_id, dst_post_id, ref_kind)`
keeps the table deduplicated.

---

## 8. Summarisation — token-budgeted multi-pass

For regions older than 2 hours, the rolling-summary cron emits a
fresh `rolling` summary every 30 minutes. Final summaries fire on
close. Digest summaries are an operator-triggered roll-up of the
prior rolling summaries.

Token budget defaults:

- `rolling` — 500 tokens
- `final` — 1500 tokens
- `digest` — 3000 tokens

The summary generator is multi-pass:

1. **Pass 1.** Chunk posts into ~2000-token windows.
2. **Pass 2.** Summarise each window into ~200 tokens via the
   injected `SummaryLLMPort`.
3. **Pass 3.** Concatenate window summaries; if the total exceeds
   the budget, recursively summarise again.

Output is persisted to `blackboard_summaries` with `covers_from` /
`covers_to` timestamps so the next rolling pass picks up where the
last one stopped. The `audit_hash` chains into the region's hash
chain so a tampered summary breaks verification.

---

## 9. Reactive flow — SSE primary, WebSocket fallback

- **SSE** is the default for read-only consumers (the chat-UI
  blackboard panel, the regulator portal). One channel per
  `(tenant_id, region_id)`. Heartbeat every 15 s.
- **WebSocket** opens automatically when a region is
  `dashboard-composition` or `shift-planning` (the two CRDT regions).
  Reads + writes both stream through.
- **Rate limit** — 100 posts/min/tenant via leaky-bucket. Excess
  buffers to a tenant queue; the post is durable but the SSE emission
  is delayed.

The post-stream module exposes a Node `Readable` so the API gateway
can pipe it directly into an `EventStream` HTTP response.

---

## 10. Concurrency — optimistic posts, CRDT for collab

Two regimes:

- **Non-collaborative regions** (incident-investigation, royalty-
  filing-prep, buyer-deal-room, regulator-correspondence, deep-
  research-session) — **optimistic posting**. Last-write-wins on
  conflicting `parent_post_id` lineages. `edit_count` increments on
  each amendment. The hash chain records the order accepted.
- **Collaborative regions** (dashboard-composition, shift-planning) —
  **CRDT** via Y.Doc (Yjs). The package exposes a `Y.Doc`-shaped
  port; the live wiring uses Liveblocks. The CRDT layer is *above*
  the audit-chain layer — every CRDT update is snapshotted to a post
  on every commit.

---

## 11. Audit chain — per-region tamper-evident

Every region carries a `prev_hash` / `audit_hash` pair on
`blackboard_regions`. Every post and every summary chains into the
region's chain. Verification is per region — verifying `region X` is
O(posts(X)) — and uses the existing `@borjie/audit-hash-chain`
package's `verifyChain` function.

The first post in a region uses `GENESIS_HASH` as its `prev_hash`.
Subsequent posts use the previous post's `audit_hash`. Summaries
chain after the latest post they cover.

A tampered post is detected by `verifyChain` returning `ok=false`
with the first broken index. The operator gets a UI badge on the
region indicating "chain broken — request forensic replay".

---

## 12. Integration

- **cognitive-memory (Wave 18AA)** — every post observation can be
  promoted to a `pattern` or `fact` cell via the
  `cognitive-memory.observe()` API. The reverse path: a memory cell
  may be cited inside a post payload's `structured.cell_id` field.
- **capability-catalogue (Wave CAPABILITY)** — KS competence is read
  on demand. The `measurementAggregator.scoreFor()` call is the seam.
- **meta-learning-conductor (Wave META)** — periodically polls
  `blackboard_summaries` for cross-region episodes (e.g. an incident
  + a regulator-correspondence on the same parcel) and emits
  meta-learning tasks back to the cognitive-memory layer.
- **agent-runtime / junior-runtime** — listens to `ControlActivation`
  events from the control shell and dispatches the chosen KS.
- **chat-ui blackboard panel** — re-uses the existing
  `packages/chat-ui/src/blackboard/Blackboard.tsx` component but
  drives it from the SSE post-stream instead of the React `useState`
  notes textarea.

---

## 13. Persona & live-test policy

Persona: **Mr. Mwikila**, Borjie's Managing Director for Tanzanian
mining operators. Every blackboard interaction surfaces in the chat
UI under his voice; specialisations are juniors he delegates to.

Live-test only ([Founder-locked
2026-05-26](./FOUNDER_LOCKED_DECISIONS_2026_05_26.md)) — the
embedding port and summary-LLM port are *real* in production. Tests
use deterministic fixtures labelled `__fixtures__/embedder.ts` and
`__fixtures__/summary-llm.ts`. No synthetic-only paths reach
production.

---

## 14. Migration & rollout

Wave plan:

1. Ship `0073_blackboard_sota.sql` (this wave). No code consumers
   yet.
2. Ship `@borjie/blackboard-sota` package (this wave). Pure
   in-memory; SQL repositories follow in Wave BLACKBOARD-DRIZZLE.
3. Wire the SSE channel into the api-gateway (Wave BLACKBOARD-API).
4. Replace the chat-UI blackboard textarea with the post-stream
   subscriber (Wave BLACKBOARD-UI).
5. Backfill: convert existing `blackboard_postings` rows to
   `blackboard_posts_v2` via a coexistence view (next wave).

The 18HH `blackboard_postings` primitive is **not** removed — the v2
table coexists. The migration view `blackboard_posts_unified` is the
read seam for legacy consumers.

---

## 15. Closing — why now

The swarm crossed the threshold from "two agents talking" to "seven
agents talking about a fluid problem" at Wave 18V. Wave 18HH gave us
the primitive (a row in a table); Wave BLACKBOARD-CORE gives us the
architecture (regions, KSes, control shell, summaries, cross-refs,
audit). Mr. Mwikila is now answerable to the question *"what does the
swarm collectively know about Kahama parcel 88 right now?"* in O(1)
read against `blackboard_regions.id='incident-investigation:KAH-088'`
plus a chain verification. That is the production-grade upgrade the
mining vertical needs to scale past one operator per Mr. Mwikila.
