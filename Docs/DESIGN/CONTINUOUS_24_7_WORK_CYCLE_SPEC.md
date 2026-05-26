# Continuous 24/7 Work Cycle — Design Specification

> Wave 19A. Pillar A of [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md).
> The mandate: when the human sleeps, Mr. Mwikila works.
>
> **Cross-links:** [`AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md),
> [`DAILY_USER_FOLLOWUP_SPEC.md`](./DAILY_USER_FOLLOWUP_SPEC.md),
> [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md),
> [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md),
> [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Vision — founder verbatim

> "Company self revive and complete all crashed agents to 100% —
> improves even when owners and people sleep. Like if human is sleeping,
> work comes in, it starts to analyse and break down tasks, covering
> areas it can while waiting for user approvals and feedback."

---

## 2. The Thesis

The owner of a Tanzanian mining cooperative sleeps from 22:00 to 06:00
Africa/Dar_es_Salaam. During those 8 hours, M-Pesa SMS confirmations
arrive, regulator portals post deltas, WhatsApp Business inboxes accumulate
gold-buyer DMs, BoT publishes the next-day FX window, the Tumemadini
cadastre updates licence statuses, equipment-telemetry MQTT topics
push readings, the operations supervisor's overnight shift-end report
lands, and the cyanide-leach pad sensor logs another moisture spike.

Every existing enterprise SaaS lets that queue pile up. Borjie does
the opposite: every inbound event is **classified, triaged, and
processed** within minutes of arrival. By 06:00 local, the owner sees a
single unified handoff — the morning briefing — that names what was
handled (Tier 0/1, autonomous), what is waiting for approval (Tier 2,
above-the-line decisions), and what was escalated (Tier 2-Critical,
killswitch-grade items).

The 2026 enterprise-AI literature confirms this is now table stakes
not aspiration. Anthropic's [Managed Agents](https://www.infoq.com/news/2026/04/anthropic-managed-agents/)
explicitly cite "a whole book of deals or overnight processing" as the
primary use case. Anthropic's [Three-Agent Harness](https://www.infoq.com/news/2026/04/anthropic-three-agent-harness-ai/)
runs autonomous coding sessions for ≥4 hours unattended. Notion shipped
[Custom Agents running on schedules and triggers](https://chloeforbesk.com/blog/notion-q1-2026-updates)
("handle recurring work in the background") in Q1 2026. Replit's
[Agent 4 runs 200-minute autonomous sessions](https://replit.com/agent4)
without human intervention. The directional trend is clear: **2026 is
the year overnight autonomy becomes a feature checkbox** — Borjie's
opportunity is to ship the *vertical-specialised, audit-anchored,
owner-visible* version for Tanzanian mining.

---

## 3. Architecture — the inbound work classifier

Every inbound event flows through a single classifier called
`InboundWorkClassifier`. It assigns a tier and routes the event to one
of three lanes: autonomous-process, queue-for-morning, or
escalate-immediately.

```
                 Inbound event (omnidata connector / regulator
                 webhook / WhatsApp / M-Pesa / sensor / cron)
                                 │
                                 ▼
                      ┌────────────────────────┐
                      │ InboundWorkClassifier  │
                      │ (Tier 0 / 1 / 2 / 2-C) │
                      └─────────┬──────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
      ┌────────────┐    ┌────────────┐    ┌─────────────────┐
      │ Tier 0/1   │    │ Tier 2     │    │ Tier 2-Critical │
      │ AUTONOMOUS │    │ QUEUE FOR  │    │ ESCALATE NOW    │
      │ PROCESS    │    │ MORNING    │    │ (owner page)    │
      └─────┬──────┘    └─────┬──────┘    └─────┬───────────┘
            │                 │                 │
            ▼                 ▼                 ▼
       compose-anything    overnight-       page owner via
       fires + audit       approval-queue   FCM + SMS + email
       chain seal          row written      with one-tap deep
                                            link to context
```

The classifier reuses the existing 4-tier authority ladder from
[`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md). Routing
rules are tenant-configurable; defaults match the manifesto's
"Owner-Aligned Authority" principle.

---

## 4. Tier classification table

