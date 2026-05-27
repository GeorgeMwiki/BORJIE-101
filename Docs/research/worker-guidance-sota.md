# Worker Guidance UX — State of the Art 2026

**Audience:** Borjie `apps/workforce-mobile` design + engineering, specifically `(tabs)/home.tsx` when `user.role === 'employee'`.
**Workers:** driver, excavator operator, sample tech, labourer at Tanzanian artisanal/mid-tier mines.
**Constraints:** Swahili-first, often offline, sometimes gloved, sometimes low-literacy, sub-2GB Android phones.
**Date:** 2026-05-27.
**Method:** 13 WebSearch queries + 11 WebFetch deep reads. All citations at bottom.

---

## Executive synthesis

The best field-worker apps of 2026 collapse the shift-start into **one decision per second**. DoorDash put every other feature behind a "strict template" — three things on the home screen, nothing else [1]. Samsara wraps the whole shift in a step-by-step `Workflow Builder` flow [2]. CommCare proved in 80+ countries that low-literacy frontline workers can run complex clinical decision trees if you replace prose with audio + icons + branching [3]. Strava and Apple Fitness rings showed motivation peaks when progress is a single closing arc, not a dashboard. The recurring patterns:

1. **Big map or big card top, single primary action bottom.** No tab strip on the home screen.
2. **Performance is *one* number with *one* delta.** "Today: 4 of 6 tasks. Yesterday: 5 of 6." Not a chart.
3. **Tasks are a vertical stack of cards**, each one swipe-actionable. Kanban is a desktop pattern.
4. **Offline is a posture, not a state.** Outbox-first, optimistic UI, last-sync stamp visible always.
5. **Voice is the keyboard.** Hold-to-record on every text field. Transcribe in background; allow audio-only submit.
6. **Icons + audio replace prose** for any user the org has flagged as `literacy_low = true`.
7. **Tap targets ≥ 56dp with ≥ 12dp spacing** for gloved use, well above WCAG 44pt minimum.

The rest of this doc unpacks each.

---

## 1. Shift-start choreography — what's the first 3 seconds?

The benchmark apps converge on a **single hero element + status pill + one primary action**.

### DoorDash Dasher (the canonical example) [1]
Every pixel was redesigned around three buckets. What a Dasher sees in 3 seconds:
- **Hero:** a map of zone heat (busy/quiet/blocked).
- **Earnings pill** at the top — animates a tally counter showing weekly $ to reinforce "this is an earnings platform first."
- **Non-scrollable bottom sheet** with exactly: a headline ("Dash now in this zone"), a visual module (forecast graph), and one button. The team killed 150+ scattered UI elements to enforce this discipline.
- **Conditional content** by market state: under-supplied → incentives + Dash Now; over-supplied → schedule + alternate earnings.

### Samsara Driver [2]
Workflow-driven: opening the app *is* opening today's workflow. Drag-and-drop sequence built by the safety manager — pre-trip DVIR → HOS review → inventory check → first stop. Each step gated; the driver cannot skip. AI verifies they're physically near the truck during DVIR (geofence + photo authenticity model).

### Lyft Driver [4][5]
Map + earnings hero with bonus zones overlaid. Weekly **earnings goal** is the persistent progress mechanic (set once, motivates always). Recent updates added "Safety Hub" as one-tap from home and customizable ride preferences inline.

### Apple Fitness / Strava [6]
"Close the rings" — three colored arcs that each represent one number. The user can identify their state in 200ms without reading anything. This is the **simplest "am I doing well today?" UX ever shipped** and translates directly to a worker shift.

### CommCare (community health worker) [3]
Opens directly into today's patient list. No dashboard. No analytics. The first screen is *do the next thing*. Branching forms are gated step-by-step — "you cannot skip any of them" because the field workflow IS the algorithm.

### Pattern recap (cite ≥2 per principle)
| Principle | Sources |
|---|---|
| One hero (map OR top card) — never both | DoorDash [1], Lyft [5], Samsara [2] |
| One earnings/progress pill, always visible | DoorDash [1], Lyft [4], Apple Fitness [6] |
| Non-scrollable bottom action band | DoorDash [1], CommCare [3] |
| First screen = do next thing, not dashboard | CommCare [3], Samsara workflows [2] |
| ≤3 pieces of content above the fold | DoorDash [1], Apple [6] |

