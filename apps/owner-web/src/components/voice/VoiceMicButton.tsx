'use client';

/**
 * VoiceMicButton — CE-3 hands-free chat composer mic.
 *
 * Single visible button the owner taps to start hands-free chat
 * input. Toggles between idle / listening states; emits the final
 * transcript via `onTranscriptFinal` when the user taps stop or the
 * recogniser auto-stops on extended silence.
 *
 * Locale-aware: caller passes `languagePreference` so the hook
 * recognises Swahili-TZ vs English-TZ accents accurately.
 *
 * Accessibility:
 *   - Visually-hidden status text for screen readers.
 *   - aria-live region announces start/stop.
 *   - Keyboard-accessible (button native).
 *
 * Bilingual labels per CLAUDE.md hard rule.
 */

import { Mic, MicOff } from 'lucide-react';
import { useEffect } from 'react';
import {
  useSpeechRecognition,
  type SpeechLang,
} from './use-speech-recognition';

export interface VoiceMicButtonProps {
  readonly languagePreference: 'sw' | 'en';
  readonly disabled?: boolean;
  /**
   * Fires when the recogniser produces a non-empty interim or final
   * segment. Caller may use this to live-update the composer
   * textarea (so the owner sees what's being captured).
   */
  readonly onTranscriptUpdate?: (text: string) => void;
  /**
   * Fires once when the owner taps stop OR the recogniser auto-stops.
   * The supplied `transcript` is the full final accumulated text.
   * Caller should treat this as "submit the message" hand-off.
   */
  readonly onTranscriptFinal: (transcript: string) => void;
}

function toLocale(pref: 'sw' | 'en'): SpeechLang {
  return pref === 'sw' ? 'sw-TZ' : 'en-TZ';
}

const LABELS = {
  sw: {
    start: 'Anza kusikiliza',
    stop: 'Acha kusikiliza',
    listening: 'Inasikiliza…',
    unsupported: 'Sauti haijatumika kwenye kivinjari hiki.',
    error: 'Tatizo la sauti',
  },
  en: {
    start: 'Start listening',
    stop: 'Stop listening',
    listening: 'Listening…',
    unsupported: 'Voice input not supported in this browser.',
    error: 'Voice error',
  },
} as const;

export function VoiceMicButton({
  languagePreference,
  disabled,
  onTranscriptUpdate,
  onTranscriptFinal,
}: VoiceMicButtonProps) {
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
        {state.error ? ` ${labels.error}: ${state.error}` : ''}
      </span>
    </>
  );
}
