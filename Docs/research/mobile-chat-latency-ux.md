# Mobile Chat Latency UX — SOTA 2026 Patterns for Perceived Speed

**Project:** Borjie (workforce-mobile + buyer-mobile)
**Audience:** front-end engineers wiring `apps/*/src/chat/HomeChat.tsx`
**Date:** 2026-05-27
**Status:** Research — no code edits in this pass.

The Borjie chat home is the front door. A 3G worker in rural Tanzania
will close the app within seconds if the chat does not *feel* alive.
This document distils the SOTA mobile-chat patterns that make a 1-3 s
backend feel sub-second, with concrete proposals for our two Expo
surfaces.

> **Rule of thumb.** Real latency is what the network costs you.
> Perceived latency is what the user pays *attention* to. The job is
> to spend the user's attention before the network arrives.

---

## 1. Perceived-vs-Real Latency — the foundational science

### 1.1 Doherty Threshold (IBM, 1982)

Walter J. Doherty and Ahrvind J. Thadani (IBM Systems Journal, 1982)
demonstrated that productivity "soars when a computer and its users
interact at a pace (<400 ms) that ensures that neither has to wait
on the other." Their target was a *5x reduction* from the prior
2 s standard. Users described systems meeting the 400 ms bar as
"addicting" — a finding modern UX still leans on.

Implication for Borjie: any UI feedback (button press, optimistic
bubble, skeleton appearance) **must land inside 400 ms** of the
user's input, even if the brain answer takes 3 s.

### 1.2 Nielsen's 100 ms / 1 s / 10 s Limits (NN/G)

Jakob Nielsen's three thresholds, restated verbatim:

| Bound | Nielsen original | Action required |
|---|---|---|
| **0.1 s** | "limit for having the user feel that the system is reacting instantaneously" | No special feedback — just show the result. |
| **1.0 s** | "limit for the user's flow of thought to stay uninterrupted" | No explicit progress bar needed, but users notice the delay. |
| **10 s** | "limit for keeping the user's attention focused on the dialogue" | Percent-done indicator + a way to cancel. |

The 10 s bound is the *abandonment cliff*. Past it, users mentally
context-switch and treat the app as broken.

### 1.3 Time-to-First-Token (TTFT) — the LLM-specific bound

For AI chat, the relevant metric is **TTFT**, not full-response
latency. CodeAnt's 2026 synthesis of LLM-chat research:

- **< 200 ms**: feels instant
- **< 500 ms**: feels responsive
- **> 1 s**: noticeable delay
- **> 2 s**: frustration sets in
- **> 3 s**: engagement drops ~40 %

Empirical streaming studies (Medium / HashBlock, n = 50 beta):
TTFT dropped from 4.1 s → 0.6 s **with no change to total
completion time** (5.3 s → 5.0 s). Perceived-speed rating moved
4/10 → 9/10. Drop-off during response **fell from 22 % → 7 %**.

### 1.4 The streaming illusion

Cross-corroborated finding (CodeAnt, Tian Pan, HashBlock): users
perceive streaming responses as **40-60 % faster** than equivalent
non-streaming responses, *even with identical wall-clock time*. The
"typing-cursor illusion" — but only after the first token arrives.

Critical caveat (Tian Pan 2026): **streaming masks latency
perception but not actual TTFT**. A 3 s TTFT followed by streaming
still shows a blank screen for 3 s. Perceived responsiveness depends
entirely on *when the first token arrives*, not how fast the rest
streams.

### 1.5 Cognitive-load streaming (arxiv 2504.17999)

The "Streaming, Fast and Slow" paper (n = 200 crowdsource) found:

- Simple content (5th-grade reading): users prefer **~21 words/sec**
- Complex content (college economics): users prefer **~12 words/sec**

→ Nearly 2x variance in *preferred stream rate* by content
complexity. Streaming faster than the user's reading speed wastes
compute and does not improve UX. For Borjie's Swahili copy (medium
complexity, often technical mining terms), target the lower end —
**~15 words/sec stream rate** with bursts allowed.

---

## 2. Patterns by Perceived-Latency Tier

A single chat turn passes through 5 latency tiers. Each tier
demands a different visual treatment.

### Tier A — 0-100 ms (instant)