### Borjie application
Worker opens app → sees, in priority order:
1. **Greeting + shift status pill** (e.g. "Karibu Juma · Zamu inaendelea 2h 14min" / "Shift in progress 2h 14m") — 8% of screen.
2. **Hero card: Now / Sasa** — the single next task (with map preview if location-bound) — 35% of screen.
3. **Progress strip** — today's count + target — one line — 5% of screen.
4. **Task queue (3 visible)** — vertical cards — 35% of screen.
5. **Sticky bottom bar:** big primary "Imekamilika / Done" button + voice mic icon — 17%.

No other navigation on this screen. Tabs are still bottom-tabbed (5 tabs max).

---

## 2. Performance tracking — "am I doing well today?"

Field workers do not want dashboards. They want **one number with a direction arrow**.

### Apple Fitness rings [6]
Three nested arcs. Each represents one metric (move/exercise/stand). User glance time: <300ms. The app's motivation engine is *purely* visual progress.

### Strava [6]
Pivots to social/comparative motivation: "you ran further than 73% of athletes in your area." Effective when social is appropriate; can backfire in workforce contexts (competitive labor culture).

### DoorDash earnings pill [1]
Animated tally counter. Online → live $ for today's dash. Offline → weekly total. **Just numbers.** The graph forecast appears only when the user taps in.

### Lyft weekly goal [4][7]
- Driver sets a target ("$800 this week").
- Progress shown as a bar with $ to-go.
- Crossing the goal triggers a "Set a higher goal" prompt — gentle escalator, not pressure.
- Weekly cadence beats daily — less noise, more meaning.

### Mining context — fatigue scores [8]
Rio Tinto / Fortescue use **ReadiScore** (hour-by-hour predicted fatigue per operator). Supervisors get push: "John Smith and 2 others face high fatigue today." The *worker* sees this only as advice ("Pumzika kabla ya gari kubwa / Rest before heavy haul"), never as a punitive metric. Resulted in 50% fewer in-cab fatigue alarms.

### Anti-patterns
- **Chart dumps.** A worker won't read a bar chart at 6am holding a hard hat.
- **Daily streaks** for shift work — punishing on legitimate days off.
- **Leaderboards by name** — toxic in tight crews; aggregate-only or rank-only.

### Pattern recap
| Pattern | Source |
|---|---|
| One number + one delta | Apple [6], DoorDash [1] |
| Weekly goals over daily | Lyft [7] |
| Animated tally for primary metric | DoorDash earnings pill [1] |
| Suggestion not punishment | ReadiScore [8] |
| Show graph only on tap | DoorDash [1] |

### Borjie worker progress strip
```
[ Leo / Today ]  Kazi 4/6   Saa 2h 14m   Picha 23
              ▲ +1 from jana                ▲ ahead of average
```
One line. Tappable → opens detail screen with the week graph (deep, not default).

---

## 3. Task queue patterns — list, card, or map?

The benchmark answer: **vertical card list, with optional map toggle when ≥3 tasks are location-bound**.

### Why not kanban / board
Kanban requires horizontal scrolling and column awareness. It's a desktop pattern; mobile field workers single-thread. No researched field-worker app of 2026 uses kanban on mobile [9].

### Card anatomy (synthesised from BuildOps [10], Samsara [2], Connecteam [11])
Per task card:
- **Status badge** (red/yellow/green): urgency + sync state.
- **One-line title** (Swahili first, English second if bilingual user).
- **Two metadata lines** max: location + due/window.
- **Photo thumbnail** if photo evidence required (acts as "you haven't done this yet" cue when empty).
- **Swipe right:** mark done with optimistic confirmation.
- **Swipe left:** "block / shida" → opens issue capture.
- **Tap:** expand to full task form (photo, voice, signature).

