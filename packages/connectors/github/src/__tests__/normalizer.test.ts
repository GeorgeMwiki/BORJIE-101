/**
 * GitHub normalizer tests.
 */

import { describe, it, expect } from 'vitest';

import { normaliseGitHubIssue } from '../ingest/normalizer.js';

describe('github/normalizer', () => {
  it('detects PRs via pull_request key', () => {
    const raw = {
      id: 1,
      node_id: 'I_kw1',
      number: 42,
      title: 'feat: ship OMNI-P1',
      state: 'open',
      updated_at: '2026-01-15T10:00:00Z',
      pull_request: { url: 'x' },
      user: { login: 'mwikila', email: 'sha256:abc' },
    };
    const n = normaliseGitHubIssue({ raw });
    expect(n).not.toBeNull();
    expect(n?.entityKind).toBe('pull_request');
    expect(n?.number).toBe(42);
    expect(n?.authorLogin).toBe('mwikila');
  });

  it('classifies plain issues', () => {
    const raw = {
      id: 2,
      node_id: 'I_kw2',
      number: 7,
      title: 'bug: dedup',
      state: 'closed',
      updated_at: '2026-01-15T10:00:00Z',
      user: { login: 'mwikila' },
    };
    const n = normaliseGitHubIssue({ raw });
    expect(n?.entityKind).toBe('issue');
  });

  it('returns null when node_id is missing', () => {
    expect(normaliseGitHubIssue({ raw: { id: 1, updated_at: 'x' } })).toBeNull();
  });
});
