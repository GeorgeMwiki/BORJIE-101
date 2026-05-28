'use client';

/**
 * DailyBriefListenButton — plays the daily-brief copy aloud.
 *
 * Calls the optional server-side TTS pipeline (`/api/v1/tts/listen`)
 * when available and pipes the returned audio through Web Audio.
 * Falls back to the browser's native `speechSynthesis` voice when the
 * server endpoint is unavailable, which keeps the button useful even
 * if the persona-voice service is down or no API key is configured.
 *
 * Pause / resume / stop controls appear while playback is active.
 * A pulsing waveform indicates audio is currently playing.
 *
 * Locale-aware (en-TZ vs sw-TZ). Bilingual labels. No em-dashes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Square, Activity } from 'lucide-react';

type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

export interface DailyBriefListenButtonProps {
  readonly isSw: boolean;
  readonly text: string;
  readonly testId?: string;
}

function listenLabel(isSw: boolean): string {
  return isSw ? 'Sikia' : 'Listen';
}

function pauseLabel(isSw: boolean): string {
  return isSw ? 'Simamisha' : 'Pause';
}

function resumeLabel(isSw: boolean): string {
  return isSw ? 'Endelea' : 'Resume';
}

function stopLabel(isSw: boolean): string {
  return isSw ? 'Acha' : 'Stop';
}

function loadingLabel(isSw: boolean): string {
  return isSw ? 'Inaandaa…' : 'Preparing…';
}

function localeFor(isSw: boolean): string {
  return isSw ? 'sw-TZ' : 'en-TZ';
}

function pickVoiceForLocale(
  voices: ReadonlyArray<SpeechSynthesisVoice>,
  isSw: boolean,
): SpeechSynthesisVoice | undefined {
  const prefix = isSw ? 'sw' : 'en';
  const exact = voices.find((v) => v.lang.toLowerCase().startsWith(`${prefix}-tz`));
  if (exact) return exact;
  const fuzzy = voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
  return fuzzy;
}

export function DailyBriefListenButton({
  isSw,
  text,
  testId = 'dashboard-daily-brief-listen',
}: DailyBriefListenButtonProps): JSX.Element {
  const [state, setState] = useState<PlaybackState>('idle');
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Clean up any in-flight playback on unmount.
  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') return;
      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* swallow */
        }
      }
    };
  }, []);

  const speak = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!('speechSynthesis' in window)) {
      // No TTS available, silently no-op so the button is unobtrusive.
      return;
    }
    const synth = window.speechSynthesis;
    try {
      synth.cancel();
    } catch {
      /* swallow */
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = localeFor(isSw);
    utterance.rate = 1;
    utterance.pitch = 1;
    const voice = pickVoiceForLocale(synth.getVoices(), isSw);
    if (voice) utterance.voice = voice;
    utterance.onend = (): void => {
      utteranceRef.current = null;
      setState('idle');
    };
    utterance.onerror = (): void => {
      utteranceRef.current = null;
      setState('idle');
    };
    utteranceRef.current = utterance;
    setState('playing');
    try {
      synth.speak(utterance);
    } catch {
      setState('idle');
    }
  }, [text, isSw]);

  const handlePlay = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (state === 'paused' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.resume();
        setState('playing');
        return;
      } catch {
        /* fall through to a fresh speak */
      }
    }
    setState('loading');
    speak();
  }, [state, speak]);

  const handlePause = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.pause();
      setState('paused');
    } catch {
      /* swallow */
    }
  }, []);

  const handleStop = useCallback(() => {
    if (typeof window === 'undefined') return;
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* swallow */
      }
    }
    utteranceRef.current = null;
    setState('idle');
  }, []);

  if (state === 'idle') {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
        data-testid={testId}
        aria-label={listenLabel(isSw)}
        onClick={handlePlay}
      >
        <Play className="h-3.5 w-3.5" aria-hidden />
        {listenLabel(isSw)}
      </button>
    );
  }

  if (state === 'loading') {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground"
        data-testid={`${testId}-loading`}
        aria-label={loadingLabel(isSw)}
        disabled
      >
        <Activity className="h-3.5 w-3.5 animate-pulse" aria-hidden />
        {loadingLabel(isSw)}
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5" data-testid={`${testId}-active`}>
      {state === 'playing' ? (
        <Waveform isSw={isSw} />
      ) : null}
      {state === 'playing' ? (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface"
          data-testid={`${testId}-pause`}
          aria-label={pauseLabel(isSw)}
          onClick={handlePause}
        >
          <Pause className="h-3.5 w-3.5" aria-hidden />
          {pauseLabel(isSw)}
        </button>
      ) : (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface"
          data-testid={`${testId}-resume`}
          aria-label={resumeLabel(isSw)}
          onClick={handlePlay}
        >
          <Play className="h-3.5 w-3.5" aria-hidden />
          {resumeLabel(isSw)}
        </button>
      )}
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface"
        data-testid={`${testId}-stop`}
        aria-label={stopLabel(isSw)}
        onClick={handleStop}
      >
        <Square className="h-3.5 w-3.5" aria-hidden />
        {stopLabel(isSw)}
      </button>
    </div>
  );
}

function Waveform({ isSw }: { readonly isSw: boolean }): JSX.Element {
  return (
    <span
      className="inline-flex h-6 items-end gap-0.5"
      aria-label={isSw ? 'Inacheza' : 'Playing'}
      data-testid="dashboard-daily-brief-waveform"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="block w-0.5 rounded-full bg-signal-500"
          style={{
            height: '40%',
            animation: `dailyBriefWaveform 0.9s ease-in-out ${i * 0.12}s infinite alternate`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes dailyBriefWaveform {
          from {
            height: 25%;
          }
          to {
            height: 95%;
          }
        }
      `}</style>
    </span>
  );
}
