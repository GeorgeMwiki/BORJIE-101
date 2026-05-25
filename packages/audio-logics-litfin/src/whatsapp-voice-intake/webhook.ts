/**
 * WhatsApp Cloud API voice-message webhook parser.
 *
 * Meta sends inbound voice messages via the `audio` field on a message
 * entry. The payload shape we honour matches the public Cloud API v18+
 * schema:
 *
 * {
 *   "entry": [{
 *     "changes": [{
 *       "value": {
 *         "messaging_product": "whatsapp",
 *         "metadata": { "display_phone_number": "...", "phone_number_id": "..." },
 *         "contacts": [...],
 *         "messages": [{
 *           "from": "...",
 *           "id": "...",
 *           "timestamp": "...",
 *           "type": "audio",
 *           "audio": {
 *             "id": "...",
 *             "mime_type": "audio/ogg; codecs=opus",
 *             "voice": true,
 *             "transcription": "..."          // optional, Meta-provided
 *           }
 *         }]
 *       }
 *     }]
 *   }]
 * }
 */

import { AudioLogicsLitfinError, type WhatsAppVoiceMessage } from '../types.js';

interface MetaWebhookAudioMessage {
  readonly from?: string;
  readonly id?: string;
  readonly timestamp?: string;
  readonly type?: string;
  readonly audio?: {
    readonly id?: string;
    readonly mime_type?: string;
    readonly voice?: boolean;
    readonly transcription?: string;
  };
}

interface MetaWebhookValue {
  readonly messaging_product?: string;
  readonly metadata?: {
    readonly phone_number_id?: string;
  };
  readonly messages?: ReadonlyArray<MetaWebhookAudioMessage>;
}

interface MetaWebhookChange {
  readonly value?: MetaWebhookValue;
}

interface MetaWebhookEntry {
  readonly changes?: ReadonlyArray<MetaWebhookChange>;
}

export interface MetaWebhookPayload {
  readonly entry?: ReadonlyArray<MetaWebhookEntry>;
}

const SUPPORTED_MIMES: ReadonlyArray<WhatsAppVoiceMessage['mimeType']> = Object.freeze([
  'audio/ogg',
  'audio/opus',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
]);

/**
 * Extract all voice messages from a Meta webhook payload. We tolerate
 * partial payloads (Meta delivers retries with missing fields) by
 * returning only the messages that have BOTH `audio.id` AND `from`.
 *
 * Returns a frozen array; never throws on partial data.
 *
 * @throws AudioLogicsLitfinError when payload is non-object.
 */
export function parseWhatsAppVoiceMessage(
  payload: MetaWebhookPayload,
  options: { readonly tenantId?: string } = {},
): ReadonlyArray<WhatsAppVoiceMessage> {
  if (!payload || typeof payload !== 'object') {
    throw new AudioLogicsLitfinError('payload must be an object', 'whatsapp-bad-payload');
  }
  const entries = payload.entry ?? [];
  const out: WhatsAppVoiceMessage[] = [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value || value.messaging_product !== 'whatsapp') continue;
      for (const msg of value.messages ?? []) {
        if (msg.type !== 'audio') continue;
        if (!msg.audio?.id || !msg.from || !msg.id) continue;
        const rawMime = (msg.audio.mime_type ?? 'audio/ogg').split(';')[0]!.trim();
        const mimeType = SUPPORTED_MIMES.find((m) => m === rawMime);
        if (!mimeType) continue;

        out.push(
          Object.freeze({
            messageId: msg.id,
            waPhoneNumberE164: normaliseE164(msg.from),
            mediaId: msg.audio.id,
            mimeType,
            ...(msg.audio.transcription !== undefined
              ? { autoTranscript: msg.audio.transcription }
              : {}),
            receivedAtIso: normaliseTimestamp(msg.timestamp),
            ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
          }),
        );
      }
    }
  }
  return Object.freeze(out);
}

function normaliseE164(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  return digits.startsWith('0') ? `+${digits.slice(1)}` : `+${digits}`;
}

function normaliseTimestamp(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();
  // Meta sends epoch seconds as a string.
  const asInt = Number.parseInt(raw, 10);
  if (Number.isFinite(asInt) && asInt > 0) {
    return new Date(asInt * 1000).toISOString();
  }
  return raw;
}
