import { describe, it, expect } from 'vitest';
import {
  isTerminal,
  isWarm,
  shouldExpire,
  TabLifecycleError,
  transitionTabLifecycle,
} from '../lifecycle/tab-lifecycle.js';

describe('tab-lifecycle', () => {
  it('advances opening → hydrating via OPEN', () => {
    expect(transitionTabLifecycle('opening', 'OPEN')).toBe('hydrating');
  });

  it('advances hydrating → active via HYDRATED', () => {
    expect(transitionTabLifecycle('hydrating', 'HYDRATED')).toBe('active');
  });

  it('toggles active ↔ paused via BLUR / FOCUS', () => {
    expect(transitionTabLifecycle('active', 'BLUR')).toBe('paused');
    expect(transitionTabLifecycle('paused', 'FOCUS')).toBe('active');
  });

  it('expires paused via TTL_ELAPSED, then purges to closed', () => {
    expect(transitionTabLifecycle('paused', 'TTL_ELAPSED')).toBe('expiring');
    expect(transitionTabLifecycle('expiring', 'PURGE')).toBe('closed');
  });

  it('allows expiring → hydrating on FOCUS (cold reopen)', () => {
    expect(transitionTabLifecycle('expiring', 'FOCUS')).toBe('hydrating');
  });

  it('rejects illegal transitions with TabLifecycleError', () => {
    expect(() => transitionTabLifecycle('opening', 'HYDRATED')).toThrow(
      TabLifecycleError,
    );
    expect(() => transitionTabLifecycle('active', 'OPEN')).toThrow(
      TabLifecycleError,
    );
    expect(() => transitionTabLifecycle('closed', 'FOCUS')).toThrow(
      TabLifecycleError,
    );
  });

  it('isWarm + isTerminal predicates classify correctly', () => {
    expect(isWarm('active')).toBe(true);
    expect(isWarm('paused')).toBe(true);
    expect(isWarm('opening')).toBe(false);
    expect(isWarm('closed')).toBe(false);
    expect(isTerminal('closed')).toBe(true);
    expect(isTerminal('paused')).toBe(false);
  });

  it('shouldExpire returns true only for paused rows past their TTL', () => {
    const past = new Date(1_700_000_000_000);
    const now = new Date(1_700_000_999_999);
    expect(shouldExpire('paused', past, past, now)).toBe(true);
    expect(shouldExpire('paused', past, now, past)).toBe(false);
    expect(shouldExpire('active', past, past, now)).toBe(false);
    expect(shouldExpire('paused', null, past, now)).toBe(false);
  });
});
