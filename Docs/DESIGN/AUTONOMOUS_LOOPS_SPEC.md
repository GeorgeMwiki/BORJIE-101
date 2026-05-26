# Autonomous Loops — Design Specification

Companion to `docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md`. This document is
the engineering contract for the 4 autonomous loops that turn Mr. Mwikila
from a reactive assistant into a 24/7 Managing Director.

Status: design only. Implementation lands in Phase 2 once the strict-TS
flag rollout + BossNyumba port complete.

---

## 1. Daily Research Loop

**Purpose**: produce a citation-anchored morning briefing the owner sees
before their day begins.

### Trigger
- Cron: `0 4 * * *` Africa/Dar_es_Salaam (04:00 local). One run per tenant.
- Also re-runnable on demand via `POST /v1/master-brain/daily-research/run`
  (Phase 2 route).

### Inputs
- `master_brain_briefings` (last briefing — diff against today).
- `tenant_watchlists` (owner-subscribed signals: spot price thresholds,
  cadastre polygons, regulator endpoints).
- LMBM portfolio (sites, licences, open positions, AR/AP, pending
  approvals, in-flight EPP / Tumemadini cycles).
- `daily_research_cache` (rate-limited fetch results cached at TTL).
- Regulator + commodity sources via the existing connectors package:
  `tz.botGoldWindow`, `tz.gepgGateway`, `tz.nemcPortal`, LME, Kitco.

### Process
1. Acquire per-tenant lock (Redis SETNX with 30 min TTL).
2. Refresh `daily_research_cache` for any source whose TTL has elapsed
   (parallel; respect upstream rate limits).
3. Compute deltas vs. yesterday's briefing — what changed in price, in
   regulator state, in the cadastre, in the LMBM.
4. Run scoring: opportunities = (signal * leverage * confidence);
   risks = (exposure * likelihood * proximity).
5. Rank, take top 3 of each plus top 3 owner-decisions-required.
6. Render Markdown briefing through the brain-kernel (citation-anchored).
7. Persist to `master_brain_briefings` with `evidence_ids[]` populated.
8. Fan out: email (SendGrid), in-app banner (chat-ui), push (FCM).

### Outputs
- One `master_brain_briefings` row.
- Notification fanout payloads on the existing `notifications` service.
- Spawn proposals on `spawn_proposals` for any tab the owner is likely
  to need next (e.g. if a licence expiry surfaced, pre-stage the
  Compliance tab).

### Persistence
- `master_brain_briefings` (Supabase). New table — see schema sketch.
- `daily_research_cache` (Supabase + Redis short-lived layer).
- Audit chain entry per briefing for tamper-evidence.

### Owner-touch point
- 06:30 local push notification "Habari ya asubuhi — your brief is ready".
- In-app banner above the chat-ui input box on first open of the day.
- Email summary with deep-links to each surfaced item.

### Authority tier
Tier 0 (research) + Tier 1 (drafting any artefact the owner will likely
need today). No Tier 2 actions ever execute from this loop.

### Existing infra to reuse (~80% of what's needed)
- `services/sleep-pass-orchestrator` — schedules the run.
- `@borjie/central-intelligence` — kernel.think() for the briefing render.
- `packages/connectors/tz-*` — government feeds.
- `services/notifications` — fan-out.
- `packages/observability` — decision-trace recorder for the breadcrumb.
- **Gap (~20%)**: scoring algorithm; `master_brain_briefings` table;
  the `/daily-research/run` route.

---

## 2. Anticipatory UX Loop

**Purpose**: predict the owner's next 3 moves and pre-stage them as
spawn proposals.

### Trigger
- Event subscription: every chat-turn `assistant_turn.completed` event
  on the bus. Also voice turns from `services/voice-agent`.

### Inputs
- The completed turn (user_text + assistant_text + tool_calls).
- The thread's last N turns (window of 8).
- The active `MiningCeoModeId` (informs candidate move templates).
- The user's mastery score (`packages/chat-ui/src/lib/user-mastery`)
  to gate aggressive vs. gentle anticipation.

### Process
1. Extract entities from the turn — sites, licences, documents,
   people, dates, commodity references — using the existing
   `@borjie/document-analysis` entity extractor.
2. For each entity, generate candidate next-moves from the
   move-template catalogue (per-mode rules, e.g. licence-id mention ->
   "open renewal tracker for that licence").
3. Score each candidate: `confidence = entity_certainty *
   template_priority * mastery_modifier`.
