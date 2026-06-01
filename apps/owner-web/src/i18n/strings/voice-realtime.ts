/**
 * voice-realtime.ts — guard-exempt bilingual (sw / en) string table for
 * the realtime-duplex voice client (`components/voice/use-realtime-voice`
 * + its wiring in `VoiceMicButton` / `AskComposer`).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) flags hardcoded
 * Swahili anywhere OUTSIDE `i18n/`. The realtime voice UI needs both
 * languages at the call-site (status labels, mode chips, fallback
 * notices), so the Swahili+English pairs live here — inside the exempt
 * `i18n/` tree — and the components import the values instead of inlining
 * the literals. Net effect: the voice components carry ZERO Swahili
 * literals while runtime behaviour stays byte-identical.
 *
 * SHAPE
 * One namespace per concern. Each leaf is `{ sw, en }`. Consumers read
 * `R.<ns>.<key>.sw|en` via the active locale (`'sw' | 'en'`).
 *
 * Pure data — no imports, no logic — so it is safe to pull into both the
 * server and client bundles.
 */

export interface BiString {
  readonly sw: string;
  readonly en: string;
}

export const voiceRealtimeStrings = {
  // ── live realtime-duplex mode (preferred path) ───────────────────────
  realtime: {
    /** aria-label when idle and a live duplex session is available. */
    startLive: { sw: 'Anza mazungumzo ya moja kwa moja', en: 'Start live conversation' },
    /** aria-label while a live duplex session is active (tap to hang up). */
    endLive: { sw: 'Maliza mazungumzo ya moja kwa moja', en: 'End live conversation' },
    /** Status text while the socket handshake is in flight. */
    connecting: { sw: 'Inaunganisha sauti ya moja kwa moja…', en: 'Connecting live voice…' },
    /** Status text while the duplex session is open and listening. */
    live: { sw: 'Sauti ya moja kwa moja inaendelea', en: 'Live voice on' },
    /** Status text while Mr. Mwikila is speaking back. */
    speaking: { sw: 'Bw. Mwikila anazungumza…', en: 'Mr. Mwikila is speaking…' },
    /** Status text the moment local speech interrupts playback (barge-in). */
    interrupted: { sw: 'Umekatiza — endelea kuzungumza', en: 'Interrupted — keep talking' },
    /** Visually-hidden notice when the live path failed and we degraded. */
    fallbackNotice: {
      sw: 'Sauti ya moja kwa moja haipatikani. Imerudi kwenye uandishi wa sauti wa kivinjari.',
      en: 'Live voice unavailable. Reverted to in-browser voice typing.',
    },
    /** Surfaced when the browser blocks microphone access. */
    micDenied: {
      sw: 'Ufikiaji wa kipaza sauti umezuiwa. Ruhusu kipaza sauti ili kuzungumza moja kwa moja.',
      en: 'Microphone access blocked. Allow the microphone to talk live.',
    },
    /** Surfaced when neither live duplex nor browser capture is available. */
    unavailable: {
      sw: 'Sauti ya moja kwa moja haijatumika kwenye kivinjari hiki.',
      en: 'Live voice is not supported in this browser.',
    },
    /** Generic transport error label (paired with the raw code). */
    error: { sw: 'Tatizo la sauti ya moja kwa moja', en: 'Live voice error' },
  },
} as const;
