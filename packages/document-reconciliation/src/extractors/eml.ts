/**
 * EML extractor (LP-26).
 *
 * Parses an RFC 5322 `.eml` mailbox file into subject + sender + recipients,
 * text/plain + text/html bodies (HTML stripped to plain text), and an
 * attachment manifest the caller routes back through its file extractor.
 *
 * Self-contained — no `mailparser` dependency. Handles single-part,
 * multipart/mixed, and multipart/alternative. Pure + synchronous; never
 * throws on a malformed message (best-effort parse).
 *
 * @module @borjie/document-reconciliation/extractors/eml
 */

export interface EmlAttachment {
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface EmlExtractionResult {
  readonly subject: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly date?: string;
  readonly bodyText: string;
  readonly bodyHtml?: string;
  readonly attachments: readonly EmlAttachment[];
}

export function extractEml(buffer: Uint8Array): EmlExtractionResult {
  const text = new TextDecoder('utf-8').decode(buffer);
  const { headers, body } = splitHeadersBody(text);

  const subject = decodeHeader(headers.subject ?? '');
  const from = decodeHeader(headers.from ?? '');
  const to = decodeHeader(headers.to ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const date = headers.date;

  const contentType = headers['content-type'] ?? 'text/plain';
  const parts = parseMultipart(body, contentType);

  let bodyText = '';
  let bodyHtml: string | undefined;
  const attachments: EmlAttachment[] = [];

  for (const part of parts) {
    const disposition = (part.headers['content-disposition'] ?? '').toLowerCase();
    const partType = (part.headers['content-type'] ?? 'text/plain').toLowerCase();

    if (disposition.startsWith('attachment') || /name=/i.test(disposition)) {
      const fnMatch = /name="?([^"';]+)"?/i.exec(disposition) ?? /name="?([^"';]+)"?/i.exec(partType);
      attachments.push({
        filename: fnMatch?.[1] ?? `attachment-${attachments.length + 1}`,
        mimeType: (partType.split(';')[0] ?? 'application/octet-stream').trim(),
        bytes: decodeTransferBytes(part.body, part.headers['content-transfer-encoding']),
      });
      continue;
    }
    if (partType.startsWith('text/html') && !bodyHtml) {
      bodyHtml = decodeTransferText(part.body, part.headers['content-transfer-encoding']);
    } else if (partType.startsWith('text/plain') && bodyText.length === 0) {
      bodyText = decodeTransferText(part.body, part.headers['content-transfer-encoding']);
    }
  }

  if (bodyText.length === 0 && bodyHtml) bodyText = stripHtml(bodyHtml);

  return {
    subject,
    from,
    to: Object.freeze(to),
    ...(date ? { date } : {}),
    bodyText,
    ...(bodyHtml ? { bodyHtml } : {}),
    attachments: Object.freeze(attachments),
  };
}

// ----------------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------------

function splitHeadersBody(raw: string): { headers: Record<string, string>; body: string } {
  const headerEnd = raw.indexOf('\r\n\r\n');
  const idx = headerEnd >= 0 ? headerEnd : raw.indexOf('\n\n');
  const headerBlock = idx >= 0 ? raw.slice(0, idx) : raw;
  const body = idx >= 0 ? raw.slice(idx + (headerEnd >= 0 ? 4 : 2)) : '';
  const headers: Record<string, string> = {};
  const unfolded = headerBlock.replace(/\r?\n[\t ]/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { headers, body };
}

interface MimePart {
  readonly headers: Record<string, string>;
  readonly body: string;
}

function parseMultipart(body: string, contentType: string): MimePart[] {
  const boundaryMatch = /boundary=("([^"]+)"|([^\s;]+))/i.exec(contentType);
  if (!boundaryMatch) return [{ headers: { 'content-type': contentType }, body }];
  const boundary = '--' + (boundaryMatch[2] ?? boundaryMatch[3] ?? '');
  const segments = body.split(boundary).slice(1);
  const parts: MimePart[] = [];
  for (const seg of segments) {
    const trimmed = seg.replace(/^\r?\n/, '');
    if (trimmed.startsWith('--')) break;
    const split = splitHeadersBody(trimmed);
    const partCt = split.headers['content-type'] ?? 'text/plain';
    if (partCt.toLowerCase().startsWith('multipart/')) {
      parts.push(...parseMultipart(split.body, partCt));
    } else {
      parts.push({ headers: split.headers, body: split.body });
    }
  }
  return parts;
}

function decodeTransferText(body: string, encoding?: string): string {
  const enc = (encoding ?? '').toLowerCase();
  if (enc === 'base64') {
    try {
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf-8');
    } catch {
      return body;
    }
  }
  if (enc === 'quoted-printable') return decodeQuotedPrintable(body);
  return body;
}

function decodeTransferBytes(body: string, encoding?: string): Uint8Array {
  const enc = (encoding ?? '').toLowerCase();
  if (enc === 'base64') {
    try {
      return new Uint8Array(Buffer.from(body.replace(/\s+/g, ''), 'base64'));
    } catch {
      return new TextEncoder().encode(body);
    }
  }
  if (enc === 'quoted-printable') return new TextEncoder().encode(decodeQuotedPrintable(body));
  return new TextEncoder().encode(body);
}

function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeHeader(value: string): string {
  return value.replace(/=\?([\w-]+)\?([QqBb])\?([^?]+)\?=/g, (_m, _charset, kind, encoded) => {
    if (String(kind).toUpperCase() === 'B') {
      try {
        return Buffer.from(encoded, 'base64').toString('utf-8');
      } catch {
        return encoded;
      }
    }
    return decodeQuotedPrintable(String(encoded).replace(/_/g, ' '));
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
