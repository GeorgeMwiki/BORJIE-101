/**
 * Handoff power-tool tests.
 */

import { describe, it, expect } from 'vitest';
import { handoffPowerTool } from '../handoff.js';
import type { PowerToolContext } from '../types.js';

function makeCtx(
  overrides: Partial<PowerToolContext> = {},
): PowerToolContext {
  return {
    callerId: 'u_test',
    tier: 'estate-manager',
    tenantId: 't_1',
    threadId: 'thread_1',
    approvalRecordId: null,
    auditSink: null,
    clock: () => new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('handoffPowerTool', () => {
  it('declares the expected static shape', () => {
    expect(handoffPowerTool.id).toBe('handoff');
    expect(handoffPowerTool.requiredTier).toBe('tenant-resident');
    expect(handoffPowerTool.requiresApproval).toBe(false);
    expect(handoffPowerTool.auditDestination).toBe('audit-events');
  });

  it('returns ok when escalating UP and tags `appliesFromTurn: next`', async () => {
    const result = await handoffPowerTool.execute(makeCtx({ tier: 'estate-manager' }), {
      targetTier: 'org-admin',
      intent: 'escalate',
      rationale: 'need court-filing authorisation for eviction',
      conversationRef: 'conv_1',
      expectedAction: 'authorise',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.output.fromTier).toBe('estate-manager');
      expect(result.output.toTier).toBe('org-admin');
      expect(result.output.appliesFromTurn).toBe('next');
      expect(result.output.intent).toBe('escalate');
    }
  });

  it('refuses lateral handoff (same tier)', async () => {
    const result = await handoffPowerTool.execute(makeCtx({ tier: 'estate-manager' }), {
      targetTier: 'estate-manager',
      intent: 'consult',
      rationale: 'need another estate-manager voice on this case',
      conversationRef: 'conv_1',
      expectedAction: 'advise',
    });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.reasonCode).toBe('OUT_OF_SCOPE');
    }
  });

  it('refuses downward handoff', async () => {
    const result = await handoffPowerTool.execute(makeCtx({ tier: 'org-admin' }), {
      targetTier: 'tenant-resident',
      intent: 'defer',
      rationale: 'try to handle it at the resident-concierge level',
      conversationRef: 'conv_1',
      expectedAction: 'advise',
    });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.reasonCode).toBe('OUT_OF_SCOPE');
    }
  });

  it('preserves the optional deadline through to the output', async () => {
    const result = await handoffPowerTool.execute(makeCtx({ tier: 'estate-manager' }), {
      targetTier: 'org-admin',
      intent: 'request_review',
      rationale: 'time-sensitive lease exception above my band',
      conversationRef: 'conv_42',
      expectedAction: 'decision',
      deadlineIso: '2026-01-05T12:00:00Z',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.output.deadlineIso).toBe('2026-01-05T12:00:00Z');
    }
  });

  it('emits null deadline when caller omits one', async () => {
    const result = await handoffPowerTool.execute(makeCtx({ tier: 'owner-advisor' }), {
      targetTier: 'org-admin',
      intent: 'transfer_ownership',
      rationale: 'I am stepping out for the day; please pick up case 17',
      conversationRef: 'conv_17',
      expectedAction: 'decision',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.output.deadlineIso).toBeNull();
    }
  });

  it('Zod schema rejects too-short rationale', () => {
    const parsed = handoffPowerTool.schema.safeParse({
      targetTier: 'org-admin',
      intent: 'escalate',
      rationale: 'too short',
      conversationRef: 'c_1',
      expectedAction: 'decision',
    });
    expect(parsed.success).toBe(false);
  });
});
