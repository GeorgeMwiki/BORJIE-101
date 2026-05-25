/**
 * Brain integration tests — wrap an advisor and seed conversation
 * openers.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  wrapAdvisorWithStageContext,
  seedConversationOpener,
} from '../brain-integration/index.js';
import type { StageContext } from '../types.js';

describe('seedConversationOpener — stage + role tailored', () => {
  it('mentions the stage display name and a role-shaped greeting', () => {
    const opener = seedConversationOpener({
      stage: 'sapling',
      role: 'property-manager',
    });
    expect(opener).toContain('Sapling');
    expect(opener.toLowerCase()).toContain('portfolio');
  });

  it('tenant gets a warm friendly opener', () => {
    const opener = seedConversationOpener({
      stage: 'seedling',
      role: 'tenant',
    });
    expect(opener.toLowerCase()).toContain('unit');
  });

  it('admin gets ops framing', () => {
    const opener = seedConversationOpener({
      stage: 'ecosystem',
      role: 'admin',
    });
    expect(opener.toLowerCase()).toContain('platform');
  });

  it('every stage yields a non-empty opener for every role', () => {
    const stages = [
      'pre-launch',
      'seedling',
      'sprout',
      'sapling',
      'tree',
      'forest',
      'ecosystem',
    ] as const;
    const roles = [
      'admin',
      'property-manager',
      'estate-manager',
      'owner',
      'tenant',
      'prospect',
      'service-provider',
    ] as const;
    for (const stage of stages) {
      for (const role of roles) {
        const opener = seedConversationOpener({ stage, role });
        expect(opener.length).toBeGreaterThan(20);
      }
    }
  });
});

describe('wrapAdvisorWithStageContext — middleware behaviour', () => {
  it('attaches stage context to the response', async () => {
    const advisor = {
      advise: vi.fn(async (req: { user: { tenantId: string } }) => ({
        answer: `Answer for ${req.user.tenantId}`,
      })),
    };
    const stageDetector = {
      detect: vi.fn(
        async (tenantId: string): Promise<StageContext | null> => ({
          tenantId,
          stage: 'sapling',
          confidence: 0.9,
          evidence: ['units=100'],
          focusAreas: ['procurement'],
          capabilitiesUnlocked: ['procurement-coordination'],
        }),
      ),
    };
    const wrapped = wrapAdvisorWithStageContext({ advisor, stageDetector });
    const res = await wrapped.advise({ user: { tenantId: 'tn-1' } });
    expect(res.base.answer).toBe('Answer for tn-1');
    expect(res.stageContext?.stage).toBe('sapling');
    expect(stageDetector.detect).toHaveBeenCalledWith('tn-1');
    expect(advisor.advise).toHaveBeenCalledTimes(1);
  });

  it('passes stage info that includes the call signature fields', async () => {
    const advisor = {
      advise: vi.fn(async () => ({ ok: true })),
    };
    const stageDetector = {
      detect: vi.fn(async (): Promise<StageContext | null> => ({
        tenantId: 'tn-1',
        stage: 'tree',
        confidence: 0.95,
        evidence: ['units=500'],
        focusAreas: ['fleet'],
        capabilitiesUnlocked: ['fleet-management'],
      })),
    };
    const wrapped = wrapAdvisorWithStageContext({ advisor, stageDetector });
    const res = await wrapped.advise({ user: { tenantId: 'tn-1' } });
    // Verify the StageContext is structurally complete + carries
    // tenant, stage, confidence, evidence, focusAreas, caps.
    expect(res.stageContext).toMatchObject({
      tenantId: 'tn-1',
      stage: 'tree',
      confidence: expect.any(Number),
      evidence: expect.any(Array),
      focusAreas: expect.any(Array),
      capabilitiesUnlocked: expect.any(Array),
    });
  });

  it('returns null stageContext when detector fails silently', async () => {
    const advisor = {
      advise: vi.fn(async () => ({ answer: 'ok' })),
    };
    const stageDetector = {
      detect: vi.fn(async () => {
        throw new Error('detector unavailable');
      }),
    };
    const wrapped = wrapAdvisorWithStageContext({ advisor, stageDetector });
    const res = await wrapped.advise({ user: { tenantId: 'tn-1' } });
    expect(res.base.answer).toBe('ok');
    expect(res.stageContext).toBeNull();
  });

  it('returns null stageContext when detector says no metrics yet', async () => {
    const advisor = {
      advise: vi.fn(async () => ({ ok: true })),
    };
    const stageDetector = {
      detect: vi.fn(async () => null),
    };
    const wrapped = wrapAdvisorWithStageContext({ advisor, stageDetector });
    const res = await wrapped.advise({ user: { tenantId: 'tn-new' } });
    expect(res.stageContext).toBeNull();
  });

  it('original advisor call is unchanged (additive)', async () => {
    const advisor = {
      advise: vi.fn(async (req: { user: { tenantId: string } }) => ({
        echo: req.user.tenantId,
      })),
    };
    const stageDetector = {
      detect: vi.fn(async () => null),
    };
    const wrapped = wrapAdvisorWithStageContext({ advisor, stageDetector });
    await wrapped.advise({ user: { tenantId: 'tn-x' } });
    // Confirm the advisor received the original request, untouched.
    expect(advisor.advise).toHaveBeenCalledWith({ user: { tenantId: 'tn-x' } });
  });
});
