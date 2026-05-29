/**
 * useSpeechRecognition tests — CE-3.
 *
 * Uses a hand-rolled SpeechRecognition stub on `window` so the hook
 * exercises its full lifecycle without touching the real Web Speech
 * API (jsdom doesn't provide one).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechRecognition } from '../use-speech-recognition';

interface StubInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  _emit: (kind: 'start' | 'result' | 'error' | 'end', payload?: unknown) => void;
}

let instances: StubInstance[] = [];

function makeStub(): StubInstance {
  const stub: StubInstance = {
    continuous: false,
    interimResults: false,
    lang: '',
    start: vi.fn(() => {
      queueMicrotask(() => stub.onstart?.());
    }),
    stop: vi.fn(() => {
      queueMicrotask(() => stub.onend?.());
    }),
    abort: vi.fn(() => {
      stub.onend?.();
    }),
    onresult: null,
    onerror: null,
    onend: null,
    onstart: null,
    _emit(kind, payload) {
      if (kind === 'start') stub.onstart?.();
      else if (kind === 'result') stub.onresult?.(payload);
      else if (kind === 'error') stub.onerror?.(payload);
      else if (kind === 'end') stub.onend?.();
    },
  };
  return stub;
}

beforeEach(() => {
  instances = [];
  const Ctor = function (this: StubInstance) {
    const s = makeStub();
    instances.push(s);
    Object.assign(this, s);
    // Reroute setters to keep instance ref in sync.
    Object.defineProperty(this, '_emit', {
      value: s._emit,
      enumerable: false,
    });
    return s as unknown as StubInstance;
  } as unknown as new () => StubInstance;
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = Ctor;
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown })
    .webkitSpeechRecognition;
});

describe('useSpeechRecognition — happy path', () => {
  it('transitions idle → requesting → listening → stopped', async () => {
    const { result } = renderHook(() => useSpeechRecognition('sw-TZ'));
    // initial effect already set status to idle when Ctor exists.
    expect(['idle', 'unsupported']).toContain(result.current.state.status);
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe('listening');

    await act(async () => {
      instances[0]!._emit('result', {
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: 'habari' } },
        ],
      });
    });
    expect(result.current.state.transcript).toBe('habari');

    await act(async () => {
      result.current.stop();
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe('stopped');
  });

  it('accumulates final segments and exposes interim mid-flight', async () => {
    const { result } = renderHook(() => useSpeechRecognition('en-TZ'));
    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });
    await act(async () => {
      instances[0]!._emit('result', {
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: 'open ' } },
          { isFinal: false, 0: { transcript: 'compliance' } },
        ],
      });
    });
    expect(result.current.state.transcript).toBe('open ');
    expect(result.current.state.interim).toBe('compliance');
  });

  it('passes the requested locale to the recogniser', async () => {
    const { result } = renderHook(() => useSpeechRecognition('sw-TZ'));
    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });
    expect(instances[0]!.lang).toBe('sw-TZ');
  });
});

describe('useSpeechRecognition — error paths', () => {
  it('classifies as unsupported when no constructor is present', async () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    const { result } = renderHook(() => useSpeechRecognition('en-TZ'));
    await act(async () => {
      result.current.start();
    });
    expect(result.current.state.status).toBe('unsupported');
    expect(result.current.state.error).toBe('web_speech_api_unavailable');
  });

  it('surfaces error events from the recogniser', async () => {
    const { result } = renderHook(() => useSpeechRecognition('en-TZ'));
    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });
    await act(async () => {
      instances[0]!._emit('error', { error: 'no-speech' });
    });
    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toBe('no-speech');
  });
});

describe('useSpeechRecognition — reset', () => {
  it('clears transcript without stopping the session', async () => {
    const { result } = renderHook(() => useSpeechRecognition('sw-TZ'));
    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });
    await act(async () => {
      instances[0]!._emit('result', {
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'x' } }],
      });
    });
    expect(result.current.state.transcript).toBe('x');
    await act(async () => {
      result.current.reset();
    });
    expect(result.current.state.transcript).toBe('');
    // status unchanged (still listening)
    expect(result.current.state.status).toBe('listening');
  });
});