### Sequenced vs parallel
- **Sequenced** (Samsara DVIR style [2]): tasks are gated; user must complete in order. Use for safety-critical mandatory flows (pre-shift checklist, MSHA-style entries).
- **Parallel** (DoorDash, CommCare patient list): user picks order. Use for daily ops where worker judgement matters.

Borjie should default to **parallel** with a small "Lazima kwanza / Must do first" pinned card at top when pre-shift safety isn't yet signed off.

### Skip / Done / Blocked actions
| Action | UI | Backend | Audit |
|---|---|---|---|
| Done | Swipe right → checkmark animation | `POST /v1/mining/attendance/check-in` or task-specific endpoint | task_event_log |
| Blocked / Shida | Swipe left → 4-icon picker (no parts / no fuel / no permit / accident) → optional voice note | `POST /v1/mining/incidents` with `category=block` | incidents table |
| Skip | Long-press → "ruka" requires manager PIN | manager approval flow | task_skip_audit |

### Map vs list toggle
When tasks ≥3 are geo-anchored (e.g., 3 sample sites + 2 pit stops), surface a tiny map icon top-right. Default to list (lighter, no map tile bandwidth offline). Map mode shows numbered pins matching list order.

Sources: DoorDash bottom-sheet conditional content [1], Samsara step-by-step gating [2], BuildOps gated workflows [10], CommCare "cannot skip" [3].

---

## 4. Offline-first patterns

The 2026 consensus has moved past "show offline banner." The best apps now treat offline as the **default posture**, with the network being an optimization.

### Core stack (universal across [12], [13], [14])
1. **Local write to SQLite/MMKV first, always.** UI confirms before network is even attempted.
2. **Outbox table** — every mutation queued with idempotency key.
3. **Background sync** via `WorkManager` (Android) / `BGTaskScheduler` (iOS).
4. **CRDT or OT** for shared collections; LWW (last-write-wins) is acceptable for solo-owned data like a worker's task list.
5. **Optimistic UI:** task appears done instantly; small ⏳ pending icon until server ACK; ✓ when synced.

### UI states the worker SEES [12][14]
- **Top status pill**: green dot "Imeunganishwa / Online" / amber dot "Inasawazishwa / Syncing 3" / grey dot "Hauko mtandaoni / Offline · 2h ago".
- **Last-sync stamp** visible somewhere persistent ("Mwisho: dakika 5 zilizopita / Last sync: 5 min ago").
- **Per-card pending icon** for items not yet synced.
- **Sync conflict toast** only when auto-merge fails — opens a side-by-side resolver.
- **Never block the user** for sync. Loading spinners on writes are an anti-pattern in 2026.

### Copy examples [13]
- "Imehifadhiwa katika simu — itasawazishwa / Saved on phone — will sync"
- "Sync ilikwama. Bonyeza kujaribu tena / Sync paused. Tap to retry"
- "Hauko mtandaoni — kazi yako iko salama / Offline — your work is safe"

### Conflict resolution
For Borjie, 99% of field writes are append-only (a sample, a photo, an incident, an attendance event). True conflicts are rare — only on edits to an existing task. Pattern:
- **Auto-merge** when fields don't overlap.
- **Side-by-side** with "yangu / mine" vs "ya seva / server" + one tap pick.
- Always preserve audit trail in `task_event_log`.

### Connectivity rules for Tanzanian mines
- Assume 2G fallback. Compress all photos to ≤200KB before queueing. WebP, 80% quality.
- Voice notes: Opus codec at 16 kbps, ≤10s default.
- Form payload < 5KB; defer photos to multipart background uploads.
- Sync on Wi-Fi only by default; "Sawazisha sasa / Sync now" override.

Sources: [12] (CRDT architecture 2026), [13] (sync UX patterns), [14] (Calibraint optimistic UI fallback).

---

## 5. Voice + low-literacy patterns

Tanzania has ~89% adult literacy nationally but rural and artisanal mining workers skew lower; many read only block-letter Swahili. The benchmark for low-literacy mobile UX is M-Pesa-via-USSD [15], Wave Senegal [16], and Dimagi CommCare [3].

### When voice, when icons, when text?

