# Agent Swarm Coordination — SOTA Design Specification

> Wave 18HH — the canonical contract for how every running Mr. Mwikila
> instance (root MD, district MDs, the 27+ domain specialisations, scoped
> sub-MDs, async wave-dispatched workers) knows what every peer is doing
> in real-time. No agent operates blind. No two agents race to mutate the
> same parcel. No two agents propose contradicting plans for the same
> campaign without the system noticing.
>
> Status: design-spec. Phase 2 ships `packages/swarm-coordination/` +
> migration `0030_swarm_coordination.sql` (4 tables + RLS). Retrofits the
> cognitive engine (Wave 18T), mutation authority (Wave 18S), junior
> spawner (Wave 18V-DYNAMIC), and wave-resilience-manager (Wave 18DD) to
> use the registry + A2A bus + blackboard.
>
> Sibling Wave 18GG (amnesia / temporal continuity) covers the orthogonal
> problem: "what did *I* do five minutes ago?" This spec covers "what
> are my PEERS doing right now?" — the spatial coordination problem.
>
> Persona: Mr. Mwikila (Managing Director). Brand: Borjie.

---

## 1. The coordination problem

Mr. Mwikila is plural. At any given second on a healthy tenant cluster
there can be a dozen Mr. Mwikila instances running concurrently:

- The **root MD** answering an owner's question in the floating chat.
- A **district MD** scoped to the Kahama region (Wave 18Y org-scope
  hierarchy) doing a regulatory check-in for the regulator audience.
- Six **specialisations** — mine-planner, safety-officer, geology-
  advisor, fx-treasury, kyb, fleet — each holding a turn in a
  conversation, in a background loop, or in a deep-research session.
- Two **async wave-dispatched workers** completing media-generation
  jobs the founder kicked off thirty minutes ago.
- A **background daily-followup worker** (Wave 18CC) scoring lapsed
  customers.
- A spawned **research junior** (Wave 18V-DYNAMIC) the cognitive engine
  spun up two minutes ago to investigate a Tier-2 anomaly.

None of them — today — has any structured way to discover what the
others are doing. That gap produces a rising family of real failure
modes:

1. **The contradicting-mutation race.** Two juniors are spawned from
   different surfaces and both reach a `mutate.lease` step against
   parcel `KAH-088-A`. Junior A proposes "extend 12 months"; Junior B
   proposes "terminate end of month". Both proposals land in
   `mutation_proposals` (Wave 18S) and could be approved by a
   fatigued owner clicking through their inbox.
2. **The duplicate-research blindspot.** The root MD doesn't know
   the regulatory district MD is mid-research on the same TanLII
   case law. Mr. Mwikila pays Anthropic twice and may surface two
   slightly different conclusions to the same owner inside an hour.
3. **The mid-flight wave conflict.** Async wave 18M-COMPOSE writes a
   finalised PDF embedding the hero image; wave 18N-MEDIA updates
   that same image. The customer receives mismatched assets.
4. **Inconsistent narratives.** A dispatched `compose_doc` and a
   dispatched `compose_media` for the same marketing campaign
   produce contradicting taglines because neither reads what the
   other is about to write.

The throughline is that **2026-state multi-agent systems still
overwhelmingly rely on a single supervisor as the one and only point
of coordination** ([Lushbinary][lushb]; [Nevo][nevo]). That breaks
down the moment the swarm goes plural — which Borjie crossed at Wave
18V. The field has spent 2025–2026 building active-agent registries
([AWS Bedrock AgentCore][aws-reg]; [Agent Name Service][ans]), A2A
protocols ([Google A2A][google-a2a]; [Zylos][zylos]), shared-state
blackboards ([CallSphere][bb]; [arXiv 2510.01285][arxiv-bb]), and
conflict-resolution playbooks ([Arion][arion]). This spec adopts the
strongest pieces, bounded by what already exists in Borjie.

