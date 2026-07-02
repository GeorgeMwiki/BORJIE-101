import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Reveal, RevealGroup } from './Reveal';

/** Install a matchMedia stub with a fixed reduced-motion preference. */
function setReducedMotion(reduced: boolean) {
  const mql = {
    matches: reduced,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn(() => mql as unknown as MediaQueryList),
  });
}

/** Capture the IntersectionObserver instances a render creates. */
function installIntersectionObserver() {
  const instances: Array<{ callback: IntersectionObserverCallback }> = [];
  class FakeIO {
    callback: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) {
      this.callback = cb;
      instances.push({ callback: cb });
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: FakeIO as unknown as typeof IntersectionObserver,
  });
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    FakeIO;
  return instances;
}

describe('Reveal', () => {
  const originalIO = (globalThis as unknown as { IntersectionObserver?: unknown })
    .IntersectionObserver;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      writable: true,
      configurable: true,
      value: originalIO,
    });
  });

  it('renders its children', () => {
    setReducedMotion(false);
    installIntersectionObserver();
    render(<Reveal>hello estate</Reveal>);
    expect(screen.getByText('hello estate')).toBeTruthy();
  });

  it('under reduced motion renders resting (opacity 1, no transform, no transition)', () => {
    setReducedMotion(true);
    installIntersectionObserver();
    render(<Reveal data-testid="rv">content</Reveal>);
    const el = screen.getByTestId('rv');
    expect(el.style.opacity).toBe('1');
    expect(el.style.transform).toBe('none');
    // No transition scheduled in the reduced path.
    expect(el.style.transitionProperty === '' || el.style.transitionProperty === undefined).toBe(
      true
    );
  });

  it('with motion allowed starts hidden then reveals when it intersects', () => {
    setReducedMotion(false);
    const ios = installIntersectionObserver();
    render(
      <Reveal data-testid="rv" direction="up">
        content
      </Reveal>
    );
    const el = screen.getByTestId('rv');
    // Initial hidden state.
    expect(el.style.opacity).toBe('0');
    expect(el.style.transform).toContain('translate3d');
    // The transition uses TOKEN-driven duration/easing, not hardcoded values.
    expect(el.style.transitionDuration).toContain('var(--duration-');
    expect(el.style.transitionTimingFunction).toContain('var(--ease-');

    // Fire the observer as if the element entered the viewport.
    const io = ios[0];
    expect(io).toBeTruthy();
    act(() => {
      io.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(el.style.opacity).toBe('1');
    expect(el.style.transform).toBe('none');
  });
});

describe('RevealGroup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders every child', () => {
    setReducedMotion(true);
    installIntersectionObserver();
    render(
      <RevealGroup>
        <span>one</span>
        <span>two</span>
        <span>three</span>
      </RevealGroup>
    );
    expect(screen.getByText('one')).toBeTruthy();
    expect(screen.getByText('two')).toBeTruthy();
    expect(screen.getByText('three')).toBeTruthy();
  });
});
