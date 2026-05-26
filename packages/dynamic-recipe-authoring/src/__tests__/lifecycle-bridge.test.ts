import { describe, it, expect } from 'vitest';
import {
  canTransition,
  isTerminal,
  nextTransitions,
  toCatalogueLifecycle,
} from '../lifecycle/lifecycle-bridge.js';

describe('lifecycle-bridge — allowed transitions', () => {
  it('allows draft → shadow → live and live → deprecated', () => {
    expect(canTransition({ from: 'draft', to: 'shadow' }).ok).toBe(true);
    expect(canTransition({ from: 'shadow', to: 'live' }).ok).toBe(true);
    expect(canTransition({ from: 'live', to: 'deprecated' }).ok).toBe(true);
  });

  it('allows the live ↔ locked round-trip', () => {
    expect(canTransition({ from: 'live', to: 'locked' }).ok).toBe(true);
    expect(canTransition({ from: 'locked', to: 'live' }).ok).toBe(true);
  });
});

describe('lifecycle-bridge — rejected transitions', () => {
  it('rejects reverse transitions (e.g. live → draft)', () => {
    const result = canTransition({ from: 'live', to: 'draft' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('not allowed');
    }
  });

  it('rejects no-op transitions (from === to)', () => {
    const result = canTransition({ from: 'shadow', to: 'shadow' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('noop');
    }
  });

  it('rejects any transition out of deprecated (terminal)', () => {
    expect(canTransition({ from: 'deprecated', to: 'live' }).ok).toBe(false);
    expect(canTransition({ from: 'deprecated', to: 'shadow' }).ok).toBe(false);
  });
});

describe('lifecycle-bridge — helpers', () => {
  it('isTerminal returns true only for deprecated', () => {
    expect(isTerminal('deprecated')).toBe(true);
    expect(isTerminal('draft')).toBe(false);
    expect(isTerminal('shadow')).toBe(false);
    expect(isTerminal('live')).toBe(false);
    expect(isTerminal('locked')).toBe(false);
  });

  it('nextTransitions enumerates legal successors', () => {
    expect(nextTransitions('draft')).toEqual(['shadow', 'deprecated']);
    expect(nextTransitions('shadow')).toEqual(['live', 'locked', 'deprecated']);
    expect(nextTransitions('deprecated')).toEqual([]);
  });

  it('toCatalogueLifecycle returns the state string verbatim (no rename)', () => {
    expect(toCatalogueLifecycle('draft')).toBe('draft');
    expect(toCatalogueLifecycle('shadow')).toBe('shadow');
    expect(toCatalogueLifecycle('live')).toBe('live');
    expect(toCatalogueLifecycle('locked')).toBe('locked');
    expect(toCatalogueLifecycle('deprecated')).toBe('deprecated');
  });
});