[lushb]: https://lushbinary.com/blog/multi-agent-orchestration-patterns-supervisor-swarm-pipeline-router-guide/
[nevo]: https://nevo.systems/blogs/nevo-journal/ai-agent-swarms
[aws-reg]: https://aws.amazon.com/about-aws/whats-new/2026/04/aws-agent-registry-in-agentcore-preview/
[ans]: https://arxiv.org/pdf/2505.10609
[google-a2a]: https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/
[zylos]: https://zylos.ai/research/2026-03-26-agent-interoperability-protocols-mcp-a2a-acp-convergence
[bb]: https://callsphere.ai/blog/blackboard-architecture-multi-agent-systems-shared-knowledge-spaces
[arxiv-bb]: https://arxiv.org/pdf/2510.01285
[arion]: https://www.arionresearch.com/blog/conflict-resolution-playbook

---

## 2. The active-agents registry

Every running agent registers when it starts a turn and deregisters
when the turn ends. Stale registrations auto-clear. Mirrors the
heartbeat pattern multi-agent platforms have converged on in 2026
([MindStudio][mindstudio]) and the registry discipline of AWS Bedrock
AgentCore ([AWS][aws-reg-2]) and the Agent Name Service ([ANS][ans]).

A row in `active_agents` carries:

- `agent_id` — the canonical identifier (e.g. `mr-mwikila`,
  `mining-safety-officer`, `spawned-junior-7e9c...`).
- `agent_kind` — one of `root_md` | `district_md` | `specialisation`
  | `spawned_wave` | `background_worker`.
- `tenant_id` + `scope_id` — which tenant and which org-unit (Wave
  18Y) this agent is scoped to. `scope_id` is NULL for tenant-root.
- `subject` — `{ kind, id, summary }`. What is the agent *working on*?
  e.g. `{ kind: 'parcel', id: 'KAH-088-A', summary: 'lease renewal
  review' }`. This is the single most important field; conflict
  detection (§6) and subject-scoped A2A (§3) key off it.
- `parent_agent_id` — hierarchical reference. A specialisation
  invoked by the root MD records the root MD's `agent_id` here. A
  spawned research junior records the kernel turn's spawning agent.
- `started_at`, `expected_completion_at`, `heartbeat_at`, `status`.

Three operations:

1. **Register** — at agent-turn start. Idempotent on
   `(tenant_id, agent_id, subject.kind, subject.id)`: re-entry
   refreshes the heartbeat, no duplicate row.
2. **Heartbeat** — periodically (default 30s) while the turn runs.
   Juniors exceeding two minutes silent are treated as crashed by
   the wave-resilience-manager (Wave 18DD).
3. **Deregister** — at agent-turn end with terminal status
   (`completed` | `crashed` | `paused`). Row retained for audit;
   only `running` rows participate in coordination queries.

The stale cleaner runs as a cron worker (60s cadence): any
`running` row with `heartbeat_at < now() - 2 minutes` flips to
`crashed` and a wave-resilience revival is enqueued.

[mindstudio]: https://www.mindstudio.ai/blog/heartbeat-pattern-ai-agent-systems
[aws-reg-2]: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/registry.html

---

## 3. A2A (Agent-to-Agent) messaging protocol

The registry tells an agent **who** is running. A2A tells an agent
**what to say to whom**. Borjie's A2A wire is **inspired by**, but
not blindly adopted from, Google's A2A protocol (governance handed
to the Linux Foundation in June 2025 with 150+ org backers, and a
joint MCP+A2A interop spec underway with Anthropic
[Stellagent][stell]; [Zylos][zylos]). Google A2A is HTTP+JSON-RPC
between *agent platforms*; Borjie's A2A is in-process + DB-backed
between agents on the **same** Mr. Mwikila kernel. We keep the
*semantic surface* (Agent Cards, task-oriented messages, streaming-
capable kinds) and replace the transport with our Wave 18S audit-
hashed `agent_messages` table.

[stell]: https://stellagent.ai/insights/a2a-protocol-google-agent-to-agent

A row in `agent_messages`:

- `from_agent_id` / `to_agent_id` — sender / direct recipient.
  `to_agent_id` is NULL when broadcast or subject-scoped.
- `to_subject` — `{kind, id}`. Set when the message goes to
  whoever is currently registered on that subject.
- `message_kind` — one of five canonical kinds:
  - **`inform`** — "I observed X." No reply expected.
  - **`request`** — "Please do X." Reply expected; `ack_at`
    gates the sender's continuation.
  - **`coordinate`** — "I propose we jointly do X." Used at
    supervisor fan-out and peer-debate kickoff.
  - **`conflict`** — "My proposal contradicts yours." Spawns a
    §6 reconciliation turn.
  - **`handoff`** — "Subject X is yours now; here's the state."
    Used in pipeline patterns and escalation back to the root MD.