| Tier | Examples | Lane | Owner-touch |
|---|---|---|---|
| **Tier 0** | Reads: regulator-feed fetch, sensor-log ingest, omnidata sync, audit query, capability measurement. | Autonomous (parallel) | None overnight; surfaced in morning briefing summary. |
| **Tier 1** | Drafts: morning briefing draft, board-pack draft, Tumemadini return draft, buyer reply draft, recipe variant draft, junior lifecycle proposal. | Autonomous (sequential per tenant) | Morning briefing references the drafts; owner approves with one tap. |
| **Tier 2** | Decisions with external impact: send a non-tenant email, file a Tumemadini return, place an FX hedge, sign a contract, post a marketing asset, kill a recipe. | Queue for morning (above-the-line) | Morning briefing surfaces the queue at 06:00. |
| **Tier 2-Critical** | Irreversible-money OR regulatory-breach OR killswitch-grade: funds transfer > $10k, kill MD, deploy a Tier 2 mutation without quorum, regulatory deadline missed. | Escalate immediately (page owner) | FCM push + SMS + email at any hour. Owner can defer to morning if not urgent. |

The Tier 2-Critical escalation policy is per-tenant configurable. The
default for new tenants: page during 06:00–22:00 local; queue (no page)
during 22:00–06:00 *unless* the deadline is within 12h, in which case
page anyway. The owner adjusts via the admin portal.

---

## 5. The overnight processing flow

For every Tier 0/1 inbound event during the 22:00–06:00 quiet window:

1. **Acquire per-tenant lock** (Redis SETNX, 30-minute TTL). Multiple
   workers per tenant would corrupt the audit chain ordering.
2. **Classify** via `InboundWorkClassifier` (≤2-second budget). The
   classifier uses `@borjie/brain-llm-router` with the cheapest model
   that scores ≥0.7 on tier-classification eval (Haiku 4.5 default).
3. **Route to the appropriate `compose_anything_v1` invocation** — the
   universal-creator dispatcher from
   [`CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md).
4. **Run the 6 cognitive disciplines** from
   [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md) — reasoning,
   citation, calibration, scoping, relevance, adaptive ingest.
5. **Run the 5-layer loop quality gates** from
   [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md):
   citation, brand, factual, regulatory, friction, success, anomaly.
6. **Emit typed artifact** to the audit-hash chain (every overnight
   action gets a `night_shift` provenance tag).
7. **Update the `night_shift_summary` table** with a one-line
   description for the morning briefing.
8. **Release lock**, await next event.

The flow is **idempotent**: if a worker dies mid-flow and the lock
expires, the next worker re-runs and the audit chain detects the
duplicate via the existing `audit_hash` deduplication primitive.

---

## 6. The morning briefing — unified handoff

The morning briefing at 06:00 owner-local is the single point of
handoff. It is the consumer of:

- `night_shift_summary` rows (one per Tier 0/1 autonomous action).
- `overnight_approval_queue` rows (one per Tier 2 queued decision).
- `escalation_audit` rows (any Tier 2-Critical events that paged
  overnight, with the owner's mid-night decisions if any).
- The existing `master_brain_briefings` content from
  [`AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md) §1 (today's
  capability state, capability deltas, the top-3 opportunities and
  risks).