User just hit *Send*. Backend has not even received the request.

- **Keyboard does NOT dismiss** unless user explicitly asks. Premature
  dismissal feels jarring on mobile.
- **Send button micro-animation**: 1.05x scale + spring-back over
  120 ms. Conveys "press registered."
- **Subtle haptic** (`Haptics.selectionAsync()` on iOS, light
  vibration on Android). One pulse only.
- **Composer field clears optimistically.**

### Tier B — 100-400 ms (snappy)

Network ack arrives. User has not yet looked away.

- **User bubble slides in from the right** (translateY 8 → 0,
  opacity 0 → 1, 200 ms ease-out). Note: bubble already had its
  optimistic content rendered in Tier A — this is just the
  reveal animation.
- **Assistant skeleton bubble appears at ~150 ms**: a single
  shimmering rounded rect, height ~48 px, opacity 0 → 1 over 120 ms.
- **NO spinner anywhere.** Spinners signal "we don't know when this
  ends" — which is exactly the wrong vibe.

### Tier C — 400 ms-1 s (good — Doherty crossed)

The brain is thinking. We have crossed the 400 ms threshold so the
user is *aware* of waiting but their flow is unbroken.

- **First stream tokens land in the assistant bubble.** Skeleton
  collapses, tokens take over. (See §5 for streaming detail.)
- **If we have a "thinking" pulse, this is when it fires.** Three
  dots, 600 ms cycle, NOT spinner. iMessage-style. (See §1.2 on
  three-dot anxiety — keep the loop short, ≤ 1.2 s, then transition
  to streaming text.)

### Tier D — 1-3 s (acceptable for AI)

Brain is mid-response. Tokens are streaming.

- **Tokens render progressively**, ~15 wps for Swahili copy.
- **No auto-scroll** while user is reading earlier turns (see §9).
- **Markdown progressively renders** — bold/italic resolve as
  delimiter completes; lists insert as line breaks land; code
  blocks render their fence boundary first, content streams inside.

### Tier E — 3 s+ (degraded)

Backend is slow OR network is bad.

- **At exactly 3 s** post-send: a quiet sub-text appears below the
  skeleton — `"Borjie anafikiri kwa kina…"` / `"Thinking more
  carefully…"`. Italic, muted color, 12 sp.
- **At 6 s**: pulse becomes slower (1 s cycle) — signals "still
  alive, just deep."
- **At 10 s**: hard cliff. Show "Itasync ukirudi" chip if offline;
  "Borjie ana shughuli — jaribu tena" chip with 3 alternative
  phrasings if 5xx. (See §6.)

---

## 3. Pre-Send Patterns — make the composer feel alive *before* user presses Send

### 3.1 Predictive composer (Smart Compose ancestry)

Gmail's Smart Compose: as the user types, the next 3-5 tokens
appear in grey, accept-by-swipe (Android) or tab (iOS). Gboard
extended this to WhatsApp, Telegram, Slack via OS-level keyboard
hooks (Google Workspace blog).

For Borjie:
- Use a **role-aware suggestion table** keyed off persona slug +
  first 2-3 typed words. Pull from a static dictionary first; later
  swap to a brain-side `/api/v1/brain/suggest` endpoint.
- Render the prediction **inline in the TextInput** using
  `selectionColor` + ghost text overlay (a second `Text` positioned
  absolute over the input).
- **Accept by swipe-right or tap**.

### 3.2 Smart-reply chips above the keyboard

Google Messages 2025 update: tapping a smart-reply chip *inserts
the text into the compose field* (it no longer sends immediately).
This respects user agency — they can edit before sending.

Borjie already has greeting suggestion chips (`HOME_CHAT_OPENERS`).
Extend: surface 3 contextual chips *above the keyboard* after each
brain response, derived from the brain's `proposedAction` and
`toolCalls` (e.g., after a `attendance.summary` card, suggest
"Onyesha leo?", "Ripoti ya wiki?", "Nani hayupo?").

### 3.3 Voice button always visible

WhatsApp / Telegram / iMessage all keep the mic button visible *all
the time* — never hidden behind a menu. Tap-and-hold to record. Voice
is the primary modality for 3G workers with poor typing fluency.

