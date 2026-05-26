/**
 * Teams (Graph) change-notification webhook tests.
 */

import { describe, it, expect } from 'vitest';

import { tryValidationEcho, verifyTeamsClientState } from '../ingest/webhook-receiver.js';

describe('teams/webhook', () => {
  it('echoes validationToken on subscription validation', () => {
    const tok = tryValidationEcho({ query: { validationToken: 'abc-123' } });
    expect(tok).toBe('abc-123');
  });

  it('returns null when no validationToken is present', () => {
    expect(tryValidationEcho({ query: {} })).toBeNull();
  });

  it('verifyTeamsClientState accepts matching clientState', () => {
    const secret = 'subscription-shared-secret-32bytes';
    expect(verifyTeamsClientState({ clientStateHeader: secret, secret }).ok).toBe(true);
  });

  it('verifyTeamsClientState rejects mismatched clientState', () => {
    const secret = 'subscription-shared-secret-32bytes';
    const o = verifyTeamsClientState({ clientStateHeader: 'other-secret-32bytes-long-padded!', secret });
    expect(o.ok).toBe(false);
  });
});
