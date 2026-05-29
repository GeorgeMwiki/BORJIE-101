'use client';

/**
 * useSpeechRecognition — CE-3 hands-free voice STT hook.
 *
 * Wraps the browser's Web Speech API (`SpeechRecognition` /
 * `webkitSpeechRecognition`) with a deterministic state machine
 * the chat composer can drive.
 *
 * Supports the two Borjie owner languages — Swahili (sw-TZ) and
 * English (en-TZ). Hard-codes the Tanzanian locale tags per
 * CLAUDE.md hard rule: "Swahili-first. Default user language is sw.
 * Switch on request." Locale tags drive both recognition accuracy
 * and the matched TTS voice catalog selection.
 *
 * Frontier reference: `Docs/research/CHAT_HANDLES_EVERYTHING_SOTA_
 * 2026-05-29.md` §3 — hands-free voice → agent loop is greenfield
 * (no SOTA vendor ships an integrated surface). This hook is the
 * Borjie analogue.
 *
 * Discipline:
 *   - Immutable state object (`coding-style.md` immutability rule).
 *   - <50 lines per function; nesting <4.
 *   - Caller controls language; we never assume.
 *   - All errors surface via `state.error`; no silent swallows.
 *   - No console.log — failures propagate to UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type SpeechLang = 'sw-TZ' | 'en-TZ';

export type RecognitionStatus =
  | 'unsupported'
  | 'idle'
  | 'requesting'
  | 'listening'
  | 'stopped'
  | 'error';

export interface SpeechRecognitionState {
  readonly status: RecognitionStatus;
  /** Final transcript accumulated so far (no interim text). */
  readonly transcript: string;
  /** Interim text since the last final segment. Re-renders on the fly. */
  readonly interim: string;
  /** Last error code from the Web Speech API. */
  readonly error: string | null;
}

const INITIAL_STATE: SpeechRecognitionState = Object.freeze({
  status: typeof window === 'undefined' ? 'unsupported' : 'idle',
  transcript: '',
  interim: '',
  error: null,
});

export interface UseSpeechRecognitionResult {
  readonly state: SpeechRecognitionState;
  /** Start a new recognition session. Resets transcript. */
  readonly start: () => void;
  /** Stop the current session; the transcript is preserved. */
  readonly stop: () => void;
  /** Manually clear the accumulated transcript without stopping. */
  readonly reset: () => void;
}

type WebSpeechCtor = new () => SpeechRecognition;

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
  resultIndex: number;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

function pickConstructor(): WebSpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: WebSpeechCtor;
    webkitSpeechRecognition?: WebSpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition(
  lang: SpeechLang,
): UseSpeechRecognitionResult {
  const [state, setState] = useState<SpeechRecognitionState>(INITIAL_STATE);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Re-evaluate support on mount in case the hook is rendered SSR-first.
  useEffect(() => {
    const Ctor = pickConstructor();
    setState((prev) => ({
      ...prev,
      status: Ctor ? 'idle' : 'unsupported',
    }));
  }, []);

  const stop = useCallback((): void => {
    const r = recognitionRef.current;
    if (!r) return;
    try {
      r.stop();
    } catch {
      // Stop on already-stopped recogniser throws InvalidStateError;
      // safe to ignore — we will land in `stopped` either way.
    }
  }, []);

  const reset = useCallback((): void => {
    setState((prev) => ({
      ...prev,
      transcript: '',
      interim: '',
      error: null,
    }));
  }, []);

  const start = useCallback((): void => {
    const Ctor = pickConstructor();
    if (!Ctor) {
      setState({
        status: 'unsupported',
        transcript: '',
        interim: '',
        error: 'web_speech_api_unavailable',
      });
      return;
    }
    // Discard any prior session.
    const prior = recognitionRef.current;
    if (prior) {
      try {
        prior.abort();
      } catch {
        /* noop */
      }
    }
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang;
    r.onstart = () => {
      setState({
        status: 'listening',
        transcript: '',
        interim: '',
        error: null,
      });
    };
    r.onresult = (ev) => {
      let final = '';
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const result = ev.results[i]!;
        const text = result[0].transcript;
        if (result.isFinal) final += text;
        else interim += text;
      }
      setState((prev) => ({
        ...prev,
        status: 'listening',
        transcript: prev.transcript + final,
        interim,
        error: null,
      }));
    };
    r.onerror = (ev) => {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: ev.error,
      }));
    };
    r.onend = () => {
      setState((prev) =>
        prev.status === 'error'
          ? prev
          : { ...prev, status: 'stopped', interim: '' },
      );
    };
    recognitionRef.current = r;
    setState((prev) => ({ ...prev, status: 'requesting' }));
    try {
      r.start();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'start_failed';
      setState({
        status: 'error',
        transcript: '',
        interim: '',
        error: message,
      });
    }
  }, [lang]);

  useEffect(() => {
    return () => {
      const r = recognitionRef.current;
      if (r) {
        try {
          r.abort();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  return { state, start, stop, reset };
}