Current code: voice button is present (`home-chat-voice` testID) but
the press handler is missing. (See §11 proposal.)

### 3.4 Recent prompts as quick-tap chips

Once a user has 3+ turns, surface their last 3 unique queries as
quick-tap chips above the keyboard. Reduces friction on repeated
queries like "leo nani yupo kazini?" (who is at work today?).

### 3.5 Auto-attach context (zero-friction)

The brain endpoint already accepts persona slug. Add silently to
every request:
- Current screen route (so brain knows what the user is looking at)
- GPS (if user has granted permission and is on duty)
- Current time + timezone

Never show the user "we are attaching your location" — it should be
invisible context, with an explicit Settings toggle for opt-out.

---

## 4. Send Patterns — the moment of commitment

### 4.1 Optimistic user bubble (CRITICAL)

User bubble appears in the conversation **before the network ack
arrives**, identical to Messages/WhatsApp/Messenger. The pattern is
called Optimistic UI (Filip Fajdetić / Medium; Alex Glushenkov /
Medium).

State machine:
```
draft → pending → sent → delivered → read
  └─ (network fail) → failed (subtle red dot)
```

Current Borjie code:
- `buyer-mobile/HomeChat.tsx` already uses `optimistic` ChatTurn
  with `pending: true`. Good.
- `workforce-mobile/HomeChat.tsx` uses `setPendingUserText(trimmed)`
  + `PendingTurnView`. Also good, slightly different model.

Gap: neither surface animates the optimistic bubble in. It just
appears. The reveal animation is the difference between feeling
"smooth" and feeling "abrupt."

### 4.2 Send button animation (Swiggy-style)

The send button passes through three states:
- **idle**: gold/forest pill
- **press** (touch-down): scale 0.95, 80 ms
- **post-press → ack**: scale 1.05, then settle to 1.0 over 200 ms
- **on success**: optional checkmark glyph cross-fades over the
  arrow for 400 ms then reverts

Doherty-compliant — the user sees the press register in <100 ms.

### 4.3 Haptic on send

iOS: `Haptics.selectionAsync()` — a single tactile tick. Android:
`Vibration.vibrate(10)` — a 10 ms pulse. Heavier haptics annoy on
repeated sends; keep it light (Martyn Reding / Medium).

### 4.4 Composer clears + focus stays

The TextInput clears immediately on send. Focus stays in the input
so the user can type their next thought *while the brain is
answering*. Disabling the composer is an anti-pattern (see §9).

---

## 5. Response Patterns — the assistant bubble fills

### 5.1 Skeleton bubble (200 ms onset)

200 ms after user send, an assistant skeleton bubble appears: a
shimmering rounded rectangle the width of a typical first-token
chunk (~ 60 % of screen width).

Per NN/G: skeletons reduce perceived wait by giving the eye a
visual anchor. Under 500 ms they can be *distracting* — so we hold
the skeleton for a minimum of 200 ms before allowing it to be
replaced by tokens. (Anita Demirci / Medium; NN/G.)

Implementation note: Callstack's `react-native-fast-shimmer` runs a
single shared `useSharedValue` for all on-screen shimmers, off the
UI thread. We do NOT need a new package — we can build this with
`react-native-reanimated` which is already in the workspace.

### 5.2 Token streaming with adaptive rate

Stream tokens into the assistant bubble at **~ 15 wps** for Swahili
("medium" complexity per arxiv 2504.17999). For code blocks, drop
to **~ 8 wps** (the user has to actually *read* code). Adaptive
streaming is a 2026 frontier — for Borjie v1, fixed 15 wps is fine.

### 5.3 Progressive markdown rendering

Render markdown as it streams, NOT at-end. Vercel's Chat SDK and
Streamdown both implement this. The pattern: detect stable block
boundaries (blank lines, fence closings), parse + render those
incrementally, only re-parse the trailing in-flight chunk
(Incremark; HackerNoon Tool-Call Render Pattern).

For Borjie, react-native markdown libraries are heavy. Cheaper
approach: parse only `**bold**`, `_italic_`, line breaks, and
bullet lists incrementally — a 30-line custom renderer in
`chat/streamParser.ts` (already exists, currently text-only).

### 5.4 Tool-call cards animate in one-by-one