- `payload`, `ack_at`, `audit_hash` (Wave 18S chain link).

**Routing.** Three modes: **direct** (`to_agent_id IS NOT NULL`),
**broadcast** (both targets NULL — visible to all agents in the
same `scope_id`, used for cheap notifications), and **subject-
scoped** (`to_subject IS NOT NULL` — delivered to every agent
currently registered on that subject; canonical conflict-warning
channel). Receivers long-poll (default 200ms tick) and ack inline.
A2A messages and blackboard postings (§4) are complementary: A2A
is **push**, blackboard is **pull**. Both are needed.

---

## 4. The blackboard

The blackboard is the shared scratch space. Originally the Hearsay-II
speech-recognition architecture (1970s), the pattern has had a
2025–2026 renaissance because it maps cleanly onto LLM swarms
([CallSphere][bb]; [arXiv 2507.01701][arxiv-bb2]; [arXiv
2510.01285][arxiv-bb]). The key insight: agents communicate
**indirectly** by reading and writing a shared workspace, instead of
all talking to all in a quadratic chatter mesh. This decouples agents
from each other and lets the swarm be composed.

[arxiv-bb2]: https://arxiv.org/pdf/2507.01701

A row in `blackboard_postings`:

- `posted_by_agent_id`, `subject`, `payload`, `posted_at`.
- `contribution_kind` — five canonical kinds:
  - **`observation`** — factual data the poster observed.
  - **`hypothesis`** — a proposed explanation, open for refute.
  - **`question`** — "I need someone to tell me X."
  - **`plan`** — a proposed sequence of actions.
  - **`result`** — a completed action; supersedes prior plans.
- `scope_id` — bounded by Wave 18Y org-unit hierarchy. A district
  MD's postings are visible to that district's specialisations and
  the root MD; cross-district visibility requires explicit
  elevation (Wave 18Y ESCALATE-EVENT path).
- `supersedes_posting_id` — closes lineage when a later posting
  obsoletes an earlier one; readers skip superseded postings.

