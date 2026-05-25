import { describe, it, expect } from 'vitest';
import {
  next,
  startOnboarding,
  ONBOARDING_STEPS,
  ONBOARDING_STEP_ORDER,
  ONBOARDING_STEPS_TOTAL,
  derivePolicy,
  DELEGATION_MATRIX_DIMENSIONS,
  type OnboardingAnswer,
} from '../../autonomy/index.js';

describe('onboarding flow', () => {
  it('has exactly 7 steps', () => {
    expect(ONBOARDING_STEPS_TOTAL).toBe(7);
    expect(ONBOARDING_STEP_ORDER).toHaveLength(7);
  });

  it('exposes prompt text for every step', () => {
    for (const id of ONBOARDING_STEP_ORDER) {
      expect(ONBOARDING_STEPS[id].prompt.length).toBeGreaterThan(0);
      expect(ONBOARDING_STEPS[id].choices.length).toBeGreaterThan(0);
    }
  });

  it('step 1 answer advances to step 2 and is not yet complete', () => {
    let state = startOnboarding();
    const answer: OnboardingAnswer = {
      stepId: 'deposit_policy',
      choice: 'auto_below_100k',
    };
    const advance = next('deposit_policy', answer, state);
    expect(advance.nextStepId).toBe('maintenance_threshold');
    expect(advance.complete).toBe(false);
    expect(advance.derivedPolicy).toBeNull();
  });

  it('full 7-step flow yields a derived policy with autonomous mode flipped on', () => {
    let state = startOnboarding();
    const script: OnboardingAnswer[] = [
      { stepId: 'deposit_policy', choice: 'auto_below_100k' },
      { stepId: 'maintenance_threshold', choice: 'up_to_100k' },
      { stepId: 'renewals_auto_approve', choice: 'up_to_8%' },
      { stepId: 'compliance_policy', choice: 'draft_auto_send_non_legal' },
      {
        stepId: 'escalation_path',
        choice: 'primary_and_secondary',
        primaryUserId: 'head_1',
        secondaryUserId: 'deputy_1',
      },
      { stepId: 'delegation_matrix_preview', choice: 'confirm' },
      { stepId: 'confirmation', choice: 'enable_now' },
    ];
    let advance;
    for (let i = 0; i < script.length; i++) {
      advance = next(ONBOARDING_STEP_ORDER[i], script[i], state);
      state = advance.state;
    }
    expect(advance!.complete).toBe(true);
    expect(advance!.derivedPolicy?.autonomousModeEnabled).toBe(true);
    expect(advance!.derivedPolicy?.maintenance?.autoApproveBelowMinorUnits).toBe(
      100_000,
    );
    expect(advance!.derivedPolicy?.leasing?.maxAutoApproveRentIncreasePct).toBe(8);
    expect(advance!.derivedPolicy?.escalation?.primaryUserId).toBe('head_1');
    expect(advance!.derivedPolicy?.compliance?.autoDraftNotices).toBe(true);
  });

  it('mismatched stepId throws', () => {
    const state = startOnboarding();
    expect(() =>
      next('deposit_policy', {
        stepId: 'maintenance_threshold',
        choice: 'up_to_100k',
      } as OnboardingAnswer, state),
    ).toThrow();
  });

  it('save_draft on confirmation step leaves autonomous mode off', () => {
    const answered: OnboardingAnswer[] = [
      { stepId: 'deposit_policy', choice: 'always_review' },
      { stepId: 'maintenance_threshold', choice: 'always_review' },
      { stepId: 'renewals_auto_approve', choice: 'always_review' },
      { stepId: 'compliance_policy', choice: 'always_review' },
      {
        stepId: 'escalation_path',
        choice: 'primary_only',
        primaryUserId: 'head_1',
      },
      { stepId: 'delegation_matrix_preview', choice: 'tune' },
      { stepId: 'confirmation', choice: 'save_draft' },
    ];
    let state = startOnboarding();
    let advance;
    for (let i = 0; i < answered.length; i++) {
      advance = next(ONBOARDING_STEP_ORDER[i], answered[i], state);
      state = advance.state;
    }
    expect(advance!.derivedPolicy?.autonomousModeEnabled).toBe(false);
  });

  it('derivePolicy tolerates partial state', () => {
    const partial = derivePolicy({
      answers: {
        deposit_policy: { stepId: 'deposit_policy', choice: 'auto_below_50k' },
      },
    });
    expect(partial.finance?.autoApproveRefundsMinorUnits).toBe(5_000_000);
  });

  it('delegation matrix dims are 11x6 = 66 cells (Wave 27 Part B.9 expansion)', () => {
    expect(DELEGATION_MATRIX_DIMENSIONS.totalCells).toBe(66);
    expect(DELEGATION_MATRIX_DIMENSIONS.domains).toBe(11);
    expect(DELEGATION_MATRIX_DIMENSIONS.actionTypes).toBe(6);
  });
});
