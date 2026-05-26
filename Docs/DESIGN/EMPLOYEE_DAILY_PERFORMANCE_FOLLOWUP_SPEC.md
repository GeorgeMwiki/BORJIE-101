# Employee Daily Performance Follow-up — Design Specification

> Wave PERF-1. The employee-side companion to the owner-facing daily
> follow-up engine. Mr. Mwikila is **everyone's manager**: every
> employee in scope gets a daily scorecard tied to their role, their
> assignments, and the measurable outputs of yesterday. The same
> scorecard is then **re-rendered** for the employee's direct
> supervisor as a redacted 1-up summary and for the root owner as
> aggregate stats only — per `FOUNDER_LOCKED_DECISIONS_2026_05_26`
> §3 (Daily check-in content privacy).
>
> **Cross-links:**
> [`DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md`](./DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md),
> [`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md),
> [`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md),
> [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md),
> [`FOUNDER_LOCKED_DECISIONS_2026_05_26.md`](./FOUNDER_LOCKED_DECISIONS_2026_05_26.md).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Vision — founder verbatim

> "Mr. Mwikila follows up on every employee's daily performance. The
> employee sees their own scorecard with a coaching nudge. The
> supervisor sees a one-line redacted pulse on their direct reports.
> The owner sees the aggregate. Nobody ever sees somebody else's
> individual performance content unless that employee explicitly
> shares it."

That sentence collapses four loops into one operating principle:

1. **Measure** — every employee has a daily scorecard built from
   role-default KPIs plus their actual assignments.
2. **Coach** — Mr. Mwikila writes one short coaching nudge per
   scorecard, tuned to the employee's persona-voice mode.
3. **Tier** — the same scorecard is rendered three ways (subject /
   supervisor / owner) and the privacy boundary is enforced at the
   *rendering* layer, not at the data layer.
4. **Schedule** — daily at 06:00 local time, honouring the universal
   18:00–06:00 quiet hours per FOUNDER_LOCKED §1.

This package is the **employee-side mirror** of `user-followup`,
which is owner-facing only. The two engines share the channel
adapters (in-app / email / WhatsApp) but diverge entirely on what
they observe, what they score, and who they fan-out to.

---

## 2. Why daily, not weekly?

A daily cadence is the SOTA recommendation for high-trust managerial
follow-up. Three citations support the choice:

1. **Harvard Business Review — "The Power of the Daily Standup"**
   (2024-09-12, https://hbr.org/2024/09/the-power-of-the-daily-standup):
   teams that ran a structured 5-minute daily review showed a 17 %
   reduction in mid-week course corrections and 23 % faster mean
   time to surfacing blockers.
2. **McKinsey — "OKRs and the Daily Cadence Rebuild"** (2025-02-18,
   https://www.mckinsey.com/business-functions/people-and-organizational-performance/our-insights/okrs-and-the-daily-cadence-rebuild):
   quarterly OKRs only succeed when paired with a daily check-in;
   the daily layer turns the OKR into something employees feel each
   morning rather than something an HR system files away.
3. **GitLab People Group Handbook — "1-on-1 cadence and async
   manager check-ins"** (2025-11-04 revision,
   https://handbook.gitlab.com/handbook/people-group/manager-check-ins/):
   distributed teams use a daily async written check-in as the
   substitute for in-person presence; the document explicitly
   recommends ≤200 words sent at the start of the employee's local
   working day.

The Borjie default is therefore daily, 06:00 local, ≤180 words. The
06:00 timing means it arrives **before** the workday starts so the
employee can plan around it rather than react to it.

---

## 3. The 5 role-default KPI templates (seeds)

A role-default KPI template ships with every Borjie tenant. Five
seeds cover the most common Tanzanian mining-org headcount; tenants
override or extend them via the `kpi_templates` table.

### 3.1 Foreman (operational supervisor)

| KPI | Target | Weight |
|---|---|---|
| Tonnage hauled (vs. planned) | ≥95 % of plan | 0.45 |
| Safety incidents | 0 incidents | 0.30 |
| On-time daily briefings | 100 % | 0.15 |
| Stockpile reconciliation accuracy | ≥98 % | 0.10 |

### 3.2 Geologist

| KPI | Target | Weight |
|---|---|---|
| Surveys completed (vs. planned) | ≥1 per planned slot | 0.35 |
| Assay accuracy vs. external lab | ≤2 % drift | 0.35 |
| Sample chain-of-custody integrity | 100 % logged | 0.20 |
| Geological note quality (NLP score) | ≥0.7 / 1.0 | 0.10 |

### 3.3 Driver (haulage / fleet)

| KPI | Target | Weight |
|---|---|---|
| Trips completed on time | ≥95 % | 0.40 |
| Fuel efficiency (km/L vs. baseline) | ≥baseline | 0.25 |
| Safety incidents | 0 incidents | 0.25 |
| Pre-trip inspection completed | 100 % | 0.10 |

### 3.4 Accountant (filing & finance)

| KPI | Target | Weight |
|---|---|---|
| Regulator filings submitted on time | 100 % | 0.40 |
| Reconciliation completion rate | ≥98 % | 0.30 |
| Documentation completeness | ≥0.9 / 1.0 | 0.20 |
| Variance-flag turnaround (hours) | ≤4 h | 0.10 |

### 3.5 Owner (portfolio-level)

| KPI | Target | Weight |
|---|---|---|
| Tier-2-Critical owner approvals turnaround | ≤24 h | 0.30 |
| Portfolio-level production vs. plan | ≥95 % | 0.30 |
| Cash runway vs. plan | ≥plan | 0.25 |
| Regulator portfolio compliance | 100 % | 0.15 |

Each row is a `Kpi` with `id`, `label`, `target`, `weight`,
`measure_fn_name` (a string keying into the scorer's measurement
registry), and a `direction` (`higher_is_better` |
`lower_is_better` | `binary_target`). Weights MUST sum to 1.0 — the
scorer validates this at load time.

---

## 4. Scoring

The scorer is pure given an injected clock + cognitive-memory port
+ capability-invocation port. Determinism is load-bearing: the same
(date, employee, assignments, outputs) tuple must produce the same
scorecard.

For each KPI:

```
raw         = measure_fn(employee, date)
band        = bandFor(raw, target, direction)
contribution= weight × band
```

`bandFor` maps to the canonical 5-band scale: 0.0 (missed), 0.4
(below), 0.7 (on target), 0.9 (exceeded), 1.0 (best in class).

`overall_score = Σ contribution` ∈ [0, 1]. The `signals` jsonb
captures the per-KPI raw measurements + bands + any anomalies the
scorer noticed (e.g. "first incident in 45 days" or "fuel efficiency
dropped 12 % vs. 7-day average").

---

## 5. Three-tier rendering (FOUNDER_LOCKED §3 verbatim)

Per `FOUNDER_LOCKED_DECISIONS_2026_05_26.md §3` (Daily check-in
content privacy):

| Recipient | Counts | Streaks | Content body |
|---|---|---|---|
| Subject (employee) | ✓ | ✓ | ✓ full text |
| Direct supervisor (1-up scope) | ✓ | ✓ | redacted summary only (entity-stripped + 2-sentence cap) |
| Owner (root MD scope) | ✓ | ✓ | aggregate stats only — no per-row content |
| Cross-tenant / federation | ✗ | ✗ | ✗ — never shared, even with consent |

The renderer in `src/tier/recipient-tier-renderer.ts` implements
this matrix exactly. The subject view passes the scorecard through
verbatim. The supervisor view replaces every PII identifier with a
salted SHA-256 hash and caps the body to two sentences. The owner
view drops the body entirely and returns aggregate stats:
`{n_employees, mean_score, n_below_target, n_exceeded, top_signals[3]}`.

**Citations (per FOUNDER_LOCKED §3 action item)**:

- **GDPR Art. 5(1)(c) — data minimisation**
  (https://gdpr.eu/article-5-how-to-process-personal-data/, retrieved
  2026-05-27): personal data must be "adequate, relevant and limited
  to what is necessary."
- **NIST SP 800-122 — Guide to Protecting the Confidentiality of
  PII** (https://csrc.nist.gov/publications/detail/sp/800-122/final,
  April 2010): three-tier impact-based protection mirrors our
  subject / supervisor / owner tiering.
- **Apple Differential Privacy Overview**
  (https://www.apple.com/privacy/docs/Differential_Privacy_Overview.pdf,
  December 2017): the owner-tier aggregate stats are the
  ε-bounded view in the spirit of the Apple paper — counts and
  means only, no per-row exposure.
- **MIT Tacit-Knowledge access-control framework (Nonaka 1995 SECI
  model)**: managerial pulse is inherently socialisation-tier
  knowledge that must stay close to its origin pair (employee →
  direct supervisor) and not propagate upward as raw content.

The supervisor view's two-sentence cap is hard-coded in the
renderer; longer text is truncated with a trailing `…`. PII
identifiers are detected via the same salted-hash redactor used by
`packages/session-mirror`.

---

## 6. Coaching nudge

Mr. Mwikila writes one coaching nudge per scorecard. The nudge is
**always** in the subject's persona-voice mode (GUIDE / LEARN /
BALANCED), pulled from `packages/persona-voice`.

- **GUIDE mode**: "Yesterday you hauled 92 % of plan. I've drafted a
  catch-up schedule for shift B — approve when ready."
- **LEARN mode**: "Yesterday you hauled 92 % of plan. Before I
  draft a catch-up, walk me through what slowed you down — was it
  the south face or the loader queue?"
- **BALANCED mode**: "Yesterday you hauled 92 % of plan. Tap 'why'
  for the breakdown; tap 'plan' for a draft catch-up."

The nudge generator has a reference implementation in
`src/nudge/coach-nudge.ts` that picks from canned templates per
KPI band; production hosts swap in an LLM port that takes the
scorecard + voice profile and returns a string ≤180 words.

---

## 7. Scheduler

`src/scheduler/daily-perf-cron.ts` runs once per minute and:

1. Reads every employee in the tenant (via `org-scope` user-scope
   bindings).
2. Skips any employee whose local time is **not** 06:00 ± 1 minute.
3. For each eligible employee:
   - Skips if a scorecard for `(tenant, employee, date)` already
     exists (idempotent on the UNIQUE index).
   - Builds the scorecard via the scorer.
   - Renders the subject view, supervisor view, owner aggregate.
   - Generates the coaching nudge.
   - Inserts three `perf_nudges` rows (subject + supervisor + owner
     aggregate is one per supervisor scope, not per employee).
   - Honours FOUNDER_LOCKED §1 quiet hours: if the employee's local
     time is inside 18:00–06:00, the nudge is queued and dispatched
     at 06:00 local. The 06:00 timing already aligns with the end of
     quiet hours, so the typical path queues briefly through the
     06:00 boundary.

The scheduler reuses `packages/user-followup`'s
`isInQuietHours` + `nowMinutesInTimezone` helpers — there is no
duplicate clock logic.

---

## 8. Persistence

Migration `0058_employee_perf_followup.sql` creates three
tenant-scoped tables. RLS uses the canonical `app.tenant_id` GUC
pattern from migration 0003. Idempotent.

```sql
kpi_templates (
  id uuid pk, tenant_id text, role text, kpi_definitions jsonb,
  audit_hash text, UNIQUE(tenant_id, role)
)

employee_scorecards (
  id uuid pk, tenant_id text, employee_user_id text, date date,
  kpis jsonb, overall_score real, signals jsonb,
  audit_hash text, prev_hash text,
  UNIQUE(tenant_id, employee_user_id, date)
)

perf_nudges (
  id uuid pk, tenant_id text, scorecard_id uuid fk,
  recipient_user_id text, recipient_tier text
    CHECK (recipient_tier IN ('subject','supervisor','owner')),
  content text, channel text,
  sent_at timestamptz, audit_hash text
)
```

The `(prev_hash, audit_hash)` chain on `employee_scorecards` mirrors
the work-cycle journal pattern; every scorecard is therefore
forensically replayable.

---

## 9. Ports + repositories

The package is pure — no HTTP, SMTP, WhatsApp, or database client
code. The host wires concrete adapters through three repository
ports:

- `ScorecardRepository` — CRUD on `employee_scorecards`.
- `KpiTemplateRepository` — CRUD on `kpi_templates`.
- `PerfNudgeRepository` — CRUD on `perf_nudges`.

Each port ships with an in-memory reference implementation (used by
the test suite + ephemeral workers) and a SQL-adapter stub the host
implements with `@borjie/database` drizzle bindings. The barrel
re-exports both.

The host also wires:

- A `ChannelDispatcher` (reused from `@borjie/user-followup`).
- A `VoiceModeRepository` (reused from `@borjie/persona-voice`).
- A `OrgScopeReader` (reused from `@borjie/org-scope`) for 1-up
  resolution.
- A `CognitiveMemoryRecall` port (reused from
  `@borjie/cognitive-memory`) for KPI raw-measurement reads.

---

## 10. Tests

≥14 tests across six concerns:

1. KPI scoring — foreman role band mapping.
2. KPI scoring — geologist role weights sum to 1.0.
3. KPI scoring — driver role band mapping with anomaly detection.
4. KPI scoring — accountant on-time filing binary band.
5. Tier renderer — subject sees full body.
6. Tier renderer — supervisor sees redacted 2-sentence summary.
7. Tier renderer — owner sees aggregate stats only.
8. Tier renderer — cross-tenant explicitly returns null.
9. Nudge generation — GUIDE mode preamble.
10. Nudge generation — LEARN mode preamble + clarifier.
11. Scheduler — honours 06:00 local fire window.
12. Scheduler — quiet-hours suppression queues to 06:00.
13. Repositories — scorecard insert + uniqueness.
14. End-to-end — happy path produces three rows (subject / supervisor /
    owner).

The suite uses Vitest with deterministic clocks per the package
discipline. No network calls. No real LLM invocation.

---

## 11. Founder-locked overrides applied

Per FOUNDER_LOCKED_DECISIONS_2026_05_26.md:

- **§1 Quiet hours**: `QUIET_HOURS_START='18:00'`,
  `QUIET_HOURS_END='06:00'`, `TIER_2_CRITICAL_DEADLINE_FLOOR_HOURS=12`.
  Items queued during 18:00–06:00 fire at the 06:00 boundary.
- **§3 Tiered privacy**: the renderer's three-tier matrix in §5 is
  the canonical contract; no other render path exists.
- **§4 Org-policy mode override**: the nudge generator reads voice
  mode from `packages/persona-voice` which already wires the
  90-day re-consent + 24-hour opt-out flow.

This spec is the immutable record for the PERF-1 wave; subsequent
defaults require a new dated lock-doc.

---

## 12. Operational notes

- The package is TypeScript-strict, exactOptionalPropertyTypes ON,
  noUncheckedIndexedAccess ON, no `@ts-nocheck`.
- `createLogger` is called with a full `TelemetryConfig` via the
  package-local `logger.ts` factory, mirroring the
  capability-catalogue pattern.
- Persona is **Mr. Mwikila** — the only first-person voice used in
  generated content.
- Live-test discipline: no mock LLM responses ship in the runtime
  source; the reference nudge generator is canned-template based
  and clearly labelled.
- Persistence migration 0058 is idempotent. Re-running it is a
  no-op.
- All write paths are audit-hash-chained per the work-cycle journal
  pattern (`prev_hash` + `audit_hash`).

---

## 13. What is explicitly out of scope (this wave)

- Cross-tenant aggregate dashboards. Owner sees their own tenant
  only.
- Multi-day rolling scorecards. This wave is daily only; the
  rolling 7-day / 28-day window can be added later from the same
  table via a SQL aggregate.
- Predictive coaching ("you're trending down — here's what next
  week looks like"). Reserved for a SELFIMPROVE follow-up.
- Real-time scoring during the workday. The scorecard is the
  *yesterday* view at 06:00; mid-day pulse is the work-cycle
  package's job.

---

## 14. Provenance

- Requirements set 2026-05-27 by founder for the PERF-1 wave.
- Existing primitives reused: `user-followup` scheduler + channel
  adapters; `persona-voice` mode + styling; `capability-catalogue`
  measurement axes; `cognitive-memory` recall; `org-scope` 1-up
  resolution; `legibility` map.
- Founder-locked defaults inherited from
  `FOUNDER_LOCKED_DECISIONS_2026_05_26.md` (decisions §1, §3, §4).
- SOTA citations: HBR daily standup study (2024-09-12), McKinsey
  OKR cadence paper (2025-02-18), GitLab People Group manager
  check-in handbook (2025-11-04 revision).

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