**The protocol contract** (also enforced by §10's anti-patterns):

> Before acting on a subject, every agent MUST read the blackboard
> for that subject within the current scope. If the read returns a
> conflicting plan or a superseding result, the agent re-evaluates
> instead of plowing ahead.

This is the discipline that lifts Borjie from "many agents that
happen to run in the same DB" to a coordinated swarm.

---

## 5. Coordination patterns

Five patterns. The first four are widely recognised in the 2026
multi-agent literature ([Digital Applied][da-pat];
[Codebridge][cb-2026]; [LangGraph supervisor 2026][lg]); we add
stigmergy on top because the pattern is a natural fit for our
cognitive-memory substrate (Wave 18AA).

[da-pat]: https://www.digitalapplied.com/blog/multi-agent-orchestration-5-patterns-that-work
[cb-2026]: https://www.codebridge.tech/articles/mastering-multi-agent-orchestration-coordination-is-the-new-scale-frontier
[lg]: https://callsphere.ai/blog/langgraph-supervisor-multi-agent-orchestration-2026

### 5.1 Supervisor + Workers

The default. Root MD acts as supervisor; specialisations are workers.
Root MD posts a `plan`, each named specialisation registers, reads,
posts its scoped plan, executes, and posts a `result`. Root MD
aggregates and produces the user-facing reply. CrewAI, LangGraph, and
OpenAI Agents SDK all default to this ([Gurusup][gs]; [LangGraph
2026][lth]); LangGraph's production guidance — temperature=0 on the
supervisor, recursion_limit=25, "forbid the supervisor from doing
specialist work itself" — applies to ours unchanged.

[gs]: https://gurusup.com/blog/best-multi-agent-frameworks-2026
[lth]: https://www.lifetideshub.com/langgraph-supervisor-patterns-2026/

### 5.2 Peer Debate

Two or three specialisations on a contested decision. The pattern
originates with Du et al. (2023) and has been refined through 2024 —
multi-agent debate beats a single-model baseline at any scale, and
sparse communication topologies outperform full-mesh debate
([Hung Le 2024][lehung]; [Smit et al. 2024][acl-sparse]).

[lehung]: https://hungleai.substack.com/p/agree-or-disagree-a-review-of-multi
[acl-sparse]: https://aclanthology.org/2024.findings-emnlp.427/

Root MD spawns 2–3 specialisations with adversarial framing
("safety reviewer vs throughput optimiser, debate this mine plan").
Each posts a `hypothesis`; after N rounds (default 2) the root MD
adjudicates. We deliberately do **not** auto-vote: diversity-of-
thought research is strong ([arXiv 2410.12853][div]) but "stop
overvaluing multi-agent debate" warnings caution that debate can
amplify confident-but-wrong outputs without a grounding signal
([arXiv 2502.08788][over]). Root-MD adjudication keeps debate
honest.

[div]: https://arxiv.org/html/2410.12853v1
[over]: https://arxiv.org/pdf/2502.08788

### 5.3 Consensus

All-must-agree. Reserved for Tier 2-Critical actions (Wave 18S
authority tiers): irreversible mine-plan changes, mass deletions,
counterparty terminations. All relevant specialisations PLUS the
nominated owner must approve before the mutation executes. The
underlying primitive is the `approval_policy_actions` quorum table
(Wave 18S) — swarm-coordination layers consensus *agent set*
discovery on top of it.

### 5.4 Stigmergy

Loose, low-traffic coordination via the shared environment. Agents
leave signals in `cognitive_memory_cells` (Wave 18AA); other agents
pick them up at their next semantic search. No direct message, no
blackboard posting. The 2026 literature treats this as the bio-
inspired ant-trail model ([Number Analytics][na-stig]; [arXiv
2604.03997][ledger-stig]). Borjie already has the substrate: a
`cognitive_memory_cells` row with `kind = 'pattern'` and
`reinforced_by_specialisations` is a stigmergic pheromone.

[na-stig]: https://www.numberanalytics.com/blog/stigmergy-future-decentralized-ai
[ledger-stig]: https://arxiv.org/abs/2604.03997

### 5.5 Pipeline

Sequential handoff. The classic pipeline is `research` → `cognitive-
engine` → `compose-doc` → `publish`. Each stage writes an A2A
`handoff` message to the next, carrying the subject and a payload
snapshot. The pattern is dirt-simple, audit-friendly, and dominates
production wave-dispatched workloads ([Lushbinary patterns][lushb]).

---

## 6. Conflict resolution

When two or more agents propose contradicting mutations on the same
subject, the swarm-coordination layer detects it at the mutation-
authority gate (Wave 18S `mutation_proposals` insertion) and runs
the following resolution flow:

1. **Detect.** A subject-scoped scan over `mutation_proposals`
   filtered by `(tenant_id, subject.kind, subject.id, status =
   'pending')`. If `> 1` pending proposal exists from different
   agents, conflict is recorded into `coordination_conflicts`.
2. **Pause.** Both (or all) conflicting proposals are flipped to
   `paused_conflict_review`. Neither can execute until reconciled.
3. **Spawn reconciliation turn.** The cognitive engine (Wave 18T)
   spawns a dedicated reconciliation kernel turn. Its system prompt
   shows the conflicting proposals side by side, the blackboard
   history for the subject, and the requesting users' contexts. It
   produces a `reconciliation_payload` — either a synthesis ("apply
   A's terms but B's effective date"), a tie-break ("A wins because
   it has owner approval"), or a both-reject ("neither proposal
   respects the regulatory minimum; surface to owner").
4. **Apply by tier.** If the reconciliation reduces to a Tier-0
   data interpretation (Wave 18S tier ladder), the swarm-
   coordination layer applies it automatically and resumes the
   surviving proposal. If Tier 1+, the conflict is surfaced to the
   nominated owner with three options visible side by side:
   "A proposed X, B proposed Y, my reconciliation is Z" — the owner
   picks one. Both originals close: the picked one applies; the
   rejected one is archived with reason `superseded_by_conflict`.

The conflict resolution playbook in the 2026 literature ([Arion
Research][arion]; [AgentFlow consensus][af]) reaches similar
conclusions: negotiation first, voting second, mediator (human or
elevated AI) last. We make the **mediator AI Mr. Mwikila himself**,
because the cognitive engine already has the context, and we keep
the human in the loop at Tier 1+ because that's the Borjie autonomy
contract.

[af]: https://www.agentflow.academy/blog/when-agents-disagree-consensus

---

## 7. The six coordination roles

Every agent at every moment is playing one of six roles. The role
is recorded in `active_agents.subject.role` (a soft field) and used
by §5 patterns to assemble agent sets:

- **Orchestrator** — assembles and dispatches sub-agents. The root
  MD in a supervisor + workers run is the orchestrator.
- **Worker** — does scoped work and reports back. The 27 domain
  specialisations are workers most of the time.
- **Verifier** — checks another agent's output for factual and
  contractual fidelity. Common in compose-pipeline runs; the
  document-quality-guarantor package (existing) plays verifier.
- **Critic** — challenges another agent's reasoning. The opposite-
  side specialisation in a §5.2 peer debate is the critic.
- **Mediator** — resolves conflicts. The reconciliation kernel turn
  from §6 plays mediator.
- **Observer** — read-only audit watcher. Tumemadini/TRA regulator
  audiences get observer-only mr-mwikila instances.

The six map cleanly to the multi-agent role literature
([DigitalApplied taxonomy 2026][da-tax]; [Co-Scientist DeepMind][cs])
and to the Anthropic-published agent-team teammate model (lead +
teammates with autonomous context windows but direct peer
communication, [Anthropic Agent Teams 2026][at]).

[da-tax]: https://www.digitalapplied.com/blog/agent-architecture-patterns-taxonomy-2026
[cs]: https://deepmind.google/blog/co-scientist-a-multi-agent-ai-partner-to-accelerate-research/
[at]: https://nevo.systems/blogs/nevo-journal/ai-agent-swarms

---

## 8. Schema additions

Migration `0030_swarm_coordination.sql` adds four tables, all with
canonical Wave 18S audit-hash chaining and (where tenant-bound) the
`app.tenant_id` GUC RLS policy from migration 0003.

```sql
CREATE TABLE active_agents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text NOT NULL,
  agent_id                text NOT NULL,
  agent_kind              text NOT NULL,                  -- root_md|district_md|specialisation|spawned_wave|background_worker
  scope_id                text,                           -- Wave 18Y org-unit; NULL = tenant_root
  subject                 jsonb,                          -- { kind, id, summary, role? }
  parent_agent_id         text,                           -- hierarchical reference
  started_at              timestamptz NOT NULL DEFAULT now(),
  expected_completion_at  timestamptz,
  heartbeat_at            timestamptz NOT NULL DEFAULT now(),
  status                  text NOT NULL DEFAULT 'running' -- running|paused|completed|crashed
);
CREATE INDEX idx_aa_subject ON active_agents (tenant_id, (subject->>'kind'), (subject->>'id'));
CREATE INDEX idx_aa_running ON active_agents (tenant_id, status, heartbeat_at) WHERE status = 'running';

CREATE TABLE agent_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  from_agent_id   text NOT NULL,
  to_agent_id     text,                                   -- NULL when broadcast
  to_subject      jsonb,                                  -- {kind,id} when subject-scoped
  message_kind    text NOT NULL,                          -- inform|request|coordinate|conflict|handoff
  payload         jsonb NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  ack_at          timestamptz,
  audit_hash      text NOT NULL
);
CREATE INDEX idx_am_to ON agent_messages (tenant_id, to_agent_id, ack_at) WHERE ack_at IS NULL;
CREATE INDEX idx_am_subject ON agent_messages (tenant_id, (to_subject->>'kind'), (to_subject->>'id'));

CREATE TABLE blackboard_postings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text NOT NULL,
  scope_id                text,
  posted_by_agent_id      text NOT NULL,
  subject                 jsonb NOT NULL,                 -- {kind,id}
  contribution_kind       text NOT NULL,                  -- observation|hypothesis|question|plan|result
  payload                 jsonb NOT NULL,
  supersedes_posting_id   uuid,
  posted_at               timestamptz NOT NULL DEFAULT now(),
  audit_hash              text NOT NULL
);
CREATE INDEX idx_bp_subject ON blackboard_postings (tenant_id, scope_id, (subject->>'kind'), (subject->>'id'), posted_at DESC);

CREATE TABLE coordination_conflicts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   text NOT NULL,
  subject                     jsonb NOT NULL,
  conflicting_proposal_ids    uuid[] NOT NULL,            -- references mutation_proposals (Wave 18S)
  detected_at                 timestamptz NOT NULL DEFAULT now(),
  resolution_kind             text,                       -- ai_reconciled|owner_picked|both_rejected
  reconciliation_payload      jsonb,
  resolved_at                 timestamptz,
  audit_hash                  text NOT NULL
);

ALTER TABLE active_agents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE blackboard_postings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE coordination_conflicts ENABLE ROW LEVEL SECURITY;
-- All four tables use the canonical app.tenant_id GUC isolation policy.
```

---

## 9. Anti-patterns

Each is a real failure mode observed in 2025–2026 swarm deployments
or a contradiction of the discipline laid out above:

- **Acting on a subject without reading the blackboard.** Skipping
  §4's contract means the agent risks repeating work, contradicting
  a peer's plan, or applying actions over a superseding result.
- **Two agents racing to mutate the same record without conflict
  detection.** §6 must run on every mutation-proposal insert. Bypass
  paths (admin shell mutations, raw SQL) are prohibited at the
  application layer.
- **A long-running agent that doesn't heartbeat.** Falls under
  §2's stale-cleaner; status flips to `crashed` and a revival
  attempt is logged. The agent loses its in-flight authority.
- **Sending A2A `request` messages that aren't acked.** A `request`
  sender that waits unboundedly on `ack_at IS NULL` is itself
  brittle. Default timeout is 60s; expired requests surface as a
  blackboard `question` for fallback handling.
- **Blackboard contributions that don't supersede earlier ones.**
  Posting a new `plan` over an unsuperseded previous `plan`
  creates ambiguity for downstream readers. The poster MUST set
  `supersedes_posting_id`.
- **Auto-resolving Tier 1+ conflicts without owner visibility.**
  §6 is explicit: only Tier-0 reconciliations apply silently.
  Anything higher surfaces. The autonomy charter (Wave 18S) does
  not bend here.

---

## 10. Phase 2 implementation map

Retrofits. Each existing package gets a small, additive touchpoint:

- **Cognitive engine (Wave 18T)** — the D1 reasoning loop reads
  `blackboard_postings` for the current subject before generating
  its plan. If a peer's plan is already on the board, the cognitive
  engine either picks up the plan, posts a refinement, or sends a
  `coordinate` A2A message.
- **Mutation authority (Wave 18S)** — `mutation_proposals` insert
  triggers a conflict-detect call. If contradicting pending
  proposals exist on the same subject, a `coordination_conflicts`
  row is opened and §6 runs.
- **Junior spawner (Wave 18V-DYNAMIC)** — the spawn lifecycle
  registers each spawned junior in `active_agents` at start and
  deregisters at completion. The spawner reads `active_agents`
  first to detect duplicate-research blindspots (§1.2) before
  spawning a redundant junior.
- **Wave-resilience-manager (Wave 18DD)** — pulls heartbeat data
  from `active_agents` instead of (or in addition to) its own
  `wave_progress` heartbeats. Single source of truth for "is this
  agent still alive?"
- **Compose-anything (Wave 18Q capabilities-unification)** — every
  `compose_doc` / `compose_media` posts its plan + result to the
  blackboard against the campaign subject. Sibling compose jobs
  read the board before committing to a narrative.

DeepMind's Co-Scientist proves the pattern at the research-frontier
end ([Co-Scientist][cs]): specialised ranking, evolution, and meta-
review agents coordinate through shared memory and an idea-tournament
protocol. Anthropic's Agent Teams (Claude Opus 4.6, February 2026,
[Nevo][nevo]) ships the same shape at the product-frontier end: a
lead teammate orchestrating peers that communicate directly. Borjie's
swarm-coordination layer is the Borjie-native instantiation — the
registry tells you who, A2A tells you what, the blackboard tells you
where the work is, and conflict resolution stops the swarm tripping
over itself.

> Mr. Mwikila as one mind across many bodies, knowing what every
> body is doing, in real time, with the founder still in command.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
