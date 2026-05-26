/**
 * Email normaliser — provider payload → canonical row.
 *
 * Two functions: `normaliseGmail` and `normaliseOutlook`. Both
 * produce the same `EmailMessage` shape so downstream code is
 * provider-agnostic.
 */

import type {
  Clock,
  EmailMessage,
  GmailApiMessage,
  OutlookApiMessage,
  UuidGen,
} from '../types.js';
import type { PiiRedactor } from '../redact/pii-redactor.js';

export interface EmailNormaliserDeps {
  readonly redactor: PiiRedactor;
  readonly clock: Clock;
  readonly uuid: UuidGen;
}

export interface NormaliseGmailRequest {
  readonly tenantId: string;
  readonly account: string;
  readonly message: GmailApiMessage;
  readonly auditHash: string;
}

export interface NormaliseOutlookRequest {
  readonly tenantId: string;
  readonly account: string;
  readonly message: OutlookApiMessage;
  readonly auditHash: string;
}

export function createEmailNormaliser(deps: EmailNormaliserDeps) {
  return {
    normaliseGmail: async (
      req: NormaliseGmailRequest,
    ): Promise<EmailMessage> => {
      const headers = new Map<string, string>(
        req.message.payload.headers.map((h) => [h.name.toLowerCase(), h.value]),
      );
      const subject = headers.get('subject') ?? null;
      const rawFrom = parseFirstAddress(headers.get('from') ?? null);
      const rawTo = parseAddressList(headers.get('to'));

      const fieldBase = `gmail:${req.account}`;
      const fromAddr =
        rawFrom === null
          ? null
          : await deps.redactor.redactAddress({
              tenantId: req.tenantId,
              fieldId: `${fieldBase}:from`,
              address: rawFrom,
            });
      const toAddrs = await Promise.all(
        rawTo.map((addr) =>
          deps.redactor.redactAddress({
            tenantId: req.tenantId,
            fieldId: `${fieldBase}:to`,
            address: addr,
          }),
        ),
      );

      const bodyText = decodeBody(req.message.payload, 'text/plain');
      const bodyHtml = decodeBody(req.message.payload, 'text/html');
      const redactedText =
        bodyText === null
          ? null
          : (await deps.redactor.redact({
              tenantId: req.tenantId,
              fieldId: `${fieldBase}:body_text`,
              value: bodyText,
            })).redacted;
      const redactedHtml =
        bodyHtml === null
          ? null
          : (await deps.redactor.redact({
              tenantId: req.tenantId,
              fieldId: `${fieldBase}:body_html`,
              value: bodyHtml,
            })).redacted;
      const redactedSubject =
        subject === null
          ? null
          : (await deps.redactor.redact({
              tenantId: req.tenantId,
              fieldId: `${fieldBase}:subject`,
              value: subject,
            })).redacted;

      return {
        id: deps.uuid.v4(),
        tenant_id: req.tenantId,
        provider: 'gmail',
        account: req.account,
        message_id: req.message.id,
        thread_id: req.message.threadId,
        from_addr: fromAddr,
        to_addrs: toAddrs,
        subject: redactedSubject,
        body_text: redactedText,
        body_html: redactedHtml,
        attachments: extractGmailAttachments(req.message),
        raw: {
          labelIds: [...req.message.labelIds],
          snippet: req.message.snippet,
        },
        ingested_at: deps.clock.nowIso(),
        audit_hash: req.auditHash,
      };
    },
    normaliseOutlook: async (
      req: NormaliseOutlookRequest,
    ): Promise<EmailMessage> => {
      const fieldBase = `outlook_mail:${req.account}`;
      const fromAddr =
        req.message.from === undefined
          ? null
          : await deps.redactor.redactAddress({
              tenantId: req.tenantId,
              fieldId: `${fieldBase}:from`,
              address: req.message.from.emailAddress.address,
            });
      const toAddrs = await Promise.all(
        req.message.toRecipients.map((r) =>
          deps.redactor.redactAddress({
            tenantId: req.tenantId,
            fieldId: `${fieldBase}:to`,
            address: r.emailAddress.address,
          }),
        ),
      );
      const subjectRedacted = (await deps.redactor.redact({
        tenantId: req.tenantId,
        fieldId: `${fieldBase}:subject`,
        value: req.message.subject,
      })).redacted;
      const bodyValue = req.message.body.content;
      const bodyRedacted = (await deps.redactor.redact({
        tenantId: req.tenantId,
        fieldId: `${fieldBase}:body`,
        value: bodyValue,
      })).redacted;
      const isHtml = req.message.body.contentType === 'html';

      return {
        id: deps.uuid.v4(),
        tenant_id: req.tenantId,
        provider: 'outlook_mail',
        account: req.account,
        message_id: req.message.id,
        thread_id: req.message.conversationId,
        from_addr: fromAddr,
        to_addrs: toAddrs,
        subject: subjectRedacted,
        body_text: isHtml ? null : bodyRedacted,
        body_html: isHtml ? bodyRedacted : null,
        attachments: [],
        raw: {
          hasAttachments: req.message.hasAttachments,
          receivedDateTime: req.message.receivedDateTime,
          bodyPreview: req.message.bodyPreview,
        },
        ingested_at: deps.clock.nowIso(),
        audit_hash: req.auditHash,
      };
    },
  };
}

function parseFirstAddress(headerValue: string | null): string | null {
  if (headerValue === null) return null;
  const match = headerValue.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match?.[0] ?? null;
}

function parseAddressList(headerValue: string | undefined): string[] {
  if (headerValue === undefined) return [];
  const matches = headerValue.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi);
  return matches === null ? [] : Array.from(new Set(matches));
}

function decodeBody(
  payload: GmailApiMessage['payload'],
  mimeType: 'text/plain' | 'text/html',
): string | null {
  if (payload.mimeType === mimeType && payload.body?.data !== undefined) {
    return base64UrlDecode(payload.body.data);
  }
  const parts = payload.parts ?? [];
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data !== undefined) {
      return base64UrlDecode(part.body.data);
    }
    if (part.parts !== undefined) {
      const nested = decodeBody({ ...payload, parts: part.parts }, mimeType);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function base64UrlDecode(input: string): string {
  const normalised = input.replace(/-/g, '+').replace(/_/g, '/');
  const buf = (
    globalThis as unknown as {
      Buffer?: {
        from(input: string, encoding: string): { toString(enc: string): string };
      };
    }
  ).Buffer;
  if (buf !== undefined) {
    return buf.from(normalised, 'base64').toString('utf-8');
  }
  return atob(normalised);
}

function extractGmailAttachments(
  msg: GmailApiMessage,
): EmailMessage['attachments'] {
  const out: Array<EmailMessage['attachments'][number]> = [];
  const visit = (parts: ReadonlyArray<NonNullable<GmailApiMessage['payload']['parts']>[number]>): void => {
    for (const p of parts) {
      if (
        p.filename !== '' &&
        p.body?.attachmentId !== undefined
      ) {
        out.push({
          name: p.filename,
          mimetype: p.mimeType,
          size: p.body.size ?? 0,
          storage_key: null,
          content_hash: null,
        });
      }
      if (p.parts !== undefined) visit(p.parts);
    }
  };
  if (msg.payload.parts !== undefined) visit(msg.payload.parts);
  return out;
}

export type EmailNormaliser = ReturnType<typeof createEmailNormaliser>;
