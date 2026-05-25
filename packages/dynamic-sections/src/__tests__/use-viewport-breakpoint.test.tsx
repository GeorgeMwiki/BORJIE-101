/**
 * `useViewportBreakpoint` + `useSwipeNav` smoke tests.
 *
 * Mobile-first decision: we drive collapse off Tailwind `md`
 * (768px). These tests pin that contract.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useViewportBreakpoint } from '../hooks/use-viewport-breakpoint.js';
import { useSwipeNav } from '../hooks/use-swipe-nav.js';

beforeEach(() => {
  globalThis.__setMatchMedia?.(false);
});

describe('useViewportBreakpoint', () => {
  it('returns "desktop" when matchMedia matches=false', () => {
    globalThis.__setMatchMedia?.(false);
    const { result } = renderHook(() => useViewportBreakpoint());
    expect(result.current).toBe('desktop');
  });

  it('returns "mobile" when matchMedia matches=true', () => {
    globalThis.__setMatchMedia?.(true);
    const { result } = renderHook(() => useViewportBreakpoint());
    expect(result.current).toBe('mobile');
  });

  it('updates the breakpoint when matchMedia change fires', async () => {
    globalThis.__setMatchMedia?.(false);
    const { result } = renderHook(() => useViewportBreakpoint());
    expect(result.current).toBe('desktop');
    await act(async () => {
      globalThis.__setMatchMedia?.(true);
    });
    expect(result.current).toBe('mobile');
  });
});

describe('useSwipeNav', () => {
  it('fires onSwipeLeft when horizontal travel exceeds the threshold (leftward)', () => {
    const onLeft = vi.fn();
    const onRight = vi.fn();
    const el = document.createElement('div');
    document.body.appendChild(el);

    const { result } = renderHook(() =>
      useSwipeNav({
        enabled: true,
        onSwipeLeft: onLeft,
        onSwipeRight: onRight,
      }),
    );
    act(() => {
      result.current.attach(el);
    });

    // Re-render to flush effect → listener attached.
    act(() => {
      // no-op
    });

    act(() => {
      el.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientX: 200,
          clientY: 50,
          bubbles: true,
        }),
      );
      el.dispatchEvent(
        new PointerEvent('pointerup', {
          clientX: 100,
          clientY: 50,
          bubbles: true,
        }),
      );
    });
    expect(onLeft).toHaveBeenCalled();
    expect(onRight).not.toHaveBeenCalled();
  });

  it('fires onSwipeRight when horizontal travel exceeds the threshold (rightward)', () => {
    const onLeft = vi.fn();
    const onRight = vi.fn();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const { result, rerender } = renderHook(() =>
      useSwipeNav({
        enabled: true,
        onSwipeLeft: onLeft,
        onSwipeRight: onRight,
      }),
    );
    act(() => {
      result.current.attach(el);
    });
    rerender();
    act(() => {
      el.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 100, clientY: 50, bubbles: true }),
      );
      el.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 200, clientY: 50, bubbles: true }),
      );
    });
    expect(onRight).toHaveBeenCalled();
    expect(onLeft).not.toHaveBeenCalled();
  });

  it('ignores swipes below threshold', () => {
    const onLeft = vi.fn();
    const onRight = vi.fn();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const { result, rerender } = renderHook(() =>
      useSwipeNav({
        enabled: true,
        onSwipeLeft: onLeft,
        onSwipeRight: onRight,
      }),
    );
    act(() => {
      result.current.attach(el);
    });
    rerender();
    act(() => {
      el.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 100, clientY: 50, bubbles: true }),
      );
      el.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 130, clientY: 50, bubbles: true }),
      );
    });
    expect(onLeft).not.toHaveBeenCalled();
    expect(onRight).not.toHaveBeenCalled();
  });

  it('does not bind listeners when disabled', () => {
    const onLeft = vi.fn();
    const onRight = vi.fn();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const { result, rerender } = renderHook(() =>
      useSwipeNav({
        enabled: false,
        onSwipeLeft: onLeft,
        onSwipeRight: onRight,
      }),
    );
    act(() => {
      result.current.attach(el);
    });
    rerender();
    act(() => {
      el.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 200, clientY: 50, bubbles: true }),
      );
      el.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 50, clientY: 50, bubbles: true }),
      );
    });
    expect(onLeft).not.toHaveBeenCalled();
    expect(onRight).not.toHaveBeenCalled();
  });
});
