/**
 * Learning Journeys tests — Wave-12 port.
 */

import { describe, it, expect } from 'vitest';
import {
  JOURNEY_REGISTRY,
  getJourney,
  getStep,
  listJourneysForAudience,
  listJourneysForCountry,
} from '../learning-journeys/journey-registry.js';
import {
  startJourney,
  enterStep,
  completeStep,
  failStep,
  resumeJourney,
  calculateCompletionPercent,
  JourneyRunnerError,
} from '../learning-journeys/journey-runner.js';
import {
  createStepDispatcher,
  DEFAULT_STEP_RENDERER_MAP,
} from '../learning-journeys/step-dispatcher.js';

const NOW = '2026-04-19T10:00:00Z';
const LATER = '2026-04-19T10:15:00Z';

describe('Journey registry', () => {
  it('registers all 6 required journeys', () => {
    const ids = JOURNEY_REGISTRY.map((j) => j.id).sort();
    expect(ids).toEqual([
      'admin-onboarding',
      'compliance-setup',
      'estate-officer-training',
      'migration-wizard',
      'property-owner-onboarding',
      'tenant-onboarding',
    ]);
  });

  it('admin journey has 7 steps', () => {
    expect(getJourney('admin-onboarding')?.steps.length).toBe(7);
  });

  it('property-owner journey has 5 steps', () => {
    expect(getJourney('property-owner-onboarding')?.steps.length).toBe(5);
  });

  it('tenant journey has 4 steps', () => {
    expect(getJourney('tenant-onboarding')?.steps.length).toBe(4);
  });

  it('estate officer training has 12 steps', () => {
    expect(getJourney('estate-officer-training')?.steps.length).toBe(12);
  });

  it('listJourneysForAudience filters correctly', () => {
    const tenant = listJourneysForAudience('tenant');
    expect(tenant.length).toBe(1);
    expect(tenant[0]?.id).toBe('tenant-onboarding');
  });

  it('listJourneysForCountry includes TZA scope', () => {
    const list = listJourneysForCountry('TZA');
    expect(list.length).toBeGreaterThan(0);
  });
});

