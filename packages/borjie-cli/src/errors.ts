/**
 * CLI-side error normaliser + pretty printer.
 *
 * The CLI deliberately doesn't depend on `@borjie/api-sdk`'s
 * `BorjieError` class to avoid the SDK -> CLI dep loop. Instead we
 * inspect `HttpError` (from `./http.ts`) and map status codes into a
 * stable `BorjieErrorKind` enum, then render a 3-line pretty message:
 *
 *   error: <summary>
 *   why:   <root cause hint>
 *   next:  <actionable next step>
 *   request_id: <id>          (when known)
 *
 * Each `--verbose` adds the full stack trace and original body text.
 */

import kleur from 'kleur';
import { HttpError } from './http.js';
import type { BorjieLogger } from './logger.js';

export type BorjieErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'unknown';

export interface NormalisedError {
  readonly kind: BorjieErrorKind;
  readonly status: number;
  readonly summary: string;
  readonly why: string;
  readonly next: string;
  readonly requestId?: string;
  readonly retryAfterSec?: number;
  readonly url?: string;
  readonly bodyText?: string;
  readonly stack?: string;
}

const CHAT_RATE_LIMIT_PER_MIN = 20;

export function normaliseError(err: unknown): NormalisedError {
  if (err instanceof HttpError) {
    return fromHttpError(err);
  }
  if (err instanceof Error) {
    const msg = err.message || 'Unknown error';
    const stack = typeof err.stack === 'string' ? err.stack : undefined;
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(msg)) {
      return {
        kind: 'network',
        status: 0,
        summary: `Couldn't reach the Borjie API.`,
        why: `${msg}`,
        next: 'Check your connection or set BORJIE_API_URL to a reachable host.',
        ...(stack ? { stack } : {}),
      };
    }
    return {
      kind: 'unknown',
      status: 0,
      summary: msg,
      why: 'An unexpected error occurred.',
      next: 'Re-run with --verbose for a stack trace, then file an issue if it persists.',
      ...(stack ? { stack } : {}),
    };
  }
  return {
    kind: 'unknown',
    status: 0,
    summary: String(err),
    why: 'An unexpected non-Error value was thrown.',
    next: 'Re-run with --verbose for context.',
  };
}

function fromHttpError(err: HttpError): NormalisedError {
  const requestId = extractRequestId(err.bodyText);
  const url = err.url;
  const bodyText = err.bodyText;
  const baseFields: Pick<NormalisedError, 'status' | 'url' | 'bodyText'> & {
    requestId?: string;
  } = {
    status: err.status,
    url,
    bodyText,
    ...(requestId ? { requestId } : {}),
  };
  if (err.status === 401) {
    return {
      ...baseFields,
      kind: 'auth',
      summary: 'Your session is invalid or has expired.',
      why: `The API returned 401 Unauthorized on ${shortUrl(url)}.`,
      next: 'Run: borjie login',
    };
  }
  if (err.status === 403) {
    return {
      ...baseFields,
      kind: 'forbidden',
      summary: 'Your token is missing a required scope.',
      why: `The API returned 403 Forbidden on ${shortUrl(url)}.`,
      next: 'Run: borjie login --scope owner:read --scope owner:write …',
    };
  }
  if (err.status === 404) {
    return {
      ...baseFields,
      kind: 'not_found',
      summary: 'That resource does not exist (or you do not have access).',
      why: `The API returned 404 on ${shortUrl(url)}.`,
      next: 'Double-check the id; try `borjie drafts ls` or `borjie sessions ls` first.',
    };
  }
  if (err.status === 400 || err.status === 422) {
    return {
      ...baseFields,
      kind: 'validation',
      summary: 'The request did not pass validation.',
      why: extractWhy(bodyText) ?? `The API returned ${err.status} on ${shortUrl(url)}.`,
      next: 'Re-run with --verbose to see the issues array; check arg types.',
    };
  }
  if (err.status === 429) {
    const retry = extractRetryAfterSec(bodyText);
    return {
      ...baseFields,
      kind: 'rate_limit',
      ...(retry !== undefined ? { retryAfterSec: retry } : {}),
      summary: `Hit rate limit (chat default: ${CHAT_RATE_LIMIT_PER_MIN}/min).`,
      why: `The API returned 429 on ${shortUrl(url)}.`,
      next: retry
        ? `Retry in ${retry}s (e.g. \`sleep ${retry} && borjie …\`).`
        : 'Back off for ~60s and try again.',
    };
  }
  if (err.status >= 500) {
    return {
      ...baseFields,
      kind: 'server',
      summary: 'The Borjie API is having a bad day.',
      why: `The API returned ${err.status} on ${shortUrl(url)}.`,
      next: 'Retry in a minute. If it persists, share the request_id with support.',
    };
  }
  return {
    ...baseFields,
    kind: 'unknown',
    summary: `Request failed (HTTP ${err.status}).`,
    why: extractWhy(bodyText) ?? `The API returned ${err.status} on ${shortUrl(url)}.`,
    next: 'Re-run with --verbose for more context.',
  };
}

