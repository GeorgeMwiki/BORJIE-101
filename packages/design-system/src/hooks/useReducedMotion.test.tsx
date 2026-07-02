import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReducedMotion } from './useReducedMotion';

/**
 * Fake MediaQueryList that lets a test flip `matches` and dispatch a change.
 */
function installMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches: initialMatches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
    // Legacy API intentionally omitted here to exercise the modern path.
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  };

  const matchMedia = vi.fn(() => mql as unknown as MediaQueryList);
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: matchMedia,
  });

  return {
    setMatches(next: boolean) {
      mql.matches = next;
      for (const cb of listeners) {
        cb({ matches: next } as MediaQueryListEvent);
      }
    },
  };
}

describe('useReducedMotion', () => {
  const original = (window as unknown as { matchMedia?: unknown }).matchMedia;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: original,
    });
  });

  it('returns false when the user does NOT prefer reduced motion', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('returns true when the user prefers reduced motion', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('reacts live to a change in the OS preference', () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => media.setMatches(true));
    expect(result.current).toBe(true);

    act(() => media.setMatches(false));
    expect(result.current).toBe(false);
  });

  it('defaults to false (SSR-safe) when matchMedia is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    });
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('does NOT read matchMedia during the render phase (no hydration mismatch)', () => {
    // Regression for the first-paint hydration mismatch: the state initialiser
    // used to call matchMedia synchronously during render, so under
    // prefers-reduced-motion the first client render disagreed with the server
    // (which has no matchMedia) and flipped any motion-gated className.
    // matchMedia must ONLY be read inside the post-mount effect (commit phase).
    let inRenderPhase = false;
    let readDuringRender = false;
    const mql = {
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    };
    const matchMedia = vi.fn(() => {
      if (inRenderPhase) readDuringRender = true;
      return mql as unknown as MediaQueryList;
    });
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: matchMedia,
    });

    const { result } = renderHook(() => {
      // Any matchMedia call made synchronously inside this render body is a
      // render-phase read (the initialiser bug). Effect callbacks run later.
      inRenderPhase = true;
      try {
        return useReducedMotion();
      } finally {
        inRenderPhase = false;
      }
    });

    // matchMedia was read in the effect, never during render.
    expect(readDuringRender).toBe(false);
    // And after the effect commit, the real preference is applied.
    expect(result.current).toBe(true);
  });
});
