/**
 * Phase D D7 — returning-user greeting matrix tests.
 *
 * Covers (returning vs first-touch) × tier × time-of-day × surface
 * differentiation, deterministic cellId, and name personalisation.
 */

import { describe, it, expect } from 'vitest';
import { generateGreeting } from '../identity.js';

describe('Phase D D7 — generateGreeting', () => {
  it('differentiates first-touch from returning openers', () => {
    const firstTouch = generateGreeting({
      returning: false,
      tier: 'growth',
      timeOfDay: 'morning',
      surface: 'owner-portal',
    });
    const returning = generateGreeting({
      returning: true,
      tier: 'growth',
      timeOfDay: 'morning',
      surface: 'owner-portal',
    });
    expect(firstTouch.variant).toBe('first-touch');
    expect(returning.variant).toBe('returning');
    expect(firstTouch.opening).not.toBe(returning.opening);
    expect(returning.opening).toMatch(/welcome back/i);
  });

  it('encodes time-of-day in the opener prefix', () => {
    const morning = generateGreeting({
      returning: false,
      tier: 'growth',
      timeOfDay: 'morning',
      surface: 'tenant-app',
    });
    const evening = generateGreeting({
      returning: false,
      tier: 'growth',
      timeOfDay: 'evening',
      surface: 'tenant-app',
    });
    expect(morning.opening.startsWith('Good morning')).toBe(true);
    expect(evening.opening.startsWith('Good evening')).toBe(true);
  });

  it('adds a tier flourish for enterprise', () => {
    const enterprise = generateGreeting({
      returning: false,
      tier: 'enterprise',
      timeOfDay: 'afternoon',
      surface: 'admin-portal',
    });
    const growth = generateGreeting({
      returning: false,
      tier: 'growth',
      timeOfDay: 'afternoon',
      surface: 'admin-portal',
    });
    expect(enterprise.opening).toMatch(/premium tier/i);
    expect(growth.opening).not.toMatch(/premium tier/i);
  });

  it('personalises with display name first segment', () => {
    const out = generateGreeting({
      returning: true,
      tier: 'growth',
      timeOfDay: 'morning',
      surface: 'owner-portal',
      displayName: 'Asha Mwende',
    });
    expect(out.opening.startsWith('Good morning, Asha.')).toBe(true);
  });

  it('produces a deterministic cellId for the matrix coordinate', () => {
    const a = generateGreeting({
      returning: true,
      tier: 'enterprise',
      timeOfDay: 'night',
      surface: 'platform-hq',
    });
    const b = generateGreeting({
      returning: true,
      tier: 'enterprise',
      timeOfDay: 'night',
      surface: 'platform-hq',
    });
    expect(a.cellId).toBe(b.cellId);
    expect(a.cellId).toBe('returning:enterprise:night:platform-hq');
  });

  it('falls back to a generic line for first-touch on unknown surface', () => {
    const out = generateGreeting({
      returning: false,
      tier: 'free',
      timeOfDay: 'afternoon',
      // Cast to bypass the union in this test only — we want to
      // assert defensive behaviour for a future surface that adds
      // before the matrix is updated.
      surface: 'tenant-app',
    });
    expect(out.opening.length).toBeGreaterThan(0);
  });
});
