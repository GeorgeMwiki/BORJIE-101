/**
 * Per-channel canonicalizers (LP-25).
 *
 * Each function maps one provider's native inbound shape to the partial
 * canonical fields (`text`, `attachments`, `rawSender`, `metadata`,
 * `eventId`). The gateway then runs the signature verifier + tier resolver
 * to finish the {@link ChannelEvent}.
 *
 * These are intentionally defensive: provider payloads are untrusted and
 * frequently partial. A field we cannot read is left empty rather than
 * throwing — `canonicalize` decides whether the result is usable.
 *
 * Pure functions, no I/O.
 *
 * @module @borjie/channel-gateway/canonicalizers
 */

import type {
  AttachmentKind,
  ChannelAttachment,
  ChannelKind,
  RawSender,
} from './types.js';

/** Intermediate shape produced by a canonicalizer, pre-resolution. */
export interface CanonicalDraft {
  readonly eventId: string;
  readonly rawSender: RawSender;
  readonly text: string;
  readonly attachments: readonly ChannelAttachment[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function freezeMeta(meta: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze({ ...meta });
}

function attachmentKindFromMime(mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

// ----------------------------------------------------------------------------
// WhatsApp (Meta Cloud API)
// ----------------------------------------------------------------------------

interface WaMediaRef {
  readonly id?: string;
  readonly mime_type?: string;
  readonly link?: string;
  readonly filename?: string;
}

interface WaMessage {
  readonly id?: string;
  readonly from?: string;
  readonly type?: string;
  readonly text?: { readonly body?: string };
  readonly audio?: WaMediaRef;
  readonly image?: WaMediaRef & { readonly caption?: string };
  readonly document?: WaMediaRef;
  readonly video?: WaMediaRef;
}

/**
 * Canonicalize a single Meta WhatsApp message object (the element of
 * `entry[].changes[].value.messages[]`). Media `link` is preferred; when
 * Meta only sends a media `id`, we surface it in metadata so the host can
 * resolve the download URL through its Graph API + safe-fetch port.
 */
export function canonicalizeWhatsApp(message: WaMessage): CanonicalDraft {
  const attachments: ChannelAttachment[] = [];
  let text = str(message.text?.body);

  const media = message.audio ?? message.image ?? message.document ?? message.video;
  if (media) {
    const mime = str(media.mime_type) || 'application/octet-stream';
    if (message.image?.caption) text = text || str(message.image.caption);
    if (media.link) {
      attachments.push({
        kind: attachmentKindFromMime(mime),
        url: media.link,
        mimeType: mime,
        ...(media.filename ? { filename: media.filename } : {}),
      });
    }
  }

  return {
    eventId: str(message.id) || `wa-${Date.now()}`,
    rawSender: { phone: normalizePhone(str(message.from)) },
    text,
    attachments,
    metadata: freezeMeta({
      waType: str(message.type),
      waMediaId: media?.id ? str(media.id) : undefined,
    }),
  };
}

// ----------------------------------------------------------------------------
// SMS (Africa's Talking inbound)
// ----------------------------------------------------------------------------

interface SmsInbound {
  readonly from?: string;
  readonly to?: string;
  readonly text?: string;
  readonly id?: string;
  readonly linkId?: string;
}

export function canonicalizeSms(payload: SmsInbound): CanonicalDraft {
  return {
    eventId: str(payload.id) || `sms-${Date.now()}`,
    rawSender: { phone: normalizePhone(str(payload.from)) },
    text: str(payload.text),
    attachments: [],
    metadata: freezeMeta({
      to: str(payload.to),
      linkId: payload.linkId ? str(payload.linkId) : undefined,
    }),
  };
}

// ----------------------------------------------------------------------------
// USSD
// ----------------------------------------------------------------------------

interface UssdInbound {
  readonly sessionId?: string;
  readonly serviceCode?: string;
  readonly phoneNumber?: string;
  readonly text?: string;
}

export function canonicalizeUssd(payload: UssdInbound): CanonicalDraft {
  return {
    eventId: str(payload.sessionId) || `ussd-${Date.now()}`,
    rawSender: { phone: normalizePhone(str(payload.phoneNumber)) },
    text: str(payload.text),
    attachments: [],
    metadata: freezeMeta({
      serviceCode: str(payload.serviceCode),
      sessionId: str(payload.sessionId),
    }),
  };
}

// ----------------------------------------------------------------------------
// Voice (IVR transcript / recording callback)
// ----------------------------------------------------------------------------

interface VoiceInbound {
  readonly sessionId?: string;
  readonly callerNumber?: string;
  readonly transcript?: string;
  readonly recordingUrl?: string;
  readonly durationSeconds?: number;
}

export function canonicalizeVoice(payload: VoiceInbound): CanonicalDraft {
  const attachments: ChannelAttachment[] = [];
  if (payload.recordingUrl) {
    attachments.push({
      kind: 'audio',
      url: str(payload.recordingUrl),
      mimeType: 'audio/wav',
    });
  }
  return {
    eventId: str(payload.sessionId) || `voice-${Date.now()}`,
    rawSender: { phone: normalizePhone(str(payload.callerNumber)) },
    text: str(payload.transcript),
    attachments,
    metadata: freezeMeta({
      durationSeconds:
        typeof payload.durationSeconds === 'number' ? payload.durationSeconds : undefined,
    }),
  };
}

// ----------------------------------------------------------------------------
// Email
// ----------------------------------------------------------------------------

interface EmailInbound {
  readonly messageId?: string;
  readonly from?: string;
  readonly subject?: string;
  readonly bodyText?: string;
  readonly threadId?: string;
  readonly attachments?: ReadonlyArray<{
    readonly url?: string;
    readonly mimeType?: string;
    readonly filename?: string;
    readonly sizeBytes?: number;
  }>;
}

export function canonicalizeEmail(payload: EmailInbound): CanonicalDraft {
  const attachments: ChannelAttachment[] = [];
  for (const a of payload.attachments ?? []) {
    if (!a.url) continue;
    const mime = str(a.mimeType) || 'application/octet-stream';
    attachments.push({
      kind: attachmentKindFromMime(mime),
      url: a.url,
      mimeType: mime,
      ...(a.filename ? { filename: a.filename } : {}),
      ...(typeof a.sizeBytes === 'number' ? { sizeBytes: a.sizeBytes } : {}),
    });
  }
  const subject = str(payload.subject);
  const body = str(payload.bodyText);
  // Prepend the subject so the brain has the email's topic in the text.
  const text = subject ? `${subject}\n\n${body}`.trim() : body;
  return {
    eventId: str(payload.messageId) || `email-${Date.now()}`,
    rawSender: { email: str(payload.from).toLowerCase() },
    text,
    attachments,
    metadata: freezeMeta({
      subject,
      threadId: payload.threadId ? str(payload.threadId) : undefined,
    }),
  };
}

// ----------------------------------------------------------------------------
// Web (in-app chat)
// ----------------------------------------------------------------------------

interface WebInbound {
  readonly messageId?: string;
  readonly userId?: string;
  readonly text?: string;
}

export function canonicalizeWeb(payload: WebInbound): CanonicalDraft {
  return {
    eventId: str(payload.messageId) || `web-${Date.now()}`,
    rawSender: { webUserId: str(payload.userId) },
    text: str(payload.text),
    attachments: [],
    metadata: freezeMeta({}),
  };
}

// ----------------------------------------------------------------------------
// Dispatch table
// ----------------------------------------------------------------------------

/**
 * Canonicalize any channel's raw payload to a draft. The payload type is
 * `unknown` because it crosses the webhook boundary; each canonicalizer
 * reads defensively. An unknown channel returns `null`.
 */
export function canonicalizeByChannel(
  channel: ChannelKind,
  payload: unknown,
): CanonicalDraft | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (channel) {
    case 'whatsapp':
      return canonicalizeWhatsApp(p as WaMessage);
    case 'sms':
      return canonicalizeSms(p as SmsInbound);
    case 'ussd':
      return canonicalizeUssd(p as UssdInbound);
    case 'voice':
      return canonicalizeVoice(p as VoiceInbound);
    case 'email':
      return canonicalizeEmail(p as EmailInbound);
    case 'web':
      return canonicalizeWeb(p as WebInbound);
    default:
      return null;
  }
}

// ----------------------------------------------------------------------------
// Phone normalization (jurisdiction-neutral E.164-ish)
// ----------------------------------------------------------------------------

/**
 * Best-effort E.164 normalization. We keep a leading `+` and digits only.
 * Deep per-jurisdiction parsing (TZ +255 etc.) is the host's job via its
 * jurisdiction pack; here we only canonicalize formatting so the same phone
 * is keyed consistently across channels. Never throws.
 */
export function normalizePhone(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 0) return '';
  return hasPlus ? `+${digits}` : digits;
}
