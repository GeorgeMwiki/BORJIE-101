/**
 * outcome-capture tests — Wave 28 Learning-Loop.
 */

import { describe, it, expect } from 'vitest';
import {
  createOutcomeCapture,
  createInMemoryOutcomeRepository,
} from '../outcome-capture.js';
import { createFakeEventBus } from './helpers.js';

describe('outcome-capture', () => {
  it('records an outcome programmatically', async () => {
    const repo = createInMemoryOutcomeRepository();
    const capture = createOutcomeCapture({ repository: repo });
    const event = await capture.record({
      actionId: 'a1',
      tenantId: 't1',
      domain: 'finance',
      actionType: 'auto_approve_refund',
      decision: 'auto_approve',
      rationale: 'under threshold',
      confidence: 0.9,
    });
    expect(event.actionId).toBe('a1');
    expect(event.outcome).toBe('pending');
    const roundTrip = await repo.findByActionId('a1');
    expect(roundTrip?.confidence).toBe(0.9);
  });

  it('updates outcome status after a revert signal', async () => {
    const repo = createInMemoryOutcomeRepository();
    const capture = createOutcomeCapture({ repository: repo });
    await capture.record({
      actionId: 'a2',
      tenantId: 't1',
      domain: 'finance',
      actionType: 'auto_approve_refund',
      decision: 'auto_approve',
      rationale: 'under threshold',
      confidence: 0.8,
    });
    const updated = await capture.updateOutcome('a2', {
      outcome: 'reverted',
      feedbackScore: 2,
      observedConsequences: 'customer complained',
    });
    expect(updated?.outcome).toBe('reverted');
    expect(updated?.feedbackScore).toBe(2);
  });

  it('captures action.completed events from the bus', async () => {
    const bus = createFakeEventBus();
    const repo = createInMemoryOutcomeRepository();
    const capture = createOutcomeCapture({ eventBus: bus, repository: repo });
    const unsubscribe = capture.subscribe();

    await bus.publish('action.completed', {
      event: {
        eventType: 'action.completed',
        eventId: 'evt_1',
        tenantId: 't1',
        timestamp: new Date().toISOString(),
        payload: {
          actionId: 'bus_a',
          domain: 'maintenance',
          actionType: 'auto_approve_workorder',
          decision: 'auto_approve',
          rationale: 'under vendor threshold',
          confidence: 0.7,
          outcome: 'success',
        },
      },
    });

    const row = await repo.findByActionId('bus_a');
    expect(row?.domain).toBe('maintenance');
    expect(row?.outcome).toBe('success');
    unsubscribe();
  });

  it('validates required fields', async () => {
    const repo = createInMemoryOutcomeRepository();
    const capture = createOutcomeCapture({ repository: repo });
    await expect(
      capture.record({
        actionId: '',
        tenantId: 't',
        domain: 'finance',
        actionType: 'x',
        decision: 'y',
        rationale: '',
        confidence: 1,
      }),
    ).rejects.toThrow(/actionId/);
  });
});