- Tab-as-loop friction signals overnight
  ([`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md)).

The briefing format extends the existing morning brief with three new
sections:

- **Overnight work completed** — list of Tier 0/1 outputs with one-tap
  drill-down to the audit-chain entry.
- **Awaiting your approval** — list of Tier 2 queued decisions, sorted
  by deadline urgency, with the recommended option and one-tap
  approve/decline/defer affordance.
- **Overnight escalations** — any Tier 2-Critical pages, with the
  owner's mid-night response (if any) and the open follow-ups.

---

## 7. Operating contract — TypeScript

```typescript
export interface InboundEvent {
  readonly id: string;                              // uuid
  readonly tenant_id: string;
  readonly source: InboundSource;                   // 'whatsapp' | 'mpesa' | 'bot_gold_window' | etc.
  readonly received_at: string;                     // ISO 8601
  readonly payload: unknown;                        // typed per source
  readonly inferred_user_id: string | null;         // the addressee, if known
  readonly correlation_id: string | null;           // if tied to an outbound thread
}

export interface ClassifiedWork {
  readonly event_id: string;
  readonly tier: 0 | 1 | 2 | '2-critical';
  readonly lane: 'autonomous' | 'queue_for_morning' | 'escalate_now';
  readonly recommended_capability: CapabilityId;    // compose_anything_v1, etc.
  readonly recommended_action: string;              // human-readable
  readonly deadline_local: string | null;
  readonly recommended_owner_response_at: string | null;
  readonly evidence_citations: ReadonlyArray<SpanCitation>;
  readonly classification_confidence: number;       // 0..1
}

export interface NightShiftSummaryRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly event_id: string;
  readonly summary: string;                         // "Drafted Tumemadini Q2 return"
  readonly artifact_ref: { kind: string; id: string };
  readonly tier_handled: 0 | 1;
  readonly cost_usd_cents: number;
  readonly duration_ms: number;
  readonly audit_hash: string;
  readonly completed_at: string;
}

export interface OvernightApprovalQueueRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly event_id: string;
  readonly description: string;
  readonly recommended_action: string;
  readonly alternatives: ReadonlyArray<string>;
  readonly tradeoffs: string;
  readonly deadline_local: string | null;
  readonly evidence_artifact_refs: ReadonlyArray<{ kind: string; id: string }>;
  readonly status: 'pending' | 'approved' | 'declined' | 'deferred';
  readonly audit_hash: string;
  readonly queued_at: string;
}
```

Three new tables:

```sql
CREATE TABLE inbound_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  source TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL,
  inferred_user_id UUID,
  correlation_id UUID,
  audit_hash TEXT NOT NULL,
  classified_at TIMESTAMPTZ,
  tier TEXT,
  lane TEXT
);
CREATE INDEX idx_inbound_tenant_received ON inbound_events(tenant_id, received_at DESC);

CREATE TABLE night_shift_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES inbound_events(id),
  summary TEXT NOT NULL,
  artifact_ref JSONB NOT NULL,
  tier_handled INTEGER NOT NULL CHECK (tier_handled IN (0, 1)),
  cost_usd_cents INTEGER,
  duration_ms INTEGER,
  audit_hash TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE overnight_approval_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES inbound_events(id),
  description TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  alternatives JSONB NOT NULL DEFAULT '[]',
  tradeoffs TEXT,
  deadline_local TIMESTAMPTZ,
  evidence_artifact_refs JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','deferred')),
  audit_hash TEXT NOT NULL,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
```

All three carry RLS keyed on `tenant_id`. Migration `0033_overnight_processing.sql`.

---

## 8. SOTA landscape — 2026 references

- **Anthropic Managed Agents** ([InfoQ, April 2026](https://www.infoq.com/news/2026/04/anthropic-managed-agents/))
  — explicit "overnight processing" use case naming.
- **Anthropic Three-Agent Harness** ([InfoQ, April 2026](https://www.infoq.com/news/2026/04/anthropic-three-agent-harness-ai/))
  — separated planner / generator / evaluator for ≥4-hour autonomy.
- **Notion Custom Agents Q1 2026** ([recap](https://chloeforbesk.com/blog/notion-q1-2026-updates))
  — autonomous AI teammates that run on schedules and triggers.
- **Replit Agent 4** ([product page](https://replit.com/agent4)) —
  200-minute autonomous sessions with self-reflection loops.
- **Google Spark / Gemini Daily Brief** ([Explosion explainer](https://www.explosion.com/186813/google-turns-gemini-into-a-proactive-ai-agent-with-spark/))
  — proactive AI agent shipping daily briefs at I/O 2026.

The state-of-the-art is converging on what the founder named: a
substrate that watches the world, classifies inbound work, processes
what it has the authority to process, and queues the rest for owner
review. Borjie's specific contribution is **the audit-anchored,
tier-classified, vertically-specialised version** that ships on top of
the Tanzanian mining substrate (WhatsApp Business + M-Pesa + Tumemadini
+ NEMC + TRA + BoT gold window + GePG).

---

## 9. How this connects to existing Borjie architecture

This spec **extends** rather than replaces. Specifically:

- The existing `services/sleep-pass-orchestrator/` (Wave 6) already
  runs the 60-second heartbeat and 8 base passes. This spec adds the
  inbound classifier as the 9th pass + the morning-handoff aggregator
  as the 10th pass.
- The existing
  [`AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md) §4 Sleep-Pass
  Loop is the parent of this spec. The 24/7 work cycle adds the
  inbound-event lane on top of the existing FX-reconciliation,
  Tumemadini-due-check, and next-day-plan passes.
- The existing
  [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md) 4-tier
  ladder is the classification target.
- The existing
  [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md) 6 disciplines
  run on every autonomous action overnight.

