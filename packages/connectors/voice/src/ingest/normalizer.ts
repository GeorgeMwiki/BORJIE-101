/**
 * Twilio Voice normalizer — Call resource → canonical
 * `VoiceCallPayload`.
 *
 * Note: the input `raw` is expected to be the REDACTED payload (i.e.
 * `from` / `to` are already salted hashes by the time we get here).
 * The normalizer copies them across into `*Hashed` fields verbatim.
 */

import type { CallDirection, VoiceCallPayload } from '../types.js';

export interface NormaliseParams {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly recordingUri?: string | null;
  readonly transcriptText?: string | null;
}

function clampDirection(d: string | null): CallDirection {
  if (d === 'inbound' || d === 'outbound-api' || d === 'outbound-dial') return d;
  if (d === 'outbound') return 'outbound';
  return 'outbound';
}

export function normaliseVoiceCall(params: NormaliseParams): VoiceCallPayload | null {
  const r = params.raw;
  const sid = typeof r.sid === 'string' ? r.sid : null;
  if (sid === null) return null;
  const startedAt = typeof r.start_time === 'string' ? r.start_time : null;
  if (startedAt === null) return null;

  const from = typeof r.from === 'string' ? r.from : '';
  const to = typeof r.to === 'string' ? r.to : '';
  const dir = typeof r.direction === 'string' ? r.direction : null;
  const status = typeof r.status === 'string' ? r.status : 'unknown';
  const durationRaw = typeof r.duration === 'string' ? r.duration : typeof r.duration === 'number' ? String(r.duration) : null;
  const durationS = durationRaw === null ? null : Number(durationRaw);

  return {
    callSid: sid,
    direction: clampDirection(dir),
    fromPhoneHashed: from,
    toPhoneHashed: to,
    durationS: durationS !== null && Number.isFinite(durationS) ? durationS : null,
    status,
    recordingUri: params.recordingUri ?? null,
    transcriptText: params.transcriptText ?? null,
    startedAt,
  };
}
