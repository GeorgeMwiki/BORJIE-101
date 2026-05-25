/**
 * Brain API Service — client wrapper for /api/v1/brain endpoints.
 *
 * All endpoints require a Supabase Bearer token. The api-client must be
 * initialized with an `onTokenRefresh` that returns the current Supabase
 * access token (see each app's src/lib/supabase.ts).
 */

import { getApiClient, ApiResponse } from '../client';

export interface Persona {
  id: string;
  displayName: string;
  missionStatement: string;
  kind: 'manager' | 'junior' | 'coworker' | 'utility';
}

export interface BrainHandoff {
  from: string;
  to: string;
  objective: string;
}

export interface BrainToolCall {
  tool: string;
  ok: boolean;
}

export interface BrainProposedAction {
  verb: string;
  object: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reviewRequired: boolean;
}

export interface BrainTurnResponse {
  threadId: string;
  finalPersonaId: string;
  responseText: string;
  handoffs: BrainHandoff[];
  toolCalls: BrainToolCall[];
  advisorConsulted: boolean;
  proposedAction?: BrainProposedAction;
  tokensUsed: number;
}

export interface BrainThread {
  id: string;
  tenantId: string;
  primaryPersonaId: string;
  title: string;
  status: 'open' | 'resolved' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface BrainThreadEvent {
  id: string;
  kind:
    | 'user_message'
    | 'persona_message'
    | 'tool_call'
    | 'tool_result'
    | 'handoff_out'
    | 'handoff_in'
    | 'review_requested'
    | 'review_decision'
    | 'system_note';
  actorId: string;
  createdAt: string;
  visibility: {
    scope: 'private' | 'team' | 'management' | 'public';
    authorActorId: string;
  };
  [payload: string]: unknown;
}

export interface BrainReviewQueueItem {
  threadId: string;
  threadTitle: string;
  personaId: string;
  copilotRequestId: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requestedAt: string;
  preview?: string;
}

export interface BrainHealth {
  ok: boolean;
  anthropicReachable: boolean;
  threadStoreReachable: boolean;
  toolCount: number;
  personaCount: number;
  toolGaps: Array<{ personaId: string; missingTools: string[] }>;
  checkedAt: string;
  failure?: string;
}

export const brainService = {
  async health(): Promise<ApiResponse<BrainHealth>> {
    return getApiClient().get<BrainHealth>('/brain/health');
  },

  async personae(): Promise<ApiResponse<{ personae: Persona[] }>> {
    return getApiClient().get<{ personae: Persona[] }>('/brain/personae');
  },

  async turn(body: {
    threadId?: string;
    userText: string;
    forcePersonaId?: string;
  }): Promise<ApiResponse<BrainTurnResponse>> {
    return getApiClient().post<BrainTurnResponse>('/brain/turn', body);
  },

  async listThreads(
    limit = 50
  ): Promise<ApiResponse<{ threads: BrainThread[] }>> {
    return getApiClient().get<{ threads: BrainThread[] }>('/brain/threads', {
      params: { limit: String(limit) },
    });
  },

  async getThread(
    id: string
  ): Promise<
    ApiResponse<{ thread: BrainThread; events: BrainThreadEvent[] }>
  > {
    return getApiClient().get<{
      thread: BrainThread;
      events: BrainThreadEvent[];
    }>(`/brain/threads/${id}`);
  },

  async reviewQueue(): Promise<
    ApiResponse<{ items: BrainReviewQueueItem[]; count: number }>
  > {
    return getApiClient().get<{
      items: BrainReviewQueueItem[];
      count: number;
    }>('/brain/review-queue');
  },

  async submitReview(body: {
    threadId: string;
    copilotRequestId: string;
    decision: 'approved' | 'rejected';
    notes?: string;
  }): Promise<
    ApiResponse<{ ok: true; decision: string; reviewedAt: string }>
  > {
    return getApiClient().post<{
      ok: true;
      decision: string;
      reviewedAt: string;
    }>('/brain/review', body);
  },

  async migrateExtract(body: {
    sheets?: Record<string, Array<Record<string, string | number | null>>>;
    plainText?: string;
    hints?: { propertyName?: string };
  }): Promise<ApiResponse<{ bundle: unknown; diff: unknown }>> {
    return getApiClient().post<{ bundle: unknown; diff: unknown }>(
      '/brain/migrate/extract',
      body
    );
  },

  async migrateCommit(body: {
    bundle: unknown;
    bestEffort?: boolean;
  }): Promise<ApiResponse<{ report: unknown }>> {
    return getApiClient().post<{ report: unknown }>(
      '/brain/migrate/commit',
      body
    );
  },
};
