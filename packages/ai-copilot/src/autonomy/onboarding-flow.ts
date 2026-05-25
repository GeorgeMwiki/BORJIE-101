/**
 * Autonomous-mode onboarding flow.
 *
 * 7-step conversational flow that runs through the Mr. Mwikila widget
 * the first time a head enables autonomous mode. Each step captures one
 * policy knob; answers are persisted per-step via
 * `progressive-intelligence` so the head can step away and resume later.
 *
 * The flow is transport-free: the widget calls `next(currentStep,
 * answer, state)` to advance. When the last step resolves, the flow
 * returns a complete UpdatePolicyInput plus a confirmation summary.
 */

import type { UpdatePolicyInput } from './types.js';

export type OnboardingStepId =
  | 'deposit_policy'
  | 'maintenance_threshold'
  | 'renewals_auto_approve'
  | 'compliance_policy'
  | 'escalation_path'
  | 'delegation_matrix_preview'
  | 'confirmation';

export const ONBOARDING_STEP_ORDER: readonly OnboardingStepId[] = [
  'deposit_policy',
  'maintenance_threshold',
  'renewals_auto_approve',
  'compliance_policy',
  'escalation_path',
  'delegation_matrix_preview',
  'confirmation',
];

export const ONBOARDING_STEPS_TOTAL = ONBOARDING_STEP_ORDER.length;

export interface OnboardingStepDefinition {
  readonly id: OnboardingStepId;
  readonly prompt: string;
  readonly rationale: string;
  readonly choices: readonly string[];
}

export const ONBOARDING_STEPS: Record<OnboardingStepId, OnboardingStepDefinition> = {
  deposit_policy: {
    id: 'deposit_policy',
    prompt: 'How should deposits refunds be handled on move-out?',
    rationale: 'Sets the finance.auto_approve_refunds threshold.',
    choices: ['auto_below_50k', 'auto_below_100k', 'always_review'],
  },
  maintenance_threshold: {
    id: 'maintenance_threshold',
    prompt: 'What maintenance spend may Mr. Mwikila approve on his own?',
    rationale: 'Sets maintenance.auto_approve_below.',
    choices: ['up_to_50k', 'up_to_100k', 'up_to_250k', 'always_review'],
  },
  renewals_auto_approve: {
    id: 'renewals_auto_approve',
    prompt: 'On same-terms renewals, what rent bump may Mr. Mwikila approve?',
    rationale: 'Sets leasing.max_auto_approve_rent_increase_pct.',
    choices: ['0%', 'up_to_5%', 'up_to_8%', 'up_to_12%', 'always_review'],
  },
  compliance_policy: {
    id: 'compliance_policy',
    prompt: 'Should Mr. Mwikila draft compliance notices automatically?',
    rationale: 'Sets compliance.auto_draft_notices. Legal notices never auto-send.',
    choices: ['draft_auto_send_never', 'draft_auto_send_non_legal', 'always_review'],
  },
  escalation_path: {
    id: 'escalation_path',
    prompt: 'Who should I escalate to when I hit a rail?',
    rationale: 'Sets escalation.primary_user_id + secondary_user_id.',
    choices: ['primary_only', 'primary_and_secondary', 'primary_and_email_fallback'],
  },
  delegation_matrix_preview: {
    id: 'delegation_matrix_preview',
    prompt: 'Here is the delegation matrix your answers produced — confirm or tune.',
    rationale: 'Shows derived per-domain rules for inspection.',
    choices: ['confirm', 'tune'],
  },
  confirmation: {
    id: 'confirmation',
    prompt: 'Enable Autonomous Department Mode now?',
    rationale: 'Flips the master switch once all 6 prior steps are set.',
    choices: ['enable_now', 'save_draft'],
  },
};

export type OnboardingAnswer =
  | { stepId: 'deposit_policy'; choice: 'auto_below_50k' | 'auto_below_100k' | 'always_review' }
  | {
      stepId: 'maintenance_threshold';
      choice: 'up_to_50k' | 'up_to_100k' | 'up_to_250k' | 'always_review';
    }
  | {
      stepId: 'renewals_auto_approve';
      choice: '0%' | 'up_to_5%' | 'up_to_8%' | 'up_to_12%' | 'always_review';
    }
  | {
      stepId: 'compliance_policy';
      choice: 'draft_auto_send_never' | 'draft_auto_send_non_legal' | 'always_review';
    }
  | {
      stepId: 'escalation_path';
      choice: 'primary_only' | 'primary_and_secondary' | 'primary_and_email_fallback';
      primaryUserId?: string;
      secondaryUserId?: string;
      fallbackEmails?: readonly string[];
    }
  | { stepId: 'delegation_matrix_preview'; choice: 'confirm' | 'tune' }
  | { stepId: 'confirmation'; choice: 'enable_now' | 'save_draft' };

export interface OnboardingState {
  readonly answers: Partial<Record<OnboardingStepId, OnboardingAnswer>>;
}

