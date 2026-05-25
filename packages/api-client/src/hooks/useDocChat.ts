/**
 * Document Chat hooks.
 *
 * Endpoints:
 *   POST /doc-chat/sessions                       → start
 *   POST /doc-chat/sessions/:id/ask               → ask (RAG)
 *   POST /doc-chat/sessions/:id/messages          → post message
 *   GET  /doc-chat/sessions/:id/messages          → history
 *   GET  /doc-chat/sessions/:id                   → session detail
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiClientError } from '../client';
import { queryKeys } from './query-keys';
import {
  client,
  defaultMutationRetry,
  defaultQueryRetry,
  type DefaultMutationOptions,
  type DefaultQueryOptions,
  type TenantScopeArg,
} from './shared';

export type DocChatScope = 'single_document' | 'multi_document' | 'group_chat';

export interface DocChatSession {
  readonly id: string;
  readonly tenantId: string;
  readonly scope: DocChatScope;
  readonly documentIds: ReadonlyArray<string>;
  readonly participants: ReadonlyArray<string>;
  readonly title?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DocChatCitation {
  readonly documentId: string;
  readonly pageNumber?: number;
  readonly snippet: string;
}

export interface DocChatMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly authorId: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly citations?: ReadonlyArray<DocChatCitation>;
  readonly createdAt: string;
}

export interface StartDocChatInput {
  readonly scope?: DocChatScope;
  readonly documentIds: ReadonlyArray<string>;
  readonly participants?: ReadonlyArray<string>;
  readonly title?: string;
}

export interface AskDocChatInput {
  readonly sessionId: string;
  readonly question: string;
}

export interface PostDocChatMessageInput {
  readonly sessionId: string;
  readonly content: string;
}

const BASE = '/doc-chat';

export function useDocChatSession(
  scope: TenantScopeArg,
  sessionId: string,
  options?: DefaultQueryOptions<DocChatSession>,
) {
  return useQuery<DocChatSession, ApiClientError>({
    queryKey: queryKeys.docChat.session(scope, sessionId),
    queryFn: async () => {
      const res = await client().get<DocChatSession>(
        `${BASE}/sessions/${sessionId}`,
      );
      return res.data;
    },
    enabled: Boolean(sessionId),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useDocChatMessages(
  scope: TenantScopeArg,
  sessionId: string,
  options?: DefaultQueryOptions<ReadonlyArray<DocChatMessage>>,
) {
  return useQuery<ReadonlyArray<DocChatMessage>, ApiClientError>({
    queryKey: queryKeys.docChat.messages(scope, sessionId),
    queryFn: async () => {
      const res = await client().get<ReadonlyArray<DocChatMessage>>(
        `${BASE}/sessions/${sessionId}/messages`,
      );
      return res.data;
    },
    enabled: Boolean(sessionId),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useStartDocChatSession(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<DocChatSession, StartDocChatInput>,
) {
  const qc = useQueryClient();
  return useMutation<DocChatSession, ApiClientError, StartDocChatInput>({
    mutationFn: async (input) => {
      const res = await client().post<DocChatSession>(`${BASE}/sessions`, input);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.docChat.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useAskDocChat(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<DocChatMessage, AskDocChatInput>,
) {
  const qc = useQueryClient();
  return useMutation<DocChatMessage, ApiClientError, AskDocChatInput>({
    mutationFn: async ({ sessionId, question }) => {
      const res = await client().post<DocChatMessage>(
        `${BASE}/sessions/${sessionId}/ask`,
        { question },
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.docChat.messages(scope, variables.sessionId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function usePostDocChatMessage(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<DocChatMessage, PostDocChatMessageInput>,
) {
  const qc = useQueryClient();
  return useMutation<DocChatMessage, ApiClientError, PostDocChatMessageInput>({
    mutationFn: async ({ sessionId, content }) => {
      const res = await client().post<DocChatMessage>(
        `${BASE}/sessions/${sessionId}/messages`,
        { content },
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.docChat.messages(scope, variables.sessionId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
