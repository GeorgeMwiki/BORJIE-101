'use client';

/**
 * BrowserMic — the browser Web-Speech STT fallback surface.
 *
 * This is the ORIGINAL VoiceMicButton behaviour, extracted verbatim so it
 * remains the always-available fallback when the realtime-duplex path is
 * unavailable. It toggles between idle / listening states and emits the
 * final transcript via `onTranscriptFinal` when the owner taps stop or the
 * recogniser auto-stops on extended silence.
 *
 * Locale-aware: the caller passes `languagePreference` so the hook
 * recognises Swahili-TZ vs English-TZ accents accurately.
 *
 * Accessibility:
 *   - Visually-hidden status text for screen readers.
 *   - aria-live region announces start/stop + any fallback notice.
 *   - Keyboard-accessible (native button).
 *
 * All copy is imported from the guard-exempt i18n string tables.
 */

import { Mic, MicOff } from 'lucide-react';
import { useEffect } from 'react';
import {
  useSpeechRecognition,
  type SpeechLang,
} from './use-speech-recognition';
import { tailStrings as S } from '@/i18n/strings/tail';
import { voiceRealtimeStrings as R } from '@/i18n/strings/voice-realtime';

export interface BrowserMicProps {
  readonly languagePreference: 'sw' | 'en';
  readonly disabled?: boolean;
  /** When true, announce that we degraded from the live path to browser STT. */
  readonly showFallbackNotice?: boolean;
  readonly onTranscriptUpdate?: (text: string) => void;
  readonly onTranscriptFinal: (transcript: string) => void;
}

function toLocale(pref: 'sw' | 'en'): SpeechLang {
  return pref === 'sw' ? 'sw-TZ' : 'en-TZ';
}

const M = S.voiceMicButton;

const LABELS = {
  sw: {
    start: M.start.sw,
    stop: M.stop.sw,
    listening: M.listening.sw,
    unsupported: M.unsupported.sw,
    error: M.error.sw,
    fallbackNotice: R.realtime.fallbackNotice.sw,
  },
  en: {
    start: M.start.en,
    stop: M.stop.en,
    listening: M.listening.en,
    unsupported: M.unsupported.en,
    error: M.error.en,
    fallbackNotice: R.realtime.fallbackNotice.en,
  },
} as const;

export function BrowserMic({
  languagePreference,
  disabled,
  showFallbackNotice,
  onTranscriptUpdate,
  onTranscriptFinal,
}: BrowserMicProps) {
  const labels = LABELS[languagePreference];
  const { state, start, stop } = useSpeechRecognition(toLocale(languagePreference));

  // Live-update the composer with combined transcript + interim.
  useEffect(() => {
    if (!onTranscriptUpdate) return;
    const merged = state.transcript + state.interim;
    if (merged.length > 0) onTranscriptUpdate(merged);
  }, [state.transcript, state.interim, onTranscriptUpdate]);

  // Final hand-off when the recogniser stops with content.
  useEffect(() => {
    if (state.status !== 'stopped') return;
    const finalText = state.transcript.trim();
    if (finalText.length === 0) return;
    onTranscriptFinal(finalText);
  }, [state.status, state.transcript, onTranscriptFinal]);

  const handleClick = (): void => {
    if (state.status === 'listening' || state.status === 'requesting') {
      stop();
      return;
    }
    start();
  };

  if (state.status === 'unsupported') {
    return (
      <button
        type="button"
        aria-label={labels.unsupported}
        disabled
        title={labels.unsupported}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface/40 text-neutral-400"
      >
        <MicOff className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  const isActive = state.status === 'listening' || state.status === 'requesting';
  const ariaLabel = isActive ? labels.stop : labels.start;
  const Icon = isActive ? MicOff : Mic;
  const tone = isActive
    ? 'border-destructive/40 bg-destructive/10 text-destructive animate-pulse'
    : 'border-border bg-surface/40 text-foreground hover:bg-surface';
  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-pressed={isActive}
        data-testid="voice-mic-button"
        className={`inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {isActive ? labels.listening : ''}
        {showFallbackNotice ? ` ${labels.fallbackNotice}` : ''}
        {state.error ? ` ${labels.error}` : ''}
      </span>
    </>
  );
}
