/**
 * Vitest setup for `@borjie/blackboard-viz`.
 *
 * Wires the jest-dom matchers (`toBeInTheDocument`, `toHaveAttribute`,
 * …) and the jest-axe matcher (`toHaveNoViolations`). Also resets the
 * announcer + jsdom localStorage between tests so each test runs in
 * isolation.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect } from 'vitest';
import { toHaveNoViolations, axe as axeRunner } from 'jest-axe';

import { _internal_flush } from '../a11y/announcer';

expect.extend(toHaveNoViolations);

beforeEach(() => {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.clear();
  }
  if (typeof window !== 'undefined') {
    // Reset the URL between tests so `?post=...` parsing is deterministic.
    window.history.replaceState({}, '', '/');
  }
});

afterEach(() => {
  _internal_flush();
  if (typeof document !== 'undefined') {
    const a = document.getElementById('bb-announcer-region-a');
    const b = document.getElementById('bb-announcer-region-b');
    if (a) a.textContent = '';
    if (b) b.textContent = '';
  }
});

/**
 * Re-export of `jest-axe`'s `axe()` runner so tests get a single
 * import surface. Configured to silence the `color-contrast` rule
 * because jsdom does not implement layout/paint and therefore
 * cannot compute computed-style contrast accurately; we rely on
 * the OKLCH theme test (`isValidThemeColor`) to enforce contrast.
 */
export const axe = (node: Element): ReturnType<typeof axeRunner> =>
  axeRunner(node, {
    rules: {
      'color-contrast': { enabled: false },
    },
  });
