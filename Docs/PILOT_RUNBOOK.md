# Borjie Pilot Runbook — Co-located Observer Edition

**Audience:** every Borjie team member who sits next to a pilot owner
or worker during the May/Jun 2026 cohort window.
**Brand:** Borjie. **Persona of authority:** Mr. Mwikila (founder).
**Last updated:** 2026-05-27.

This runbook is the only document a pilot observer needs at hand. Print
it. Carry it. Read sections 3, 4, and 5 *before* you sit down with the
pilot.

---

## 1. Pre-pilot setup checklist (complete the day before)

- [ ] **Pilot account provisioned** — confirm `users.id` exists in the
      pilot tenant and `app_metadata.roles` contains `pilot`. Use:

      ```
      make pilot-provision USER=+255712345678 TENANT=tnt_pilot_001 COHORT=pilot-tz-may-2026
      ```

- [ ] **Pilot kill-switch ENABLED for the cohort** — verify
      `pilot_enabled` flag is ON for the tenant in the feature-flags
      table. The platform defaults to OFF; you must turn it on
      explicitly for the pilot to see anything.
- [ ] **Mobile phone fully charged + LTE + Wi-Fi tested.** Pilots are
      mid-range Android with patchy connectivity — verify offline mode
      works before they touch it.
- [ ] **Camera + microphone permissions granted** in app settings.
- [ ] **Swahili keyboard installed** as the primary keyboard on the
      pilot's phone.
- [ ] **Two laptops on site** — one for the observer to take notes,
      one as the platform-ops console (for the kill-switch).
- [ ] **Sentry pilot-mode dashboard pinned** in the platform-ops
      laptop's browser. Filter: `tags.cohort:pilot-tz-may-2026`.
- [ ] **Test the FeedbackButton end-to-end** on a staging tenant so you
      know the modal works before the pilot uses it.
- [ ] **Pilot has WhatsApp number** for your on-call SRE — show it on
      the home screen widget area.
- [ ] **Hard-stop time agreed** with the pilot's family/work — never
      run a session past 90 minutes without a break.
- [ ] **Consent recorded** — pilot has signed the data-sharing form;
      session recording opt-in is on file.

---

## 2. The co-located observer script

You sit on the **pilot's non-dominant side** and slightly behind. You
are a quiet witness, not a coach. Speak only when the script tells you
to. Write everything down — the pilot will rationalise the experience
the moment the session ends.

### Step 1: Greeting (60 seconds)

> "Mambo, [first name]. Asante kwa muda wako leo. Tutachunguza Borjie
> pamoja. Sitakusaidia sana — ningependa kuona kile ambacho kingine
> watu watapata wakitumia. Ukikwama, kaa kimya kwa sekunde tano kabla
> ya kuniuliza."

