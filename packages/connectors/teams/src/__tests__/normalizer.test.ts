/**
 * Teams normalizer tests.
 */

import { describe, it, expect } from 'vitest';

import { normaliseTeamsMessage } from '../ingest/normalizer.js';

describe('teams/normalizer', () => {
  it('normalises a channel message with body + attachments', () => {
    const raw = {
      id: 'msg-1',
      createdDateTime: '2026-01-15T10:00:00Z',
      from: { user: { displayName: 'Mr. Mwikila', mail: 'sha256:abc' } },
      body: { contentType: 'html', content: '<p>Mining update</p>' },
      attachments: [
        { id: 'att-1', contentType: 'reference', name: 'report.pdf', contentUrl: 'https://x' },
      ],
    };
    const n = normaliseTeamsMessage({ teamId: 't', channelId: 'c', raw });
    expect(n).not.toBeNull();
    expect(n?.fromDisplayName).toBe('Mr. Mwikila');
    expect(n?.fromEmailHashed).toBe('sha256:abc');
    expect(n?.attachments.length).toBe(1);
    expect(n?.attachments[0]?.name).toBe('report.pdf');
  });

  it('returns null when id is missing', () => {
    expect(normaliseTeamsMessage({ teamId: 't', channelId: 'c', raw: { createdDateTime: 'x' } })).toBeNull();
  });

  it('returns null when createdDateTime is missing', () => {
    expect(normaliseTeamsMessage({ teamId: 't', channelId: 'c', raw: { id: 'm' } })).toBeNull();
  });
});
