# Owner Status UX — State of the Art (2026)

**Audience:** Borjie engineers designing the workforce-mobile owner home surface.
**Scope:** What world-class products actually ship for read-mostly, decision-prompting executive status views — synthesized from 12 WebSearch queries and 9 WebFetch deep-reads.
**Goal:** Patterns we can engineer, not platitudes.

---

## 0. TL;DR — the 8 patterns that recur across SOTA

1. **Single north-star up top.** One metric, oversized, in the top-left quadrant — answering "are we OK?" in <2s. (Stripe revenue, Vercel deployment status, Oura readiness score, Apple Stocks ticker, Caterpillar "Needs Review" count.) [925studios, BrowserLondon, AppDeck]
2. **Decision queue separated from status feed.** "Needs Review" / "For You" / "Inbox" sits as a distinct band above the metric strip. Cat VisionLink calls theirs Needs Review; Datadog calls it the Watchdog carousel; GitHub calls it the For You feed. The pattern: ≤5 actionable items, each with a one-tap response. [Cat, Datadog, GitHub]
3. **KPI strip of 4–6 cards, paired-context atoms.** Each card = name + big number + delta + sparkline + status colour. Mosaic, Stripe, Plausible, Linear all converge on 4–6 above the fold. [AppDeck, GitNexa, 925studios]
4. **Progressive disclosure ladder.** Summary → segment → row → record. No more than 3 taps from any KPI to its causal evidence. Linear, Notion, Stripe all use this. [BrowserLondon, ArtOfStyleframe]
5. **Time-horizon tabs, not date pickers.** Today / Week / Month / Quarter as segmented control — swipe-able on mobile. Calendar apps converge on swipe-between-periods as the dominant gesture. [ServiceNow Horizon, Teamup]
6. **Personal baseline beats population.** "vs your average" / "vs last week" outperforms abstract industry benchmarks. Oura, Linear, Apple Stocks all pair every metric with a personal-baseline delta. [BrowserLondon, AppDeck]
7. **AI-curated daily brief, not raw feed.** A 3-minute readable summary at the top — top 3 priorities, urgent decisions, FYIs, quick wins. Replaces email + status feeds for the executive use case. [LeadWithAI, AppDeck]
8. **Refresh model: pull-to-refresh + push for critical, not poll-everything.** Real-time only where minutes matter (safety, cash, prices). Daily for trends. Auto-refreshing everything is a 2026 anti-pattern. [GraycellAmerica, ThinkDesign]

---

## 1. Core SOTA patterns (engineerable)

### Pattern A — "Alert-first" home (≤5 items)

