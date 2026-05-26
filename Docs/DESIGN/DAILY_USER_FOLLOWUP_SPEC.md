# Daily User Follow-up — Design Specification

> Wave 19B. Pillar A of [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md).
> The MD checks in with every user, every day. The org *feels alive*.
>
> **Cross-links:** [`AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md),
> [`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md),
> [`GUIDE_VS_LEARN_MODE_SPEC.md`](./GUIDE_VS_LEARN_MODE_SPEC.md),
> [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md),
> [`ORG_HIERARCHY_TERMINOLOGY_SPEC.md`](./ORG_HIERARCHY_TERMINOLOGY_SPEC.md),
> [`MASTER_BRAIN_AUTONOMY_MANIFESTO.md`](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Vision — founder verbatim

> "Root MD always knows progress of every user daily and makes
> appropriate follow-ups, making the org feel ALIVE for the owner."

---

## 2. The Thesis — Every User, Every Day, A Daily Check-in

Most enterprise software is dead until a human opens it. The user logs
in, does something, logs out, and the system goes quiet until the next
session. The org feels like a *building you visit*, not a *team you
belong to*.

Borjie inverts the polarity. Mr. Mwikila — at root MD level — knows
exactly where every user (Owner, Manager, Worker, Customer) left off
yesterday, what's outstanding, what's blocking, and what would help
today. At each user's local 09:00, a short personalised check-in
fires: their open decisions, their pending approvals, their learning
streak, the gaps that need attention. The owner of the cooperative
sees the *aggregate* in the morning briefing — "Joseph is on a 5-day
streak; Linda has a wall-stability question waiting; Saada finishes
onboarding today". The org **feels alive** because the AI is talking
to every member of it, every day, on the human's behalf.

The 2026 directional evidence: Google's [Gemini Spark / Daily Brief](https://www.explosion.com/186813/google-turns-gemini-into-a-proactive-ai-agent-with-spark/)
ships morning/afternoon/evening summaries; the [proactive-AI-agent
pattern](https://www.useyourai.com/agents/proactive-ai-agent/) is now
standard ("continuously observes, identifies patterns, initiates
actions without being prompted"); [self-driving CRM patterns](https://www.mindstudio.ai/blog/what-is-proactive-ai-reactive-to-anticipatory-agents)
("monitor commitments, detect neglected relationships, generate
contextual drafts 24/7") are productised in 2026.
What Borjie does that they don't: the *root MD* aggregates every
individual check-in into the *owner's* morning briefing, so the owner
gets a single coherent view of the org's pulse.

---

## 3. Architecture — the per-user thread tracker

The system maintains a **`UserThreadState`** per (tenant, user) tuple
that tracks the user's open commitments, the topics they last touched,
the decisions they have pending, the learning streaks, and the
relationships they tend.

```
                  Per-user thread state machine
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
   OPEN DECISIONS     LEARNING STREAK     RELATIONSHIPS
   ────────────────   ───────────────     ─────────────
   • Tier 2 awaits    • Days in a row     • Buyers tended
   • Tier 1 drafts    • Surfaces learnt   • Suppliers
     approved/not       (mastery scores)    contacted
   • Friction blocks  • Recent gains       • Workers checked
                                            in on
```

The state is updated by:

- Every chat turn the user has with Mr. Mwikila (the cognitive engine
  writes to the user's `UserThreadState` via the per-turn loop).
- Every approval/decline/defer action.
- Every artifact created.
- Every memory cell reinforced where the contributor is the user.
- Every tab opened or closed (via passive-capture-events).

At 09:00 local, a worker — `services/daily-followup-worker/` — reads
every user's state, composes a personalised 3-section check-in, and
posts it to the user's primary surface (chat-ui or WhatsApp Business
or email, per preference).

---

## 4. The daily check-in — format

Every check-in has three sections, in this order:

### 4.1 Yesterday's progress

A short paragraph naming what the user shipped, what was approved,
what was learned. Voice matches the user's mode preference
(GUIDE: "You approved the Tumemadini Q2 return; I filed it at 14:30 —
confirmation TRA-2026-Q2-09231. The buyer-pricing draft is ready for
your review." LEARN: "Yesterday you walked through the royalty
calculation with me. The Q2 return is filed. Want to try the FX
hedging walk-through today? Your last session was 4 days ago.")

### 4.2 Today's open items

A bullet list of 3–5 items needing the user's attention. Sorted by
urgency. Each carries:

- A short description.
- The deadline (if applicable).
- A one-tap action affordance.
- A confidence label (from cognitive-engine D3).

Example for a Manager (geologist):

- "Pit 4 wall-stability — your 4-month-old concern still has no
  resolution. I drafted an update memo to the owner; tap to review."
- "NEMC EIA renewal — due in 47 days. I have a complete draft; needs
  your sign-off on the bench-height table."
- "Mr. Mboya's leach-pad playbook — 3 questions you can answer to
  finalise. Tap to harvest."

### 4.3 Streaks & gaps

A short positive-reinforcement block. *"5-day streak on daily
check-ins."* *"Mastery on the FX-hedge tab moved from 0.62 to 0.71
yesterday — at 0.75 you're a veteran."* *"You haven't tended to your
buyer Jamhuri Mining in 17 days; their last DM is unread."*

The streaks section is the **alive** signal — the user feels seen,
known, and tracked-with-care (not surveilled).

---

## 5. The owner's aggregate view

Every check-in also writes a row to `daily_followup_summary` (one per
user per day). At 06:00 owner-local, the morning briefing aggregator
([`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md))
reads these rows and composes the owner's "Daily user check-ins"
section of the briefing.

The owner sees, in one scroll:

- Total users active yesterday: 14 of 16 (Saada off; Joseph offline).
- Streaks: 4 users at 5+ days.
- Open user-side decisions: 8 across the org; 2 are awaiting the
  owner (cross-reference back to the morning briefing's "awaiting
  your approval" section).
- Friction signals: 1 user (the new hire) struggled with the buyer-KYB
  flow yesterday — 22 minutes on a tab that should take 8. The
  meta-learning conductor proposes a recipe revision.
- Relationships tended: 6 buyer relationships touched yesterday; 3
  buyers haven't been contacted in >14 days.

This is what the founder calls **the org feels alive**: the owner
walks into a business that knows every employee's day, every
customer's last touch, every learning gain, every gap — captured
without anyone having to fill out a status report.

---

## 6. Privacy + opt-out controls

Daily check-ins are powerful and intrusive if mishandled. Three
controls:

1. **Per-user opt-out.** Every user can disable daily check-ins
   entirely from their settings. The owner cannot override (employee
   privacy).
2. **Frequency tuning.** Defaults are daily; user can set
   weekly-only, weekdays-only, or off.
3. **Channel preference.** Default to chat-ui; user can move to email,
   WhatsApp Business, or SMS.

The owner sees aggregate stats (counts) but NOT the per-user
check-in content. The check-in is between Mr. Mwikila and that
employee. The morning briefing surfaces:

- counts (active / inactive users yesterday),
- streaks (anonymised at the employee-name level if the user has
  chosen privacy mode),
- friction signals (tab-level, not user-level, if user has chosen
  privacy mode),
- and any items the user has explicitly flagged "share with owner".

The default for new tenants is: counts + streaks visible to owner;
content private. The owner can request more visibility per tenant but
must inform employees.

---

## 7. Tier-aware follow-up cadence

Different roles get different follow-up patterns:

| Role | Default cadence | Surface | Content emphasis |
|---|---|---|---|
| **Owner** | Once daily at 06:00 local | Morning briefing | Aggregate org pulse + open Tier 2 |
| **Manager** | Once daily at 09:00 local | Chat-ui Home tab + email | Open Tier 1 drafts to approve + capability progress |
| **Worker** | Twice daily (09:00 + 14:00) local | WhatsApp Business | Shift handoffs + tacit-knowledge harvest follow-ups |
| **Customer** (buyer) | On open thread cadence; default weekly | App + email | Inventory updates + price-window reminders |

The cadence is configurable per role per tenant. The defaults match
the rhythm of a typical mining-operator org.

---

## 8. Operating contract — TypeScript

```typescript
export interface UserThreadState {
  readonly user_id: string;
  readonly tenant_id: string;
  readonly open_decisions: ReadonlyArray<OpenDecision>;
  readonly pending_approvals: ReadonlyArray<PendingApproval>;
  readonly learning_streak_days: number;
  readonly last_active_at: string;
  readonly mastery_scores: Record<string, number>;        // surface_id -> 0..1
  readonly relationships_tended: ReadonlyArray<Relationship>;
  readonly recent_friction: ReadonlyArray<FrictionSignal>;
  readonly checked_in_today: boolean;
}

export interface DailyCheckIn {
  readonly id: string;
  readonly user_id: string;
  readonly tenant_id: string;
  readonly composed_at: string;
  readonly local_date: string;
  readonly section_yesterday: string;
  readonly section_today: ReadonlyArray<TodayItem>;
  readonly section_streaks: ReadonlyArray<StreakItem>;
  readonly delivered_channel: 'chat-ui' | 'email' | 'whatsapp' | 'sms';
  readonly delivered_at: string | null;
  readonly viewed_at: string | null;
  readonly responded_at: string | null;
  readonly mode_used: 'guide' | 'learn';
  readonly audit_hash: string;
}

export interface DailyFollowupSummary {
  readonly id: string;
  readonly tenant_id: string;
  readonly local_date: string;
  readonly users_active: number;
  readonly users_inactive: number;
  readonly streaks_5_plus: number;
  readonly open_decisions_total: number;
  readonly relationships_overdue: ReadonlyArray<{ buyer_name: string; days_since_contact: number }>;
  readonly friction_signals_top3: ReadonlyArray<FrictionSignal>;
  readonly composed_at: string;
}
```

Schema (migration `0034_daily_followup.sql`):

```sql
CREATE TABLE user_thread_states (
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  open_decisions JSONB NOT NULL DEFAULT '[]',
  pending_approvals JSONB NOT NULL DEFAULT '[]',
  learning_streak_days INTEGER NOT NULL DEFAULT 0,
  last_active_at TIMESTAMPTZ,
  mastery_scores JSONB NOT NULL DEFAULT '{}',
  relationships_tended JSONB NOT NULL DEFAULT '[]',
  recent_friction JSONB NOT NULL DEFAULT '[]',
  checked_in_today_date DATE,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE daily_check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  composed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  local_date DATE NOT NULL,
  section_yesterday TEXT NOT NULL,
  section_today JSONB NOT NULL,
  section_streaks JSONB NOT NULL,
  delivered_channel TEXT NOT NULL,
  delivered_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  mode_used TEXT NOT NULL CHECK (mode_used IN ('guide','learn')),
  audit_hash TEXT NOT NULL,
  UNIQUE (user_id, local_date)
);

CREATE TABLE daily_followup_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  local_date DATE NOT NULL,
  users_active INTEGER NOT NULL,
  users_inactive INTEGER NOT NULL,
  streaks_5_plus INTEGER NOT NULL,
  open_decisions_total INTEGER NOT NULL,
  relationships_overdue JSONB NOT NULL DEFAULT '[]',
  friction_signals_top3 JSONB NOT NULL DEFAULT '[]',
  composed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, local_date)
);
```

All three tables have RLS keyed on `tenant_id`. Per-user privacy
restricts owners to summary-level access on `daily_check_ins`.

---

## 9. SOTA landscape — 2026 references

- **Google Gemini Spark / Daily Brief** ([Explosion overview, May 2026](https://www.explosion.com/186813/google-turns-gemini-into-a-proactive-ai-agent-with-spark/))
  — proactive AI agent with morning/afternoon/evening Daily Brief
  summaries via email or Telegram.
- **Proactive AI Pattern** ([Use Your AI](https://www.useyourai.com/agents/proactive-ai-agent/))
  — continuously observes, identifies patterns, initiates actions
  without prompts.
- **MindStudio Proactive AI** ([primer](https://www.mindstudio.ai/blog/what-is-proactive-ai-reactive-to-anticipatory-agents))
  — "monitor commitments, detect neglected relationships, generate
  contextual drafts 24/7". CRM Assistant case study describes daily
  check-ins.
- **Replit Agent 4** ([product page](https://replit.com/agent4)) —
  200-minute autonomous sessions with self-reflection; the architecture
  ports to daily check-ins.

---

## 10. How this connects to existing Borjie architecture

- **Autonomous Loops Spec**
  [`AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md): the daily
  check-in is a per-user variant of the existing Daily Research Loop,
  running at user-local 09:00 instead of global 04:00.
- **Master Brain Autonomy Manifesto** §2.3 ("Anticipatory, not Reactive"):
  every user gets the same anticipatory treatment the owner gets.
- **Unified Cognitive Memory** [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md):
  the user's mastery scores and relationship-tending records live as
  `preference` and `pattern` memory cells respectively.
- **Org Hierarchy Terminology** [`ORG_HIERARCHY_TERMINOLOGY_SPEC.md`](./ORG_HIERARCHY_TERMINOLOGY_SPEC.md):
  the scoped MD at each org unit composes the local-flavour check-in;
  the root MD aggregates.
- **Guide vs Learn Mode** [`GUIDE_VS_LEARN_MODE_SPEC.md`](./GUIDE_VS_LEARN_MODE_SPEC.md):
  every check-in obeys the user's mode preference.
- **24/7 Work Cycle** [`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md):
  the morning briefing aggregator pulls the `daily_followup_summary`
  row of the prior day.

---

## 11. Anti-patterns

1. **Nagging.** A check-in that fires daily with no new content
   becomes noise. The composer must include a *novelty filter*: if
   yesterday's open items are unchanged AND no new artifacts shipped,
   the check-in is **skipped** (counts toward the streak as
   *no-activity-acknowledged*, not as *missed*).
2. **No-respect for opt-out.** A user who has set frequency to
   weekly-only must NOT get a daily check-in even if the system
   detects a critical open item. Critical items route to the
   escalation path, not the cadence path.
3. **Surveillance feel.** Check-in content for an individual must
   never include language like *"the system noticed you spent 17
   minutes on tab X"* — the user must feel partnered with, not
   observed. The voice rendering is critical.
4. **Aggregating PII into the owner brief.** The owner sees counts,
   streaks, and friction (tab-level). Specific user text from a
   check-in does NOT bleed into the owner's morning briefing without
   explicit user opt-in.
5. **Same content twice.** If the user already saw the open
   decision in last night's morning brief (owner) or yesterday's
   check-in, the check-in must dedupe.
6. **Time-zone drift.** Local 09:00 is *user-local* (not org-local
   and not server-UTC). The composer must read each user's timezone
   preference (existing `users.timezone`).

---

## 12. Phase 2 implementation map

- **New package** `packages/user-followup/` (≈700 LOC):
  - `thread-state-aggregator.ts` (composes the `UserThreadState`
    from cognitive turns + approvals + mastery + relationships).
  - `daily-check-in-composer.ts` (composes the 3-section check-in
    using the GUIDE/LEARN voice templates).
  - `delivery-channels.ts` (chat-ui, email, WhatsApp Business, SMS
    fanout).
  - `summary-composer.ts` (composes the org-level
    `daily_followup_summary` row).
- **New service** `services/daily-followup-worker/` — runs hourly,
  fires per-user composer when each user's local time hits 09:00.
- **Migration** `0034_daily_followup.sql` — 3 tables above + the 2
  tables from [`GUIDE_VS_LEARN_MODE_SPEC.md`](./GUIDE_VS_LEARN_MODE_SPEC.md).
- **API routes:**
  - `GET  /api/v1/followup/state/:user_id`
  - `POST /api/v1/followup/optout`
  - `GET  /api/v1/followup/summary/:tenant_id/:date`
- **Estimated effort:** 3 weeks for one engineer (most reuse from
  existing per-turn loop + morning-briefing aggregator).

---

## 13. Cross-reference to siblings

- Master vision: [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md)
  §7 (the day-in-the-life narrative).
- 24/7 work cycle: [`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md).
- Guide vs Learn: [`GUIDE_VS_LEARN_MODE_SPEC.md`](./GUIDE_VS_LEARN_MODE_SPEC.md).
- Tab-as-loop: [`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md) — the
  per-tab friction signals feed the check-in's gap section.
- Strategic direction: [`STRATEGIC_DIRECTION_LAYER_SPEC.md`](./STRATEGIC_DIRECTION_LAYER_SPEC.md)
  — strategic memos may flag specific employees as growth
  candidates; the check-in surfaces these as opportunities.
- Five-layer loop: [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md)
  — every check-in passes the quality gates before delivery.

---

*The org feels alive because Mr. Mwikila is everywhere — but with
discipline. Daily check-ins are a privilege of attention, not an
audit. They tell every user: I know what you're working on, I'm
here to help, and the owner is informed at the right level of
abstraction.*

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