describe('Journey runner lifecycle', () => {
  it('starts a journey and unlocks first step', () => {
    const { snapshot, events } = startJourney({
      tenantId: 't-1',
      userId: 'u-1',
      journeyId: 'tenant-onboarding',
      now: NOW,
    });
    expect(snapshot.currentStepId).toBe('tenant-welcome');
    expect(snapshot.stepProgress['tenant-welcome']?.status).toBe('unlocked');
    expect(snapshot.stepProgress['tenant-profile']?.status).toBe('locked');
    expect(events[0]).toMatchObject({ kind: 'journey-started' });
  });

  it('throws when starting unknown journey', () => {
    expect(() =>
      startJourney({
        tenantId: 't-1',
        userId: 'u-1',
        journeyId: 'does-not-exist',
        now: NOW,
      }),
    ).toThrow(JourneyRunnerError);
  });

  it('enters a step and marks in-progress', () => {
    const { snapshot } = startJourney({
      tenantId: 't-1',
      userId: 'u-1',
      journeyId: 'tenant-onboarding',
      now: NOW,
    });
    const { snapshot: s2, events } = enterStep({
      snapshot,
      stepId: 'tenant-welcome',
      tenantId: 't-1',
      now: LATER,
    });
    expect(s2.stepProgress['tenant-welcome']?.status).toBe('in-progress');
    expect(events[0]).toMatchObject({ kind: 'step-entered' });
  });

  it('cannot enter locked step', () => {
    const { snapshot } = startJourney({
      tenantId: 't-1',
      userId: 'u-1',
      journeyId: 'tenant-onboarding',
      now: NOW,
    });
    expect(() =>
      enterStep({
        snapshot,
        stepId: 'tenant-profile',
        tenantId: 't-1',
        now: LATER,
      }),
    ).toThrow(/Prerequisites not met/);
  });

  it('completing a step unlocks the next step', () => {
    const { snapshot } = startJourney({
      tenantId: 't-1',
      userId: 'u-1',
      journeyId: 'tenant-onboarding',
      now: NOW,
    });
    const { snapshot: s2 } = completeStep({
      snapshot,
      stepId: 'tenant-welcome',
      tenantId: 't-1',
      now: LATER,
    });
    expect(s2.stepProgress['tenant-welcome']?.status).toBe('completed');
    expect(s2.stepProgress['tenant-profile']?.status).toBe('unlocked');
  });

  it('completes a full journey and emits journey-completed', () => {
    let state = startJourney({
      tenantId: 't-1',
      userId: 'u-1',
      journeyId: 'tenant-onboarding',
      now: NOW,
    }).snapshot;
    const stepIds = ['tenant-welcome', 'tenant-profile', 'tenant-lease-review', 'tenant-first-payment'];
    let lastEvents;
    for (const id of stepIds) {
      const r = completeStep({ snapshot: state, stepId: id, tenantId: 't-1', now: LATER });
      state = r.snapshot;
      lastEvents = r.events;
    }
    expect(state.completedAt).toBeDefined();
    expect(lastEvents?.find((e) => e.kind === 'journey-completed')).toBeDefined();
  });

  it('refuses tenant mismatch on enterStep', () => {
    const { snapshot } = startJourney({
      tenantId: 't-1',
      userId: 'u-1',
      journeyId: 'tenant-onboarding',
      now: NOW,
    });
    expect(() =>
      enterStep({
        snapshot,
        stepId: 'tenant-welcome',
        tenantId: 't-2',
        now: LATER,
      }),
    ).toThrow(/Tenant mismatch/);
  });

  it('refuses tenant mismatch on completeStep', () => {
    const { snapshot } = startJourney({
      tenantId: 't-1',
      userId: 'u-1',
      journeyId: 'tenant-onboarding',
      now: NOW,
    });
    expect(() =>
      completeStep({ snapshot, stepId: 'tenant-welcome', tenantId: 't-2', now: LATER }),
    ).toThrow(/Tenant mismatch/);
  });

  it('failStep increments attempts; at max, status goes failed', () => {
    const { snapshot } = startJourney({
      tenantId: 't-1',
      userId: 'u-1',
      journeyId: 'admin-onboarding',
      now: NOW,
    });
    // go to quiz by completing all prior steps
    let state = snapshot;
    const priorSteps = ['admin-welcome', 'admin-portfolio-shape', 'admin-invite-team', 'admin-approval-policy', 'admin-financial-setup', 'admin-first-report'];
    for (const id of priorSteps) {
      state = completeStep({ snapshot: state, stepId: id, tenantId: 't-1', now: LATER }).snapshot;
    }
    let s2 = state;
    for (let i = 0; i < 3; i++) {
      s2 = failStep({ snapshot: s2, stepId: 'admin-quiz', tenantId: 't-1', now: LATER, reason: 'failed' }).snapshot;
    }
    expect(s2.stepProgress['admin-quiz']?.status).toBe('failed');
  });

  it('resumeJourney returns same snapshot when completed', () => {
    const { snapshot } = startJourney({
      tenantId: 't-1',
      userId: 'u-1',
      journeyId: 'tenant-onboarding',
      now: NOW,
    });
    const completed = { ...snapshot, completedAt: LATER };
    const result = resumeJourney(completed, 't-1');
    expect(result.completedAt).toBe(LATER);
  });

  it('resumeJourney refuses tenant mismatch', () => {
    const { snapshot } = startJourney({
      tenantId: 't-1',
      userId: 'u-1',
      journeyId: 'tenant-onboarding',
      now: NOW,
    });
    expect(() => resumeJourney(snapshot, 't-2')).toThrow(/Tenant mismatch/);
  });

  it('calculateCompletionPercent works', () => {
    const { snapshot } = startJourney({
      tenantId: 't-1',
      userId: 'u-1',
      journeyId: 'tenant-onboarding',
      now: NOW,
    });
    expect(calculateCompletionPercent(snapshot)).toBe(0);
    const s2 = completeStep({ snapshot, stepId: 'tenant-welcome', tenantId: 't-1', now: LATER }).snapshot;
    expect(calculateCompletionPercent(s2)).toBe(25);
  });

  it('getStep returns known step', () => {
    expect(getStep('tenant-onboarding', 'tenant-welcome')).toBeDefined();
  });

  it('getStep returns undefined for unknown', () => {
    expect(getStep('tenant-onboarding', 'nope')).toBeUndefined();
  });
});

describe('Step dispatcher', () => {
  it('dispatches a video step', () => {
    const dispatcher = createStepDispatcher();
    const step = getStep('tenant-onboarding', 'tenant-welcome')!;
    const result = dispatcher.dispatch(step);
    expect(result.componentKey).toBe('VideoPlayer');
  });

  it('dispatches a quiz step', () => {
    const dispatcher = createStepDispatcher();
    const step = getStep('admin-onboarding', 'admin-quiz')!;
    const result = dispatcher.dispatch(step);
    expect(result.componentKey).toBe('QuizRunner');
    expect(result.props.passingScore).toBe(70);
  });

  it('allows overriding a renderer', () => {
    const dispatcher = createStepDispatcher({
      video: () => ({ componentKey: 'CustomVideo', props: {} }),
    });
    const step = getStep('tenant-onboarding', 'tenant-welcome')!;
    expect(dispatcher.dispatch(step).componentKey).toBe('CustomVideo');
  });

  it('default map has all 5 renderers', () => {
    expect(Object.keys(DEFAULT_STEP_RENDERER_MAP).sort()).toEqual([
      'ai-conversation',
      'hands-on-task',
      'quiz',
      'reading',
      'video',
    ]);
  });
});
