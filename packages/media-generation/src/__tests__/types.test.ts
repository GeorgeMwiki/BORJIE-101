/**
 * Type-error contract tests — confirm `MediaCompositionError` carries
 * the expected codes + detail array.
 */

import { describe, expect, it } from 'vitest';
import { MediaCompositionError } from '../types.js';

describe('MediaCompositionError', () => {
  it('carries code + message + detail', () => {
    const err = new MediaCompositionError('INPUT_GAP', 'missing', ['k1', 'k2']);
    expect(err.code).toBe('INPUT_GAP');
    expect(err.message).toBe('missing');
    expect(err.detail).toEqual(['k1', 'k2']);
    expect(err.name).toBe('MediaCompositionError');
  });

  it('defaults detail to empty array', () => {
    const err = new MediaCompositionError('RECIPE_NOT_FOUND', 'gone');
    expect(err.detail).toEqual([]);
  });

  it('is throwable + catchable as Error', () => {
    expect(() => {
      throw new MediaCompositionError('CONSENT_MISSING', 'consent');
    }).toThrow(MediaCompositionError);
    expect(() => {
      throw new MediaCompositionError('CONSENT_MISSING', 'consent');
    }).toThrow(Error);
  });
});
