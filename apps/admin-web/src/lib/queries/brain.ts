'use client';

/**
 * React-query bindings for the LIVE `/api/v1/brain` endpoint —
 * admin-web copy.
 *
 * - `useBrainThread(threadId)` — hydrate a saved thread on mount.
 * - `useAskBorjie(args)`       — opinionated wrapper that owns the
 *                                in-memory transcript and the optimistic
 *                                user + assistant bubbles. Forces the
 *                                `T2_admin_strategist` persona so every
 *                                turn lands on the tier-2 all-tenant
 *                                seed.
 *
 * LIVE-only: errors propagate through react-query's `error` channel; the
 * consuming page renders an empty-state when the gateway is unreachable
 * or `NEXT_PUBLIC_API_GATEWAY_URL` is missing.
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
import { mapProposedActionToChip } from '@/components/superpowers';

const ADMIN_PERSONA_ID = 'T2_admin_strategist' as const;

const QUERY_KEYS = {
  thread: (threadId: string | null) =>
    ['admin', 'brain', 'thread', threadId] as const,
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
 * Single-turn mutation wrapper for `POST /api/v1/brain/turn`. Useful for
 * tests / callers that only need the raw envelope. Prefer
 * `useAskBorjie` for the actual page surface.
 */
export function useBrainTurn(): UseMutationResult<
  BrainTurnResult,
  ApiError,
  BrainTurnInput
> {
  return useMutation<BrainTurnResult, ApiError, BrainTurnInput>({
    mutationFn: async (input) =>
      submitBrainTurn({
        userText: input.userText,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        forcePersonaId: input.forcePersonaId ?? ADMIN_PERSONA_ID,
      }),
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
  readonly latestToolCalls: ReadonlyArray<BrainToolCall>;
  readonly isStreaming: boolean;
  readonly isHydrating: boolean;
  readonly error: ApiError | Error | null;
  readonly send: (text: string) => Promise<void>;
  readonly reset: () => void;
}

function genId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
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
 * Owns the admin ask-Borjie transcript: hydrates from `initialThreadId`,
 * appends user bubbles immediately on submit, streams the assistant
 * reply via `streamBrainChat`, and surfaces the latest tool-call breadcrumb
 * so the sidebar can render whichever junior was invoked.
 *
 * Every turn carries `forcePersonaId: T2_admin_strategist` so the brain
 * answers from the all-tenant seed instead of falling back to the owner
 * persona.
 */
export function useAskBorjie(args: UseAskBorjieArgs = {}): UseAskBorjieResult {
  const initial = args.initialThreadId ?? null;
  const [threadId, setThreadId] = useState<string | null>(initial);
  const [messages, setMessages] = useState<ReadonlyArray<AskBorjieMessage>>(
    [],
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [latestToolCalls, setLatestToolCalls] = useState<
    ReadonlyArray<BrainToolCall>
  >([]);
  const onThreadCreatedRef = useRef(args.onThreadCreated);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    onThreadCreatedRef.current = args.onThreadCreated;
  }, [args.onThreadCreated]);

  const threadQuery = useBrainThread(threadId);

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
    setLatestToolCalls([]);
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
          forcePersonaId: ADMIN_PERSONA_ID,
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
          setLatestToolCalls(chunk.toolCalls);
          if (chunk.threadId && chunk.threadId !== threadId) {
            setThreadId(chunk.threadId);
            onThreadCreatedRef.current?.(chunk.threadId);
          }
          // Wave SUPERPOWERS — when the envelope (or future SSE frame)
          // carries a chip-eligible `proposedAction`, publish it onto
          // the chip emission bus keyed by the assistant message id.
          // The bubble subscribes via `useAdminChipEmissions(assistantId)`.
          if (chunk.proposedAction) {
            mapProposedActionToChip(assistantId, chunk.proposedAction);
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
    latestToolCalls,
    isStreaming,
    isHydrating: threadQuery.isLoading,
    error,
    send,
    reset,
  };
}