export function printPrettyError(
  logger: BorjieLogger,
  err: unknown,
): NormalisedError {
  const n = normaliseError(err);
  if (logger.opts.json) {
    logger.json({
      ok: false,
      error: {
        kind: n.kind,
        status: n.status,
        summary: n.summary,
        why: n.why,
        next: n.next,
        requestId: n.requestId,
        retryAfterSec: n.retryAfterSec,
        url: n.url,
      },
    });
    return n;
  }
  const useColor = !logger.opts.noColor;
  const tag = useColor ? kleur.red('error:') : 'error:';
  const why = useColor ? kleur.gray('why:  ') : 'why:  ';
  const next = useColor ? kleur.cyan('next: ') : 'next: ';
  process.stderr.write(`${tag} ${n.summary}\n`);
  process.stderr.write(`${why} ${n.why}\n`);
  process.stderr.write(`${next} ${n.next}\n`);
  if (n.requestId) {
    process.stderr.write(
      useColor
        ? kleur.gray(`request_id: ${n.requestId}\n`)
        : `request_id: ${n.requestId}\n`,
    );
  }
  if (logger.opts.verbose) {
    if (n.bodyText) {
      process.stderr.write(`\nbody:\n${n.bodyText}\n`);
    }
    if (n.stack) {
      process.stderr.write(`\nstack:\n${n.stack}\n`);
    }
  }
  return n;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function extractRequestId(bodyText: string): string | undefined {
  if (!bodyText) return undefined;
  try {
    const j = JSON.parse(bodyText) as Record<string, unknown>;
    const candidates: Array<unknown> = [
      j['request_id'],
      j['requestId'],
      (j['error'] as Record<string, unknown> | undefined)?.['request_id'],
      (j['error'] as Record<string, unknown> | undefined)?.['requestId'],
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.length > 0) return c;
    }
  } catch {
    /* not JSON */
  }
  return undefined;
}

function extractWhy(bodyText: string | undefined): string | undefined {
  if (!bodyText) return undefined;
  try {
    const j = JSON.parse(bodyText) as Record<string, unknown>;
    const m = j['message'] ?? j['error_description'] ?? j['error'];
    if (typeof m === 'string' && m.length > 0) return m;
  } catch {
    /* not JSON */
  }
  return undefined;
}

function extractRetryAfterSec(bodyText: string | undefined): number | undefined {
  if (!bodyText) return undefined;
  try {
    const j = JSON.parse(bodyText) as Record<string, unknown>;
    const candidates: Array<unknown> = [
      j['retry_after'],
      j['retryAfter'],
      j['retryAfterSec'],
    ];
    for (const c of candidates) {
      if (typeof c === 'number' && Number.isFinite(c)) return c;
      if (typeof c === 'string') {
        const n = Number.parseInt(c, 10);
        if (Number.isFinite(n)) return n;
      }
    }
  } catch {
    /* not JSON */
  }
  return undefined;
}
