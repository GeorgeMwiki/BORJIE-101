'use client';

/**
 * useRealtimeVoice — realtime-duplex voice client for the owner cockpit.
 *
 * Upgrades the owner's voice from one-shot browser STT/TTS to a true
 * duplex loop against the gateway voice WS (`/api/v1/brain/voice/stream`,
 * in front of the brain). It:
 *   - captures the mic as PCM16 frames (`MicCapture`),
 *   - streams them up the WebSocket (`VoiceTransport`),
 *   - plays returned model-audio frames gaplessly (`PcmPlayer`),
 *   - barges in (stops playback + signals the server) the instant local
 *     mic energy crosses a VAD threshold while the model is speaking,
 *   - surfaces a live transcript so the composer can mirror it.
 *
 * GRACEFUL DEGRADATION (the whole point of this hook):
 *   The gateway voice WS is NOT live in this environment. The hook
 *   feature-detects audio + WebSocket support, and treats ANY handshake
 *   failure, transport error, or mic denial as a hard signal to give up
 *   the live path. It NEVER throws and NEVER blocks the UI — it flips to
 *   `status: 'fallback'`, at which point the caller mounts the existing
 *   browser Web-Speech mic instead. The browser path is never removed.
 *
 * Discipline:
 *   - Immutable state object (`coding-style.md`).
 *   - Each function <50 lines; nesting <4.
 *   - No console.log — every fault lands in `state.error` / `status`.
 *   - Caller owns locale; we never assume.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MicCapture,
  PcmPlayer,
  isRealtimeAudioSupported,
  type MicFrame,
} from './realtime-audio';
import {
  VoiceTransport,
  isWebSocketSupported,
  type VoiceServerEvent,
} from './realtime-transport';

/** RMS over this threshold while the model speaks triggers barge-in. */
const BARGE_IN_RMS = 0.05;

export type RealtimeVoiceStatus =
  | 'unsupported' // no audio/WebSocket in this runtime — use browser path
  | 'idle' // supported, not yet connected
  | 'connecting' // socket handshake in flight
  | 'live' // duplex open; listening to the owner
  | 'speaking' // model audio is playing back
  | 'fallback' // live path failed; caller should use browser Web-Speech
  | 'error'; // transport/mic fault (also routes caller to fallback)

export interface RealtimeVoiceState {
  readonly status: RealtimeVoiceStatus;
  /** Live transcript of the owner's speech (server ASR), for mirroring. */
  readonly transcript: string;
  /** Final assistant reply text for the most recent turn, if delivered. */
  readonly lastReply: string;
  /** Last error/degradation code; null when healthy. */
  readonly error: string | null;
}

const INITIAL_STATE: RealtimeVoiceState = Object.freeze({
  status: 'idle',
  transcript: '',
  lastReply: '',
  error: null,
});

export interface UseRealtimeVoiceArgs {
  readonly locale: 'sw' | 'en';
  /** Resolves the Supabase access token, or null when unauthenticated. */
  readonly getToken: () => Promise<string | null>;
}

export interface UseRealtimeVoiceResult {
  readonly state: RealtimeVoiceState;
  /** True when the live duplex path is currently the active surface. */
  readonly isLive: boolean;
  /** Open the duplex session. No-op if unsupported / already connecting. */
  readonly connect: () => void;
  /** Tear down the session and release the mic. Safe to call any time. */
  readonly disconnect: () => void;
}

interface VoiceRefs {
  readonly transport: VoiceTransport | null;
  readonly capture: MicCapture | null;
  readonly player: PcmPlayer | null;
}

const EMPTY_REFS: VoiceRefs = { transport: null, capture: null, player: null };

