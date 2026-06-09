/**
 * Trust + Theory-of-Mind SSE normaliser tests.
 *
 * These guard the wire-format bridge between the brain-teach stream's
 * `debate_metadata` / `brain_state` / `auto_authorized` / `affective_profile`
 * frames (emitted by services/api-gateway/src/routes/brain-teach.hono.ts)
 * and the badges + ProactiveHint feed rendered in HomeChatTeach. Mirrors
 * the blackboard-bridge pattern: test the pure bridge, not the fetch
 * machinery.
 */

import { describe, it, expect } from 'vitest';
import {
  normaliseAffectiveProfile,
  normaliseDebateBadge,
  normaliseBrainStateBadge,
  normaliseAutoAuthorized,
} from '../teach-sse-normalisers';

describe('normaliseAffectiveProfile', () => {
  it('maps the exact five-axis frame the gateway emits', () => {
    // Shape mirrors brain-teach.hono.ts: { ...AffectiveProfile.state,
    // lastUpdated, turns, at }.
    const frame = {
      frustration: 0.9,
      comprehension: 0.4,
      anxiety: 0.2,
      trust: 0.7,
      urgency: 0.5,
      lastUpdated: '2026-05-31T10:00:00.000Z',
      turns: 4,
      at: '2026-05-31T10:00:00.000Z',
    };
    const profile = normaliseAffectiveProfile(frame);
    expect(profile).toEqual({
      frustration: 0.9,
      comprehension: 0.4,
      anxiety: 0.2,
      trust: 0.7,
      urgency: 0.5,
      lastUpdated: '2026-05-31T10:00:00.000Z',
    });
  });

  it('returns null when any axis is missing (never a half-formed hint)', () => {
    expect(
      normaliseAffectiveProfile({
        frustration: 0.9,
        comprehension: 0.4,
        anxiety: 0.2,
        trust: 0.7,
        // urgency missing
        lastUpdated: '2026-05-31T10:00:00.000Z',
      }),
    ).toBeNull();
  });

  it('returns null for non-numeric axes and non-records', () => {
    expect(
      normaliseAffectiveProfile({
        frustration: 'high',
        comprehension: 0.4,
        anxiety: 0.2,
        trust: 0.7,
        urgency: 0.5,
      }),
    ).toBeNull();
    expect(normaliseAffectiveProfile(null)).toBeNull();
    expect(normaliseAffectiveProfile('nope')).toBeNull();
  });

  it('synthesises lastUpdated when the frame omits it', () => {
    const profile = normaliseAffectiveProfile({
      frustration: 0.1,
      comprehension: 0.9,
      anxiety: 0.1,
      trust: 0.9,
      urgency: 0.1,
    });
    expect(profile).not.toBeNull();
    expect(typeof profile?.lastUpdated).toBe('string');
  });
});

describe('normaliseDebateBadge', () => {
  it('reads verified + contenders from the provider-agnostic gateway frame', () => {
    // CLOSE-G: the frame carries NO winner/provider/model/judge identity.
    const frame = {
      verified: true,
      contenders: 3,
      at: '2026-05-31T10:00:00.000Z',
    };
    expect(normaliseDebateBadge(frame)).toEqual({
      verified: true,
      contenders: 3,
    });
  });

  it('NEVER surfaces provider/model identity, even if a stale frame still carries it (IP-egress invariant)', () => {
    // Defence in depth: should the wire ever regress and re-include winner /
    // provider / model / judge identity, the normaliser must DROP it — the
    // badge shape exposes only { verified, contenders }.
    const leakyFrame = {
      verified: true,
      contenders: 2,
      winner: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      trace: { judgeProvider: 'openai', responses: [{}, {}] },
    };
    const badge = normaliseDebateBadge(leakyFrame);
    expect(badge).toEqual({ verified: true, contenders: 2 });
    const serialised = JSON.stringify(badge);
    expect(serialised).not.toMatch(/anthropic|openai|claude|provider|model/i);
  });

  it('defaults contenders to 0 when absent or non-numeric', () => {
    expect(normaliseDebateBadge({ verified: false })).toEqual({
      verified: false,
      contenders: 0,
    });
    expect(
      normaliseDebateBadge({ verified: true, contenders: 'three' }),
    ).toEqual({ verified: true, contenders: 0 });
  });

  it('returns null for a non-record payload', () => {
    expect(normaliseDebateBadge(undefined)).toBeNull();
  });
});

describe('normaliseBrainStateBadge', () => {
  it('surfaces the degraded pill with its label', () => {
    expect(
      normaliseBrainStateBadge({
        degraded: true,
        consecutiveFailures: 2,
        label: 'Brain operating in degraded mode',
      }),
    ).toEqual({
      label: 'Brain operating in degraded mode',
      consecutiveFailures: 2,
    });
  });

  it('returns null when not degraded (healthy turns carry no pill)', () => {
    expect(
      normaliseBrainStateBadge({ degraded: false, consecutiveFailures: 0 }),
    ).toBeNull();
  });
});

describe('normaliseAutoAuthorized', () => {
  it('reads the action + rationale from the nested payload envelope', () => {
    expect(
      normaliseAutoAuthorized({
        payload: { action: 'reminder_set', rationale: 'Low-risk, reversible.' },
        at: '2026-05-31T10:00:00.000Z',
      }),
    ).toEqual({ action: 'reminder_set', rationale: 'Low-risk, reversible.' });
  });

  it('falls back to a top-level action + `reason` field', () => {
    expect(
      normaliseAutoAuthorized({ action: 'draft_saved', reason: 'Draft only.' }),
    ).toEqual({ action: 'draft_saved', rationale: 'Draft only.' });
  });

  it('returns null when no action is present', () => {
    expect(normaliseAutoAuthorized({ payload: { rationale: 'x' } })).toBeNull();
    expect(normaliseAutoAuthorized(null)).toBeNull();
  });
});
