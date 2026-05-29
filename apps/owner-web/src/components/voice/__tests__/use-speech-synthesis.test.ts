/**
 * useSpeechSynthesis tests — CE-3.
 *
 * Stubs `window.speechSynthesis` + `SpeechSynthesisUtterance` so the
 * hook exercises its speak / cancel / locale-fallback logic without
 * touching the real Web Speech Synthesis API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechSynthesis } from '../use-speech-synthesis';

interface UtteranceStub {
  text: string;
  lang: string;
  voice: { name: string; lang: string; default: boolean } | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
}

let utterances: UtteranceStub[] = [];
let speakCalls = 0;
let cancelCalls = 0;
let voices: Array<{ name: string; lang: string; default: boolean }> = [];

beforeEach(() => {
  utterances = [];
  speakCalls = 0;
  cancelCalls = 0;
  voices = [
    { name: 'sw-tz-female', lang: 'sw-TZ', default: false },
    { name: 'en-us-male', lang: 'en-US', default: true },
  ];
  (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
    speak: (utt: UtteranceStub) => {
      speakCalls += 1;
      queueMicrotask(() => utt.onstart?.());
    },
    cancel: () => {
      cancelCalls += 1;
    },
    getVoices: () => voices,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
    function (this: UtteranceStub, text: string) {
      const u: UtteranceStub = {
        text,
        lang: '',
        voice: null,
        onstart: null,
        onend: null,
        onerror: null,
      };
      utterances.push(u);
      Object.assign(this, u);
      return u;
    } as unknown as typeof SpeechSynthesisUtterance;
});

afterEach(() => {
  delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  delete (window as unknown as { SpeechSynthesisUtterance?: unknown })
    .SpeechSynthesisUtterance;
});

describe('useSpeechSynthesis — speak', () => {
  it('speaks the supplied text with the requested locale', async () => {
    const { result } = renderHook(() => useSpeechSynthesis('sw-TZ'));
    await act(async () => {
      result.current.speak('Habari yako');
      await Promise.resolve();
    });
    expect(speakCalls).toBe(1);
    expect(utterances[0]!.lang).toBe('sw-TZ');
    expect(result.current.state.status).toBe('speaking');
    expect(result.current.state.currentText).toBe('Habari yako');
  });

  it('picks the exact-locale voice when available', async () => {
    const { result } = renderHook(() => useSpeechSynthesis('sw-TZ'));
    await act(async () => {
      result.current.speak('hi');
      await Promise.resolve();
    });
    expect(utterances[0]!.voice?.lang).toBe('sw-TZ');
  });

  it('falls back to the prefix-matched voice', async () => {
    voices = [{ name: 'sw-ke', lang: 'sw-KE', default: false }];
    const { result } = renderHook(() => useSpeechSynthesis('sw-TZ'));
    await act(async () => {
      result.current.speak('hi');
      await Promise.resolve();
    });
    expect(utterances[0]!.voice?.lang).toBe('sw-KE');
  });

  it('ignores empty / whitespace text', async () => {
    const { result } = renderHook(() => useSpeechSynthesis('en-TZ'));
    await act(async () => {
      result.current.speak('   ');
    });
    expect(speakCalls).toBe(0);
  });
});

describe('useSpeechSynthesis — cancel + barge-in', () => {
  it('cancel returns to idle and clears currentText', async () => {
    const { result } = renderHook(() => useSpeechSynthesis('sw-TZ'));
    await act(async () => {
      result.current.speak('hello');
      await Promise.resolve();
    });
    await act(async () => {
      result.current.cancel();
    });
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.currentText).toBe('');
  });

  it('speak barges in: cancels prior utterance before queuing a new one', async () => {
    const { result } = renderHook(() => useSpeechSynthesis('en-TZ'));
    await act(async () => {
      result.current.speak('first');
      await Promise.resolve();
    });
    await act(async () => {
      result.current.speak('second');
      await Promise.resolve();
    });
    expect(cancelCalls).toBe(2);
    expect(speakCalls).toBe(2);
  });
});

describe('useSpeechSynthesis — unsupported', () => {
  it('reports unsupported when speechSynthesis is missing', async () => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    delete (window as unknown as { SpeechSynthesisUtterance?: unknown })
      .SpeechSynthesisUtterance;
    const { result } = renderHook(() => useSpeechSynthesis('en-TZ'));
    expect(result.current.state.status).toBe('unsupported');
  });
});
