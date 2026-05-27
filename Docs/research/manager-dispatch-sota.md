# Manager-Dispatch UX — State of the Art 2026

**Audience:** Borjie product + workforce-mobile design squad
**Scope:** Manager role (site-level mid-layer between Owner and Workers)
**Surface in focus:** `apps/workforce-mobile/app/(tabs)/home.tsx` when `user.role === 'manager'`
**Date:** 2026-05-27
**Method:** 12 WebSearch + 8 WebFetch deep dives across dispatch, triage, field-service, mining shift control, construction superintendents, restaurant GMs, healthcare EMS, and AI dispatch.

---

## 0. Manager is a different beast

The owner asks "are we winning?" The worker asks "what do I do next?" The manager sits between and must answer both in opposite directions every hour:

- **Upward:** What does the owner need to know now?
- **Downward:** Who has slack, who is blocked, what is the next move?
- **Lateral:** Which crew is at risk of missing target? Which equipment is going to fail before lunch?

Every reference below confirms the same shape: managers run a *protocol engine*, not an information explorer. Their UX is decision-first, scannable in <10 seconds, and every screen state must surface the next actionable step.

This is the unifying design constraint: **if a data point cannot inform a decision in the next ten minutes, it does not belong on the manager home.** ([Mobisoft command center 2026](https://mobisoftinfotech.com/resources/blog/transportation-logistics/command-center-operations-dashboard-alerts-decision-loops)).

---

## 1. Information architecture — manager home priority order

Across 14 references the dominant pattern is a **four-band layered home** in this order:

| Band | Purpose | Latency tolerance | Mobile real estate |
|------|---------|-------------------|--------------------|
| **1. Site pulse** | KPI vs plan, attainment %, safety flag | <60 sec | Top 1/3 (above the fold) |
| **2. Live exceptions** | Red/amber alerts demanding action | <5 min | Middle slice, scrollable card stack |
| **3. Crew & dispatch** | Who's on, who's free, what's queued | <15 min | Mid-bottom, swipeable tabs |
| **4. Approvals & escalations** | Backlog of pending requests, send-up queue | <hour | Bottom anchored or drawer |

This mirrors Linear's Triage (inbox above all else), ServiceTitan Atlas (Activity Center centralizes alerts), Bringg (Map+List unified), and CommandCentral CAD (incident prioritization first).

**Critical:** mining-specific KPI dashboards converge on **3–5 KPIs per band, color-coded green/amber/red**, with explicit thresholds ([opsima mining KPIs](https://opsima.com/blog/kpis/mining-industry-kpis/)). More KPIs reduce perceived urgency of any single one — and operators experience "visual-noise normalization" at ~20 minutes of sustained exposure ([Mobisoft 2026](https://mobisoftinfotech.com/resources/blog/transportation-logistics/command-center-operations-dashboard-alerts-decision-loops)).

### Site pulse — what the top of screen must show

From the Wenco / opsima / inetsoft mining sources and ServiceTitan Atlas:

1. **Plan attainment %** for current shift (vs target tonnes / units processed)
2. **Active alerts count** with single-tap drill-in
3. **Crew on-shift / expected ratio** (e.g. "23 / 27 on shift")
4. **Equipment availability %** by class (haul / drill / processing)
5. **Safety status pill** — green/amber/red, with last incident timestamp

These are the same KPIs surfaced on Wenco, GroundHog Shift Boss, Commit Works CiteOps, and Modular Mining DISPATCH "embedded dashboard display" ([CIM Magazine — Automated Supervision](https://magazine.cim.org/en/technology/automated-supervision/)).

---

## 2. Crew visualization — what works on mobile

Six patterns appear repeatedly; only three survive the mobile-thumb test:

| Pattern | Web works | Mobile works | Used by |
|---------|-----------|--------------|---------|
| Avatar grid + status pill | yes | **yes** | 7shifts, Toast, GitHub Mobile |
| List with status pill + sparkline | yes | **yes** | Linear, Asana, Onfleet driver list |
| GPS map of workers | yes | partial | Onfleet, Bringg, ServiceTitan, Modular DISPATCH |
| Calendar swimlane | yes | no | Procore, Bridgit Bench (desktop only) |
| Gantt | yes | no | Salesforce FSL, Dynamics 365 schedule board |
| Kanban columns | yes | partial | Height, Linear board |

### The winning mobile pattern

**Vertical list of crew members, one row per person**, with:

- **Avatar** (40×40 left), photo or initials, with a colored **status dot**
- **Name + role** on top line (16pt semibold)
- **Status pill** on second line ("On site · 06:12", "Late 18 min", "Absent — sick", "Break", "Off")
- **Workload bar** (right side) — micro-bar showing today's assigned task load vs capacity (0–100%)
- **Right-chevron** for drill-in, or **swipe-right to reveal action sheet** (reassign, message, mark absent)

Mining-specific add-ons (from GroundHog Shift Boss and Commit Works):
- **Equipment paired** — which truck/loader/drill they're currently assigned to
- **Productivity sparkline** — last 4 hours of tonnes/output per hour

For GPS context, a **map-toggle button at the top of the crew section** swaps the list for a map view (Onfleet "Unified View" pattern, Bringg January 2025 release). Do not default to map; the list is faster to scan and one-thumb-friendly. ([Bringg Dispatch Experience](https://help.bringg.com/docs/introducing-the-new-dispatch-and-planning-experience), [Onfleet 2025](https://onfleet.com/blog/2025-whats-new-in-onfleet/)).

---

## 3. Task assignment UX — high-conversion vs friction patterns

### High-conversion (mobile-native, used by ServiceTitan Atlas Fall 2025, Onfleet, Bringg)

| Pattern | Where used | Why it works |
|---------|-----------|--------------|
| **Tap-and-assign bottom sheet** | ServiceTitan, Onfleet right-click → mobile equivalent | Single thumb, one screen, names visible |
| **Swipe-right on task to "accept on my behalf"** | Linear Triage mobile | 100ms gesture vs 500ms tap-and-search |
| **Auto-assign suggestion w/ override** | Onfleet auto-assign, Bringg AutoDispatch, FieldProxy AI | Manager review > manager create |
| **Long-press task → multi-select → bulk action** | GitHub Mobile inbox, Linear Triage | Backlog burn-down in seconds |
| **Drag from "holding area" to crew row** | ServiceTitan Atlas "Job Holding Area" | Cognitively clear: unassigned → assigned |
| **Driver self-claim from pool** | Onfleet Driver App self-assign, 7shifts Shift Pool | Removes manager from the loop entirely |

### Low-conversion (avoid on mobile)

- Drag-and-drop Gantt swimlanes — requires 2 hands, breaks at small sizes (Salesforce FSL, Dynamics 365 are desktop-only for a reason).
- Modal forms with >3 fields per assignment.
- "Pick technician from dropdown of 47" — replace with AI suggestion + override.
- Calendar grid with hourly cells — too small on phones.

### The Borjie pattern (synthesized)

For each unassigned task in the dispatch queue, the row is:

```
[icon] Task title           [AI: João 87%] [chevron]
       Site · ETA · priority
```

- Tap row → bottom sheet with **AI top-3 recommendations** ranked by confidence score (FieldCamp/FieldProxy pattern, [Microsoft Dynamics AI](https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/csw-enable-ai-suggested-cases-knowledge-articles)).
- Tap a name → assigned, haptic confirmation, row dismissed.
- Swipe row right → assign to top-suggested.
- Swipe row left → snooze 1 hour (mining: equipment not yet ready, weather, blast clearance).
- Long-press → multi-select for bulk assign.

---

## 4. Approval queue — the Linear Triage gold standard

Linear Triage is unanimously cited as the SOTA pattern for processing a backlog of incoming requests fast. The interaction model that survives translation to mobile:

### Linear Triage decoded ([Linear Docs](https://linear.app/docs/triage))

- **One-key dispositions:** `1` accept, `2` mark duplicate, `3` decline, `H` snooze. On mobile this becomes **single-swipe gestures** — left/right/long-press.
- **Hidden until needed:** snoozed items disappear from the queue and resurface on activity or timer. Borjie manager should snooze approvals not abandon them.
- **Triage Intelligence (AI):** the system learns prioritization patterns and pre-suggests priority. The manager confirms or overrides, never starts from blank.
- **No multi-step dialogs.** Every decision is one tap, one swipe, or one confirmation modal. Linear's design philosophy is "single-key decisions, never branching dialogs."

### Translation to Borjie manager-home approvals

Each approval row:
```
[Worker avatar]  Aisha · Leave request   [3d ago]
                 04 Jun — 06 Jun (3 days)
                 Reason: Family wedding
─────────────────────────────────────
 [⬅ Decline]    [Snooze 24h]   [Approve ➡]
```

- **Swipe right** approve, **swipe left** decline, **tap snooze chip** defer.
- **Approve** has haptic-success confirmation, no modal.
- **Decline** opens a single-input bottom sheet asking for reason (mandatory — audit chain).
- **Bulk select** via long-press for "approve all pending leave for this week" type batches.
- **AI hint inline:** "Borjie suggests Approve — Aisha has 18 unused leave days, no schedule conflict, 92% confidence" rendered as a subtle chip below the request, not a popup ([ShapeOfAI nudges pattern](https://www.shapeof.ai/patterns/nudges)).

### What approval types exist on Borjie

Cross-referenced against `services/api-gateway/src/routes/*.hono.ts`:
- Leave requests
- Shift swap requests (7shifts pattern)
- Overtime authorization
- Equipment reassignment requests
- Material/supply requests
- Worker self-reported incidents requiring manager sign-off
- AI-flagged anomalies requiring human acknowledgment (e.g. attendance gap explanation)

All flow through one **unified inbox**, not one queue per type. The Linear/GitHub/Asana pattern is converging: one queue, filtered by tab or chip. ([GitHub Notification Inbox](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox)).

---

## 5. Escalation patterns — sending it up to the owner

Across PagerDuty, CommandCentral CAD, ServiceTitan, mining DISPATCH systems:

### The dominant pattern: tiered, automated, never manual-only

| Tier | Trigger | Channel | Latency |
|------|---------|---------|---------|
| **1. Self-handle** | Within manager's authority | Inline action | Now |
| **2. Peer-coordinate** | Cross-site or cross-crew | In-app message or co-assign | <5 min |
| **3. Escalate up** | Exceeds policy threshold or refused by peer | Owner notification + log | <5 min from tier 2 |
| **4. Auto-escalate** | Tier 1 alert unack'd in 90 sec | System notifies owner direct | 90 sec |

Mobile UX patterns:

- **"Escalate to Owner" button** is always one tap from any alert detail (PagerDuty mobile reassign pattern: "More → Reassign → next on-call").
- **Pre-filled escalation context:** when the manager taps escalate, the system pre-composes the message (alert summary, what manager already tried, recommended next steps) — they review and send. ServiceTitan Atlas Activity Center centralizes this.
- **Dynamic escalation:** if the manager dismisses three Tier-1 alerts in a row without action, the system auto-escalates to owner ([USPTO patent 9886840 — chain-of-command escalation](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9886840)).
- **Read-receipt visibility:** the manager sees when the owner has opened the escalation; cuts the "did they see it?" anxiety loop.

### Mining-specific escalations

From CIM Automated Supervision and opsima mining KPIs:
- **Safety incident** — auto-escalate immediately, fail-closed.
- **Plan attainment <90%** at mid-shift — surface to owner with root cause options.
- **Unplanned downtime >4 hours** — root-cause assignment, owner notified.
- **Repeat equipment failure (same asset, 2nd time)** — halt and escalate.
- **Kill-switch activation** — per Borjie CLAUDE.md hard rule, fail-closed and never silenced.

---

## 6. AI suggestions — the "Borjie suggests X" pattern without nagging

State of the art in 2026 (Gartner: 40% of enterprise apps will include task-specific AI agents by end-2026):

### Three patterns work, two fail

**Works:**

1. **Inline chip with confidence score** — "Borjie suggests João · 87% match · why?" rendered next to the action button. Subtle, dismissable, never blocks. (Pattern: GitHub Copilot inline completions, Grammarly suggestions, [koruux AI patterns](https://www.koruux.com/ai-patterns-for-ui-design/)).

2. **Pre-fill, never auto-submit** — Borjie picks the suggested assignee but the manager must confirm. Removes the "AI just did something I didn't approve" anxiety. (Pattern: Microsoft Copilot, Linear Triage Intelligence).

3. **Explain on hover/tap** — "Why João? On site, certified for excavator, lowest workload, no overlap with safety stand-down." Confidence + reasoning together. ([Microsoft Confidence Scoring](https://learn.microsoft.com/en-us/azure/ai-services/language-service/question-answering/concepts/confidence-score)).

**Fails:**

1. **Popup/modal asking "Accept AI suggestion?"** — interruption tax. INSEAD research distinguishes nudge (good) from "tell me what to do" (bad) ([INSEAD Knowledge](https://knowledge.insead.edu/operations/should-ai-nudge-you-or-tell-you-what-do)).

2. **Auto-assign without consent** — destroys trust. Every reference recommends "AI augments dispatch decisions; humans confirm." Override capability is non-negotiable.

### Confidence thresholds for routing

From ablypro / fieldproxy: AI confidence scores route to different UX paths:
- **>90%:** show as pre-filled default, one-tap confirm.
- **70–90%:** show top 3 as options, manager picks.
- **<70%:** ask manager from scratch; tell them AI was unsure and why.

### Borjie-specific: bilingual hint text

Per Borjie CLAUDE.md hard rule (Swahili-first), every AI suggestion chip is rendered in both `sw` and `en`:
```
sw: "Borjie inapendekeza João · 87%"
en: "Borjie suggests João · 87%"
```
Toggle by user language preference.

---

## 7. References & sources

### Triage / IC dashboards
- **Linear Triage** — [linear.app/docs/triage](https://linear.app/docs/triage) — gold standard for inbox-style queue burn-down. Single-key dispositions; mobile translation = single-swipe gestures.
- **GitHub Mobile Inbox** — [GitHub Notification triage](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox) — multi-select batch triage, filter chips, mobile-first.
- **Asana Approvals** — [asana.com/inside-asana/new-approvals-feature](https://asana.com/inside-asana/new-approvals-feature) — custom approval-stage field, manager review surface.
- **Height (closing 2025)** — [height.app](https://height.app/) — referenced for spreadsheet+Kanban+Gantt convergence but officially shut down Sep 2025.

### Field-service dispatch
- **ServiceTitan Atlas Fall 2025** — [Fall 2025 release guide](https://www.servicetitan.com/blog/fall-2025-release-guide) — new Dispatch Board, Job Holding Area, Activity Center centralization; mobile-first responsive build.
- **Salesforce Field Service Dispatcher Console** — [Trailhead module](https://trailhead.salesforce.com/content/learn/modules/field-service-dispatcher-console-for-dispatchers/explore-the-dispatcher-console) — Gantt+map+list triad; desktop-anchored.
- **Microsoft Dynamics 365 Field Service Schedule Board** — [Microsoft Learn](https://learn.microsoft.com/en-us/dynamics365/field-service/work-with-schedule-board) — drag-drop Gantt, view scales hourly/daily/weekly, 2025 visual refresh.

### Operational manager apps
- **PagerDuty Incident Commander** — [response.pagerduty.com](https://response.pagerduty.com/training/incident_commander/) — reassign-to-next-on-call, escalation policy cycles, mobile reassign in 3 taps.
- **Slack Workflow Builder for ops** — [slack.com/blog/transformation/incident-management-slack](https://slack.com/blog/transformation/incident-management-slack) — auto-channel-creation, standardized templates, form-driven launch.

### Mining mid-level ops
- **GroundHog Shift Boss + Line-up app** — [groundhogapps.com/shift-boss-app-for-short-interval-control](https://groundhogapps.com/shift-boss-app-for-short-interval-control/) — SIC, real-time task tracking, consumable monitoring, downtime management.
- **Commit Works CiteOps / SIC** — [commit.works/short-interval-control](https://commit.works/short-interval-control/) — large-screen plan-vs-actual, mobile field access, offline support, decision-support for variance.
- **Modular Mining DISPATCH** — [CIM Magazine Automated Supervision](https://magazine.cim.org/en/technology/automated-supervision/) — embedded shift dashboard with KPI gauges/trend lines, dispatcher sees underloading in real-time, tiered alerts to avoid fatigue.
- **Cru Software Mining** — [crusoftware.com/mining](https://www.crusoftware.com/mining/) — supervisor tracks attendance, manages shifts, fills gaps in real-time.
- **opsima Mining KPIs** — [opsima.com/blog/kpis/mining-industry-kpis](https://opsima.com/blog/kpis/mining-industry-kpis/) — 30 KPIs with thresholds; 3-tier escalation (immediate / 4-hour / shift handover).

### Healthcare / EMS dispatch
- **Pulsara** — [pulsara.com](https://www.pulsara.com/) — unified patient channel, mobile-first, mass casualty triage, 22–68% treatment time reduction.

### Construction
- **Procore Daily Log** — [procore.com](https://www.procore.com/whats-new/organize-daily-logs-by-area-shift-or-crew) — calendar view, organize by area/shift/crew, mobile field entry.
- **Bridgit Bench** — [gobridgit.com](https://gobridgit.com/) — workforce planning, Gantt for crew, certifications/skills profile.
- **Linarc** — [linarc.com/jobsite-management](https://www.linarc.com/jobsite-management) — "phone as live site journal," geotagged auto-filed entries.

### Restaurant
- **7shifts Manager Mobile** — [7shifts shift trading](https://kb.7shifts.com/hc/en-us/articles/4417514302995-Set-Up-and-View-Shift-Trading) — single-tap approve/decline shift swap with warnings inline.
- **Toast Now** — [pos.toasttab.com/products/toast-now](https://pos.toasttab.com/products/toast-now) — operate restaurant from phone, real-time sales/labor data, manager-log conversational threads, 35% of users open 10+ times/week.

### Delivery / logistics
- **Onfleet Command Center (2025)** — [onfleet.com/blog/2025-whats-new-in-onfleet](https://onfleet.com/blog/2025-whats-new-in-onfleet/) — real-time Route Plans, Tasks, Drivers; auto-assign + driver self-claim.
- **Bringg Dispatch (Jan 2025)** — [help.bringg.com/docs/introducing-the-new-dispatch-and-planning-experience](https://help.bringg.com/docs/introducing-the-new-dispatch-and-planning-experience) — unified map+list, interactive route assignment, color-coded indicators.
- **Bringg dispatcher day-in-life** — [help.bringg.com/docs/a-day-in-the-life-of-a-bringg-dispatcher](https://help.bringg.com/docs/a-day-in-the-life-of-a-bringg-dispatcher) — exception-driven workflow, AutoDispatch, manage-by-exception.

### AI-assisted dispatch
- **FieldCamp AI 2026** — [fieldcamp.ai/blog/how-ai-is-transforming-field-service-management](https://fieldcamp.ai/blog/how-ai-is-transforming-field-service-management/) — 60% less dispatch time, single-click planning.
- **Locus AI Dispatch comparison** — [locus.sh/blogs/best-ai-dispatch-software](https://locus.sh/blogs/best-ai-dispatch-software/) — 2026 comparison of AI dispatch platforms.
- **FieldProxy AI Routing** — [fieldproxy.ai/blog/ai-dispatch-how-machine-learning-optimizes-technician-routing](https://www.fieldproxy.ai/blog/ai-dispatch-how-machine-learning-optimizes-technician-routing-d1-28) — confidence-based override patterns.
- **INSEAD: nudge vs tell** — [knowledge.insead.edu/operations/should-ai-nudge-you-or-tell-you-what-do](https://knowledge.insead.edu/operations/should-ai-nudge-you-or-tell-you-what-do) — research on optimal AI assertiveness.

### UX foundations
- **Mobile thumb zones 2025** — [elaris.software/blog/mobile-ux-thumb-zones-2025](https://elaris.software/blog/mobile-ux-thumb-zones-2025/) — green/yellow/red reachability zones, 44×44 minimum touch target.
- **Command center 2026 design** — [mobisoftinfotech.com/resources/blog/transportation-logistics/command-center-operations-dashboard-alerts-decision-loops](https://mobisoftinfotech.com/resources/blog/transportation-logistics/command-center-operations-dashboard-alerts-decision-loops) — three-tier alerts, OODA scan-assess-decide-close loop, 90-second Tier-1 acknowledgment.
- **AI UX nudge patterns** — [shapeof.ai/patterns/nudges](https://www.shapeof.ai/patterns/nudges) — contextual inline actions, dismissable, never disruptive.
- **Lean Construction Daily Huddle** — [leanconstructionblog.com/Daily-Huddle-101](https://leanconstructionblog.com/Daily-Huddle-101.html) — 15-min standup, completion → barriers → adjustments → readiness → concerns; 30% productivity uplift.

---

## 8. Anti-patterns — what to avoid

| Anti-pattern | Why it fails | Where seen |
|--------------|--------------|------------|
| **Owner dashboard with manager role-filter** | Wrong abstraction: managers act, owners review. Re-cropping doesn't fix this. | Common SaaS error |
| **Gantt as primary view on mobile** | Two-handed, breaks below 768px, dense info | Salesforce FSL mobile, Dynamics 365 |
| **Multi-step modal dialogs for assignment** | Each tap is friction; 5-step modals → abandonment | Legacy ServiceNow, SAP |
| **"Notifications" tab separate from approvals** | Two queues to monitor instead of one | Common; fixed by Linear/GitHub unified inbox |
| **Hidden actions in hamburger menu** | Discoverability collapses; thumb has to leave green zone | Pre-2018 enterprise apps |
| **AI auto-assign without human in loop** | Destroys trust on first wrong call | Banned by every modern source |
| **Color-only signal** | A11y fail; color-blind users miss critical info | Always pair color with icon + label |
| **Generic "View More" CTAs** | Wastes a tap; tap the row itself | Procore older mobile (improved post-2024) |
| **Approval requiring switch to email** | Out-of-app context loss; latency balloons | Pre-2020 SAP, Oracle |
| **5+ KPI tiles in band 1** | Visual noise normalization at 20 min, perceived urgency drops | Banned by command-center literature |
| **Quick-action buttons in top-right corner** | Outside green thumb zone | Common on phablets |
| **Real-time map as default crew view** | Slower than list scan; GPS battery cost | Bringg pre-2025 |

---

## 9. CONCRETE PROPOSAL — `apps/workforce-mobile/app/(tabs)/home.tsx` for `role === 'manager'`

### Wire-level spec

```
┌─────────────────────────────────────────────────────┐
│ ScreenShell · screenId="W-M-02M" (Manager home)     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [BAND 1 — SITE PULSE]                              │
│  ┌─────────────────────────────────────────────┐   │
│  │ Mgodi: Geita-North · Zamu ya asubuhi        │   │
│  │                                              │   │
│  │   78% │ 23/27 │ 91% │ ⚠ 3 │ ✓ safe         │   │
│  │  Plan  Crew    Equip  Alerts  Safety        │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [BAND 2 — LIVE EXCEPTIONS] (red/amber stack)      │
│  ┌─────────────────────────────────────────────┐   │
│  │ 🔴 Excavator EX-204 down 47 min  [Escalate] │   │
│  │ 🟡 Aisha late 18 min  [Reassign] [Call]    │   │
│  │ 🟡 Drill DR-12 oil temp high   [Inspect]   │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [BAND 3 — CREW + DISPATCH] (swipeable tabs)       │
│  ┌─[Crew]──[Tasks]──[Map]──┐                       │
│  │ • João  · On site · 06:12     ▆▆▆▆▆ 80%   │   │
│  │ • Aisha · Late 18 min         ▆▆▆░░ 60%   │   │
│  │ • Pedro · On site · 05:58     ▆▆▆▆▆ 95%   │   │
│  │ • +20 zaidi  →                              │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [BAND 4 — APPROVALS] (Linear-style queue)         │
│  ┌─────────────────────────────────────────────┐   │
│  │ 3 zinasubiri (3 pending)                    │   │
│  │ • Leave: Aisha 4-6 Jun        [✓] [✕] [⏰] │   │
│  │ • Overtime: João 2hr today    [✓] [✕] [⏰] │   │
│  │ • Equipment swap: Pedro       [✓] [✕] [⏰] │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [BAND 5 — LINE-UP BRIEF + ESCALATE UP] (footer)   │
│  ┌─────────────────────────────────────────────┐   │
│  │ [Anza muhtasari] (Start huddle)             │   │
│  │ [Tuma kwa Mmiliki] (Send up to owner)       │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Section-by-section data sources

| Band | Component | Endpoint | Refresh | Notes |
|------|-----------|----------|---------|-------|
| 1 | `<SitePulse />` | `GET /v1/mining/cockpit?siteId={mgr.siteId}` | 60 sec poll or WS | Returns `{ planAttainment, crewOnShift, crewExpected, equipmentAvailability, alertsCount, safetyStatus }` |
| 2 | `<ExceptionStack />` | `GET /v1/mining/incidents?status=open&severity=high,medium&siteId=…` | 30 sec poll | Filter to current site, sort by severity then time. Pull equipment health from maintenance endpoint. |
| 2 | `<ExceptionStack />` cont. | `GET /v1/mining/maintenance?healthStatus=warning,critical&siteId=…` | 30 sec | Equipment temp/availability anomalies. |
| 3 | `<CrewRoster />` | `GET /v1/mining/attendance?siteId=…&shift=current` | 60 sec | Each row: worker, status, current task, workload %, equipment paired |
| 3 | `<TaskQueue />` (tab) | `GET /v1/mining/tasks?status=unassigned&siteId=…` | 60 sec | With AI suggestion endpoint `POST /v1/mining/tasks/{id}/suggest-assignee` |
| 3 | `<CrewMap />` (tab) | reuse attendance GPS | 30 sec | Toggle only — never default |
| 4 | `<ApprovalQueue />` | `GET /v1/mining/approvals?managerId=…&status=pending` | 60 sec | Unified across leave / overtime / swap / equipment / material |
| 5 | `<LineUpBrief />` | `POST /v1/mining/shift-reports/draft` | on-demand | Generates a daily-huddle brief with attainment / barriers / adjustments / readiness |
| 5 | `<EscalateUp />` | `POST /v1/mining/escalations` | on-demand | Pre-fills owner notification with current alert context |

### Interaction model (one thumb)

- **Pull-to-refresh** at top — manual sync.
- **Tap KPI tile in band 1** → drill-down to historical chart (last 7 shifts).
- **Tap exception row** → bottom sheet with full detail + actions (Acknowledge / Reassign / Escalate).
- **Swipe right on crew row** → reveal action sheet (Reassign / Message / Mark absent / View today's tasks).
- **Tap task queue row** → AI suggestion sheet with top 3 assignees + confidence; swipe right to accept top suggestion, tap a name to assign.
- **Long-press any row** → multi-select mode for bulk action.
- **Swipe right on approval** → approve + haptic success.
- **Swipe left on approval** → decline sheet (mandatory reason).
- **Tap snooze chip** → snooze 1/4/24 hours.
- **Anza muhtasari (Start huddle)** → opens a focus screen with the 5-item daily-huddle agenda (Completion / Barriers / Adjustments / Readiness / Concerns) pre-filled from current shift data — manager edits and one-taps to publish to the crew.
- **Tuma kwa Mmiliki (Send up to owner)** → pre-composed escalation with context, manager reviews + sends.

### Brand-lock alignment (per Borjie CLAUDE.md)

- **Swahili-first copy:** every label in `sw`, `en` fallback. Use `useI18n()` and add `W-M-02M` screen entries.
- **Currency rendering:** any TZS / USD shown uses `formatCurrency(amount, currencyCode)` — never hardcoded.
- **Evidence chain:** AI suggestions cite `evidence_id` from LMBM (mandatory for Auditor Agent acceptance).
- **Hash-chained audit:** every approval and escalation writes an immutable audit-trail entry via the audit-trail package.
- **RLS:** `app.current_tenant_id` is set by middleware; all queries automatically scoped. Manager only sees their assigned site(s).
- **Tier policy:** any HIGH-risk approval (cross-site equipment move, kill-switch bypass) hits literal policy rules in `packages/central-intelligence/src/kernel/policy-gate.ts` — no reason-resolver generalization.

### Performance budget

- Site pulse render ≤ 200ms (skeleton → first paint).
- Exception stack render ≤ 400ms (cached LMBM + live WebSocket).
- Crew roster render ≤ 600ms (paginated 25/page; virtualized list).
- All buttons in green thumb zone (bottom 2/3 of screen).
- Each row tappable area ≥ 56×56pt (above 44×44 minimum).
- Pull-to-refresh: ≤ 1.5s round-trip on 4G.

### A11y

- Every status color is paired with an icon and a Swahili+English label.
- Screen reader announces band transitions and unread approval count on focus.
- Haptic confirmation on every destructive action (decline, escalate).
- Color contrast ≥ 4.5:1 (WCAG 2.2 AA).
- Minimum text size 14pt body, 16pt primary actions.

### Out of scope (deliberately)

- Full crew Gantt — desktop only (admin-web).
- Multi-site cross-comparison — owner-web only.
- Worker-side task completion — already covered by W-M-02 worker home.
- Site map editing — owner-web only.

---

## 10. Risks & open questions

| Risk | Mitigation |
|------|------------|
| 4 bands + footer = scrolling on small phones | Collapse bands 3 and 4 to single-line summaries until tapped (progressive disclosure) |
| AI suggestions noisy if confidence model untuned | Start with 70%+ threshold for inline chip; below that, no suggestion shown |
| Escalation spam to owner | Auto-rate-limit; require manager to dismiss in-tier-2 first |
| Multi-site managers | Add site switcher pill at top; default to most active site by activity |
| Offline mode | Cache last 4h of band-1 KPIs locally; queue actions for replay (Borjie shift-reports already supports this) |
| Bilingual copy expansion | Every new string lands in `i18n/sw.json` and `i18n/en.json` simultaneously — gate by lint rule |

---

**End of research doc.** ~340 lines. Ready to feed into a `/gsd:plan-phase` or `/plan` for implementation.
