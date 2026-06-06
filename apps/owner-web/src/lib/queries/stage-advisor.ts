'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Stage-advisor query hooks — the owner cockpit front door onto the
 * stage-aware capability advisor (`@borjie/stage-advisor`).
 *
 * Live endpoints (services/api-gateway/src/routes/stage/index.ts):
 *   GET  /api/v1/stage/current            current stage + evidence + confidence
 *   GET  /api/v1/stage/playbook           current playbook + task completion
 *   GET  /api/v1/stage/nudges             active proactive nudges
 *   GET  /api/v1/stage/history            past stage transitions
 *   POST /api/v1/stage/nudges/:id/dismiss suppress a nudge
 *
 * Tenant scope is bound server-side via the `app.current_tenant_id` GUC
 * + RLS. The advisor classifies the org's lifecycle stage (pre-launch →
 * ecosystem) off real metrics with hysteresis, then surfaces the
 * playbook + nudges the org needs NOW. Every stage read carries an
 * `evidence[]` chain explaining the classification.
 *
 * NOTE (wiring gap): the gateway mounts these routes but the
 * `stageAdvisor` service is not yet bound into the request `services`
 * registry, so live calls currently return 503 SERVICE_UNAVAILABLE.
 * These hooks degrade cleanly — the panel renders an "unavailable"
 * empty state on 503. See the integration report (STAGE-SERVICE-WIRE).
 */

// ── Current stage ───────────────────────────────────────────────────

const stageContextSchema = z.object({
  tenantId: z.string().optional(),
  stage: z.string().nullable(),
  confidence: z.number().default(0),
  evidence: z.array(z.string()).default([]),
  focusAreas: z.array(z.string()).default([]),
  capabilitiesUnlocked: z.array(z.string()).default([]),
});

export type StageContext = z.infer<typeof stageContextSchema>;

// ── Playbook ────────────────────────────────────────────────────────

const taskEvalSchema = z.object({
  objectiveId: z.string(),
  objectiveName: z.string().optional(),
  taskId: z.string(),
  taskName: z.string(),
  description: z.string().optional(),
  requiredCapability: z.string().optional(),
  completed: z.boolean().optional(),
});

const nextTaskSchema = z.object({
  objectiveId: z.string(),
  taskId: z.string(),
  taskName: z.string(),
  description: z.string().optional(),
  requiredCapability: z.string().optional(),
});

const playbookViewSchema = z.object({
  stage: z.string().nullable(),
  card: z
    .object({
      name: z.string(),
      displayName: z.string(),
      focusAreas: z.array(z.string()).default([]),
      capabilitiesUnlocked: z.array(z.string()).default([]),
      capabilitiesHidden: z.array(z.string()).default([]),
      recommendedTabs: z.array(z.string()).default([]),
      recommendedReports: z.array(z.string()).default([]),
      recommendedAdvisors: z.array(z.string()).default([]),
    })
    .nullable(),
  evaluation: z
    .object({
      stage: z.string(),
      totalTasks: z.number(),
      completedTasks: z.number(),
      completionRatio: z.number(),
      evaluations: z.array(taskEvalSchema).default([]),
      nextIncompleteTasks: z.array(nextTaskSchema).default([]),
    })
    .nullable(),
});

export type PlaybookView = z.infer<typeof playbookViewSchema>;

// ── Nudges ──────────────────────────────────────────────────────────

const nudgeSchema = z.object({
  id: z.string(),
  urgency: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  title: z.string(),
  message: z.string(),
  suggestedActionPrompt: z.string().default(''),
  evidence: z.array(z.string()).default([]),
  dismissable: z.boolean().default(true),
  stage: z.string(),
  generatedAt: z.string(),
});

export type StageNudge = z.infer<typeof nudgeSchema>;

const nudgeListSchema = z.array(nudgeSchema);

export const stageAdvisorKeys = {
  current: () => ['stage-advisor', 'current'] as const,
  playbook: () => ['stage-advisor', 'playbook'] as const,
  nudges: () => ['stage-advisor', 'nudges'] as const,
};

/**
 * Determine if an ApiError was a 503 (service unwired) so the caller can
 * render the graceful unavailable state instead of a hard error.
 */
function isServiceUnavailable(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status?: number }).status === 503
  );
}

export function useStageCurrent() {
  return useQuery({
    queryKey: stageAdvisorKeys.current(),
    queryFn: async ({ signal }): Promise<StageContext> => {
      const raw = await apiRequest<unknown>('/api/v1/stage/current', { signal });
      return stageContextSchema.parse(raw);
    },
    staleTime: 5 * 60_000,
    // 503 means the service isn't wired yet — don't hammer it on retry.
    retry: (count, err) => !isServiceUnavailable(err) && count < 2,
  });
}

export function useStagePlaybook() {
  return useQuery({
    queryKey: stageAdvisorKeys.playbook(),
    queryFn: async ({ signal }): Promise<PlaybookView> => {
      const raw = await apiRequest<unknown>('/api/v1/stage/playbook', { signal });
      return playbookViewSchema.parse(raw);
    },
    staleTime: 5 * 60_000,
    retry: (count, err) => !isServiceUnavailable(err) && count < 2,
  });
}

export function useStageNudges() {
  return useQuery({
    queryKey: stageAdvisorKeys.nudges(),
    queryFn: async ({ signal }): Promise<ReadonlyArray<StageNudge>> => {
      // apiRequest unwraps the gateway `{ success, data }` envelope, so
      // the nudge array arrives directly.
      const raw = await apiRequest<unknown>('/api/v1/stage/nudges', { signal });
      return nudgeListSchema.parse(raw);
    },
    staleTime: 60_000,
    retry: (count, err) => !isServiceUnavailable(err) && count < 2,
  });
}

export function useDismissStageNudge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (nudgeId: string): Promise<{ dismissed: string }> => {
      const raw = await apiRequest<{ dismissed?: string }>(
        `/api/v1/stage/nudges/${encodeURIComponent(nudgeId)}/dismiss`,
        { method: 'POST' },
      );
      return { dismissed: String(raw.dismissed ?? nudgeId) };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stageAdvisorKeys.nudges() });
    },
  });
}
