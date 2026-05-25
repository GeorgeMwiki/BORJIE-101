/**
 * Error envelope — uniform shape (SCAFFOLDED 10)
 */

import { describe, it, expect } from 'vitest';
import { ApiError } from '../middleware/error-envelope.js';

describe('ApiError', () => {
  it('carries status, code, and details', () => {
    const err = new ApiError({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'Bad input',
      details: { field: 'email' },
    });
    expect(err.status).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual({ field: 'email' });
    expect(err.message).toBe('Bad input');
  });
});