| Scenario | Best modality | Why |
|---|---|---|
| Greet / intent | Icon + 2-word label | Universal recognisability |
| Numeric input (quantity, kg) | Big keypad + voice digits | Numbers are language-agnostic |
| Free-text comment | **Voice note ALWAYS first**, text optional | WhatsApp voice notes proved this in West Africa farming [17] |
| Dangerous action confirm | Audio + repeat-aloud + double-tap | M-Pesa USSD plays amount aloud before commit [15] |
| Choosing from a list ≤5 | Icons + audio playback per option | CommCare model [3] |
| Choosing from a list >5 | Search / scroll list | Voice opens it; visual narrows |

### Voice-first concrete patterns
- **Press-and-hold mic** on every text input. Visible amplitude wave during recording.
- **Auto-transcribe** to text but **always submit the raw audio too**; supervisor can replay. Both Wezesha na Kabambe and UlangiziAI (Kenya/Malawi agri chatbots) do this [18].
- **Common Voice Swahili models** are accurate enough at 2026 ASR levels for agricultural and mining jargon when fine-tuned [18].
- **"Soma kwa sauti / Read aloud"** icon next to any text block longer than 12 words. Use ElevenLabs / Soniox Swahili TTS [18].

### Dangerous-action confirmation (e.g. submitting fuel-out incident at 3am)
Borrowed from M-Pesa STK push [15]:
1. Action triggers a modal: "Una hakika? / Are you sure?"
2. **Plays audio**: "Unaomba ripoti shida — fueli imeisha. Bonyeza tena ndio."
3. Two big buttons: "NDIO" (green, 60% width) + "HAPANA" (grey, 40% width).
4. Requires a **second tap within 5s** — no auto-confirm.
5. Result has **audio confirmation**: "Imepokelewa. Asante."

### Icon vocabulary for mining workers
A small, consistent set, used everywhere:
- 🚜 Excavator / heavy machine
- ⛏️ Pit / face
- 🪨 Sample
- 💧 Water issue
- ⛽ Fuel
- 🔧 Maintenance
- ⚠️ Safety incident
- 📸 Photo task
- 🎤 Voice note
- 📍 Location
- ✓ Done
- ⏳ Pending sync
- ❌ Blocked

These should be hand-illustrated for Borjie (not emoji) — consistent line weight, gold/earth palette, ≥48dp render.

### Wave Senegal / M-Pesa lessons [15][16]
- Wave deliberately kept feature-phone parity — every smartphone feature has a USSD path.
- Account opening: **phone number only**. No KYC docs at first touch.
- Agent-assisted = critical fallback. Borjie needs a "Niombe msaada wa msimamizi / Ask supervisor for help" button on every screen.

Sources: [15] USSD vs app, [16] Wave Mobile Money, [17] WhatsApp voice notes in Senegal farming (general principle), [18] Mozilla Common Voice Swahili.

---

## 6. Glove-friendly, sunlight-readable, dusty-finger patterns

Real-world field conditions degrade everything. The benchmark sets are SafetyCulture iAuditor [19], Samsara DVIR 2.0 [20], and the WCAG-extended specs in [21].

### Tap target sizes
- **WCAG 2.2 AA minimum:** 24×24 CSS px, recommended 44×44.
- **Apple HIG:** 44pt minimum.
- **Material Design:** 48dp minimum.
- **Industrial / gloved use:** **56dp minimum**, **64dp preferred for primary CTAs** [21].
- **Spacing:** 12dp between interactive elements, 16dp around primary CTAs.
- **Thumb zone:** primary actions in bottom 30–40% of screen.

