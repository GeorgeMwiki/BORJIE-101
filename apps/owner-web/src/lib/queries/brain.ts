'use client';

/**
 * React-query bindings for the LIVE `/api/v1/brain` endpoint.
 *
 * - `useBrainThread(threadId)`     — hydrates a saved thread on mount.
 * - `useBrainTurn()`               — mutation that POSTs a single turn.
 * - `useAskBorjie()`               — opinionated wrapper that owns the
 *                                    in-memory transcript, append-on-
 *                                    success, and the optimistic user
 *                                    bubble + assistant placeholder.
 *
 * LIVE-only: no mock fallback. Errors propagate through react-query's
 * `error` channel; the consuming page renders a clear empty-state when
 * the gateway is unreachable or NEXT_PUBLIC_API_GATEWAY_URL is missing.
 */

import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  isBrainConfigured,
  loadThread,
  streamBrainChat,
  submitBrainTurn,
  type BrainCitation,
  type BrainMessage,
  type BrainToolCall,
  type BrainTurnResult,
} from '@/lib/brain-api';

const QUERY_KEYS = {
  thread: (threadId: string | null) => ['brain', 'thread', threadId] as const,
} as const;

export interface UseBrainThreadResult {
  readonly threadId: string | null;
  readonly messages: ReadonlyArray<BrainMessage>;
}

/**
 * Hydrate a saved thread when `threadId` is non-null. Disabled when the
 * gateway is unconfigured so the UI does not thrash 503s.
 */
export function useBrainThread(
  threadId: string | null,
): UseQueryResult<UseBrainThreadResult, ApiError> {
  return useQuery<UseBrainThreadResult, ApiError>({
    queryKey: QUERY_KEYS.thread(threadId),
    enabled: Boolean(threadId) && isBrainConfigured(),
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      if (!threadId) {
        return { threadId: null, messages: [] };
      }
      const result = await loadThread(threadId, { signal });
      return { threadId: result.threadId, messages: result.messages };
    },
  });
}

interface BrainTurnInput {
  readonly userText: string;
  readonly threadId?: string;
  readonly forcePersonaId?: string;
}

/**
 * Single-turn mutation wrapper for `POST /api/v1/brain/turn`. Prefer
 * `useAskBorjie` for the page surface; this lower-level hook exists for
 * tests and for any caller that only needs the raw envelope.
 */
export function useBrainTurn(): UseMutationResult<
  BrainTurnResult,
  ApiError,
  BrainTurnInput
> {
  return useMutation<BrainTurnResult, ApiError, BrainTurnInput>({
    mutationFn: async (input) => submitBrainTurn(input),
  });
}

// ─── Ask-Borjie transcript hook ────────────────────────────────────────

export interface AskBorjieMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly citations: ReadonlyArray<BrainCitation>;
  readonly toolCalls: ReadonlyArray<BrainToolCall>;
  readonly streaming: boolean;
  readonly errored: boolean;
  readonly createdAt: string;
}

export interface UseAskBorjieResult {
  readonly threadId: string | null;
  readonly messages: ReadonlyArray<AskBorjieMessage>;
  readonly isStreaming: boolean;
  readonly isHydrating: boolean;
  readonly error: ApiError | Error | null;
  readonly send: (text: string) => Promise<void>;
  readonly reset: () => void;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fromBrainMessage(m: BrainMessage): AskBorjieMessage | null {
  if (m.role !== 'user' && m.role !== 'assistant') return null;
  const citations = Array.isArray(m.citations) ? m.citations : [];
  return {
    id: m.id,
    role: m.role,
    text: m.content,
    citations,
    toolCalls: [],
    streaming: false,
    errored: false,
    createdAt: m.createdAt,
  };
}

interface UseAskBorjieArgs {
  readonly initialThreadId?: string | null;
  readonly onThreadCreated?: (threadId: string) => void;
}

/**
 * Owns the ask-Borjie transcript: hydrates from `initialThreadId`,
 * appends user bubbles immediately on submit, streams the assistant
 * reply via `streamBrainChat`, and propagates the server-assigned
 * threadId back to the caller (so the URL can be updated).
 */
export function useAskBorjie(args: UseAskBorjieArgs = {}): UseAskBorjieResult {
  const initial = args.initialThreadId ?? null;
  const [threadId, setThreadId] = useState<string | null>(initial);
  const [messages, setMessages] = useState<ReadonlyArray<AskBorjieMessage>>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const onThreadCreatedRef = useRef(args.onThreadCreated);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    onThreadCreatedRef.current = args.onThreadCreated;
  }, [args.onThreadCreated]);

  const threadQuery = useBrainThread(threadId);

  // Mirror the hydrated thread into local state once it arrives. We do
  // this once per (threadId, dataIdentity) so the user can append new
  // messages without the query refetch wiping them.
  const hydratedFromRef = useRef<string | null>(null);
  useEffect(() => {
    if (!threadQuery.data) return;
    if (hydratedFromRef.current === threadQuery.data.threadId) return;
    hydratedFromRef.current = threadQuery.data.threadId;
    const mapped: AskBorjieMessage[] = [];
    for (const m of threadQuery.data.messages) {
      const view = fromBrainMessage(m);
      if (view) mapped.push(view);
    }
    setMessages(mapped);
  }, [threadQuery.data]);

  // Surface any thread-load error to the caller so the page can render
  // a clear empty-state. Mutation errors flow through `error` directly.
  useEffect(() => {
    if (threadQuery.error) {
      setError(threadQuery.error);
    }
  }, [threadQuery.error]);

  const reset = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    hydratedFromRef.current = null;
  }, []);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userMsg: AskBorjieMessage = {
        id: genId(),
        role: 'user',
        text: trimmed,
        citations: [],
        toolCalls: [],
        streaming: false,
        errored: false,
        createdAt: new Date().toISOString(),
      };
      const assistantId = genId();
      const assistantMsg: AskBorjieMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        citations: [],
        toolCalls: [],
        streaming: true,
        errored: false,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      setError(null);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        for await (const chunk of streamBrainChat({
          message: trimmed,
          ...(threadId ? { threadId } : {}),
          signal: controller.signal,
        })) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    text: m.text + chunk.chunk,
                    citations: chunk.citations,
                    toolCalls: chunk.toolCalls,
                    streaming: !chunk.done,
                  }
                : m,
            ),
          );
          if (chunk.threadId && chunk.threadId !== threadId) {
            setThreadId(chunk.threadId);
            onThreadCreatedRef.current?.(chunk.threadId);
          }
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        );
      } catch (err) {
        const e = err instanceof Error ? err : new Error('brain turn failed');
        setError(e);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, streaming: false, errored: true }
              : m,
          ),
        );
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, threadId],
  );

  return {
    threadId,
    messages,
    isStreaming,
    isHydrating: threadQuery.isLoading,
    error,
    send,
    reset,
  };
}