export interface OnboardingAdvance {
  readonly state: OnboardingState;
  readonly nextStepId: OnboardingStepId | null;
  readonly complete: boolean;
  readonly derivedPolicy: UpdatePolicyInput | null;
  readonly summary: string | null;
}

export function startOnboarding(): OnboardingState {
  return { answers: {} };
}

export function next(
  currentStep: OnboardingStepId,
  answer: OnboardingAnswer,
  state: OnboardingState,
): OnboardingAdvance {
  if (answer.stepId !== currentStep) {
    throw new Error(`Answer stepId ${answer.stepId} does not match current ${currentStep}`);
  }
  const nextAnswers = { ...state.answers, [currentStep]: answer };
  const nextState: OnboardingState = { answers: nextAnswers };
  const currentIdx = ONBOARDING_STEP_ORDER.indexOf(currentStep);
  const nextIdx = currentIdx + 1;
  if (nextIdx < ONBOARDING_STEP_ORDER.length) {
    return {
      state: nextState,
      nextStepId: ONBOARDING_STEP_ORDER[nextIdx],
      complete: false,
      derivedPolicy: null,
      summary: null,
    };
  }
  // Last answer landed — derive policy.
  const derived = derivePolicy(nextState);
  const summary = summarise(nextState, derived);
  return {
    state: nextState,
    nextStepId: null,
    complete: true,
    derivedPolicy: derived,
    summary,
  };
}

export function derivePolicy(state: OnboardingState): UpdatePolicyInput {
  const dep = state.answers.deposit_policy;
  const finance =
    dep && dep.stepId === 'deposit_policy'
      ? {
          autoApproveRefundsMinorUnits:
            dep.choice === 'auto_below_50k'
              ? 50_000_00
              : dep.choice === 'auto_below_100k'
                ? 100_000_00
                : 0,
        }
      : undefined;
  const maint = state.answers.maintenance_threshold;
  const maintenance =
    maint && maint.stepId === 'maintenance_threshold'
      ? {
          autoApproveBelowMinorUnits:
            maint.choice === 'up_to_50k'
              ? 50_000
              : maint.choice === 'up_to_100k'
                ? 100_000
                : maint.choice === 'up_to_250k'
                  ? 250_000
                  : 0,
        }
      : undefined;
  const ren = state.answers.renewals_auto_approve;
  const leasing =
    ren && ren.stepId === 'renewals_auto_approve'
      ? (() => {
          const pct =
            ren.choice === '0%'
              ? 0
              : ren.choice === 'up_to_5%'
                ? 5
                : ren.choice === 'up_to_8%'
                  ? 8
                  : ren.choice === 'up_to_12%'
                    ? 12
                    : -1;
          return {
            autoApproveRenewalsSameTerms: pct >= 0,
            maxAutoApproveRentIncreasePct: pct >= 0 ? pct : 0,
          };
        })()
      : undefined;
  const comp = state.answers.compliance_policy;
  const compliance =
    comp && comp.stepId === 'compliance_policy'
      ? {
          autoDraftNotices: comp.choice !== 'always_review',
          autoSendLegalNotices: false as const,
        }
      : undefined;
  const esc = state.answers.escalation_path;
  const escalation =
    esc && esc.stepId === 'escalation_path'
      ? {
          primaryUserId: esc.primaryUserId ?? null,
          secondaryUserId:
            esc.choice === 'primary_and_secondary'
              ? (esc.secondaryUserId ?? null)
              : null,
          fallbackEmails:
            esc.choice === 'primary_and_email_fallback'
              ? (esc.fallbackEmails ?? [])
              : [],
        }
      : undefined;
  const conf = state.answers.confirmation;
  const autonomousModeEnabled =
    conf?.stepId === 'confirmation' && conf.choice === 'enable_now';
  return {
    autonomousModeEnabled,
    ...(finance ? { finance } : {}),
    ...(maintenance ? { maintenance } : {}),
    ...(leasing ? { leasing } : {}),
    ...(compliance ? { compliance } : {}),
    ...(escalation ? { escalation } : {}),
  };
}

function summarise(_state: OnboardingState, derived: UpdatePolicyInput): string {
  const parts: string[] = [];
  if (derived.autonomousModeEnabled) parts.push('Autonomous mode ENABLED.');
  if (derived.finance)
    parts.push(`Refunds auto-approved below ${derived.finance.autoApproveRefundsMinorUnits}.`);
  if (derived.maintenance)
    parts.push(`Maintenance auto-approved below ${derived.maintenance.autoApproveBelowMinorUnits}.`);
  if (derived.leasing)
    parts.push(`Renewals auto-approved up to +${derived.leasing.maxAutoApproveRentIncreasePct}%.`);
  if (derived.compliance) parts.push('Legal notices will NEVER auto-send.');
  if (derived.escalation)
    parts.push(`Escalation primary: ${derived.escalation.primaryUserId ?? 'unset'}.`);
  return parts.join(' ');
}
