import { describe, it, expect } from 'vitest';
import {
  masteryDefaultMode,
  defaultVerbosityForMode,
  resolveVoiceProfile,
  type ResolveModeDeps,
} from '../mode/mode-selector.js';
import { createInMemoryVoiceModeRepository } from '../repositories/voice-mode-repository.js';

const fixedClock = (): Date => new Date('2026-05-26T09:00:00.000Z');

function buildDeps(): ResolveModeDeps {
  return {
    repo: createInMemoryVoiceModeRepository(),
    clock: fixedClock,
  };
}

describe('masteryDefaultMode', () => {
  it('returns LEARN for mastery below 0.7', () => {
    expect(masteryDefaultMode(0)).toBe('learn');
    expect(masteryDefaultMode(0.3)).toBe('learn');
    expect(masteryDefaultMode(0.6)).toBe('learn');
  });

  it('returns GUIDE for mastery at or above 0.7', () => {
    expect(masteryDefaultMode(0.7)).toBe('guide');
    expect(masteryDefaultMode(0.9)).toBe('guide');
    expect(masteryDefaultMode(1.0)).toBe('guide');
  });

  it('returns BALANCED when mastery is NaN', () => {
    expect(masteryDefaultMode(Number.NaN)).toBe('balanced');
  });
});

describe('defaultVerbosityForMode', () => {
  it('returns 3 for LEARN (Socratic prompts need room)', () => {
    expect(defaultVerbosityForMode('learn')).toBe(3);
  });

  it('returns 2 for GUIDE and BALANCED (terse / neutral)', () => {
    expect(defaultVerbosityForMode('guide')).toBe(2);
    expect(defaultVerbosityForMode('balanced')).toBe(2);
  });
});

describe('resolveVoiceProfile — cascade order', () => {
  it('respects a tenant-policy override above stored preference', async () => {
    const deps = buildDeps();
    await deps.repo.upsert({
      tenant_id: 't1',
      user_id: 'u1',
      mode: 'guide',
      verbosity_level: 2,
      updated_at: fixedClock().toISOString(),
    });
    const profile = await resolveVoiceProfile(deps, {
      tenant_id: 't1',
      user_id: 'u1',
      tenant_policy_default: 'learn',
    });
    expect(profile.mode).toBe('learn');
    expect(profile.verbosity_level).toBe(3);
  });

  it('returns the stored preference when no tenant override is set', async () => {
    const deps = buildDeps();
    await deps.repo.upsert({
      tenant_id: 't1',
      user_id: 'u1',
      mode: 'guide',
      verbosity_level: 2,
      updated_at: fixedClock().toISOString(),
    });
    const profile = await resolveVoiceProfile(deps, {
      tenant_id: 't1',
      user_id: 'u1',
    });
    expect(profile.mode).toBe('guide');
  });

  it('uses mastery-tier heuristic when nothing is stored', async () => {
    const deps = buildDeps();
    const novice = await resolveVoiceProfile(deps, {
      tenant_id: 't1',
      user_id: 'novice',
      surface_mastery: 0.2,
    });
    expect(novice.mode).toBe('learn');

    const veteran = await resolveVoiceProfile(deps, {
      tenant_id: 't1',
      user_id: 'veteran',
      surface_mastery: 0.92,
    });
    expect(veteran.mode).toBe('guide');
  });

  it('returns BALANCED hard-default when nothing else applies', async () => {
    const deps = buildDeps();
    const profile = await resolveVoiceProfile(deps, {
      tenant_id: 't1',
      user_id: 'anonymous',
    });
    expect(profile.mode).toBe('balanced');
    expect(profile.verbosity_level).toBe(2);
  });
});
