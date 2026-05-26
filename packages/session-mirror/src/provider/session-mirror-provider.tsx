'use client';

/**
 * SessionMirrorProvider — wires together the batch flusher + the
 * capture client, and exposes hooks for the field-capture +
 * ui-beacon primitives to emit events into the pipeline.
 *
 * The provider is the SINGLE point in the app tree where the session
 * scope (tenantId + userId + sessionId) is bound. Hooks read the
 * scope via `useSessionScope`; the emit function via
 * `useCaptureEmit`. Outside the provider, both hooks return
 * `null` / a no-op respectively — drop-in safe.
 *
 * On unload, any pending events are sent via `navigator.sendBeacon`
 * so the final state lands server-side before the tab dies.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  BatchFlusher,
  type BatchFlusherOptions,
} from './batch-flusher.js';
import {
  buildBatch,
  createCaptureClient,
  type CaptureClient,
} from '../capture-client/capture-client.js';
import type { CaptureEvent } from '../types.js';

export interface SessionScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
}

interface ProviderValue {
  readonly scope: SessionScope | null;
  readonly emit: (event: CaptureEvent) => void;
}

const Ctx = createContext<ProviderValue>({
  scope: null,
  emit: () => undefined,
});

export interface SessionMirrorProviderProps {
  readonly scope: SessionScope;
  /** Disable capture entirely (e.g. for unauth / public sessions). */
  readonly disabled?: boolean;
  readonly endpoint?: string;
  /** Test seam — inject a stubbed fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly flusherOptions?: Omit<BatchFlusherOptions, 'onFlush'>;
  readonly children: React.ReactNode;
}

export function SessionMirrorProvider(
  props: SessionMirrorProviderProps,
): React.ReactElement {
  const {
    scope,
    disabled = false,
    endpoint,
    fetchImpl,
    flusherOptions,
    children,
  } = props;

  const clientRef = useRef<CaptureClient | null>(null);
  const flusherRef = useRef<BatchFlusher | null>(null);

  if (!clientRef.current) {
    clientRef.current = createCaptureClient({
      ...(endpoint !== undefined ? { endpoint } : {}),
      ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    });
  }

  if (!flusherRef.current) {
    flusherRef.current = new BatchFlusher({
      ...(flusherOptions ?? {}),
      onFlush: async (events) => {
        if (!clientRef.current) return;
        const batch = buildBatch({
          tenantId: scope.tenantId,
          userId: scope.userId,
          sessionId: scope.sessionId,
          events,
        });
        await clientRef.current.send(batch);
      },
    });
  }

  useEffect(() => {
    if (disabled) return;
    const handleUnload = (): void => {
      if (!flusherRef.current || !clientRef.current) return;
      const pending = flusherRef.current.__peek();
      if (pending.length === 0) return;
      clientRef.current.sendOnUnload(
        buildBatch({
          tenantId: scope.tenantId,
          userId: scope.userId,
          sessionId: scope.sessionId,
          events: pending,
        }),
      );
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handleUnload);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', handleUnload);
      }
      flusherRef.current?.stop();
    };
  }, [disabled, scope.sessionId, scope.tenantId, scope.userId]);

  const value = useMemo<ProviderValue>(() => {
    return {
      scope: disabled ? null : scope,
      emit: disabled
        ? () => undefined
        : (event: CaptureEvent) => {
            flusherRef.current?.enqueue(event);
          },
    };
  }, [disabled, scope]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Read the active session scope. Returns null outside the provider. */
export function useSessionScope(): SessionScope | null {
  return useContext(Ctx).scope;
}

/** Get the emit function. No-op outside the provider. */
export function useCaptureEmit(): (event: CaptureEvent) => void {
  return useContext(Ctx).emit;
}
