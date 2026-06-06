'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest, LLM_REQUEST_TIMEOUT_MS } from '@/lib/api-client';

/**
 * Role-aware advisor query hooks — the owner cockpit front door onto the
 * universal advisor (`@borjie/role-aware-advisor`).
 *
 * Live endpoints (services/api-gateway/src/routes/ask/ask.router.ts):
 *   POST /api/v1/ask                  submit a question → role-tailored answer
 *   GET  /api/v1/ask/starting-points  suggested chips for THIS user
 *   POST /api/v1/ask/feedback         rate an answer (feeds the lesson store)
 *
 * Role + tenant are derived server-side from the session — never sent
 * from the client. The advisor's data-access guard partitions evidence
 * into allowed / redacted / denied before the brain ever sees it; the
 * `redactedFields` + `deniedSnippetIds` arrays surface that posture so
 * the panel can show what was withheld. Every answer carries an
 * `evidence[]` chain (evidence-required AI output, per CLAUDE.md).
 *
 * The `apiRequest` helper unwraps the gateway's `{ success, data }`
 * envelope, so each hook parses the inner payload directly.
 */

// ── Answer ──────────────────────────────────────────────────────────

const citationSchema = z.object({
  id: z.string(),
  label: z.string(),
  source: z.string(),
});

const evidenceSchema = z.object({
  id: z.string(),
  resource: z.string(),
  summary: z.string(),
});

const adviseResponseSchema = z.object({
  answer: z.string(),
  intent: z.string(),
  answerId: z.string(),
  citations: z.array(citationSchema).default([]),
  suggestedFollowUps: z.array(z.string()).default([]),
  evidence: z.array(evidenceSchema).default([]),
  redactedFields: z.array(z.string()).default([]),
  deniedSnippetIds: z.array(z.string()).default([]),
});

export type AdviseResponse = z.infer<typeof adviseResponseSchema>;
export type AdvisorCitation = z.infer<typeof citationSchema>;
export type AdvisorEvidence = z.infer<typeof evidenceSchema>;

export interface AskInput {
  readonly question: string;
  readonly sessionId?: string;
}

// ── Starting points ─────────────────────────────────────────────────

const startingPointSchema = z.object({
  id: z.string(),
  label: z.string(),
  prompt: z.string(),
  priority: z.number(),
  reason: z.string(),
});

const startingPointsResponseSchema = z.object({
  chips: z.array(startingPointSchema).default([]),
  sessionId: z.string().nullable().default(null),
});

export type StartingPoint = z.infer<typeof startingPointSchema>;

export const roleAdvisorKeys = {
  startingPoints: (sessionId?: string) =>
    ['role-advisor', 'starting-points', sessionId ?? 'none'] as const,
};

/**
 * Suggested starting-point chips for the current user. Cheap, role-tuned,
 * and recomputed when the session id changes.
 */
export function useAdvisorStartingPoints(sessionId?: string) {
  return useQuery({
    queryKey: roleAdvisorKeys.startingPoints(sessionId),
    queryFn: async ({ signal }): Promise<ReadonlyArray<StartingPoint>> => {
      const qs = sessionId
        ? `?sessionId=${encodeURIComponent(sessionId)}`
        : '';
      const raw = await apiRequest<unknown>(
        `/api/v1/ask/starting-points${qs}`,
        { signal },
      );
      return startingPointsResponseSchema.parse(raw).chips;
    },
    staleTime: 60_000,
  });
}

/**
 * Ask the advisor a question. Uses the long LLM timeout — the brain turn
 * runs multi-second server-side (multi-LLM proposer + synthesizer).
 */
export function useAskAdvisor() {
  return useMutation({
    mutationFn: async (input: AskInput): Promise<AdviseResponse> => {
      const raw = await apiRequest<unknown>('/api/v1/ask', {
        method: 'POST',
        body: {
          question: input.question,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        },
        timeoutMs: LLM_REQUEST_TIMEOUT_MS,
      });
      return adviseResponseSchema.parse(raw);
    },
  });
}

// ── Feedback ────────────────────────────────────────────────────────

export interface AdvisorFeedbackInput {
  readonly sessionId: string;
  readonly answerId: string;
  readonly rating: number;
  readonly freeText?: string;
}

/**
 * Submit a 1–5 rating on an answer. A low rating (≤2) drops a lesson
 * into the reflexion store server-side keyed `role-aware-advisor`.
 */
export function useAdvisorFeedback() {
  return useMutation({
    mutationFn: async (input: AdvisorFeedbackInput): Promise<{ recorded: boolean }> => {
      const raw = await apiRequest<{ recorded?: boolean }>(
        '/api/v1/ask/feedback',
        {
          method: 'POST',
          body: {
            sessionId: input.sessionId,
            answerId: input.answerId,
            rating: input.rating,
            ...(input.freeText ? { freeText: input.freeText } : {}),
          },
        },
      );
      return { recorded: raw.recorded === true };
    },
  });
}
