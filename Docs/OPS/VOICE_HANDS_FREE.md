# Voice Hands-Free Operator Runbook (CE-3)

**Status:** First-cut wired in `apps/owner-web/src/components/voice/`.
**Last updated:** 2026-05-29.
**Owners:** Owner-cockpit + workforce + buyer mobile crews.

This runbook describes how Mr. Mwikila's voice surfaces work, how to
verify them on each device, and how to triage common failures.

---

## 1. Surface map

| App | Voice STT (mic in) | Voice TTS (reply out) | Implementation |
|-----|---------------------|------------------------|-----------------|
| `apps/owner-web` | Web Speech API `SpeechRecognition` | `speechSynthesis` | `src/components/voice/` (this wave) |
| `apps/workforce-mobile` (Expo) | `expo-av` Recording for shift reports; `@react-native-voice/voice` planned | `expo-speech` planned | Voice recorder shipped (`src/media/useVoiceRecorder.ts`); chat STT/TTS deferred to a sibling RN voice wave |
| `apps/buyer-mobile` (Expo) | Same as workforce-mobile | Same as workforce-mobile | Deferred — buyer-mobile chat surface ships SSE-only today |

The owner-web wire is the canonical reference. Mobile parity follows
the same hook-and-button contract via `expo-speech` +
`@react-native-voice/voice` in a sibling RN voice wave (out of CE-3
scope to avoid clobbering the workforce-mobile expo wave).

---

## 2. Owner-web voice loop

The loop has four nodes:

```
Mic tap ── useSpeechRecognition (sw-TZ | en-TZ) ──▶ AskComposer fills
                                                       │
                                                       ▼
                                                 chat send to brain
                                                       │
                                                       ▼
                                          inline blocks render reply
                                                       │
                                                       ▼
                              VoicePlayButton tap → useSpeechSynthesis
```

Hooks: `useSpeechRecognition`, `useSpeechSynthesis`.
UI: `VoiceMicButton`, `VoicePlayButton`.
Both live in `apps/owner-web/src/components/voice/`.

### Wiring contract

```typescript
// In AskComposer (next wire — out of CE-3 ship):
<VoiceMicButton
  languagePreference={languagePreference}
  onTranscriptUpdate={(t) => setDraft(t)}
  onTranscriptFinal={(t) => onSubmit(t)}
/>

// Next to every Mr. Mwikila bubble:
<VoicePlayButton
  text={message.content}
  languagePreference={languagePreference}
/>
```

Wiring is intentionally deferred so the next wave (owner-cockpit
voice surface) can decide UX layout (footer vs. floating, bubble vs.
side-rail).

---

## 3. Browser support matrix (May 2026)

| Browser | STT | TTS | Notes |
|---------|-----|-----|-------|
| Chrome 130+ desktop | ✓ | ✓ | First-class; both APIs ship. sw-TZ + en-TZ voices ship on macOS / Windows. |
| Edge 130+ desktop | ✓ | ✓ | Same as Chrome. |
| Safari 17+ desktop | ✓ | ✓ | STT uses Apple's on-device model. sw-TZ falls back to sw-KE on Safari macOS — verified by test. |
| Firefox 130+ desktop | ✗ STT | ✓ TTS | `SpeechRecognition` unimplemented — the mic button auto-renders disabled with "Voice input not supported in this browser" tooltip. |
| Chrome Android 130+ | ✓ | ✓ | Same as desktop Chrome. |
| Safari iOS 17+ | ✓ | ✓ | Same as desktop Safari. |
| Workforce-mobile (Expo) | (different stack) | (different stack) | Uses `@react-native-voice/voice` + `expo-speech` — sibling wave. |

The hook (`useSpeechRecognition`) surfaces a stable
`status === 'unsupported'` state for Firefox + any older browsers;
`VoiceMicButton` renders disabled with a bilingual tooltip.

---

## 4. Local verification

### Owner-web (desktop)