(Translation: "Hi, [name]. Thanks for your time today. We'll explore
Borjie together. I won't help much — I'd like to see what others will
encounter when they use it. If you get stuck, please pause five
seconds before asking me.")

### Step 2: First-task hand-off (no demo)

Hand them the phone open to the home screen. Say only the high-level
task ("Tafadhali angalia ripoti ya mgodi ya jana"). Do not point at
buttons. Do not narrate.

### Step 3: Note-taking template

For every screen the pilot lands on, write:

```
[HH:MM] Screen: <screen-id e.g. W-DASH-01>
  Action attempted:  <verbatim words the pilot used>
  Outcome:           <success | stuck | gave up>
  Time on screen:    <seconds>
  Emotion:           <neutral | confused | frustrated | delighted>
  Verbatim quote:    <one short phrase, sw or en>
```

### Step 4: When to step in vs let them struggle

Let them struggle when:
- They have not asked for help.
- They are reading the screen (eyes moving, not idle).
- They are within their first 30 seconds on a screen.

Step in **only** when:
- They have explicitly asked twice ("Sasa nifanyeje?").
- They are about to perform an irreversible action they didn't intend
  (delete, send, approve).
- 90 seconds have passed on the same screen with no action.
- They show physical distress (sigh, push phone away, look at you).

When you step in, say:
> "Hakuna shida. Tukae hapa kwa muda. Ungependa kufanya nini hapo?"
> ("No problem. Let's pause. What did you want to do here?")

Never tap the screen for them. Never say "press this".

---

## 3. Top-10 likely failure modes + what to say/do

| # | Symptom | Likely cause | What to say | What to do |
|---|---------|--------------|-------------|------------|
| 1 | App shows 503 PILOT_PAUSED | Kill-switch tripped | "Ngoja kidogo, naangalia." | DM SRE; do NOT debug live. |
| 2 | Phone offline | Bandwidth blip | "Ni mtandao tu, itarudi." | Wait 30s; if still down, switch to Wi-Fi. |
| 3 | Login screen loops | Supabase JWT expired | "Tutafanya log-in upya." | Tap Sign-Out → Sign-In. |
| 4 | Camera permission denied | Settings off | "Tunahitaji ruhusa ya kamera." | Walk to Settings → Apps → Borjie. |
| 5 | Voice doesn't transcribe | Mic muted / quiet room | (Stay silent) | Let them retry once. |
| 6 | Map tiles missing | Mapbox quota | (Stay silent; note) | Skip the map step. |
| 7 | Photo advisor stalls | LLM timeout | "Hii inachelewa kidogo." | Note + move on; flag at debrief. |
| 8 | "Niarifu Borjie" send fails | API 401/503 | "Tutaiandika kwenye karatasi." | Capture verbatim in your notes. |
| 9 | Persona greeting wrong language | Lang detection edge | (Stay silent) | Note + capture screenshot. |
| 10 | App crash to home screen | Native crash | "Pole, nimeona hilo." | Re-open; if it crashes twice, stop the session. |

---

## 4. Capturing a session recording

### Mobile (Android)

1. Pull down the quick-settings shade with two fingers.
2. Long-press the **Screen Record** tile to configure: record audio
   = "device + mic", show taps = ON.
3. Tap to start. The status bar turns red.
4. At the end of the session: pull the shade, tap "Stop recording".
5. The video lands in `Photos → Movies → Screen recordings`.
6. **Upload to the pilot drive** (folder
   `pilot-sessions/<cohort>/<pilot-id>/<YYYY-MM-DD>/`).
   Filename: `<screen-id-or-task>-<HH-MM>.mp4`.

### Web (owner-web / admin-web)

Use the platform's built-in session-replay (rrweb under the hood):

1. Make sure `session_replay_pilot` flag is ON for the tenant.
2. Open the platform-ops console; the replay appears in
   `/admin/session-replay?cohort=<cohort>`.
3. Filter to the pilot's user_id and the session start time.
4. Tag the replay with the screen-id of the bug if you spotted one.

If session-replay is unavailable, fall back to OS screen recording
(macOS: cmd+shift+5; Windows: Win+G).

---

## 5. When to abort the session

Stop the session **immediately** if any of:

- The pilot expresses physical discomfort (pain, fatigue, headache).
- They ask to stop.
- The app crashes more than **twice** in 15 minutes.
- A data-corruption event is observed (wrong amount, wrong user, wrong
  language locked).
- A regulatory red flag (PII shown to the wrong tenant).
- You — the observer — feel out of your depth on a question that risks
  giving wrong advice (compliance, tax, legal).

When you abort:
1. Save your notes immediately.
2. Walk the pilot through a graceful exit ("Tumefanya vya kutosha leo,
   asante sana.").
3. DM the on-call SRE with `#pilot-incident <cohort> <one-line>`.

---

## 6. Post-session debrief (5 questions, 10 minutes max)

Ask these five — in this order — verbatim. Write the answers down.

1. "Kipi kilikuwa rahisi zaidi leo?" *(What was easiest today?)*
2. "Kipi kilikukatisha tamaa zaidi?" *(What frustrated you most?)*
3. "Kama ungekuwa Mr. Mwikila, ungebadilisha nini kwanza?"
   *(If you were Mr. Mwikila, what would you change first?)*
4. "Je, ungekabidhi kazi hii kwa msaidizi wako kesho?"
   *(Would you hand this task to your assistant tomorrow?)* Yes / No / Why?
5. "Una shaka gani kuhusu kutumia Borjie kila siku?"
   *(What's your single biggest worry about using Borjie daily?)*

End with: "Asante. Ujumbe wako una thamani kubwa kwetu." ("Thank you.
Your input is precious to us.")

---

## 7. Kill-switch instructions

### Soft pause — for known issues, scoped to the cohort

1. SRE opens the platform-ops console.
2. In the `feature_flags` table, set `pilot_enabled = false` for the
   pilot tenant id (or for the cohort allow-list).
3. Within 30 seconds every pilot-tagged route returns **503 PILOT_PAUSED**
   with a bilingual sw/en message. The rest of the platform is
   unaffected.

### Hard pause — emergency, all cohorts

1. SSH to api-gateway: `kubectl set env deploy/api-gateway PILOT_KILL_SWITCH_OPEN=true`
2. Rolling restart is **not** required; the middleware re-reads env per
   request.
3. The 503 is logged with `evt=pilot_kill_switch_tripped` so SRE can
   verify it's been applied.

### Revoke pilot tokens (suspected compromise)

1. In Supabase Auth dashboard, find the user by phone.
2. Click "Sign out all sessions" — invalidates every JWT.
3. Optional: rotate the user's password via `make pilot-provision`
   (re-run is idempotent and refreshes the cohort tag).

### Re-enable

Reverse the kill-switch in the same order:
1. Unset `PILOT_KILL_SWITCH_OPEN` (env var).
2. Flip `pilot_enabled = true` for the tenant.
3. Confirm: visit a pilot route — expect 200.

---

## 8. Pilot communication SLAs

| Event                                 | SLA            | Channel                        |
|---------------------------------------|----------------|--------------------------------|
| Pilot WhatsApp message (any)          | 4 hours        | WhatsApp                       |
| Pilot "Niarifu Borjie" (1–2 stars)    | 24 hours       | Outbound call from observer    |
| Pilot "Niarifu Borjie" (3–5 stars)    | 48 hours       | Email / WhatsApp acknowledgment|
| Crash / 503 / data corruption         | 1 hour         | SRE on-call → pilot owner      |
| Weekly cadence call                   | 30 min, Friday | Voice call                     |
| End-of-cohort debrief                 | 90 min, in-person | Field visit                |

---

## 9. Where to find each lever

- Provisioning script:    `scripts/pilot-provision.ts`
- Kill-switch code:       `packages/feature-flags-adapter/src/pilot-kill-switch.ts`
- Kill-switch middleware: `services/api-gateway/src/middleware/pilot-kill-switch.ts`
- Feedback endpoint:      `services/api-gateway/src/routes/pilot-feedback.hono.ts`
- Mobile FAB:             `apps/workforce-mobile/src/components/FeedbackButton.tsx`
- Owner FAB:              `apps/owner-web/src/components/FeedbackButton.tsx`
- Admin FAB:              `apps/admin-web/src/components/FeedbackButton.tsx`
- Migration (table):      `packages/database/src/migrations/0077_pilot_feedback.sql`
- Triage automation:      `Makefile :: pilot-summary, pilot-auto-assign`
