/**
 * Zoom normalizer tests.
 */

import { describe, it, expect } from 'vitest';

import { normaliseZoomMeeting } from '../ingest/normalizer.js';

describe('zoom/normalizer', () => {
  it('normalises a past-meeting payload with participants', () => {
    const raw = {
      id: 123456789,
      topic: 'Mining ops sync',
      start_time: '2026-02-15T10:00:00Z',
      end_time: '2026-02-15T10:45:00Z',
      participants: [
        { name: 'Mr. Mwikila', user_email: 'sha256:abc', join_time: '2026-02-15T10:00:01Z', leave_time: '2026-02-15T10:45:00Z' },
        { name: 'Site Foreman', user_email: 'sha256:def', join_time: '2026-02-15T10:00:05Z', leave_time: '2026-02-15T10:44:30Z' },
      ],
    };
    const n = normaliseZoomMeeting({ raw, recordingUri: 'https://signed.zoom/recording', transcriptText: 'redacted body' });
    expect(n).not.toBeNull();
    expect(n?.meetingId).toBe('123456789');
    expect(n?.topic).toBe('Mining ops sync');
    expect(n?.participants.length).toBe(2);
    expect(n?.participants[0]?.name).toBe('Mr. Mwikila');
    expect(n?.recordingUri).toBe('https://signed.zoom/recording');
  });

  it('returns null when start_time is missing', () => {
    expect(normaliseZoomMeeting({ raw: { id: 'm' } })).toBeNull();
  });

  it('returns null when id is missing', () => {
    expect(normaliseZoomMeeting({ raw: { start_time: '2026-02-15T10:00:00Z' } })).toBeNull();
  });

  it('accepts string id as well as numeric', () => {
    const n = normaliseZoomMeeting({
      raw: { id: 'string-uuid-form', start_time: '2026-02-15T10:00:00Z' },
    });
    expect(n?.meetingId).toBe('string-uuid-form');
  });
});
