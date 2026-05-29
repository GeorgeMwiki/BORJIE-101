'use client';

/**
 * useSpeechSynthesis — CE-3 hands-free voice TTS hook.
 *
 * Wraps the browser's `SpeechSynthesisUtterance` + `speechSynthesis`
 * for playing Mr. Mwikila replies aloud. Companion to
 * `useSpeechRecognition` — together they form the voice loop
 * documented in `Docs/research/CHAT_HANDLES_EVERYTHING_SOTA_
 * 2026-05-29.md` §4.2.
 *
 * Locale handling: caller passes `lang` (sw-TZ / en-TZ); we pick
 * the best-matching voice from `speechSynthesis.getVoices()`. When
 * no voice matches the exact locale we fall back to the language
 * tag prefix (sw / en) and then to the platform default.
 *
 * Discipline:
 *   - Immutable state object.
 *   - Speak / cancel only — no queuing API; caller handles barge-in.
 *   - No console.log — failures surface via state.error.
 *   - Cleans up on unmount to silence in-flight utterances.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechLang } from './use-speech-recognition';

export type TtsStatus = 'unsupported' | 'idle' | 'speaking' | 'error';

export interface SpeechSynthesisState {
  readonly status: TtsStatus;
  readonly currentText: string;
  readonly error: string | null;
}

const INITIAL_STATE: SpeechSynthesisState = Object.freeze({
  status: typeof window === 'undefined' ? 'unsupported' : 'idle',
  currentText: '',
  error: null,
});

export interface UseSpeechSynthesisResult {
  readonly state: SpeechSynthesisState;
  readonly speak: (text: string) => void;
  readonly cancel: () => void;
}

function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.speechSynthesis !== 'undefined' &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  );
}

function pickVoice(
  lang: SpeechLang,
  voices: ReadonlyArray<SpeechSynthesisVoice>,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const exact = voices.find((v) => v.lang === lang);
  if (exact) return exact;
  const prefix = lang.split('-')[0]!;
  const prefixMatch = voices.find((v) => v.lang.startsWith(prefix));
  if (prefixMatch) return prefixMatch;
  // Fall back to whichever default voice exists.
  return voices.find((v) => v.default) ?? voices[0]!;
}

export function useSpeechSynthesis(
  lang: SpeechLang,
): UseSpeechSynthesisResult {
  const [state, setState] = useState<SpeechSynthesisState>(INITIAL_STATE);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voicesRef = useRef<ReadonlyArray<SpeechSynthesisVoice>>([]);

  useEffect(() => {
    if (!isSupported()) {
      setState({
        status: 'unsupported',
        currentText: '',
        error: 'speech_synthesis_unavailable',
      });
      return;
    }
    // Capture the API reference at mount time so the cleanup closure
    // is safe even if the test harness (or a future page transition)
    // wipes `window.speechSynthesis` between mount and unmount.
    const synth = window.speechSynthesis;
    setState((prev) =>
      prev.status === 'unsupported' ? prev : { ...prev, status: 'idle' },
    );
    const load = (): void => {
      try {
        voicesRef.current = synth.getVoices();
      } catch {
        voicesRef.current = [];
      }
    };
    load();
    synth.addEventListener?.('voiceschanged', load);
    return () => {
      try {
        synth.removeEventListener?.('voiceschanged', load);
        synth.cancel();
      } catch {
        /* harness teardown — synth no longer addressable */
      }
    };
  }, []);

  const cancel = useCallback((): void => {
    if (!isSupported()) return;
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setState((prev) => ({ ...prev, status: 'idle', currentText: '' }));
  }, []);

  const speak = useCallback(
    (text: string): void => {
      if (!isSupported()) {
        setState({
          status: 'unsupported',
          currentText: '',
          error: 'speech_synthesis_unavailable',
        });
        return;
      }
      if (text.trim().length === 0) return;
      // Barge-in: cancel any prior utterance.
      window.speechSynthesis.cancel();
      const utt = new window.SpeechSynthesisUtterance(text);
      utt.lang = lang;
      const voice = pickVoice(lang, voicesRef.current);
      if (voice) utt.voice = voice;
      utt.onstart = () => {
        setState({ status: 'speaking', currentText: text, error: null });
      };
      utt.onend = () => {
        setState({ status: 'idle', currentText: '', error: null });
        utteranceRef.current = null;
      };
      utt.onerror = (ev) => {
        setState({
          status: 'error',
          currentText: text,
          error: (ev as SpeechSynthesisErrorEvent).error ?? 'tts_error',
        });
      };
      utteranceRef.current = utt;
      try {
        window.speechSynthesis.speak(utt);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'speak_failed';
        setState({ status: 'error', currentText: text, error: message });
      }
    },
    [lang],
  );

  return { state, speak, cancel };
}
