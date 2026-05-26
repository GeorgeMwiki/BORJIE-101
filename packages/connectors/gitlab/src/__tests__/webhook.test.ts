/**
 * GitLab webhook (X-Gitlab-Token shared-secret) tests.
 */

import { describe, it, expect } from 'vitest';

import { verifyGitLabWebhook } from '../ingest/webhook-receiver.js';

describe('gitlab/webhook', () => {
  const secret = 'gitlab-shared-secret-32-bytes-min!';

  it('accepts matching token via timing-safe compare', () => {
    expect(verifyGitLabWebhook({ tokenHeader: secret, secret }).ok).toBe(true);
  });

  it('rejects mismatched token of same length', () => {
    const wrong = secret.split('').reverse().join('');
    const o = verifyGitLabWebhook({ tokenHeader: wrong, secret });
    expect(o.ok).toBe(false);
  });

  it('rejects mismatched token of different length', () => {
    const o = verifyGitLabWebhook({ tokenHeader: 'too-short', secret });
    expect(o.ok).toBe(false);
  });
});