### Contrast
- WCAG AA = 4.5:1 normal text, 3:1 large.
- **Outdoor / sunlight = 7:1 minimum** for primary text [21].
- **Borjie palette** (already gold/earth) is good for sun; ensure white text on dark earth (#3a2515) and dark earth text on gold (#d4a017) both clear 7:1.
- **Never rely on color alone.** Status pills use icon + color + text label always.

### Dust / dirt / sweat handling
- **No swipe-only actions.** Always provide a tap fallback (long-press menu, or expand → tap-confirm).
- **No precise multi-touch.** Pinch-zoom on maps OK; gestures inside cards are no.
- **Generous press-state feedback.** 100ms haptic on every tap (Android: `HapticFeedbackConstants.LONG_PRESS`).
- **Capture intent quickly.** Voice + photo first; text last.

### Dark mode considerations
- **Counterintuitively, light mode is better outdoors** in direct sun [22]. Dark mode loses contrast against ambient light.
- Auto-switch based on device ambient light sensor + GPS (outdoor/indoor inference).
- Provide manual toggle from user settings.

Sources: [19] SafetyCulture iAuditor field user reports, [20] Samsara DVIR 2.0 photo verification, [21] thumb zone + tap target research, [22] sunlight contrast guidance.

---

## 7. References (every URL fetched / searched)

1. **DoorDash Dasher home screen redesign** — https://medium.com/@a_kill_/doordash-visions-redesigning-the-dasher-apps-homescreen-f40d1b09ba8c — three-bucket non-scrollable bottom sheet; earnings pill as primary motivator.
2. **Samsara Workflow Builder + App Designer** — https://www.samsara.com/blog/introducing-workflow-builder-and-app-designer — drag-and-drop sequenced workflows gated step-by-step; managers configure per role.
3. **CommCare in Burkina Faso** — https://www.exemplars.health/emerging-topics/epidemic-preparedness-and-response/digital-health-tools/commcare-in-burkina-faso — multimedia + branching forms; "cannot skip" gated flow for low-literacy workers; offline by default.
4. **Lyft new driver tools** — https://www.lyft.com/blog/posts/new-driver-improvements-to-take-your-drive-further — Earnings tab tips breakdown; Safety Hub; bonus zones on map; customizable challenges.
5. **Lyft Ride Challenges (home screen)** — https://help.lyft.com/hc/en-us/all/articles/360001943867-Ride-Challenges — challenges shown on home; weekly cadence.
6. **Strava × Apple Fitness+ rings** — https://press.strava.com/articles/strava-and-apple-fitness-collaborate-to-motivate-and-reach-more-active — three-arc closure as motivation primitive.
7. **Lyft goal-setting** — https://help.lyft.com/hc/en-us/all/articles/360015172314-Goal-setting-for-drivers — weekly $ goal; auto-escalator on hit.
8. **Mine site predictive fatigue (ReadiScore)** — https://fatiguescience.com/blog/re-thinking-the-toolbox-talk-how-mine-sites-are-changing-pre-shift-safety-briefings-to-use-predictive-fatigue-data — push to supervisor, advice-not-punishment to worker; 50% fewer alarms.
9. **Kanban UX patterns** — https://www.interaction-design.org/literature/topics/kanban-boards — kanban is a desktop pattern; cards on mobile.
10. **BuildOps technician mobile app** — https://buildops.com/products/technician-mobile-app/ — gated workflows; custom forms; offline auto-sync; OCR asset capture.
11. **Connecteam mobile clock-in** — https://connecteam.com/employee-time-clock-app/ — offline clock-in, kiosk fallback, polish interface for "all levels of tech literacy."
12. **Offline-first 2026 CRDT** — https://www.calibraint.com/blog/offline-first-mobile-app-in-2026 — CRDT, reliability-over-connectivity.
13. **Offline sync UX patterns** — https://developersvoice.com/blog/mobile/offline-first-sync-patterns/ — Syncing / LocalChangesPending / Stale states; non-intrusive banners; optimistic UI with ⏳.
14. **Offline sync architecture trade-offs** — https://www.sachith.co.uk/offline-sync-conflict-resolution-patterns-architecture-trade%E2%80%91offs-practical-guide-feb-19-2026/ — outbox-first, persist before network, design actions not snapshots.
15. **USSD vs app emerging markets** — https://hsenidmobile.com/ussd-vs-mobile-apps-for-financial-services-what-scales-better-in-emerging-markets/ — numbered menus, audio playback, language at entry, mandatory verbal confirm for high-value actions.
16. **Wave Mobile Money Senegal** — https://triplepundit.com/2025/wave-mobile-money-cote-divoire/ — phone-number-only onboarding; agent-assisted; feature-phone parity.
17. **WhatsApp voice notes in West African farming** — https://www.mozillafoundation.org/en/blog/talk-swahili-to-me-voice-enabled-apps-changing-the-game-for-farmers-and-local-communities/ — voice replaces literacy; SMS + WhatsApp transport.
18. **Mozilla Common Voice Swahili / UlangiziAI / KTVRP** — same Mozilla URL plus https://developer.nvidia.com/blog/ai-chatbot-delivers-multilingual-support-to-african-farmers/ — voice-first chatbots; ASR + LLM in Kiswahili; feature-phone fallback via SMS.
19. **SafetyCulture iAuditor at Newmont** — https://safetyculture.com/customers/newmont-mining — 1,000+ inspections/day across 11 mines; "minimal training" templates per task/team/location.
20. **Samsara DVIR 2.0** — https://www.samsara.com/products/apps-and-workflows/dvir + https://kb.samsara.com/hc/en-us/articles/43217017570829 — offline-capable inspections; AI verifies driver proximity + photo authenticity.
21. **Thumb zone + tap target research** — https://parachutedesign.ca/blog/thumb-zone-ux/ + https://blog.openreplay.com/improving-tap-targets-mobile-ux/ — 44pt min, 56–64dp for primary; bottom 30–40% zone.
22. **Sunlight + dark mode** — https://www.quora.com/What-is-the-best-color-scheme-for-outdoor-mobile-apps-in-sunlight + https://www.uxdesigninstitute.com/blog/dark-mode-design-practical-guide/ — light mode better outdoors; 7:1 contrast for sun.
23. **Pre-shift toolbox talk apps for mining / oil** — https://basincheck.com/resources/best-toolbox-talk-apps — digital signatures + GPS-tagged sessions + asynchronous micro-training; 5–15 minute briefings.
24. **DoorDash Dash Now help** — https://help.doordash.com/dashers/s/article/How-to-use-the-Dash-Now-home-page — real-time heatmap; one-tap go-online.
25. **Dimagi CommCare general** — https://dimagi.com/commcare/ — 37M+ forms/month across 80 countries; multimedia, branching, offline.

---

## 8. Anti-patterns to avoid

- **Dashboard-as-home.** Field workers don't want analytics first thing. Cite: DoorDash redesign eliminated 150+ scattered UI elements.
- **Hamburger menu hiding the primary action.** Bottom-tab + bottom-button always wins for one-handed gloved use.
- **Daily streaks for shift workers.** Punishes legitimate days off. Use weekly goals.
- **Toxic leaderboards** with named ranks. Aggregate or anonymous only.
- **Pop-up modals during high-risk operations.** A "Rate this experience" modal in the middle of a pit operation will be force-tapped without reading. Disable in-app surveys when `activity = on_shift`.
- **Text-heavy forms.** Replace prose questions with voice prompt + audio playback + icon options.
- **Charts as default.** Defer to detail screens; home screen gets one number max per metric.
- **Sync spinners blocking writes.** Always optimistic, always background.
- **"Tap to retry" without context.** Show what failed and what queued. Worker must trust the outbox.
- **English fallback for missing Swahili strings.** Worse than wrong Swahili — gives the impression the app doesn't actually speak their language. Block ship if `i18n.sw` coverage < 100%.
- **GPS-required for everything.** Allow late-bound location capture; offline-attendance should be cached and stamped at next online ping.
- **Kanban or board views on mobile.** Vertical list always.
- **More than 5 bottom tabs.** Four ideal.

---

## 9. CONCRETE PROPOSAL — `apps/workforce-mobile/app/(tabs)/home.tsx` (employee role)

Wire-level spec. Sections from top to bottom of the scroll. **Above-the-fold = sections 1–3 only.**

### Layout grammar
- **Screen padding:** 16dp horizontal, 12dp vertical between sections.
- **Section radius:** 16dp.
- **Primary tap targets:** ≥56dp height, gold (#d4a017) on earth-900 (#3a2515).
- **Status pill row:** 32dp height, always visible at very top.
- **Bottom action band:** fixed, 80dp, full-width, lives outside the ScrollView.

### Section 1 — Status strip (always visible, 32dp)
**Data:** `useOnlineStatus()` + `useSyncQueue()` + `useShiftStatus()`.
**Renders:** Three pills inline, left-to-right.
- **Connection pill:** green "Mtandaoni / Online" · amber "Inasawazisha 3 / Syncing 3" · grey "Hauko mtandaoni · 5 dakika zilizopita / Offline · 5 min ago".
- **Shift pill:** "Zamu: 2h 14m" (live timer) — pulses gold when ≥2h to break, red when ≥6h continuous.
- **Sync timestamp:** "Mwisho: 18:23" small caption.
**Endpoint:** `GET /v1/mining/attendance?worker_id=me&latest=true` — already exists.

### Section 2 — Hero "Sasa / Now" card (35% of screen)
**Data:** Current top-priority task from queue (computed server-side).
**Renders:**
- Big title: e.g. "Pakua sampuli A12 kutoka shimo 3 / Collect sample A12 from pit 3".
- Sub-label: location + window: "📍 Shimo 3 · 220m kaskazini / Pit 3 · 220m north" + "⏰ Mpaka 09:30 / By 09:30".
- If geo-anchored, mini-map preview (60dp tall, no zoom, tappable to open full map).
- **One big action button** at card bottom: "Anza / Start" (56dp, gold). On tap → opens task detail.
- Long-press → "Ruka / Skip" (requires manager PIN).
**Endpoint:** `GET /v1/mining/tasks?worker_id=me&status=open&order_by=priority&limit=1` (new endpoint — uses existing tasks scaffold).

### Section 3 — Progress strip (single line, 48dp)
**Data:** Today's counts + delta from yesterday.
**Renders:** One line, 4 chips:
```
Kazi 4/6    Saa 2h 14m    Picha 23    Pointi 87
   ▲+1          ▼-12m         ▲+5         ▲+3
```
Each chip is tappable → opens its history.
**Endpoint:** `GET /v1/mining/shift-reports?worker_id=me&date=today&summary=true` — extend existing route.

### Section 4 — Task queue (3 visible cards)
**Data:** Open tasks except the hero.
**Renders:** Vertical stack. Each card:
- Status badge (red urgent / amber due / green flex).
- Title (1 line) + meta (1 line: location, time window).
- Right-side icon: 📸 (photo required) / 🎤 (voice required) / 🪨 (sample) / ⛽ (fuel).
- Swipe right → mark done with optimistic ✓ animation + ⏳ pending icon until sync.
- Swipe left → "Shida / Issue" → 4-icon block reason picker → voice note → `POST /v1/mining/incidents` with `category=block` (existing endpoint).
- Tap → expand to full task screen.
- "Ona zote / See all" link at bottom → opens full task tab.
**Endpoint:** `GET /v1/mining/tasks?worker_id=me&status=open&limit=3&exclude=hero_id` (new).

### Section 5 — Safety pulse (collapsed by default)
**Data:** Site-level incidents in last 24h + pre-shift toolbox talk status.
**Renders:**
- If pre-shift talk NOT acknowledged: red banner "Lazima: Soma muhtasari wa usalama / Required: Read safety briefing" → tap opens audio-playback + e-signature flow.
- If acknowledged: small grey "✓ Muhtasari umesainiwa 06:12 / Briefing signed".
- Below: "Matukio juzi: 1 dogo / Yesterday: 1 minor" with tap to incident list.
**Endpoint:** `GET /v1/mining/incidents?site_id=...&since=24h&summary=true` + new toolbox-talk endpoint.

### Section 6 — Quick capture (always-visible floating action button — actually a fixed bottom band)
**The bottom action band** is the only persistent UI outside the scroll area.
- **Big "Imekamilika / Done"** button on left (60% width, gold, 64dp tall) — completes hero task.
- **Mic icon** on right (40% width, earth, 64dp tall) — press-and-hold voice note → `POST /v1/mining/incidents` with `category=note` and `audio_url` set after upload.
- **Long-press mic** → opens "What kind of report?" 4-icon menu (sample / incident / fuel / shida).

### Section 7 — Sync centre (below the fold, collapsed by default)
**Data:** Outbox state.
**Renders:**
- "3 items hazijasawazisha / 3 items pending sync" with expandable list.
- Each entry: timestamp + summary + retry button.
- "Sawazisha sasa / Sync now" override button.
**Endpoint:** local outbox only; sync via existing API endpoints.

### Section 8 — Sign-out & language (below fold)
- Language toggle: SW / EN.
- "Toka / Sign out" — confirms with audio "Una hakika unataka kutoka? Bonyeza tena."

### Behavioral rules
- **No data fetched on this screen blocks render.** Skeleton states for each section; render with cached data first, refresh in background.
- **All endpoint calls are idempotent + retry-safe.** Failures queue to outbox.
- **Press-state haptic on every tap** (Expo's `Haptics.impactAsync(Light)`).
- **Read-aloud icon** next to hero title and section 5 banner — tap plays Swahili TTS.
- **Sun-mode flag:** auto-switches to high-contrast palette when ambient light > 10,000 lux (ExpoSensors.LightSensor).
- **Glove-mode toggle** in settings: when on, all tap targets render at 64dp (vs default 56dp).

### Existing endpoints leveraged
| Section | Endpoint | Status |
|---|---|---|
| 1 status strip | `GET /v1/mining/attendance?worker_id=me&latest=true` | Exists [`mining/attendance.hono.ts`] |
| 3 progress strip | `GET /v1/mining/shift-reports?worker_id=me&date=today&summary=true` | Exists [`mining/shift-reports.hono.ts`] — needs `?summary=true` flag added |
| 4 task queue done | task-specific endpoints + `POST /v1/mining/samples` for sample tasks | `mining/samples.hono.ts` exists |
| 4 task queue block | `POST /v1/mining/incidents` with `category=block` | Exists [`mining/incidents.hono.ts`] |
| 5 safety pulse | `GET /v1/mining/incidents?site_id&since=24h&summary=true` | Exists; needs `summary=true` flag |
| 6 voice note | `POST /v1/mining/incidents` with `category=note` + `audio_url` | Exists; needs `audio_url` field added |

### New endpoints required (proposed, not built here)
1. `GET /v1/mining/tasks?worker_id&status&limit&order_by` — task queue.
2. `POST /v1/mining/tasks/:id/complete` — mark done with optimistic-sync-safe idempotency key.
3. `GET /v1/mining/toolbox-talks?worker_id&date=today` + `POST /v1/mining/toolbox-talks/:id/acknowledge`.

### Edge cases handled
- **No shift started yet:** hero becomes "Anza zamu / Start shift" with attendance check-in flow.
- **Offline since boot:** status pill grey + cached hero + queue from local SQLite; new mutations queue.
- **Low literacy flag = true on user:** all text strings switch to icon-prefixed, read-aloud icon shows by default (not behind tap), bottom band shows mic prominently (60/40 inverted).
- **Manager role:** add a "Approvals" card between sections 4 and 5 (existing manager hint in current home.tsx).

---

## 10. Open research questions (for follow-up)

- **Crew chat / radio integration** — no benchmark app has this nailed for low-bandwidth crews. Push-to-talk in-app might be the answer; investigate Discord/Walkie-talkie patterns.
- **Wearable integration (Spot-r style)** — Triax Spot-r [Wikipedia entry, Invixium acquisition 2024] provides slip/trip/fall detection via clip device. Borjie should plan a wearable companion or integrate to Spot-r/Invixium SDK.
- **Voice ASR accuracy in mining jargon** — Common Voice Swahili models are good for agriculture but mining vocabulary (e.g. "shimo", "korongo", "kompresa") needs domain fine-tuning. Tactical: build a 500-utterance training set with mine workers in Q3.
- **Feature-phone parity via USSD** — Wave proved this matters in Senegal. Borjie may need a USSD `*123#` shortcode for the lowest tier of workers — costs vary by Tanzanian MNO.
- **Biometric clock-in** — fingerprint at most mines is impractical (dust, gloves); voice-print + face are emerging. Worth a small pilot.

---

*End of doc.*