After the assistant text completes, tool-call cards animate in
**sequentially**, ~ 80 ms stagger. Each card:
1. Skeleton shimmer for 100 ms (gives the user time to register
   that a new thing is arriving)
2. Cross-fades from skeleton → content over 200 ms
3. Settles into place

This is the "stagger reveal" pattern (Trickle, Webflow blog-card
stagger). It feels deliberate and high-touch — the cards aren't
*loaded*, they're *delivered*.

### 5.5 Citations as chips at the bottom

Perplexity's anchor pattern: sources at the *top* of the response,
text below. Henry Modisett (NN/G): "people want information as
fast as possible and want to trust that information."

For Borjie, mirror this — when a brain response cites an
`evidence_id`, render a small chip row at the *bottom* of the
assistant bubble (not top — mining workers care about the answer
first, the source second). Tap-to-expand opens the evidence in a
modal sheet.

---

## 6. Failure Patterns — never strand the user

### 6.1 Subtle red dot on user bubble

If the request fails, attach a small red dot (8 px) to the
top-right corner of the *user* bubble. Tap-to-retry sends the
same message body again. Do NOT show a banner — banner blocks
the conversation flow and feels catastrophic.

### 6.2 Slow indicator at 3 s, NOT 0 s

A spinner that appears the moment you press Send communicates "we
have no idea how long this takes." A spinner that appears at 3 s
post-send communicates "we acknowledge this is taking longer than
usual." Same UI element, opposite emotional message.

Current Borjie code (`buyer-mobile/HomeChat.tsx`) uses a permanent
`ActivityIndicator` while `mutation.isPending`. This is the
anti-pattern.

### 6.3 Offline detection → outbox queue

When the device is offline, surface a Swahili-first message:
**"Itasync ukirudi mtandaoni"** ("Will sync when you're back
online") below the user bubble. Per AppMaster & DevelopersVoice
on offline-first patterns, the message goes into a durable outbox
(use `AsyncStorage` — already in the stack) keyed by a client UUID,
drained when connectivity returns.

UX touches:
- "Itasync" copy mirrors Tanzanian Swahili borrowing pattern
  (English root verbs + Swahili prefix). Native to the target user.
- A small "(2 pending)" pill in the chat header when items are
  queued.

### 6.4 5xx fallback chip

If we get a 5xx response (the brain timed out or service is down),
the assistant bubble shows: **"Borjie ana shughuli sasa hivi.
Jaribu tena."** ("Borjie is busy right now. Try again.") plus a
row of 3 chips:
- "Jaribu tena" (try again)
- "Uliza vingine" (ask differently — prefills a suggestion)
- "Wasiliana na msaada" (contact support)

Per Tian Pan: "uncertainty amplifies the sensation of delay."
Giving the user *three concrete next actions* converts uncertainty
into agency.

---

## 7. Voice Patterns — the modality of choice for the field

### 7.1 Press-and-hold, NOT tap-toggle

WhatsApp/Telegram/Signal pattern. Touch-down starts recording;
release ends it. (uxdesign.cc, GetStream blog.)

Why this matters for 3G workers: a tap-toggle leaves a "recording…"
state alive in the background that they might forget about,
silently uploading their conversation. Press-and-hold makes the
recording window unambiguous — when you let go, it stops.

### 7.2 Live waveform during recording

Render a real-time amplitude waveform across the bottom of the
screen during recording. Cheap to render — a sliding window of
~ 32 amplitude samples, each a vertical bar 4 px wide. Anthropic's
own Claude Code voice dictation does exactly this: "switches to a
live waveform once recording is active."

### 7.3 Inline transcription as the user speaks

Server-side STT streaming: send audio chunks every 250 ms, render
the partial transcript *in the composer field* as it arrives.
Anthropic's pattern again — they tune transcription for coding
vocabulary; we'd tune for mining (e.g., "tani" / "tonne", mineral
names, common owner roles).

### 7.4 Auto-send after 1.5 s silence (lock-mode only)

If the user has slide-locked the recording (slide up to lock,
WhatsApp pattern), 1.5 s of silence auto-sends. If they're still
holding, silence does *not* auto-send — they may be thinking.

### 7.5 Tap-anywhere-to-cancel

