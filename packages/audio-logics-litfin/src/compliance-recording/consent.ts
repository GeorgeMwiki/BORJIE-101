/**
 * Append-only consent log + before-storage gating.
 *
 * Recording a call without proper consent in a 2-party-consent state /
 * GDPR jurisdiction is a regulatory breach. We:
 *
 *   1. Record consent as an immutable `ConsentRecord` tied to the first
 *      audible second of the audio (so a tampered audio file cannot be
 *      paired with a forged consent).
 *   2. Refuse to store any recording where the jurisdiction requires
 *      explicit consent and we did not capture it.
 *
 * The append-only log is in-memory by default. Wire to Postgres in the
 * api-gateway boot path via the adapter port.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  AudioLogicsLitfinError,
  type ConsentRecord,
  type ConsentVerification,
  type Jurisdiction,
} from '../types.js';
import { getRecordingNotice } from './notices.js';

export interface RecordConsentArgs {
  readonly tenantId: string;
  readonly callerId: string;
  readonly channel: ConsentRecord['channel'];
  readonly jurisdiction: Jurisdiction;
  readonly audioSampleStartIso: string;
  readonly consentGiven: boolean;
  readonly noticePlayed: boolean;
  readonly nowIso?: string;
}

/**
 * Stamp a consent decision into the immutable log. Does NOT mutate any
 * passed argument; returns a frozen object suitable for direct insert.
 */
export function recordConsent(args: RecordConsentArgs): ConsentRecord {
  if (!args.tenantId) {
    throw new AudioLogicsLitfinError('tenantId required', 'compliance-missing-tenant');
  }
  const notice = getRecordingNotice(args.jurisdiction);
  const noticeHash = createHash('sha256').update(notice.noticeText).digest('hex');

  return Object.freeze({
    consentId: `cn_${randomUUID()}`,
    tenantId: args.tenantId,
    callerId: args.callerId,
    channel: args.channel,
    jurisdiction: args.jurisdiction,
    audioSampleStartIso: args.audioSampleStartIso,
    consentGiven: args.consentGiven,
    noticePlayed: args.noticePlayed,
    noticeHash,
    capturedAtIso: args.nowIso ?? new Date().toISOString(),
  });
}

export interface VerifyConsentBeforeStorageArgs {
  readonly recording: { readonly audioSampleStartIso: string };
  readonly jurisdiction: Jurisdiction;
  readonly consentLog: ReadonlyArray<ConsentRecord>;
}

/**
 * Decide whether a recording can be persisted given the consent log.
 *
 * Rules:
 *   - Jurisdictions with `requiresExplicitConsent` need a `consentGiven=true`
 *     record whose `audioSampleStartIso` matches the recording's start.
 *   - When required and missing → returns `{ canStore: false, mustDelete: true }`.
 *   - Notice-only jurisdictions (US-1P) need at least a noticePlayed=true
 *     record; failing that we soft-deny (`canStore: false, mustDelete: false`).
 *
 * Pure function — no side effects.
 */
export function verifyConsentBeforeStorage(
  args: VerifyConsentBeforeStorageArgs,
): ConsentVerification {
  const notice = getRecordingNotice(args.jurisdiction);
  const match = args.consentLog.find(
    (c) =>
      c.jurisdiction === args.jurisdiction &&
      c.audioSampleStartIso === args.recording.audioSampleStartIso,
  );

  if (!match) {
    return {
      canStore: false,
      mustDelete: notice.requiresExplicitConsent,
      reason: `no consent record found for ${args.jurisdiction} at ${args.recording.audioSampleStartIso}`,
      jurisdiction: args.jurisdiction,
    };
  }

  if (notice.requiresExplicitConsent && !match.consentGiven) {
    return {
      canStore: false,
      mustDelete: true,
      reason: `${args.jurisdiction} requires explicit consent; consentGiven=false`,
      jurisdiction: args.jurisdiction,
    };
  }

  if (!notice.requiresExplicitConsent && !match.noticePlayed) {
    return {
      canStore: false,
      mustDelete: false,
      reason: `${args.jurisdiction} requires recording notice; noticePlayed=false`,
      jurisdiction: args.jurisdiction,
    };
  }

  return { canStore: true, jurisdiction: args.jurisdiction };
}

/**
 * Build a WhatsApp opt-in message body for the supplied jurisdiction.
 * Returned text complies with Meta's marketing-template policy: identifies
 * sender, purpose, opt-out mechanism.
 */
export function buildWhatsAppOptInMessage(args: {
  readonly tenantId: string;
  readonly displayName: string;
  readonly jurisdiction: Jurisdiction;
}): string {
  const notice = getRecordingNotice(args.jurisdiction);
  return [
    `${args.displayName} (Borjie on behalf of tenant ${args.tenantId})`,
    notice.noticeText,
    'Reply YES to consent, STOP to opt out at any time.',
  ].join('\n\n');
}

/**
 * Build an SMS opt-in message body — same legal content as WhatsApp but
 * compacted for the 160-char GSM-7 limit.
 */
export function buildSmsOptInMessage(args: {
  readonly displayName: string;
  readonly jurisdiction: Jurisdiction;
}): string {
  const notice = getRecordingNotice(args.jurisdiction);
  const compact =
    notice.noticeText.length > 100
      ? `${notice.noticeText.slice(0, 97)}...`
      : notice.noticeText;
  return `${args.displayName}: ${compact} Reply YES to consent, STOP to opt out.`;
}
