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

/**
 * Strip HTML markup to plain text for an `.eml` body.
 *
 * Deliberately NOT regex-based: a single forward character scan (no
 * backtracking, no nested/overlapping quantifiers) removes every tag and the
 * full contents of `<script>` / `<style>` elements, then HTML entities are
 * decoded in ONE atomic pass. Linear `O(n)` in input length, so it cannot be
 * driven into super-linear backtracking, and because tag removal is performed
 * structurally (not by a `.replace()` that runs once) a nested injection such
 * as `<scr<script>ipt>` cannot survive — there is no residue to reconstitute a
 * tag, since the scan re-enters tag-mode at every `<` it encounters.
 */
function stripHtml(html: string): string {
  const stripped = stripTags(html);
  const decoded = decodeHtmlEntities(stripped);
  return collapseWhitespace(decoded);
}

/**
 * Forward character scan that removes all tags and drops the raw contents of
 * raw-text elements (`script` / `style`). No regular expressions, hence no
 * catastrophic backtracking. A `<` always re-enters tag-scanning mode, so
 * overlapping/nested constructs cannot leave a partial tag behind.
 */
function stripTags(html: string): string {
  let out = '';
  let i = 0;
  const n = html.length;
  while (i < n) {
    const ch = html[i];
    if (ch !== '<') {
      out += ch;
      i += 1;
      continue;
    }
    // At a tag opener. Identify a raw-text element so its body is discarded.
    const rawTextEl = matchRawTextElementName(html, i + 1);
    const tagEnd = html.indexOf('>', i + 1);
    if (tagEnd < 0) {
      // Unterminated tag: drop the remainder (cannot be valid markup).
      break;
    }
    if (rawTextEl) {
      // Skip the whole element, body included, up to its matching close tag.
      const closeIdx = indexOfCloseTag(html, tagEnd + 1, rawTextEl);
      i = closeIdx < 0 ? n : closeIdx;
      out += ' ';
      continue;
    }
    // Ordinary tag (incl. comments `<!-- ... -->`, doctype, malformed): the
    // first `>` terminates our notion of the tag; replace with a separator.
    out += ' ';
    i = tagEnd + 1;
  }
  return out;
}

const RAW_TEXT_ELEMENTS: readonly string[] = ['script', 'style'];

/**
 * If a tag opening at `pos` (the char after `<`) names a raw-text element,
 * return its lowercased name; otherwise null. Uses bounded single-char checks
 * only — no quantified subpatterns.
 */
function matchRawTextElementName(html: string, pos: number): string | null {
  for (const name of RAW_TEXT_ELEMENTS) {
    if (pos + name.length > html.length) continue;
    let matches = true;
    for (let k = 0; k < name.length; k += 1) {
      if ((html[pos + k] ?? '').toLowerCase() !== name[k]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    // Next char must be a tag delimiter so `<scriptx>` is not treated as raw.
    const after = html[pos + name.length] ?? '';
    if (after === '>' || after === ' ' || after === '\t' || after === '\n' || after === '\r' || after === '/') {
      return name;
    }
  }
  return null;
}

/**
 * Find the index just past the `>` of the next `</name ...>` close tag at or
 * after `from`, case-insensitively. Linear scan; no backtracking.
 */
function indexOfCloseTag(html: string, from: number, name: string): number {
  const n = html.length;
  let i = from;
  while (i < n) {
    if (html[i] === '<' && html[i + 1] === '/') {
      const namePos = i + 2;
      let matches = namePos + name.length <= n;
      for (let k = 0; matches && k < name.length; k += 1) {
        if ((html[namePos + k] ?? '').toLowerCase() !== name[k]) matches = false;
      }
      if (matches) {
        const tagEnd = html.indexOf('>', namePos + name.length);
        return tagEnd < 0 ? n : tagEnd + 1;
      }
    }
    i += 1;
  }
  return -1;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Decode HTML entities in a SINGLE atomic pass so escaping is never applied
 * twice (no `&amp;lt;` → `&lt;` → `<` double-decode): each `&...;` token is
 * resolved exactly once, left to right, and the produced character is never
 * re-scanned. The entity body class `[a-zA-Z0-9#]` has no nested quantifier,
 * so the match is linear.
 */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const codePoint =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/** Collapse runs of ASCII/Unicode whitespace to a single space and trim. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
