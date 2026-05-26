/**
 * Jira normalizer tests.
 */

import { describe, it, expect } from 'vitest';

import { normaliseJiraIssue } from '../ingest/normalizer.js';

describe('jira/normalizer', () => {
  it('normalises a typical issue', () => {
    const issue = {
      id: '10001',
      key: 'PROJ-1',
      fields: {
        summary: 'Ship Wave OMNI-P1',
        status: { name: 'In Progress' },
        assignee: { emailAddress: 'sha256:abc' },
        reporter: { emailAddress: 'sha256:def' },
        updated: '2026-01-15T10:00:00.000+0000',
      },
    };
    const n = normaliseJiraIssue({ kind: 'issue', issue });
    expect(n).not.toBeNull();
    expect(n?.key).toBe('PROJ-1');
    expect(n?.summary).toBe('Ship Wave OMNI-P1');
    expect(n?.status).toBe('In Progress');
    expect(n?.assigneeEmailHashed).toBe('sha256:abc');
    expect(n?.reporterEmailHashed).toBe('sha256:def');
  });

  it('returns null when id is missing', () => {
    expect(normaliseJiraIssue({ kind: 'issue', issue: { key: 'P-1', fields: { updated: 'x' } } })).toBeNull();
  });

  it('returns null when updated field is missing', () => {
    expect(
      normaliseJiraIssue({ kind: 'issue', issue: { id: '1', key: 'P-1', fields: { summary: 'x' } } }),
    ).toBeNull();
  });
});