While recording, any tap outside the mic button = cancel. Plus the
WhatsApp slide-left-to-cancel gesture. Two cancel modalities
because mining workers wear gloves and accidental triggers are
real.

---

## 8. Tool-Call Card Patterns

Borjie's brain returns text + an array of tool calls (
`turn.toolCalls`). Each tool call gets a card.

### 8.1 Cards animate one-by-one (80 ms stagger)

NOT all-at-once. Stagger gives the user a moment to register each
card before the next. Per Trickle's chat-animation builder, the
80-200 ms range feels deliberate without being slow.

### 8.2 Each card: 100 ms shimmer → content

A 100 ms skeleton inside the card *before* the content materialises.
This is a "drum roll" — primes the user that something
content-rich is coming.

### 8.3 Touch interactions within the bubble

OpenAI Apps SDK guidelines:
- Cards have *at most two actions* (primary + secondary).
- No nested scroll.
- Tap-to-expand for detail.

For Borjie: a `KPICard` (attendance summary, today's tonnage)
expands inline on tap to show a 7-day sparkline. A `ListCard`
(today's incidents) deep-links to the full list screen on tap.

### 8.4 "Open in app" deep-link if card has more detail

When the card preview is only a summary, the footer has a small
"Fungua kamili →" link ("Open full →"). This routes to the
appropriate deep-screen in the role-gated stack.

---

## 9. Anti-Patterns — what NOT to do

| Anti-pattern | Why it's bad | Borjie current state |
|---|---|---|
| Full-screen spinner | Implies the whole app is frozen. | Not present. Good. |
| "Loading..." text without visual progress | Information-free; sentence dies the second the user reads it. | `buyer-mobile` uses `loadingText` next to spinner. Replace. |
| Disabling the composer while AI thinks | User cannot queue a follow-up, breaks conversational flow. | `workforce-mobile` disables `canSend` while pending. **Replace** — allow queueing. |
| Auto-scrolling when AI speaks | Interrupts user reading earlier turns. | `buyer-mobile` does `scrollToEnd` on each token. **Replace** — only auto-scroll if user is *already at the bottom*. |
| Premature keyboard dismiss | Adds a tap to send a follow-up. | Current code does not dismiss. Good. |
| Three-dot pulse for >2 s | Three-dot anxiety (Pavliscak / Feels Guide); user gets tense. | Transition pulse → streaming as soon as first token arrives. |
| Banner on error | Blocks conversation; feels catastrophic. | `workforce-mobile` uses `PreviewBanner` on error. **Replace** with bubble-attached dot. |

---

## 10. References (with one-liner each)

1. **[Doherty Threshold — Laws of UX](https://lawsofux.com/doherty-threshold/)** — the 400 ms productivity bound from IBM 1982. "Users found such applications addicting."
2. **[Nielsen — Response Time Limits](https://www.nngroup.com/articles/response-times-3-important-limits/)** — the 100 ms / 1 s / 10 s heuristic.
3. **[NN/G — Skeleton Screens 101](https://www.nngroup.com/articles/skeleton-screens/)** — guidance: <1 s no indicator, 2-10 s skeleton/spinner, >10 s progress bar.
4. **[Anita Demirci — Skeleton Loading Screens](https://medium.com/@anitademirci/skeleton-loading-screens-why-perception-is-reality-in-modern-ux-design-b7e09b316585)** — shimmer is most effective; <500 ms a skeleton is *distracting*.
5. **[Tian Pan — Streaming TTFT Latency Perception (2026)](https://tianpan.co/blog/2026-04-16-streaming-ttft-latency-perception)** — streaming masks perception of *subsequent* tokens but NOT TTFT itself.
6. **[CodeAnt — Why Faster First Tokens Matter](https://www.codeant.ai/blogs/ai-first-token-latency)** — TTFT thresholds for LLM chat; engagement drops 40 % past 3 s.
7. **[HashBlock — Streaming Tokens, Triple Speed](https://medium.com/@connect.hashblock/streaming-tokens-triple-speed-4704da5afb4d)** — n=50 beta: drop-off 22 % → 7 % with streaming; perceived speed 4/10 → 9/10.
8. **[arxiv 2504.17999 — Cognitive Load-Aware Streaming](https://arxiv.org/html/2504.17999v2)** — preferred stream rate is content-complexity dependent (21 wps simple → 12 wps complex).
9. **[OpenAI Apps SDK — UI Guidelines](https://developers.openai.com/apps-sdk/concepts/ui-guidelines)** — composer shimmer pattern, ≤2 actions per card, no nested scroll.
10. **[NN/G — UX Lessons from Perplexity](https://www.nngroup.com/articles/perplexity-henry-modisett/)** — "people want information as fast as possible and want to trust that information."
11. **[ustwo — Inflection AI / Pi case study](https://ustwo.com/work/inflection-ai/)** — strip UI conventions in favour of "intentional, emotional flow"; voice is the superpower.
12. **[Anthropic — Claude Voice Dictation docs](https://code.claude.com/docs/en/voice-dictation)** — live waveform during recording; push-to-talk in hold mode.
13. **[Pamela Pavliscak — Three-Dot Anxiety](https://medium.com/feels-guide/three-dot-anxiety-b1c9318ed27b)** — typing-dot anticipation elevates heart rate; keep loop short.
14. **[Filip Fajdetić — Optimistic UI](https://medium.com/distant-horizons/using-optimistic-ui-to-delight-your-users-ac819a81d59a)** — Twitter likes, Messages send bubbles: update immediately, reconcile after.
15. **[LogRocket — Doherty Threshold patterns](https://blog.logrocket.com/ux-design/designing-instant-feedback-doherty-threshold/)** — concrete patterns: skeleton + optimistic + microinteractions to stay under 400 ms.
16. **[Callstack — Performant shimmer in RN](https://www.callstack.com/blog/performant-and-cross-platform-shimmers-in-react-native-apps)** — shared `useSharedValue` for all shimmers; off-UI-thread via Reanimated.
17. **[GetStream — iOS Async Voice Messaging](https://getstream.io/blog/ios-async-voice-messaging/)** — press-and-hold mic; slide-to-cancel; slide-to-lock; waveform navigation.
18. **[DevelopersVoice — Offline-First Sync Patterns](https://developersvoice.com/blog/mobile/offline-first-sync-patterns/)** — outbox + stable UUID + "Syncing" pill, not banner.
19. **[Google Workspace — Smart Compose in Chat](https://workspaceupdates.googleblog.com/2023/06/smart-compose-google-chat.html)** — ghost-text inline predictions; swipe to accept.
20. **[Android Central — Smart Reply Tap-to-Draft](https://www.androidcentral.com/apps-software/google-messages-smart-reply-tap-to-draft)** — 2025 change: chip inserts text instead of sending, respecting user agency.

---

## 11. Concrete Proposal for Borjie

Two surfaces, mostly parallel changes, no new package imports
(everything below is achievable with `react-native`,
`react-native-reanimated` v3, and `expo-haptics` — all already in
the dependency graph).

### 11.1 `apps/workforce-mobile/src/chat/HomeChat.tsx`

#### a) Optimistic bubble with reveal animation

Today: `PendingTurnView` appears statically when `pendingUserText`
is set.

Change: wrap the user bubble in `Animated.View` with an
`useAnimatedStyle` that animates `translateY: 8 → 0` and
`opacity: 0 → 1` over **200 ms** with `Easing.out(Easing.cubic)`
on mount. Skeleton assistant bubble fades in **200 ms after** the
user bubble settles.

```ts
// pseudocode, do NOT apply yet
const userBubbleEnter = useSharedValue(0)
useEffect(() => {
  userBubbleEnter.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) })
}, [])
const userBubbleStyle = useAnimatedStyle(() => ({
  opacity: userBubbleEnter.value,
  transform: [{ translateY: (1 - userBubbleEnter.value) * 8 }]
}))
```

#### b) Skeleton assistant bubble (200 ms onset, single shared shimmer)

Replace the current `PendingTurnView`'s static `bubbleAssistantTextThinking`
italic text with an `Animated.View` rounded rect whose background
gradient shifts left→right over 1200 ms cycle (single
`useSharedValue` shared across all skeletons on screen, per
Callstack pattern).

Hold the skeleton for **minimum 200 ms** before allowing the
streaming text to replace it (NN/G — under 500 ms the skeleton
becomes distracting, so a brief floor avoids flicker on fast
turns).

#### c) Three-dot pulse only during 400 ms → 1 s gap

Add a small `[• • •]` pulse beneath the skeleton at 400 ms
post-send, animated with 600 ms cycle. Hide as soon as the first
streamed token lands. Maximum lifetime: 1.2 s.

#### d) Streaming text rendering

Currently `mutation.onSuccess` writes the full `responseText` in
one go. Replace `postBrainTurn` with the existing `streamChat.ts`
(already in the chat module — currently unused by HomeChat).

Stream tokens at **~15 wps** for Swahili. Use a `requestAnimationFrame`
loop on the local state buffer rather than a hard `setTimeout`.

#### e) Slow indicator at 3 s

Track `pendingSince` ms timestamp. At **3 s**: render an italic
sub-text below the skeleton.

**Copy:**
- sw: `"Borjie anafikiri kwa kina…"`
- en: `"Thinking more carefully…"`

At **10 s**, swap for the offline/5xx fallback chips.

#### f) Send button bounce + haptic

```ts
// On press:
sendBtnScale.value = withSequence(
  withTiming(0.95, { duration: 80 }),
  withSpring(1.05, { damping: 8, stiffness: 200 }),
  withSpring(1.0, { damping: 12, stiffness: 200 })
)
Haptics.selectionAsync()  // expo-haptics, already a transitive dep
```

#### g) Failure dot, not banner

Remove the `PreviewBanner kind="env-missing"` on `mutation.isError`.
Instead, attach a red 8 px dot to the **top-right of the user
bubble** when its associated mutation failed. Tap-to-retry.

#### h) Composer never disables during pending

Today: `canSend = draft.trim().length > 0 && !mutation.isPending`.

Change: `canSend = draft.trim().length > 0`. Allow queueing
follow-ups. Internally, queue the second mutation behind the first
(serialised — the thread ID must be set from the first response
before the second is sent).

#### i) Voice press-and-hold

Currently the voice button has no handler.

Add:
- `onLongPress` (300 ms threshold) starts recording
  (`expo-av` Audio.Recording — already in stack).
- Render an absolute-positioned waveform strip above the composer
  during recording: 32 vertical bars, animated amplitude.
- Release ends recording; transcribe via a new
  `streamChatTranscript` endpoint; pre-fill the TextInput; user
  taps Send.
- Slide-left (translateX < -50) cancels.
- Slide-up (translateY < -80) locks (the recording continues
  hands-free; tap mic again to stop).

### 11.2 `apps/buyer-mobile/src/chat/HomeChat.tsx`

The buyer chat is one step behind workforce in chat polish. Same
changes apply, with these specifics:

#### a) Remove the `ActivityIndicator`

The current `<View style={styles.pending}>` block uses a
permanent `ActivityIndicator` while `mutation.isPending`.
**Replace** with the skeleton-bubble + three-dot pattern from
§11.1.b/c.

#### b) Auto-scroll only when at-bottom

Today: `requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))`
fires on every success.

Change: track scroll position via `onScroll`; only call
`scrollToEnd` if the user is already within 80 px of the bottom.
Otherwise, show a floating "↓ majibu mapya" chip at the bottom of
the scroll view that taps to scroll.

#### c) Smart-reply chips above the keyboard

After each brain response, render 3 contextual chips above the
composer (between the ScrollView and the composer View). Derive
from `response.proposedAction` + `response.toolCalls[0].type` via
a small mapping table in `greeting.ts`.

#### d) Optimistic bubble reveal

Same Reanimated entry as §11.1.a.

#### e) Citations chip row

When `turn.toolCalls` contains evidence references, render a small
horizontal chip row at the bottom of the assistant bubble (NOT
the top — buyers want price/quality first, source second).

### 11.3 Specific timings (single table for engineering)

| Event | Workforce | Buyer | Source |
|---|---|---|---|
| Send button press scale | 80 ms | 80 ms | Doherty + microinteraction |
| User bubble enter | 200 ms ease-out | 200 ms ease-out | Optimistic UI |
| Skeleton bubble onset (post-send) | 200 ms | 200 ms | NN/G (avoid <500 ms distraction) |
| Skeleton minimum lifetime | 200 ms | 200 ms | Avoid flicker on fast turns |
| Three-dot pulse onset | 400 ms | 400 ms | Doherty crossing |
| Three-dot pulse cycle | 600 ms | 600 ms | iMessage convention |
| Three-dot maximum lifetime | 1.2 s | 1.2 s | Three-dot anxiety |
| Token stream rate (sw) | ~15 wps | ~15 wps | arxiv 2504.17999 |
| Token stream rate (code) | ~8 wps | ~8 wps | arxiv 2504.17999 |
| Tool-call card stagger | 80 ms | 80 ms | Trickle / Webflow |
| Tool-call card skeleton | 100 ms | 100 ms | Drum-roll micro-pause |
| Slow indicator onset | 3 s | 3 s | CodeAnt — engagement cliff |
| Fallback chip onset | 10 s | 10 s | Nielsen abandonment cliff |

### 11.4 Specific copy (sw + en)

| Context | Swahili (primary) | English |
|---|---|---|
| Skeleton sub-text @3 s | Borjie anafikiri kwa kina… | Thinking more carefully… |
| Offline outbox pill | Itasync ukirudi mtandaoni | Will sync when you're back online |
| 5xx fallback | Borjie ana shughuli sasa hivi. Jaribu tena. | Borjie is busy right now. Try again. |
| Retry chip | Jaribu tena | Try again |
| Rephrase chip | Uliza vingine | Ask differently |
| Support chip | Wasiliana na msaada | Contact support |
| Floating new-message indicator | ↓ Majibu mapya | ↓ New replies |
| Voice "hold to record" footer | Shikilia kuongea | Hold to speak |
| Voice "release to send" footer | Achia kutuma | Release to send |
| Voice "slide left to cancel" | Sogeza kushoto kufuta | Slide left to cancel |

### 11.5 What we are NOT doing in v1

- No new packages. Everything above lives within `react-native`,
  `react-native-reanimated`, `expo-haptics`, `expo-av`.
- No bidirectional voice (Gemini Live, OpenAI Realtime). Out of
  scope for 3G pilot; revisit when 5G coverage hits target
  districts.
- No predictive composer / Smart-Compose ghost text. Requires a
  `/brain/suggest` endpoint; ship in v2.
- No cognitive-load-adaptive stream rate. Fixed 15 wps for v1.
- No background sync worker beyond the AsyncStorage outbox we
  already plan. WorkManager/BGTaskScheduler is v2.

---

## 12. Validation plan

When the proposal above lands, validate against these targets:

| Metric | Target | How to measure |
|---|---|---|
| Optimistic bubble appears | < 100 ms post-press | Manual stopwatch + screen recording |
| Skeleton onset | 200 ± 30 ms post-press | Frame-by-frame screen recording |
| TTFT (perceived, via skeleton presence) | < 400 ms | Test with throttled 3G network |
| Drop-off rate (turns abandoned mid-stream) | < 10 % | PostHog event funnel |
| Voice transcript appears in composer | < 500 ms after each spoken phrase | Manual |
| Tool-card stagger spacing | 80 ± 10 ms between cards | Frame-by-frame |
| Offline → outbox → recovery | 100 % success on next online | Integration test |

---

## 13. Open questions

1. Do we want **adaptive streaming** (per arxiv 2504.17999) in v2,
   or fixed 15 wps forever? Cost: ~10 % compute savings, but adds
   complexity.
2. Should the smart-reply chips be **brain-generated** (each turn
   asks the brain "what 3 questions might the user ask next?") or
   **statically mapped** off `proposedAction` + tool-call type?
   Cost: brain-generated = extra round-trip; statically mapped =
   less personalised.
3. Voice transcription endpoint: do we proxy through api-gateway
   (RLS-clean, audit-logged, but +30 ms) or hit the STT provider
   directly from the device? Recommendation: gateway, always.
4. Three-dot pulse — do we want any cultural adjustment? Swahili-
   speaking users may not have the same "three-dot anxiety"
   association as Western iMessage users. Worth a 5-user pilot
   interview before locking the pattern.

---

**End of research doc.** No code changes have been applied. Ready
for engineering review.