4. Keep top 3 with `confidence >= 0.55`.
5. Pre-fill payloads — for each candidate, gather the data the target
   tab/form would need (so accepting is one click, not three).
6. Persist to `spawn_proposals` with `status='proposed'`.
7. Emit `tab_spawn_proposal.created` event consumed by chat-ui's
   `NeedSpawnBanner`.
8. On owner accept / dismiss, update row status and feed the result back
   into the move-template scorer (online learning).

### Outputs
- Rows in `spawn_proposals`.
- Live events to `NeedSpawnBanner`.
- Pre-filled form state cached in `passive_capture_events` for the
  target form to consume.

### Persistence
- `spawn_proposals` (Supabase). New table.
- `passive_capture_events` (Supabase). New table — captures the entity
  extraction so the same turn does not get re-processed.

### Owner-touch point
- Inline banner in chat-ui (existing `NeedSpawnBanner`).
- Subtle — never pop a modal; never auto-navigate without consent.

### Authority tier
Tier 0 (entity extraction + scoring) + Tier 1 (pre-fill). Owner accept
is the only path that mutates external state.

### Existing infra to reuse
- `packages/chat-ui/src/components/NeedSpawnBanner.tsx` — UX surface.
- `@borjie/document-analysis` — entity extraction.
- `@borjie/tab-need-detector` (referenced in the banner doc-string) —
  scoring scaffolding.
- The event bus + `services/api-gateway` — turn-completed events.
- **Gap (~20%)**: move-template catalogue per mode; pre-fill payload
  builders; online learning feedback wire.

---

## 3. Continuous Improvement Loop

**Purpose**: detect drift on operational metrics and emit ranked
intervention proposals. Make sure every cycle ends with a 1%-better
candidate.

### Trigger
- Cron: every 60 minutes (the existing `proactive-triggers-worker`
  default).
- Threshold breach: subscribe to metric streams from
  `packages/observability` for instant fires on critical bands.

### Inputs
- Operational metrics: production-per-shift, cost-per-gram,
  royalty-payment cadence, equipment uptime, attendance, document
  expiry windows, sales NSR vs. spot.
- The 1%-better backlog table (proposals from prior cycles).
- LMBM target bands per metric (configured per tenant).

### Process
1. Iterate active tenants (existing tenant-iteration helper).
2. For each tenant + each metric, compute current-vs-band delta.
3. For any breach beyond `min_urgency` (default 4 of 5), generate an
   intervention proposal (cite which metric, which band, which
   suggested action).
4. Cross-reference the 1%-better backlog: if a queued improvement
   addresses the breach, promote it.
5. Apply idempotency (existing `IdempotencyCache`) to avoid spamming.
6. Emit the proposal through the existing `TriggerSink` to the
   notification pipeline.
7. End of cycle: emit one fresh 1%-better candidate per tenant even
   if no breach (the "always hungry" invariant — never end empty).
8. Score outcomes against owner accept/ignore rates over time.

### Outputs
- Trigger events on the existing sink.
- New rows in `master_brain_briefings.actions_proposed` so the next
  morning brief includes them.

### Persistence
- Existing `proactive_triggers_worker` idempotency cache.
- New: `improvement_proposals` table (optional — may piggyback on
  `master_brain_briefings.actions_proposed`).

### Owner-touch point
- In-app via the existing `ProactiveHint` component.
- Aggregated into the morning briefing for non-urgent items.

### Authority tier
Tier 0 (detection) + Tier 1 (drafting proposed action). Execution
remains owner-driven.

### Existing infra to reuse
- `services/proactive-triggers-worker` — entire skeleton.
- `packages/chat-ui/src/components/ProactiveHint.tsx` — UX surface.
- `packages/observability/src/metrics` — metric stream.
- **Gap (~20%)**: 1%-better backlog table + scorer; LMBM target-band
  config schema.

---

## 4. Sleep-Pass Loop

**Purpose**: overnight maintenance + reconciliation so the next day starts
clean. The Daily Research Loop reads what this loop produced.

### Trigger
- Cron: the existing heartbeat (default 60 s tick, off-peak window
  guard inside each pass).

### Inputs
- LMBM state at end-of-day.
- BoT gold-window rate (T+0).
- Open Tumemadini cycles + their due dates.
- Audit-chain hash from last sealed block.
- Cache hit/miss telemetry from `daily_research_cache`.

