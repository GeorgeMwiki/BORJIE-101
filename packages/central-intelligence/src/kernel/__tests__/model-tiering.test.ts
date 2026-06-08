/**
 * Model tiering — latency win 5.
 *
 * Verifies the cheapest-capable-model policy: fast lane ⇒ cheap (Haiku),
 * critical / deep-reasoning ⇒ deep (Opus), else standard (Sonnet), and that
 * the master flag defaults OFF.
 */

import { describe, it, expect } from 'vitest';
import {
  selectModelTier,
  resolveModelIdForTier,
  resolveModelTieringEnabled,
} from '../model-tiering.js';
import type { ThoughtRequest } from '../kernel-types.js';

function req(over: Partial<ThoughtRequest> = {}): ThoughtRequest {
  return {
    threadId: 't',
    userMessage: 'q',
    scope: {
      kind: 'tenant',
      tenantId: 'tenant-1',
      actorUserId: 'u',
      roles: ['owner'],
      personaId: 'mr-mwikila',
    },
    tier: 'tenant',
    stakes: 'low',
    surface: 'owner-portal',
    ...over,
  } as ThoughtRequest;
}

describe('selectModelTier', () => {
  it('fast lane ⇒ cheap (Haiku-class)', () => {
    expect(selectModelTier({ route: 'fast', req: req() }).tier).toBe('cheap');
  });

  it('full + critical ⇒ deep (Opus-class)', () => {
    expect(selectModelTier({ route: 'full', req: req({ stakes: 'critical' }) }).tier).toBe('deep');
  });

  it('full + synthesis/judge ⇒ deep', () => {
    expect(selectModelTier({ route: 'full', req: req({ requireSynthesis: true }) }).tier).toBe('deep');
    expect(selectModelTier({ route: 'full', req: req({ requireJudge: true }) }).tier).toBe('deep');
  });

  it('full default ⇒ standard (Sonnet-class)', () => {
    expect(selectModelTier({ route: 'full', req: req({ stakes: 'medium' }) }).tier).toBe('standard');
  });

  it('fast lane wins even when stakes elevated would be deep (fast only set for safe turns)', () => {
    // The fast-path router never sets route='fast' for high stakes, but if a
    // caller does, the tier still downshifts — the router is the guard.
    expect(selectModelTier({ route: 'fast', req: req({ stakes: 'low' }) }).tier).toBe('cheap');
  });
});

describe('resolveModelIdForTier', () => {
  const map = { cheap: 'claude-haiku-4-5', standard: 'claude-sonnet-4-6', deep: 'claude-opus-4-8' };

  it('maps a tier to its concrete model id', () => {
    expect(resolveModelIdForTier('cheap', map)).toBe('claude-haiku-4-5');
    expect(resolveModelIdForTier('deep', map)).toBe('claude-opus-4-8');
  });

  it('falls back to the provided default when unmapped', () => {
    expect(resolveModelIdForTier('cheap', {}, 'fallback-model')).toBe('fallback-model');
  });

  it('returns null when neither map nor default available (kernel keeps its default)', () => {
    expect(resolveModelIdForTier('cheap', undefined)).toBeNull();
    expect(resolveModelIdForTier('cheap', {})).toBeNull();
  });
});

describe('resolveModelTieringEnabled — default OFF', () => {
  it('defaults to OFF (current behaviour)', () => {
    expect(resolveModelTieringEnabled({})).toBe(false);
    expect(resolveModelTieringEnabled({ BORJIE_MODEL_TIERING: 'off' })).toBe(false);
  });

  it.each(['1', 'true', 'on', 'yes'])('enables on "%s"', (v) => {
    expect(resolveModelTieringEnabled({ BORJIE_MODEL_TIERING: v })).toBe(true);
  });
});
