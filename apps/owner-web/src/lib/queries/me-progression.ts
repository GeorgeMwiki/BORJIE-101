'use client';

/**
 * react-query bindings for the progressive-disclosure super-powers:
 *
 *   GET /api/v1/me/mastery          → <MasteryGate masteryScore=… />
 *   GET /api/v1/me/shortcuts?topN=… → <LearnedShortcutsPanel learnedShortcuts=… />
 *
 * Both go through the shared `apiRequest` client, which forwards the
 * Supabase bearer + the session cookie and unwraps the gateway's
 * `{ success, data }` envelope. The fetched JSON is zod-parsed here
 * (defence in depth) so a wire-format drift surfaces as a clean query
 * error rather than a runtime crash inside the chat-ui components.
 *
 * Graceful by construction: an unauthenticated / empty / errored read
 * resolves to `null` (mastery) or `[]` (shortcuts) at the call site, so
 * the gated components simply render nothing until real data lands.
 */

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest, ApiError } from '@/lib/api-client';
import type { LearnedShortcut, MasteryScore } from '@borjie/chat-ui';

// Mirrors `MasteryScore` (packages/chat-ui/.../user-mastery/types.ts) and
// the gateway response of GET /api/v1/me/mastery.
const masteryLevelSchema = z.enum([
  'novice',
  'intermediate',
  'expert',
  'power-user',
]);

const masteryScoreSchema = z.object({
  level: masteryLevelSchema,
  totalActions: z.number(),
  distinctActions: z.number(),
  recencyWeight: z.number(),
  weightedScore: z.number(),
  nextThreshold: z.number().nullable(),
  nextLevel: masteryLevelSchema.nullable(),
});

// The gateway's GET /api/v1/me/shortcuts returns `{ id, label, confidence }`
// per entry (`apiRequest` unwraps the `data` array). That is a structural
// subset of `LearnedShortcut` (whose `icon` / `route` are optional), so the
// parsed rows assign cleanly under `exactOptionalPropertyTypes`.
const learnedShortcutSchema = z.object({
  id: z.string(),
  label: z.string(),
  confidence: z.number(),
});

const learnedShortcutsSchema = z.array(learnedShortcutSchema);

export const meProgressionKeys = {
  mastery: ['me', 'mastery'] as const,
  shortcuts: (topN: number) => ['me', 'shortcuts', topN] as const,
};

/**
 * Fetch the caller's mastery score. Returns `null` (not an error) on a
 * 401 so the gate stays hidden for unauthenticated/expired sessions
 * instead of surfacing a destructive notice in the chat.
 */
export function useMyMastery() {
  return useQuery<MasteryScore | null, ApiError>({
    queryKey: meProgressionKeys.mastery,
    queryFn: async ({ signal }) => {
      const raw = await apiRequest<unknown>('/api/v1/me/mastery', { signal });
      return masteryScoreSchema.parse(raw);
    },
    staleTime: 60_000,
    retry: (failureCount, error) =>
      error.status !== 401 && error.status !== 403 && failureCount < 1,
  });
}

/**
 * Fetch the caller's top-N learned shortcuts. Defaults to 8 — enough to
 * fill the inline panel without crowding the chat column.
 */
export function useMyShortcuts(topN = 8) {
  return useQuery<ReadonlyArray<LearnedShortcut>, ApiError>({
    queryKey: meProgressionKeys.shortcuts(topN),
    queryFn: async ({ signal }) => {
      const raw = await apiRequest<unknown>(
        `/api/v1/me/shortcuts?topN=${topN}`,
        { signal },
      );
      return learnedShortcutsSchema.parse(raw);
    },
    staleTime: 60_000,
    retry: (failureCount, error) =>
      error.status !== 401 && error.status !== 403 && failureCount < 1,
  });
}
