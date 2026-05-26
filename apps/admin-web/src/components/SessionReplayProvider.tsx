'use client';

/**
 * SessionReplayProvider — Central Command Phase B (B5).
 *
 * Wires the rrweb-based recorder (`src/lib/session-replay`) into the
 * admin platform portal. Started client-side on mount; stopped on
 * unmount. Use `useSessionReplay()` from a child component to read the
 * current sessionId and uploader stats.
 *
 * The recorder is held SEPARATELY from the sensorium 14-event taxonomy.
 * rrweb chunks ride the dedicated `/api/v1/session-replay/chunks`
 * endpoint and the gzipped, PII-masked bytes are stored in the cold
 * object store. They are NEVER fed into the LLM context window.
 *
 * Boot conditions:
 *   - `'use client'` so Next 15 only loads the recorder client-side.
 *   - `process.env.NEXT_PUBLIC_SESSION_REPLAY_ENABLED === 'false'`
 *     disables the recorder (engineering escape-hatch for noisy dev
 *     pages). Defaults to enabled.
 *   - Boots with a fresh sessionId per mount when none is supplied so
 *     the sequence number does not collide with prior tabs.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createChunkUploader,
  type ChunkUploader,
  type ChunkUploaderStats,
} from '@/lib/session-replay/chunk-uploader';
import {
  startSessionReplayRecorder,
  type RecorderHandle,
} from '@/lib/session-replay/recorder';

interface SessionReplayContextValue {
  readonly sessionId: string | null;
  readonly enabled: boolean;
  readonly stats: ChunkUploaderStats | null;
}

const SessionReplayContext = createContext<SessionReplayContextValue>({
  sessionId: null,
  enabled: false,
  stats: null,
});

export interface SessionReplayProviderProps {
  readonly surface?: string;
  readonly sessionId?: string;
  readonly endpoint?: string;
  readonly enabled?: boolean;
  readonly authToken?: string | (() => string | null);
  readonly children: React.ReactNode;
}

function generateSessionId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `srpl_${crypto.randomUUID()}`;
  }
  return `srpl_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

function resolveEnabled(prop: boolean | undefined): boolean {
  if (typeof prop === 'boolean') return prop;
  const env =
    typeof process !== 'undefined' && process.env
      ? process.env.NEXT_PUBLIC_SESSION_REPLAY_ENABLED
      : undefined;
  if (env === 'false') return false;
  return true;
}

function resolveEndpoint(prop: string | undefined): string {
  if (prop) return prop;
  const base =
    typeof process !== 'undefined' && process.env
      ? process.env.NEXT_PUBLIC_API_BASE_URL ?? ''
      : '';
  return `${base.replace(/\/$/, '')}/api/v1/session-replay/chunks`;
}

export function SessionReplayProvider({
  surface = 'admin-web',
  sessionId,
  endpoint,
  enabled,
  authToken,
  children,
}: SessionReplayProviderProps) {
  const effectiveEnabled = resolveEnabled(enabled);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    null,
  );
  const [stats, setStats] = useState<ChunkUploaderStats | null>(null);
  const uploaderRef = useRef<ChunkUploader | null>(null);
  const handleRef = useRef<RecorderHandle | null>(null);

  useEffect(() => {
    if (!effectiveEnabled) return undefined;
    if (typeof window === 'undefined') return undefined;
    const sid = sessionId ?? generateSessionId();
    const ep = resolveEndpoint(endpoint);
    const uploader = createChunkUploader({
      endpoint: ep,
      ...(authToken !== undefined ? { authToken } : {}),
    });
    uploaderRef.current = uploader;
    setActiveSessionId(sid);

    let cancelled = false;
    void startSessionReplayRecorder({
      sessionId: sid,
      uploader,
      surface,
    }).then((handle) => {
      if (cancelled) {
        void handle.stop();
        return;
      }
      handleRef.current = handle;
    });

    // Lightweight stats poll for the staff overlay (5s cadence).
    const statsTimer = setInterval(() => {
      const u = uploaderRef.current;
      if (u) setStats(u.getStats());
    }, 5_000);

    return () => {
      cancelled = true;
      clearInterval(statsTimer);
      const handle = handleRef.current;
      if (handle) {
        void handle.stop();
      }
      handleRef.current = null;
      uploaderRef.current = null;
    };
  }, [effectiveEnabled, sessionId, endpoint, surface, authToken]);

  const value = useMemo<SessionReplayContextValue>(
    () => ({
      sessionId: activeSessionId,
      enabled: effectiveEnabled,
      stats,
    }),
    [activeSessionId, effectiveEnabled, stats],
  );

  return (
    <SessionReplayContext.Provider value={value}>
      {children}
    </SessionReplayContext.Provider>
  );
}

export function useSessionReplay(): SessionReplayContextValue {
  return useContext(SessionReplayContext);
}