1. `pnpm --filter @borjie/owner-web dev` → open `http://localhost:3010`.
2. Sign in as an owner persona.
3. Open the home chat surface.
4. Tap the mic button (rendered next to the Send button once the
   voice wire lands — for CE-3 the components ship without the
   AskComposer wire so you can mount them in a story / preview).
5. Grant the browser the mic permission prompt.
6. Speak — verify the interim transcript appears in the composer.
7. Stop — verify the full transcript posts to the brain.
8. After the brain replies, tap the speaker icon on the reply
   bubble — verify the voice plays at the right locale.

### Mobile (Expo)

Deferred until the RN voice wave ships
`@react-native-voice/voice` + `expo-speech` hooks mirroring the
web contract. Today the mic icon on `apps/workforce-mobile` only
captures audio for shift reports; chat input is text-only.

---

## 5. Common failures + triage

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Mic button greys out with "Voice input not supported" | Firefox / older Safari / Chrome <60 | Use Chrome / Edge / Safari ≥17. |
| `state.error === 'not-allowed'` | Owner denied mic permission | Re-grant via browser settings; reload page. |
| `state.error === 'no-speech'` | Silence detected | Re-tap mic; speak louder; check OS-level mic gain. |
| `state.error === 'audio-capture'` | Mic in use by another app / unavailable | Close Zoom / Teams / OBS; restart browser. |
| `state.error === 'network'` | Browser STT uses cloud (Chrome) and is offline | Switch to a Safari install (on-device STT) or wait for network. |
| TTS plays in the wrong accent (sw-KE instead of sw-TZ) | Platform has no sw-TZ voice installed | Acceptable fallback; document in user guide. Install OS-level sw-TZ voice for exact match (macOS: Settings → Accessibility → Spoken Content → System Voice; Windows: Settings → Time & Language → Speech). |
| Reply stops mid-sentence when owner taps mic again | Expected — barge-in cancels TTS so the recogniser can hear cleanly | None. |

---

## 6. Privacy + redaction

- Web Speech API STT in Chrome sends audio to Google Cloud; in
  Safari it runs on-device. Document this in the owner-facing
  privacy disclosure (`Docs/COMPLIANCE/privacy-notice.md`).
- TTS runs entirely on-device — no upstream beyond the OS-level
  voice catalog.
- The voice loop never transmits raw audio to Borjie servers; only
  the final text transcript hits the chat send endpoint. The same
  redaction pipeline that runs on text input (pino-redact in api-
  gateway) applies.
- For high-stakes chats (kill_switch / four_eye / sovereign), the
  policy gate still requires a two-tap on-screen confirmation —
  voice can initiate but never bypass the visual confirmation card
  (CE-4 invariant).

---

## 7. Confirmation gates in voice mode

Per `services/api-gateway/src/services/orchestration/risk-tiers.ts`:

| Tier | Voice-initiated behaviour |
|------|---------------------------|
| `low` | Tool fires; reply plays via TTS. |
| `medium` | `<preview>` inline block renders; voice TTS reads "Tap to confirm" in the owner's language; owner must visually tap the confirm chip. |
| `high` | `<confirmation_card>` inline block renders; TTS reads "Two taps required" warning; owner must visually two-tap to fire. NO voice-only confirmation path exists. |

This invariant lives in the brain's prompt — every voice-initiated
mutation tour eventually requires an on-screen tap. The TTS makes
the gate audible, but the gate itself is visual.

---

## 8. Future hardening (post-CE-3)

- Wire `VoiceMicButton` into `AskComposer`.
- Wire `VoicePlayButton` into the assistant bubble.
- Ship `@react-native-voice/voice` + `expo-speech` parity for
  workforce-mobile + buyer-mobile (sibling RN voice wave).
- Add a wake-word ("Hi Borjie" / "Habari Borjie") via Picovoice
  Porcupine for true hands-free without a tap (post-MVP).
- Stream TTS as the brain streams the reply (Web Audio API +
  ReadableStream pipeline) — reduces perceived latency.
- A11y: announce STT errors via the global toast surface, not just
  the screen-reader-only span.