The 24/7 work cycle adds **zero new mutation power** to Mr. Mwikila —
it adds *throughput*. Tier 2 still requires owner approval; Tier
2-Critical still pages; Tier 0/1 still autonomous. What changes is the
*time domain* of the work, not its authorisation envelope.

---

## 10. Anti-patterns — things that would break this

1. **Tier 2 silent execution.** A Tier 2 mutation that fires overnight
   without queuing for morning approval violates the manifesto. The
   classifier MUST route Tier 2 to the morning queue.
2. **Silent failure.** A crashed autonomous worker that does not write
   a `night_shift_summary` row with status `failed` violates the
   "Cite or Stay Silent" principle. Every worker must write success
   OR failure rows.
3. **Page-storming at 03:00.** Tier 2-Critical pages should be rare
   (target <1 per tenant per week). If the page rate spikes, the
   classifier's tier-distribution drift is anomalous and the
   meta-learning conductor must propose a recalibration.
4. **Spurious overnight drafts.** Drafting 200 buyer emails the owner
   would not approve wastes cost. The classifier must include a
   *value-estimate* in the recommendation; below a tenant-configured
   floor ($0.50 expected value default), the draft is not generated.
5. **Owner-language drift.** Overnight outputs default to the owner's
   preferred language (Swahili or English). A draft email in the
   wrong language is a friction signal flagged by the next morning's
   briefing.
6. **No idempotency.** The same inbound event must not be processed
   twice. The classifier writes a `correlation_id` and downstream
   workers de-dupe via `IdempotencyCache`.

---

## 11. Phase 2 implementation map

- **New package** `packages/work-cycle/` (≈800 LOC):
  - `inbound-classifier.ts` (Tier 0/1/2/2-Critical assignment).
  - `night-shift-orchestrator.ts` (lock acquisition, route, audit).
  - `morning-handoff-aggregator.ts` (compose the unified briefing
    extensions).
  - `escalation-pager.ts` (Tier 2-Critical FCM + SMS + email fanout).
- **New service** `services/work-cycle-orchestrator/` — runs as a
  separate worker process for the cycle (kept distinct from
  `sleep-pass-orchestrator` so cycle latency doesn't pollute pass
  scheduling).
- **Migration** `0033_overnight_processing.sql` — 3 tables above.
- **New api-gateway routes:**
  - `POST /api/v1/work-cycle/event` — webhook + connector entry point.
  - `GET  /api/v1/work-cycle/queue` — morning briefing queue read.
  - `POST /api/v1/work-cycle/approval` — owner one-tap action.
- **New persona-kernel tools:**
  - `classify_inbound_v1` — used internally + exposed to recipes.
  - `queue_for_approval_v1` — used by Tier 2 routing.
  - `escalate_critical_v1` — used by Tier 2-Critical routing.
- **Estimated effort:** 3 weeks for one engineer (most reuse from
  sleep-pass-orchestrator + mutation-authority + autonomous-loops).

---

## 12. Cross-reference to siblings

- Loop architecture: [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md)
  — every overnight autonomous action runs all 5 layers.
- Daily user follow-up: [`DAILY_USER_FOLLOWUP_SPEC.md`](./DAILY_USER_FOLLOWUP_SPEC.md)
  — overnight context informs the 09:00 per-user check-in.
- Guide-vs-Learn mode: [`GUIDE_VS_LEARN_MODE_SPEC.md`](./GUIDE_VS_LEARN_MODE_SPEC.md)
  — morning briefing voice obeys the owner's mode toggle.
- Org legibility: [`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md)
  — every overnight event creates a typed artifact in the legibility
  stream.
- Strategic direction: [`STRATEGIC_DIRECTION_LAYER_SPEC.md`](./STRATEGIC_DIRECTION_LAYER_SPEC.md)
  — board-grade memos compose overnight if scheduled.
- Tab-as-loop: [`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md) —
  friction signals collected during the day inform overnight recipe
  improvement.
- Information synthesis: [`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md)
  — overnight is the primary window for hierarchical synthesis of
  accumulated artifact streams.
- On-demand internal software: [`ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md`](./ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md)
  — generated tools schedule themselves into the 24/7 cycle.
- Master vision: [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md)
  §3.3 — the ambient layer this spec implements.

---

*The principle the founder named — "company self revive while everyone
sleeps" — is the engineering invariant this document compiles to. The
business does not pause because the human does.*
