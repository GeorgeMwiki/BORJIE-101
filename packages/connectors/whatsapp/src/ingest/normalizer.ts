/**
 * Normalise a Meta webhook envelope into canonical `WhatsappMessage`
 * rows. The function is pure — no I/O, no allocation of random ids
 * (the caller supplies a uuid port).
 */

import { createHash } from 'node:crypto';
import type {
  WhatsappMessage,
  WhatsappInboundMessage,
  WhatsappMessageKind,
  WhatsappMediaProjection,
  WhatsappContactProjection,
  WhatsappWebhookEnvelope,
} from '../types.js';
import { redactValue } from '../redact/pii-redactor.js';

const ALLOWED_KINDS: ReadonlyArray<WhatsappMessageKind> = [
  'text',
  'image',
  'video',
  'audio',
  'document',
  'sticker',
  'location',
  'contacts',
  'interactive',
  'reaction',
];

function coerceKind(raw: string): WhatsappMessageKind {
  if ((ALLOWED_KINDS as ReadonlyArray<string>).includes(raw)) {
    return raw as WhatsappMessageKind;
  }
  return 'unknown';
}

function extractText(msg: WhatsappInboundMessage): string | null {
  if (msg.text?.body) return msg.text.body;
  if (msg.image?.caption) return msg.image.caption;
  if (msg.video?.caption) return msg.video.caption;
  if (msg.document?.caption) return msg.document.caption;
  return null;
}

function extractMedia(msg: WhatsappInboundMessage): WhatsappMediaProjection | null {
  const part = msg.image ?? msg.video ?? msg.audio ?? msg.document ?? msg.sticker;
  if (!part) return null;
  const sha256Raw: string | undefined = 'sha256' in part ? part.sha256 : undefined;
  const filenameRaw: string | undefined =
    'filename' in part && typeof part.filename === 'string' ? part.filename : undefined;
  const captionRaw: string | undefined =
    'caption' in part && typeof part.caption === 'string' ? part.caption : undefined;
  return {
    assetId: part.id,
    mimeType: part.mime_type,
    ...(sha256Raw !== undefined ? { sha256: sha256Raw } : {}),
    ...(filenameRaw !== undefined ? { filename: filenameRaw } : {}),
    ...(captionRaw !== undefined ? { caption: captionRaw } : {}),
  };
}

function extractContacts(
  msg: WhatsappInboundMessage,
  tenantId: string,
): ReadonlyArray<WhatsappContactProjection> | null {
  if (!msg.contacts || msg.contacts.length === 0) return null;
  return msg.contacts.map((c) => ({
    nameHashed: redactValue({
      tenantId,
      fieldPath: 'contacts.name',
      value: c.name?.formatted_name ?? '',
    }),
    phonesHashed: (c.phones ?? []).map((p) =>
      redactValue({ tenantId, fieldPath: 'contacts.phone', value: p.phone ?? '' }),
    ),
    emailsHashed: (c.emails ?? []).map((e) =>
      redactValue({ tenantId, fieldPath: 'contacts.email', value: e.email ?? '' }),
    ),
  }));
}

export interface NormalizerDeps {
  readonly tenantId: string;
  readonly nowIso: () => string;
  readonly uuid: () => string;
}

export interface NormalizedRow {
  readonly row: WhatsappMessage;
  readonly redactedFields: ReadonlyArray<string>;
}

/**
 * Walk an inbound webhook envelope and yield canonical
 * `WhatsappMessage` rows (one per `messages[]` entry). Status updates
 * and other non-message events are skipped.
 */
export function normalizeInbound(
  envelope: WhatsappWebhookEnvelope,
  deps: NormalizerDeps,
): ReadonlyArray<NormalizedRow> {
  const rows: NormalizedRow[] = [];
  for (const entry of envelope.entry) {
    const wabaId = entry.id;
    for (const change of entry.changes) {
      const value = change.value;
      const phoneNumberId = value.metadata.phone_number_id;
      const toPhone = value.metadata.display_phone_number;
      const inbound = value.messages ?? [];
      for (const msg of inbound) {
        const kind = coerceKind(msg.type);
        const text = extractText(msg);
        const media = extractMedia(msg);
        const contacts = extractContacts(msg, deps.tenantId);
        const fromRedacted = redactValue({
          tenantId: deps.tenantId,
          fieldPath: 'fromPhone',
          value: msg.from,
        });
        const toRedacted = redactValue({
          tenantId: deps.tenantId,
          fieldPath: 'toPhone',
          value: toPhone,
        });
        const textRedacted = text
          ? redactValue({
              tenantId: deps.tenantId,
              fieldPath: 'text',
              value: text,
            })
          : null;
        const canonical = `${deps.tenantId}|${wabaId}|${msg.id}`;
        const auditHash = createHash('sha256').update(canonical).digest('hex');
        const redactedFields: string[] = ['fromPhone', 'toPhone'];
        if (textRedacted) redactedFields.push('text');
        if (contacts) redactedFields.push('contacts');
        rows.push({
          row: {
            id: deps.uuid(),
            tenantId: deps.tenantId,
            wabaId,
            phoneNumberId,
            waMessageId: msg.id,
            fromPhone: fromRedacted,
            toPhone: toRedacted,
            direction: 'inbound',
            kind,
            text: textRedacted,
            media,
            contacts,
            raw: msg as unknown as Readonly<Record<string, unknown>>,
            ingestedAt: deps.nowIso(),
            auditHash,
          },
          redactedFields,
        });
      }
    }
  }
  return rows;
}
