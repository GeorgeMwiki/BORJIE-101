/**
 * GitLab normalizer tests.
 */

import { describe, it, expect } from 'vitest';

import { normaliseGitLabIssue } from '../ingest/normalizer.js';

describe('gitlab/normalizer', () => {
  it('normalises an issue with author.email present', () => {
    const raw = {
      id: 1,
      iid: 7,
      title: 'Ship pipelines',
      state: 'opened',
      updated_at: '2026-01-15T10:00:00.000Z',
      author: { username: 'mwikila', email: 'sha256:abc' },
    };
    const n = normaliseGitLabIssue({ kind: 'issue', raw });
    expect(n).not.toBeNull();
    expect(n?.iid).toBe(7);
    expect(n?.authorUsername).toBe('mwikila');
    expect(n?.authorEmailHashed).toBe('sha256:abc');
  });

  it('returns null when id is missing', () => {
    expect(normaliseGitLabIssue({ kind: 'issue', raw: { updated_at: 'x' } })).toBeNull();
  });

  it('returns null when updated_at is missing', () => {
    expect(normaliseGitLabIssue({ kind: 'issue', raw: { id: 1 } })).toBeNull();
  });
});
