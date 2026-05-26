/**
 * Zoom normalizer — Zoom v2 meeting payload → canonical
 * `ZoomMeetingPayload`.
 */

import type { ZoomMeetingPayload } from '../types.js';
import type { ZoomMeeting } from '../client/zoom-client.js';

export interface NormaliseParams {
  readonly raw: ZoomMeeting | Readonly<Record<string, unknown>>;
  readonly recordingUri?: string | null;
  readonly transcriptText?: string | null;
}

export function normaliseZoomMeeting(params: NormaliseParams): ZoomMeetingPayload | null {
  const r = params.raw as Readonly<Record<string, unknown>>;
  const idRaw = r.id;
  const meetingId = typeof idRaw === 'number' ? String(idRaw) : typeof idRaw === 'string' ? idRaw : null;
  if (meetingId === null) return null;
  const startAt = typeof r.start_time === 'string' ? r.start_time : null;
  if (startAt === null) return null;
  const endAt = typeof r.end_time === 'string' ? r.end_time : null;
  const topic = typeof r.topic === 'string' ? r.topic : null;

  const partsRaw = Array.isArray(r.participants)
    ? (r.participants as ReadonlyArray<Readonly<Record<string, unknown>>>)
    : [];
  const participants = partsRaw.map((p) => ({
    name: typeof p.name === 'string' ? p.name : 'unknown',
    emailHashed: typeof p.user_email === 'string' ? p.user_email : null,
    joinedAt: typeof p.join_time === 'string' ? p.join_time : null,
    leftAt: typeof p.leave_time === 'string' ? p.leave_time : null,
  }));

  return {
    meetingId,
    topic,
    startAt,
    endAt,
    participants,
    recordingUri: params.recordingUri ?? null,
    transcriptText: params.transcriptText ?? null,
  };
}