export function useRealtimeVoice(
  args: UseRealtimeVoiceArgs,
): UseRealtimeVoiceResult {
  const { locale, getToken } = args;
  const [state, setState] = useState<RealtimeVoiceState>(INITIAL_STATE);
  const refs = useRef<VoiceRefs>(EMPTY_REFS);
  // Mirror status into a ref so the audio callback (which closes over a
  // stale render) can read the *current* status without re-binding.
  const statusRef = useRef<RealtimeVoiceStatus>('idle');
  statusRef.current = state.status;

  const teardown = useCallback((): void => {
    refs.current.capture?.stop();
    refs.current.player?.stop();
    refs.current.transport?.close();
    refs.current = EMPTY_REFS;
  }, []);

  const degrade = useCallback(
    (code: string): void => {
      teardown();
      setState((prev) => ({ ...prev, status: 'fallback', error: code }));
    },
    [teardown],
  );

  const handleEvent = useCallback((event: VoiceServerEvent): void => {
    setState((prev) => reduceEvent(prev, event));
  }, []);

  const handleAudio = useCallback((pcm: ArrayBuffer): void => {
    refs.current.player?.enqueue(pcm);
    setState((prev) =>
      prev.status === 'live' ? { ...prev, status: 'speaking' } : prev,
    );
  }, []);

  const handleFrame = useCallback((frame: MicFrame): void => {
    refs.current.transport?.sendAudio(frame.pcm);
    if (statusRef.current !== 'speaking') return;
    if (frame.rms < BARGE_IN_RMS) return;
    // Barge-in: silence playback, tell the server, return to listening.
    refs.current.player?.stop();
    refs.current.transport?.bargeIn();
    setState((prev) => ({ ...prev, status: 'live' }));
  }, []);

  // Declared before `connect` so there is no temporal-dead-zone on the
  // closure reference; every captured callback is a stable useCallback.
  const buildHandlers = useCallback(
    () => ({
      onOpen: async () => {
        await refs.current.capture?.start();
        setState((prev) => ({ ...prev, status: 'live', error: null }));
      },
      onAudio: handleAudio,
      onEvent: handleEvent,
      onError: degrade,
      onClose: () =>
        setState((prev) =>
          prev.status === 'fallback' || prev.status === 'unsupported'
            ? prev
            : { ...prev, status: 'idle' },
        ),
      onFrame: handleFrame,
    }),
    [degrade, handleAudio, handleEvent, handleFrame],
  );

  const connect = useCallback((): void => {
    if (!isRealtimeAudioSupported() || !isWebSocketSupported()) {
      setState((prev) => ({ ...prev, status: 'unsupported' }));
      return;
    }
    if (statusRef.current === 'connecting' || statusRef.current === 'live') {
      return;
    }
    setState({ ...INITIAL_STATE, status: 'connecting' });
    void openSession({ locale, getToken, refs, handlers: buildHandlers() });
  }, [locale, getToken, buildHandlers]);

  const disconnect = useCallback((): void => {
    teardown();
    setState((prev) =>
      prev.status === 'fallback' || prev.status === 'unsupported'
        ? prev
        : INITIAL_STATE,
    );
  }, [teardown]);

  useEffect(() => teardown, [teardown]);

  const isLive = state.status === 'live' || state.status === 'speaking';
  return useMemo(
    () => ({ state, isLive, connect, disconnect }),
    [state, isLive, connect, disconnect],
  );
}

// ─── Pure reducers / wiring helpers (kept out of the hook body) ──────────

/** Fold a server control event into the immutable voice state. */
function reduceEvent(
  prev: RealtimeVoiceState,
  event: VoiceServerEvent,
): RealtimeVoiceState {
  switch (event.type) {
    case 'transcript':
      return { ...prev, transcript: event.text };
    case 'turn':
      return { ...prev, lastReply: event.text, transcript: '' };
    case 'speech_end':
      return prev.status === 'speaking' ? { ...prev, status: 'live' } : prev;
    case 'error':
      return { ...prev, status: 'error', error: event.code };
    case 'ready':
    case 'speech_start':
    default:
      return prev;
  }
}

interface SessionArgs {
  readonly locale: 'sw' | 'en';
  readonly getToken: () => Promise<string | null>;
  readonly refs: React.MutableRefObject<VoiceRefs>;
  readonly handlers: {
    readonly onOpen: () => void | Promise<void>;
    readonly onAudio: (pcm: ArrayBuffer) => void;
    readonly onEvent: (event: VoiceServerEvent) => void;
    readonly onError: (code: string) => void;
    readonly onClose: () => void;
    readonly onFrame: (frame: MicFrame) => void;
  };
}

/** Resolve the token, build the transport+capture+player graph, and open. */
async function openSession(args: SessionArgs): Promise<void> {
  const { locale, getToken, refs, handlers } = args;
  const token = await getToken();
  if (!token) {
    handlers.onError('missing_access_token');
    return;
  }
  const player = new PcmPlayer(() => undefined);
  const transport = new VoiceTransport({
    onOpen: () => void handlers.onOpen(),
    onAudio: handlers.onAudio,
    onEvent: handlers.onEvent,
    onError: handlers.onError,
    onClose: handlers.onClose,
  });
  const capture = new MicCapture({
    onFrame: handlers.onFrame,
    onError: handlers.onError,
  });
  refs.current = { transport, capture, player };
  transport.open(token, locale);
}