The top band of the screen is reserved for **what needs your attention NOW**. Items are AI- or rules-curated, capped at 5, each with:
- Severity colour (red/amber/grey — never green; green doesn't need attention)
- Single-line description
- Tap → action sheet OR deep link to record
- Optional: "snooze 1h / dismiss / delegate" affordances

**Where this lives in production:**
- **Caterpillar VisionLink** — the "Needs Review" feature explicitly "brings focus to instances that need action, creates workflows to schedule tasks." [Cat]
- **Datadog Watchdog Insights carousel** — sits near the top of every product page, "highest priority insights based on Insight type, State, Status, Start time, Anomaly type appear on the left." [Datadog docs]
- **GitHub For You feed** — algorithmic curation replaced strict chronological in 2025–2026, with "See less activity like this" tuning. [GitHub Changelog]

**Engineerable rule:** Cap at 5 items. If the curator has more, fold the rest into a "+ N more" disclosure. Latency budget for resolving an alert ≤2 taps.

---

### Pattern B — 1-line glanceable status per business pillar

Each business pillar (production, cash, safety, compliance) gets exactly ONE line:
- Pillar name (left)
- Status icon (green/amber/red dot + WCAG-compliant non-colour glyph)
- Current value + delta
- Sparkline (40×16px micro-chart)
- Tap target ≥44×44pt (Apple HIG, GitLab Pajamas)

**Source evidence:** Apple Watch complications design — "legible at a two-foot distance, under two seconds, content exceeding 20 characters reduces engagement by 38%." [Apple Developer]

**Engineerable rule:** Pillar row height = 56pt. Number font size ≥24pt. Delta font ≥14pt. Sparkline always present, never optional. Avoid color-only — pair every status colour with an icon. [Pajamas Design System, AppDeck rule #4]

---

### Pattern C — Drill-down ladder (summary → segment → row)

Every metric is tappable. No dead pixels. Linear's pattern: dashboard → drill directly to underlying issues without leaving the dashboard. Stripe's pattern: KPI card → click → segment view → click → granular detail. Mosaic's pattern: cash runway summary → burn segments → invoice list. [BrowserLondon, ArtOfStyleframe]

**Engineerable rule:** 3-level depth max. Each level must answer a single question:
- Level 1 (home): are we OK?
- Level 2 (pillar): where is the issue?
- Level 3 (record): what specifically?

If a metric needs >3 levels, your IA is wrong.

---

### Pattern D — Time-horizon segmented control

Replaces date pickers entirely on mobile. Three or four periods: **Today / Week / Month / Quarter**. Swipe-between-periods is the dominant 2026 gesture on mobile dashboards. iOS Calendar, Teamup, Structured, ServiceNow Horizon all use this. [ServiceNow, Teamup, Structured]

**Engineerable rule:** Default to "Today" for operational metrics. Default to "Month" for strategic metrics. Persist last-used per pillar. Position: directly under the alert band, above the KPI strip.

---

### Pattern E — Personal-baseline delta

Every number on screen is paired with context. Per AppDeck rule #6 and Linear's best-practice doc: "A number without context is useless." [AppDeck, Linear]

**The atom:**
```
$2.1M
+8% vs last week  ✅ 105% of target
```
Three context elements minimum: period comparison, target comparison, status indicator. Oura model: compare new data against user's own quartiles, not population percentiles. [BrowserLondon]

**Engineerable rule:** Reject any KPI card that shows only a number. Every card carries: value, delta, target/baseline. If no target exists, use 7-day rolling average.

---

### Pattern F — AI summary at the very top

A 3-paragraph daily brief (or "morning briefing") replaces the noisy feed for executives. Format per LeadWithAI / AppDeck: top 3 priorities, urgent decisions, FYIs, quick wins. Readable in under 3 minutes. [LeadWithAI, AverageDevs]

**Where this lives in production:**
- **Mosaic CFO board pack** — "Current State of the Business" auto-generated.
- **Glide executive dashboards** — AI-summarized into "trends, risks, highlights."
- **AI-summarized dashboards (AverageDevs research)** — "compress many signals into a structured brief… turning the full charts into supporting evidence rather than the main attraction."

**Engineerable rule:** AI brief is collapsible. Default expanded on first login of day, collapsed on subsequent visits. Show "last refreshed N minutes ago." Always include evidence links — every claim cites a specific datum.

---

### Pattern G — Newspaper hierarchy / inverted pyramid

AppDeck rule #3: three tiers by importance.
- **Top tier (20% of screen):** KPI summary cards — "Are we on track?"
- **Middle tier (50%):** Trend charts — "Where are we heading?"
- **Bottom tier (30%):** Detail tables — "What's behind the numbers?"

925studios research on 35 SOTA dashboards: "Size is hierarchy — primary metric appears 3x larger than supporting data." HubSpot, Baremetrics, Stripe all follow this. [925studios, AppDeck]

**Engineerable rule:** Primary metric typography ≥3× supporting metric typography. Hero metric span: full width. Supporting metrics: 2×2 grid.

---

### Pattern H — Refresh model is hybrid, not uniform

**Real-time** for: safety incidents, cash position, market prices, kill-switch state.
**Pull-to-refresh** for: production tonnage, KPI strip.
**Daily/cron** for: trends, projections, monthly summaries.

GraycellAmerica research: "set your refresh rates to match the actionability of the data… auto-refreshing everything just because you can" is a 2026 anti-pattern. [GraycellAmerica, ThinkDesign]

Mobile-specific: browser-native pull-to-refresh gesture is preferred over custom implementations. [Suhaotian/Medium]

**Engineerable rule:** Three tiers of freshness, declared in the data layer:
- `live` — websocket or SSE push (safety, cash, kill-switch).
- `pull` — user-initiated, served from cache + revalidate (KPIs).
- `cron` — daily 06:00 EAT recompute (trends, daily brief).

---

## 2. Information architecture — proposed owner home

Based on the patterns above and constrained to ≤7 surface elements (per AppDeck rule #1 "no scrolling" + GitNexa "cap metrics at 5-7"):

### Slot 1 — AI Daily Brief (collapsible card)
**Pattern F.** 3 paragraphs, Swahili-first with English fallback. Shows: top 3 priorities, decisions awaiting owner, FYIs. Refreshes 06:00 EAT (cron). Default expanded once/day.

### Slot 2 — Needs Review queue (≤5 items)
**Pattern A.** Owner-actionable items only: large parcel approvals, T-90 licence alerts, HIGH-severity safety incidents, billing failures, kill-switch state changes. Each item has a primary CTA (Approve / Acknowledge / Open) and secondary (Snooze / Delegate / Dismiss). Sourced from `/v1/mining/incidents` (severity=HIGH), `/v1/mining/licences` (T-90), `/v1/owner/billing` (failures), `/v1/mining/sales` (approvals).

### Slot 3 — Time-horizon segmented control
**Pattern D.** [Today | Week | Month | Quarter]. Persisted in async storage. Affects Slots 4-6.

### Slot 4 — Production pillar (1-line, tappable)
**Pattern B.** Tonnage today vs target + sparkline + status dot. From `/v1/mining/cockpit` production block. Tap → site-by-site breakdown.

### Slot 5 — Cash pillar (1-line, tappable)
**Pattern B.** TZS position + USD-cliff guard state + delta vs last week. From `/v1/mining/cockpit` cash block. Tap → ledger / receivables / payables breakdown.

### Slot 6 — Safety & Compliance pillar (1-line, tappable)
**Pattern B.** Open HIGH incidents count + licence T-90 status + EHS controls health. From `/v1/mining/incidents` + `/v1/mining/licences`. Tap → incident list filtered by severity.

### Slot 7 — Market & marketplace strip (1-line, tappable)
**Pattern B.** Gold/copper/tanzanite spot + FX TZS/USD + open marketplace bids. From `/v1/mining/sales` (market intel) + `/v1/mining/bids` (open offers). Tap → market intelligence detail.

**Below the fold (intentional progressive disclosure):** trend chart (selected pillar), recent activity feed (chronological, ≤10 items), shortcuts to remaining 47 screens.

---

## 3. Interaction patterns

### Voice / AI input
Borjie Vision photo-advisor stays. Add owner-only voice button (mic icon, top-right) that opens an AI conversation seeded with current home state. Reference: Notion AI dashboard pattern — "natural language queries replacing filter hierarchies." [Fuselab Creative]

### Drill-down depth
Strict 3-level cap (Pattern C). Every tap on a metric opens a typed detail screen, not a generic chart explorer. Cat VisionLink confirms: "easy-to-use dashboards allow customers to track by projects, groups, and geofences, with links to buy parts or request services" — actions live where decisions occur. [Cat]

### Refresh model
- **Pull-to-refresh** on outer scroll view → refetches Slots 2, 4, 5, 6, 7.
- **Push notification** for new HIGH incidents, USD-cliff trip, kill-switch, T-90 licence transitions, marketplace winning bid.
- **Cron 06:00 EAT** refreshes Slot 1 (AI brief).
- **Last-refreshed timestamp** visible at top, per AppDeck rule #8. [AppDeck]

### Gestures
- **Swipe left/right** on Slot 3 segmented control to change time horizon (ServiceNow Horizon pattern). [ServiceNow]
- **Long-press** on a pillar row → quick actions sheet (snooze / share / open in admin web).
- **Pull-down on alert** in Slot 2 → details + history. (Mail-style.)

### Density
~1.0 actionable signal per inch on a 6.1" iPhone. Roughly: 1 brief card (~120pt) + 5 alert rows × 56pt + segmented control (~44pt) + 4 pillar rows × 56pt = ~600pt total, comfortably above the fold on most modern phones. References: GitNexa "5-7 core KPIs above the fold"; AppDeck "6-12 metrics maximum". [GitNexa, AppDeck]

---

## 4. Density — concrete numbers from production

| Surface | Cards/metrics above fold | Reference |
|---|---|---|
| Stripe dashboard | 4 (revenue, charges, payouts, disputes) | [925studios] |
| Mosaic CFO view | 6 (cash, runway, burn, ARR, CAC, gross margin) | [Mosaic.tech] |
| Linear ops dashboard | 5-7 (issues by status, sprint progress, cycle time) | [Linear best practices] |
| Plausible | 6 metrics above fold | [925studios] |
| Cat VisionLink | "Needs Review" + 4 fleet KPIs | [Cat] |
| Datadog Watchdog | Carousel of 3-5 insights + KPI grid | [Datadog] |

**Borjie target:** 1 brief + 5 alert items + 4 pillars = 10 atomic signals. On the edge of comfortable density per the 2026 best-practice band (5–9 elements per GitNexa, 6–12 per AppDeck). Acceptable because alerts band auto-collapses when empty.

---

## 5. Mining-specific overlays (Tanzania-aware)

Borjie's owner is a Tanzanian mining-licence holder. Specific overlays required by domain context:

| Concern | Surface | Source endpoint |
|---|---|---|
| **TZS-primary money** | All cash figures in TZS by default, USD/KES toggle in pillar detail. Domestic non-TZS contracts rejected at API. (Per CLAUDE.md hard rule.) | `/v1/mining/cockpit` cash block |
| **USD-cliff guard state** | If domestic USD contract attempted post-27-Mar-2026 cliff, surface as Slot 2 alert. | `/v1/owner/billing` |
| **Licence T-90 alerts** | PML / ML expiry within 90 days = HIGH-severity alert. Per Tanzania Mining Act PMLs are 7-year licences — losing one is catastrophic. | `/v1/mining/licences` |
| **EHS / safety dominance** | Per published Tanzanite mining injury research: falling rocks 18.2%, explosion 16.9%, falls 16.1%. Safety pillar is always present, never collapsed. | `/v1/mining/incidents` |
| **Gold / copper / tanzanite spot** | Three-mineral price strip in Slot 7. Sell signals when spot crosses owner-set thresholds. | `/v1/mining/sales` market-intel block |
| **Daily report dispatch** | Owner can dispatch daily report to investors/lender from Slot 1 (one-tap "send"). | `/v1/mining/reports` |
| **Swahili-first** | Default sw, switch on request. Owner persona prompts bilingual sw/en (per CLAUDE.md hard rule). | i18n hook |
| **Evidence-required output** | Every AI brief claim cites ≥1 `evidence_id` from LMBM or corpus (per CLAUDE.md hard rule). Display as superscripted "¹" with tap-to-see-source. | brain pipeline |

---

## 6. References (every URL fetched + takeaway)

### Dashboard design — general
1. [AppDeck — Executive Dashboard Design: 10 Best Practices 2026](https://appdeck.com/blog/executive-dashboard-design-best-practices) — One-screen-no-scrolling, KPI cards as newspaper headlines, inverted pyramid (20/50/30), color as semantic signal, 4-6 KPIs above fold, 6-12 metrics max, mobile-first for board members, drill-down over more charts. **Most useful single source.**
2. [925studios — 35 SaaS Dashboard Design Examples 2026](https://www.925studios.co/blog/saas-dashboard-design-examples-2026) — Single north-star top-left (Stripe), 3× size hierarchy (Baremetrics), 5-9 elements max, 2-second load standard, functional colour coding only.
3. [BrowserLondon — Best Dashboard Designs 2026](https://www.browserlondon.com/blog/2026/03/18/best-dashboard-designs-every-product-team-should-look-at-in-2026/) — Oura "one big thing" pattern, Monzo card-based modular hierarchy, Linear three explicit dashboard types, Fathom single-screen-no-drill-down, Visual Training role-asymmetric IA.
4. [ArtOfStyleframe — Dashboard Design Patterns 2026](https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/) — Sidebar 256px expanded / 64px collapsed, KPI card 200-280px wide, 12-column grid 24px gutters, density over whitespace philosophy.
5. [GitNexa — SaaS Dashboard UX Patterns 2026](https://www.gitnexa.com/blogs/saas-dashboard-ux-patterns) — Cap metrics 5-7 above fold, progressive disclosure via expandable rows / modal panels, contextual action placement (no hidden menus), Stripe drill-down reveal on metric click.
6. [Fuselab Creative — Dashboard Trends 2026](https://fuselabcreative.com/top-dashboard-design-trends-2025/) — AI personalization needs role-aware data model first, mobile-first only for sessions <2 min, cognitive load reduction is the universally-applicable trend, conversational interfaces need clean data layer.
7. [ThinkDesign — Dashboard Design 2026 Do's and Don'ts](https://think.design/blog/dashboard-design-in-2026-dos-and-donts/) — Map top 3 decisions first, never color-only signals, no auto-refresh-everything anti-pattern, 10-second purpose-identification test.

### Alert / decision-queue patterns
8. [Datadog Watchdog Insights docs](https://docs.datadoghq.com/watchdog/insights/) — Carousel at top of every product page, sort by Insight type / State / Status / Start time / Anomaly type, "View all" opens right-side panel, hover reveals filter icons, copy-link per insight.
9. [GitHub Changelog — Dashboard Feed Refresh 2025](https://github.blog/changelog/2025-09-04-the-dashboard-feed-page-gets-a-refreshed-faster-experience/) — Modern card layout, chronological by default, algorithmic "For You" with "See less activity like this" tuning, releases/announcements/sponsor activity coverage.
10. [LeadWithAI — AI Executive Daily Briefing](https://www.leadwithai.co/article/build-your-ai-executive-daily-briefing) — 7 sections, readable <3 min, decision-focused not summary-heavy, prioritize decisions over summaries, flag conflicts / missing prep explicitly.

### Industrial / mining
11. [Caterpillar VisionLink](https://www.cat.com/en_US/by-industry/construction-industry-resources/technology/visionlink.html) — Role-based "apps" inside one product, "Needs Review" pattern brings actionable items to top, workflows tie review to scheduling and parts purchasing.
12. [Komatsu KOMTRAX](https://www.komatsu.com/en-us/services-and-support/equipment-monitoring-and-analysis/telematics) — AEMP 2.0 (ISO 15143-3) telematics integration shows mixed-fleet on one dashboard; original-owner-transferable monitoring; Komtrax Plus for mining equipment specifically.
13. [Hitachi ConSite Mine](https://www.hitachicm.com/global/en/solutions/mining-business/solutions/consite_mine/) (search-only, 403 on direct fetch) — 24/7/365 monitoring of rigid dump trucks + mining excavators, predictive alerts via Global e-Service, web-based dashboard.
14. [Hexagon Mining](https://hexagon.com/industries/mining) (search-only) — Life-of-mine connected technologies, mining-specific safety + production layered surfaces.

### Mobile + glanceable
15. [Apple Watch HIG — Complications](https://developer.apple.com/design/human-interface-guidelines/complications) — Legible at 2-foot distance under 2 seconds, content over 20 characters drops engagement 38%, load over 3s drops engagement 25%.
16. [Apple Stocks app](https://apps.apple.com/us/app/stocks/id1069512882) — Home Screen + Lock Screen + Watch complications for same data; single ticker visible without opening the app.
17. [Vercel Dashboard Redesign Feb 2026](https://vercel.com/changelog/dashboard-navigation-redesign-rollout) — Sidebar replaces horizontal tabs, floating bottom bar optimized for one-handed mobile use, projects-as-filters one-click team/project switch.

### Refresh / freshness models
18. [GraycellAmerica — Real-time Data Visualization 2026](https://graycellamerica.com/real-time-data-visualization-using-modern-tools/) — Match refresh rate to actionability of data, real-time only when minutes matter, hourly/daily for accuracy + stability, mobile widget data-minimalism approach.

### Mining + Tanzania context
19. [ZATRA — Mining Licenses in Tanzania 2026](https://www.zatra.co/post/mining-licenses-in-tanzania-explained-2026-investor-guide) — PMLs 7-year licences, citizen-only requirement, ESIA from NEMC required.
20. [PMC — Occupational injuries Mererani Tanzanite mine](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3998898/) — Falling rocks 18.2%, explosion 16.9%, falls 16.1%; rudimentary tools, lack of training drive incident rates → safety must be a permanent pillar.

### Bonus — CFO patterns
21. [Mosaic CFO Dashboard guide](https://www.mosaic.tech/post/cfo-dashboard) (search-only) — Cash position / runway / burn / ARR / CAC / gross margin as default home strip; "Current State of the Business" auto-generated brief.

---

## 7. Anti-patterns to AVOID

1. **Showing everything because data is available.** ThinkDesign: "Don't plug every data source into a single view." Owner home is curated, not exhaustive.
2. **Auto-refreshing every widget.** Per GraycellAmerica + ThinkDesign — refresh model must be tiered. Real-time everywhere kills batteries and breaks attention.
3. **Color-only status signals.** WCAG and Pajamas explicit: pair red/amber/green with an icon. Tanzanite mines are often dusty, screens often dim — colour can fail.
4. **Date pickers on mobile.** Replaced by segmented time-horizon control + swipe. Two extra taps to set "this week" is two too many.
5. **Population benchmarks.** "Average mining company tonnage" is meaningless; the owner cares about their own targets and trends. (Oura → owner's own quartiles.)
6. **Generic AI summaries.** "You had a productive week!" is anti-evidence. Every AI claim must cite a specific datum (LMBM evidence_id, per CLAUDE.md hard rule).
7. **Hiding HIGH-severity safety alerts inside a tab.** Per CLAUDE.md HIGH-risk policy prefixes — safety incidents at HIGH severity must hit the alert band, never be collapsed.
8. **English-default copy.** Borjie hard rule — `sw` is default. Hardcoded English strings break the brand promise.
9. **TZS hardcoding or USD assumption.** `formatCurrency(amount, currencyCode)` only. Domestic USD contracts post-cliff are rejected at the API — surface this in the alert band, don't crash silently.
10. **Sub-2-second-load failures.** Per 925studios research, top dashboards load primary view in <2s. Skeleton loaders + cached-then-revalidate is the pattern.
11. **Dead pixels.** Every metric on screen must be tappable. Per Linear best-practices doc — drill directly to underlying records.
12. **Scrolling for primary signal.** AppDeck rule #1 — "if your dashboard requires scrolling, you've already lost." Above-the-fold must answer "are we OK?" without scrolling.

---

## 8. Concrete proposal — `apps/workforce-mobile/app/(tabs)/home.tsx` owner branch

When `user.role === 'owner'`, render the following structure. Each slot below maps directly to existing wired endpoints (per CLAUDE.md routing table) — no new endpoints required.

### Wire-level structure (top to bottom)

```
<ScreenShell screenId="O-M-01">

  ┌─ Slot 0: Greeting strip (existing) ────────────────────────────┐
  │  "Karibu, Bwana Mkubwa · {fullName}"                           │
  │  Last refreshed N min ago · pull-to-refresh hint               │
  └────────────────────────────────────────────────────────────────┘

  ┌─ Slot 1: AI Daily Brief (collapsible) ─────────────────────────┐
  │  Header: "Brief ya leo · 06:00"  [collapse ▾] [refresh ↻]      │
  │                                                                 │
  │  ¶ Top 3 priorities (bilingual sw/en, ≤3 sentences each)        │
  │  ¶ Decisions awaiting you (count + list)                        │
  │  ¶ FYI (count + collapse-by-default)                            │
  │                                                                 │
  │  Each sentence has superscripted evidence link ¹²³ → opens     │
  │  source from LMBM / intelligence corpus                         │
  │                                                                 │
  │  Source: cron 06:00 EAT — pipeline assembles from below slots  │
  │  Endpoint: NEW /v1/owner/brief (composes existing endpoints)    │
  └────────────────────────────────────────────────────────────────┘

  ┌─ Slot 2: Needs Review queue (≤5 items) ───────────────────────┐
  │  Header: "Inahitaji uangalizi · {count}"                       │
  │                                                                 │
  │  ─ HIGH 🔴 Site Mwadui — 2 incidents open since 14:00 [Open]   │
  │  ─ AMBER 🟡 PML #4892 — expires in 73 days  [Renew]            │
  │  ─ HIGH 🔴 Parcel #221 — buyer offer USD 18k  [Approve] [Hold] │
  │  ─ AMBER 🟡 Billing — M-Pesa payment failed   [Retry]          │
  │  ─ INFO ⚪  Daily report ready                [Send] [View]     │
  │                                                                 │
  │  Source:                                                        │
  │    incidents → /v1/mining/incidents?severity=HIGH&status=open  │
  │    licences  → /v1/mining/licences?expires_within_days=90      │
  │    sales     → /v1/mining/sales?requires_owner_approval=true   │
  │    billing   → /v1/owner/billing?status=failed                 │
  │    reports   → /v1/mining/reports?status=ready                 │
  │                                                                 │
  │  Each item has primary CTA + secondary (snooze 1h / delegate). │
  │  Empty state collapses entire slot (no zero-state spam).       │
  └────────────────────────────────────────────────────────────────┘

  ┌─ Slot 3: Time-horizon segmented control ──────────────────────┐
  │  [Leo · Today]  [Wiki · Week]  [Mwezi · Month]  [Robo · Quarter]│
  │  Swipe left/right to change. Persisted in async storage.       │
  └────────────────────────────────────────────────────────────────┘

  ┌─ Slot 4: PRODUCTION pillar (1 line, tappable) ────────────────┐
  │  ⛏  Uzalishaji · 142 t  +12% vs target  ✅                     │
  │  ▁▂▃▅▆▇█  (sparkline last 7 days)                             │
  │                                                                 │
  │  Source: /v1/mining/cockpit (production block, filtered by    │
  │          Slot 3 time horizon)                                   │
  │  Tap → site-by-site breakdown (Level 2)                        │
  └────────────────────────────────────────────────────────────────┘

  ┌─ Slot 5: CASH pillar (1 line, tappable) ──────────────────────┐
  │  💰 Pesa · TZS 84.2M  -3% vs last week  🟡                     │
  │  USD-cliff guard: ACTIVE (no USD domestic contracts allowed)   │
  │  ▁▂▂▁▁▂▃  (sparkline last 7 days)                             │
  │                                                                 │
  │  Source: /v1/mining/cockpit (cash block) + /v1/owner/billing  │
  │  Tap → ledger / receivables / payables breakdown              │
  └────────────────────────────────────────────────────────────────┘

  ┌─ Slot 6: SAFETY & COMPLIANCE pillar (1 line, tappable) ───────┐
  │  🦺 Usalama · 2 open HIGH · Licences OK                       │
  │  ▁▂▁▂▃▂▁  (incidents last 7 days)                             │
  │                                                                 │
  │  Source: /v1/mining/incidents (HIGH count) + /v1/mining/      │
  │          licences (T-90 status)                                │
  │  Tap → incident list filtered by HIGH severity                │
  │                                                                 │
  │  NEVER collapses — safety always visible (CLAUDE.md hard rule).│
  └────────────────────────────────────────────────────────────────┘

  ┌─ Slot 7: MARKET & MARKETPLACE strip (1 line, tappable) ───────┐
  │  📊 Soko · Au USD/oz 2,041 ↑1.2% · Cu 9.4k ↓0.8% · 3 ofa wazi │
  │                                                                 │
  │  Source: /v1/mining/sales (market intel block) + /v1/mining/  │
  │          bids (open marketplace offers)                        │
  │  Tap → market intel detail / open bids list                   │
  └────────────────────────────────────────────────────────────────┘

  ┌─ Below the fold (intentional progressive disclosure) ──────────┐
  │  · Trend chart of selected pillar (Pattern G middle tier)       │
  │  · Activity feed (chronological, ≤10 items)                     │
  │  · Existing "Borjie Vision · Uliza picha" CTA                   │
  │  · Existing 8-screen quick-link grid (collapse to 4 here)       │
  └────────────────────────────────────────────────────────────────┘

  ┌─ Footer ───────────────────────────────────────────────────────┐
  │  Sign-out / role-switch (existing)                              │
  └────────────────────────────────────────────────────────────────┘

</ScreenShell>
```

### Data composition contract

A new BFF endpoint `/v1/owner/brief` composes Slots 1, 2, and the pillar headlines from the existing wired endpoints in one round-trip. Pillars (Slots 4–7) tap into independent endpoint detail screens on tap.

```
/v1/owner/brief  →  {
  brief_id, generated_at_eat, sw_text, en_text, evidence_ids[],
  needs_review: [{ id, severity, title_sw, title_en, kind,
                   primary_action_url, secondary_action_url }],
  pillars: {
    production: { current, target, delta_pct, status, sparkline_7d },
    cash:       { current_tzs, usd_cliff_active, delta_pct, status,
                  sparkline_7d },
    safety:     { open_high_count, licences_status, sparkline_7d },
    market:     { gold_usd_oz, copper_usd_t, tanzanite_idx,
                  open_bids_count }
  }
}
```

### Refresh tiers

| Slot | Tier | Mechanism |
|---|---|---|
| 1 — AI Brief | `cron` | Recomputed 06:00 EAT, cached in `owner_brief_snapshots` |
| 2 — Needs Review | `live` | SSE/websocket push for HIGH incidents, billing failures, T-90 transitions; pull on view |
| 4 — Production | `pull` | Pull-to-refresh refetches |
| 5 — Cash | `live` | Push on USD-cliff state, ledger writes; pull otherwise |
| 6 — Safety | `live` | Push on new HIGH incident; pull otherwise |
| 7 — Market | `pull` | Pull-to-refresh; auto every 5 min when foregrounded |

### Internationalization

Every Slot 1 sentence + every Slot 2 title + every pillar label exists in both `sw` and `en`. Default `sw` per CLAUDE.md hard rule. Switch via existing i18n hook.

### Accessibility

- Tap targets ≥44pt (Apple HIG, GitLab Pajamas).
- Every status colour paired with an icon and a textual status string ("Open / Resolved / At target").
- VoiceOver labels follow pattern: `"{pillar} · {value} · {delta} · status {status}"`.
- 200% zoom layout must not break (per ThinkDesign rule).

### Performance budget

- Initial paint ≤2s (per 925studios SOTA standard).
- Brief endpoint p95 ≤800ms.
- Skeleton loaders for all 7 slots; cache-then-revalidate strategy.

---

## 9. What to build NEXT (not in this doc)

This research file is delivery-complete. Next concrete tasks (out of scope here):

1. **Design spec** — render Slots 1-7 in Figma with both sw/en variants, light/dark, empty states, error states.
2. **`/v1/owner/brief` BFF endpoint** — composes existing endpoints, ships as a new `*.hono.ts` route.
3. **`owner_brief_snapshots` migration** — append-only table for cron-cached briefs (per CLAUDE.md immutable-migration rule).
4. **Cron worker task** — 06:00 EAT brief composer in `services/consolidation-worker/`.
5. **`home.tsx` owner branch** — wire the structure above, role-gated.
6. **e2e test** — Playwright/Detox journey: owner login → home renders all 7 slots → tap each → drill-down opens correct level-2 screen.

— End of research —
