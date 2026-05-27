import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import { toHaveNoViolations, axe as axeRunner } from 'jest-axe';

expect.extend(toHaveNoViolations);

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