### Process
1. Acquire heartbeat tick (existing orchestrator).
2. Run FX reconciliation pass — restate inventory at the T+0 BoT
   gold-window rate; persist `fx_reconciliations`.
3. Run Tumemadini-due-check pass — if a cycle's due-date is within
   the configured window, draft the submission pack (Tier 1) and queue
   for owner approval in the morning.
4. Run data-quality pass (existing).
5. Run audit-chain-verify pass (existing) — flag any tamper.
6. Run model-registry-warm pass (existing) — pre-warm Anthropic
   client connections so morning latency is low.
7. Render next-day plan: shift coverage, expected production targets,
   cash-runway projection, top 3 risk-watch items.
8. Persist next-day plan into `master_brain_briefings` (status='draft')
   so the Daily Research Loop reads it at 04:00.

### Outputs
- Updated LMBM rows (FX restatement).
- Draft `master_brain_briefings` row (status='draft').
- Tumemadini draft submissions in `spawn_proposals` with
  `target_form_id='tumemadini'`.

### Persistence
- Existing sleep-pass result rows.
- `master_brain_briefings` (status='draft').
- Audit chain entries for FX restatements.

### Owner-touch point
- None overnight. The Daily Research Loop is the consumer.

### Authority tier
Tier 0 (reconciliation, verification) + Tier 1 (drafting Tumemadini).
Zero Tier 2 actions.

### Existing infra to reuse
- `services/sleep-pass-orchestrator` — entire heartbeat + 8 base passes.
- `@borjie/central-intelligence` — kernel for plan rendering.
- `packages/connectors/tz-botGoldWindow` — rate fetch.
- **Gap (~20%)**: FX reconciliation pass + Tumemadini-due pass + plan
  renderer; tying the draft briefing into the morning loop.

---

## Schema additions needed

DDL sketches only. Migration files will follow Phase 2.

```sql
-- Citation-anchored morning briefings + overnight draft plans.
CREATE TABLE master_brain_briefings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            TEXT NOT NULL DEFAULT 'final'
                      CHECK (status IN ('draft','final','superseded')),
  summary_md        TEXT NOT NULL,
  evidence_ids      UUID[] NOT NULL DEFAULT '{}',
  actions_proposed  JSONB NOT NULL DEFAULT '[]',
  owner_seen_at     TIMESTAMPTZ NULL,
  owner_actioned_at TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mbb_tenant_generated
  ON master_brain_briefings(tenant_id, generated_at DESC);

-- Anticipatory UX spawn proposals (already partially modelled by
-- @borjie/tab-need-detector; this is the canonical persistence shape).
CREATE TABLE spawn_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  source_turn_id  UUID NOT NULL,
  entity_kind     TEXT NOT NULL,       -- 'site' | 'licence' | 'doc' | ...
  entity_payload  JSONB NOT NULL,
  target_tab      TEXT NULL,           -- chat-ui route id
  target_form_id  TEXT NULL,           -- form-engine id
  prefill         JSONB NOT NULL DEFAULT '{}',
  confidence      NUMERIC(4,3) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed','accepted','dismissed','expired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ NULL
);
CREATE INDEX idx_sp_tenant_status_created
  ON spawn_proposals(tenant_id, status, created_at DESC);

-- Entity-extraction trace; used by Anticipatory UX Loop to avoid
-- re-processing the same turn.
CREATE TABLE passive_capture_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  session_id        UUID NOT NULL,
  captured_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  source            TEXT NOT NULL
                      CHECK (source IN ('chat','voice','upload')),
  entities          JSONB NOT NULL,
  draft_state_ref   UUID NULL          -- FK to spawn_proposals.id
);
CREATE INDEX idx_pce_tenant_session
  ON passive_capture_events(tenant_id, session_id, captured_at DESC);

-- Daily Research Loop cache. Per-source TTL respected.
CREATE TABLE daily_research_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT NOT NULL
                  CHECK (source IN ('lme','kitco','tra','nemc','tumemadini','bot-gold-window','web')),
  payload       JSONB NOT NULL,
  ttl_until     TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_drc_tenant_source_ttl
  ON daily_research_cache(tenant_id, source, ttl_until DESC);
```

All four tables get RLS policies keyed on `tenant_id` (Borjie standard).
All briefing + proposal rows get audit-chain seals so tampering is
detectable. Migration ordering will: create tables first, backfill
nothing (the loops will populate as they run), then wire the brain-tools
that read from them.
