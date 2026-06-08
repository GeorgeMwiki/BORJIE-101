'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Recommendations query hooks — Mr. Mwikila's matching engine off the live
 * mining BFF.
 *
 * Live endpoint: GET /api/v1/mining/recommendations/match?target=...&userId=...
 * (services/api-gateway/src/routes/mining/recommendations.hono.ts). The
 * gateway computes via the REAL `@borjie/recommendations` engine
 * (content-based + matrix-factorization ensemble, item-item CF, MMR rerank,
 * PO-14 audit-chain seal) over the tenant's `marketplace_listings` +
 * `ratings`, persists each ranking to `recommendation_runs`, and returns the
 * top-K with an evidence chain. Tenant scope is bound server-side via the RLS
 * GUC; the `{ success, data }` envelope is unwrapped by `apiRequest`.
 */

export const RECOMMENDATION_TARGETS = [
  'buyer_mine',
  'worker_site',
  'supplier_mine',
] as const;
export type RecommendationTarget = (typeof RECOMMENDATION_TARGETS)[number];

const ScoredItemSchema = z.object({
  itemId: z.string(),
  score: z.number(),
  reason: z.string().optional(),
});
export type ScoredItem = z.infer<typeof ScoredItemSchema>;

// The gateway returns `{ target, runId, algorithm, topK, candidates,
// auditHash, servedAt, evidenceIds }` on success, or a degraded shape with
// nulls + a note when there are no candidates.
const MatchSchema = z.object({
  target: z.string().nullable().default(null),
  runId: z.string().nullable().default(null),
  algorithm: z.string().nullable().default(null),
  topK: z.array(ScoredItemSchema).default([]),
  candidates: z.array(z.string()).default([]),
  auditHash: z.string().optional(),
  servedAt: z.number().optional(),
  evidenceIds: z.array(z.string()).default([]),
  note: z.string().optional(),
});
export type RecommendationMatch = z.infer<typeof MatchSchema>;

export const recommendationKeys = {
  match: (target: RecommendationTarget, userId: string) =>
    ['recommendations', 'match', target, userId] as const,
  session: ['recommendations', 'session-user'] as const,
};

/** Resolve the signed-in owner's user id (the actor a ranking is FOR). */
export function useSessionUserId() {
  return useQuery({
    queryKey: recommendationKeys.session,
    queryFn: async (): Promise<string | null> => {
      // Client-safe session source: the browser Supabase client. The server
      // getOwnerSession() uses next/headers and breaks the build when pulled
      // into this 'use client' module (a Client Component cannot import
      // server-only code). user.id === the server session's userId.
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Compute (and persist server-side) a ranking for the given target. Disabled
 * until a `userId` is available so we never fire a match without an actor.
 */
export function useRecommendationMatch(opts: {
  readonly target: RecommendationTarget;
  readonly userId: string | undefined;
  readonly topK?: number;
  readonly category?: string;
}) {
  const topK = opts.topK ?? 10;
  return useQuery({
    enabled: Boolean(opts.userId),
    queryKey: recommendationKeys.match(opts.target, opts.userId ?? 'none'),
    queryFn: async ({ signal }): Promise<RecommendationMatch> => {
      const qs = new URLSearchParams();
      qs.set('target', opts.target);
      qs.set('userId', opts.userId ?? '');
      qs.set('topK', String(topK));
      if (opts.category) qs.set('category', opts.category);
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/recommendations/match?${qs.toString()}`,
        { signal },
      );
      return MatchSchema.parse(raw);
    },
    // Matches mutate state server-side (persisted run); don't auto-refetch.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
