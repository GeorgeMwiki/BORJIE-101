'use client';

/**
 * VoiceMicButton — CE-3 hands-free chat composer mic.
 *
 * Single visible control the owner taps to talk to Mr. Mwikila. It runs
 * TWO voice surfaces behind one button and picks the best available:
 *
 *   1. PREFERRED — realtime duplex against the gateway voice WS
 *      (`useRealtimeVoice`). Opens a live "call": mic PCM streams up, model
 *      audio plays back, barge-in interrupts. The live ASR transcript is
 *      mirrored into the composer and the final reply text is handed back.
 *
 *   2. FALLBACK — the original browser Web-Speech STT (`BrowserMic`,
 *      wrapping `useSpeechRecognition`). Used automatically whenever the
 *      realtime path is unsupported, fails its handshake, errors, or the
 *      mic is denied. The browser path is NEVER removed.
 *
 * The realtime endpoint is not live in this environment, so on any failure
 * `useRealtimeVoice` reports `status: 'fallback'`, and this component
 * transparently renders the browser mic instead — no dead button, ever.
 *
 * `preferRealtime={false}` forces the browser path (e.g. for tests or
 * surfaces that opt out of the live call). Locale drives both surfaces
 * (en→en-TZ, sw→sw-TZ).
 *
 * Bilingual labels per CLAUDE.md hard rule; all copy is imported from the
 * guard-exempt i18n string tables (zero Swahili literals here).
 */

import { useCallback, useEffect } from 'react';
import { BrowserMic } from './BrowserMic';
import { RealtimeMic } from './RealtimeMic';
import { useRealtimeVoice } from './use-realtime-voice';
import { getBrainAccessToken } from '@/lib/brain-api';

export interface VoiceMicButtonProps {
  readonly languagePreference: 'sw' | 'en';
  readonly disabled?: boolean;
  /**
   * Prefer the realtime-duplex gateway path when it can connect. Defaults
   * to true; set false to pin the browser Web-Speech fallback.
   */
  readonly preferRealtime?: boolean;
  /**
   * Fires when the active surface produces a non-empty interim/final
   * segment (browser STT) or a live ASR transcript (realtime). Callers
   * use it to mirror what is being captured into the composer textarea.
   */
  readonly onTranscriptUpdate?: (text: string) => void;
  /**
   * Fires once with the full final transcript when the owner stops a
   * browser-STT dictation. Treated by the caller as "submit this message".
   * (In realtime mode the brain answers over the audio channel, so this
   * fires only on the browser fallback path.)
   */
  readonly onTranscriptFinal: (transcript: string) => void;
  /**
   * Optional: fires with the assistant's final reply TEXT for a realtime
   * turn, so a transcript surface can render it alongside the spoken audio.
   */
  readonly onVoiceReply?: (text: string) => void;
}

/** Resolve the Supabase token for the WS handshake (null when signed out). */
async function resolveToken(): Promise<string | null> {
  return getBrainAccessToken();
}

export function VoiceMicButton({
  languagePreference,
  disabled,
  preferRealtime = true,
  onTranscriptUpdate,
  onTranscriptFinal,
  onVoiceReply,
}: VoiceMicButtonProps) {
  const realtime = useRealtimeVoice({
    locale: languagePreference,
    getToken: resolveToken,
  });

  // Mirror the live ASR transcript into the composer while the call runs.
  useEffect(() => {
    if (!realtime.isLive || !onTranscriptUpdate) return;
    if (realtime.state.transcript.length > 0) {
      onTranscriptUpdate(realtime.state.transcript);
    }
  }, [realtime.isLive, realtime.state.transcript, onTranscriptUpdate]);

  // Surface the final spoken reply text to any listening transcript view.
  useEffect(() => {
    if (!onVoiceReply) return;
    const reply = realtime.state.lastReply.trim();
    if (reply.length > 0) onVoiceReply(reply);
  }, [realtime.state.lastReply, onVoiceReply]);

  const onToggleRealtime = useCallback((): void => {
    if (realtime.isLive || realtime.state.status === 'connecting') {
      realtime.disconnect();
      return;
    }
    realtime.connect();
  }, [realtime]);

  // The realtime path has decided it cannot run here — degrade to browser.
  const degraded =
    realtime.state.status === 'fallback' ||
    realtime.state.status === 'unsupported' ||
    realtime.state.status === 'error';

  if (!preferRealtime || degraded) {
    return (
      <BrowserMic
        languagePreference={languagePreference}
        showFallbackNotice={degraded && preferRealtime}
        onTranscriptFinal={onTranscriptFinal}
        {...(disabled !== undefined ? { disabled } : {})}
        {...(onTranscriptUpdate ? { onTranscriptUpdate } : {})}
      />
    );
  }

  return (
    <RealtimeMic
      languagePreference={languagePreference}
      status={realtime.state.status}
      onToggle={onToggleRealtime}
      {...(disabled !== undefined ? { disabled } : {})}
    />
  );
}
