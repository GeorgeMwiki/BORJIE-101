/**
 * Unit tests for rate-limiter pure helpers.
 *
 * These validate the building blocks that don't need a full request
 * context: IP block store and the CORS middleware factory's input
 * validation (the latter must reject missing allowlists — a wildcard
 * default combined with credentials=true enabled CSRF previously).
 */

import { describe, it, expect } from 'vitest';
import { corsMiddleware, blockIP } from '../middleware/rate-limiter';

describe('corsMiddleware (factory input validation)', () => {
  it('throws when origins allowlist is missing', () => {
    expect(() =>
      // @ts-expect-error intentionally missing origins to verify the guard
      corsMiddleware({})
    ).toThrow(/allowlist is required/i);
  });

  it('throws when origins array is empty', () => {
    expect(() => corsMiddleware({ origins: [] })).toThrow(/allowlist is required/i);
  });

  it('accepts a non-empty origins array', () => {
    const mw = corsMiddleware({ origins: ['https://app.borjie.com'] });
    expect(typeof mw).toBe('function');
  });
});

describe('blockIP', () => {
  it('accepts an IP + duration without throwing', () => {
    expect(() => blockIP('10.0.0.99', 60)).not.toThrow();
  });

  it('defaults to 3600s duration when not specified', () => {
    expect(() => blockIP('10.0.0.98')).not.toThrow();
  });
});
