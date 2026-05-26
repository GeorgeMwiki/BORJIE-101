'use client';

import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

export type OnboardingStep =
  | 'kyb'
  | 'licences'
  | 'sites'
  | 'drill_holes'
  | 'cockpit_seed';

export interface OnboardingSession {
  readonly sessionId: string;
  readonly currentStep: OnboardingStep | 'complete';
}

/**
 * POST /api/v1/mining/onboarding/start — fired on wizard mount when
 * no session id is in local storage. Returns the new session id.
 */
export function useStartOnboarding() {
  return useMutation({
    mutationFn: () =>
      apiRequest<OnboardingSession>(`/api/v1/mining/onboarding/start`, {
        method: 'POST',
        body: {},
      }),
  });
}

export interface AdvanceInput {
  readonly sessionId: string;
  readonly step: OnboardingStep;
  readonly payload: unknown;
}

/**
 * POST /api/v1/mining/onboarding/advance — invoked at each Next click
 * with the validated step payload. The orchestrator persists state
 * server-side so a reload picks up where the owner left off.
 */
export function useAdvanceOnboarding() {
  return useMutation({
    mutationFn: (input: AdvanceInput) =>
      apiRequest<OnboardingSession>(`/api/v1/mining/onboarding/advance`, {
        method: 'POST',
        body: input,
      }),
  });
}

/**
 * POST /api/v1/mining/onboarding/complete — last step. Finalises the
 * session and seeds the cockpit. On 2xx the wizard redirects to `/`.
 */
export function useCompleteOnboarding() {
  return useMutation({
    mutationFn: (sessionId: string) =>
      apiRequest<{ readonly sessionId: string; readonly briefId?: string }>(
        `/api/v1/mining/onboarding/complete`,
        { method: 'POST', body: { sessionId } },
      ),
  });
}
