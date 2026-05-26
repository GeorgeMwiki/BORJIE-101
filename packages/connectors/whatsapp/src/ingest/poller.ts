/**
 * Reconciliation poller for WhatsApp.
 *
 * Meta's webhook delivery is best-effort. Every 6h the poller walks
 * recent conversations via the Graph API `/messages` endpoint to fill
 * gaps. Recovered rows are tagged with
 * `raw.meta.recovered_via='reconciliation'` so downstream analytics
 * can adjust latency expectations.
 *
 * Reference: Meta — "Cloud API messaging analytics & retrieval"
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/reference
 *   (visited 2026-05-26).
 */

import { createHash } from 'node:crypto';
import type {
  WhatsappMessage,
  WhatsappMessageKind,
  ConnectorLogger,
  Fetcher,
} from '../types.js';
import { redactValue } from '../redact/pii-redactor.js';

const RECONCILIATION_WINDOW_HOURS = 6;

export interface PollerInput {
  readonly tenantId: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly accessToken: string;
  /** ISO cursor — fetch messages with timestamp > cursor. */
  readonly since: string | null;
  readonly maxItems: number;
}

export interface PollerDeps {
  readonly fetcher: Fetcher;
  readonly logger: ConnectorLogger;
  readonly nowIso: () => string;
  readonly uuid: () => string;
  readonly baseUrl?: string;
}

export interface PollerResult {
  readonly outcome: 'ok' | 'rate-limited' | 'auth-failed' | 'transport-error';
  readonly rows: ReadonlyArray<WhatsappMessage>;
  readonly nextSince: string;
  readonly retryAfterMs?: number;
}

interface UpstreamMessageRow {
  readonly id?: string;
  readonly from?: string;
  readonly to?: string;
  readonly type?: string;
  readonly timestamp?: string;
  readonly text?: { readonly body?: string };
}

interface UpstreamPayload {
  readonly data?: ReadonlyArray<UpstreamMessageRow>;
}

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

function coerceKind(raw: string | undefined): WhatsappMessageKind {
  if (raw && (ALLOWED_KINDS as ReadonlyArray<string>).includes(raw)) {
    return raw as WhatsappMessageKind;
  }
  return 'unknown';
}

/**
 * Run one reconciliation poll. Returns canonical rows + the next
 * cursor. Caller is responsible for the SQL UNIQUE-on-conflict insert.
 */
export async function pollWhatsappReconciliation(
  input: PollerInput,
  deps: PollerDeps,
): Promise<PollerResult> {
  const base = deps.baseUrl ?? 'https://graph.facebook.com/v20.0';
  const nowIso = deps.nowIso();
  const sinceIso =
    input.since ??
    new Date(
      Date.parse(nowIso) - RECONCILIATION_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();
  const url = new URL(`${base}/${input.phoneNumberId}/messages`);
  url.searchParams.set('limit', String(Math.min(input.maxItems, 100)));
  url.searchParams.set('since', sinceIso);
  const req = new Request(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
  let res: Response;
  try {
    res = await deps.fetcher(req);
  } catch (e) {
    deps.logger.error('WhatsApp poller transport-error', {
      persona: 'Mr. Mwikila',
      connector: 'whatsapp',
      tenantId: input.tenantId,
      err: e instanceof Error ? e.message : String(e),
    });
    return {
      outcome: 'transport-error',
      rows: [],
      nextSince: input.since ?? nowIso,
    };
  }
  if (res.status === 429) {
    const retryAfterRaw = res.headers.get('Retry-After') ?? '60';
    const retryAfterMs = Number(retryAfterRaw) * 1000;
    return {
      outcome: 'rate-limited',
      rows: [],
      nextSince: input.since ?? nowIso,
      retryAfterMs,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      outcome: 'auth-failed',
      rows: [],
      nextSince: input.since ?? nowIso,
    };
  }
  if (!res.ok) {
    return {
      outcome: 'transport-error',
      rows: [],
      nextSince: input.since ?? nowIso,
    };
  }
  const body = (await res.json()) as UpstreamPayload;
  const rowsRaw = body.data ?? [];
  const rows: WhatsappMessage[] = [];
  let maxTs = sinceIso;
  for (const raw of rowsRaw) {
    if (!raw.id || !raw.from || !raw.to || !raw.timestamp) continue;
    const kind = coerceKind(raw.type);
    const text = raw.text?.body ?? null;
    const canonical = `${input.tenantId}|${input.wabaId}|${raw.id}`;
    const auditHash = createHash('sha256').update(canonical).digest('hex');
    if (raw.timestamp > maxTs) maxTs = raw.timestamp;
    rows.push({
      id: deps.uuid(),
      tenantId: input.tenantId,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      waMessageId: raw.id,
      fromPhone: redactValue({
        tenantId: input.tenantId,
        fieldPath: 'fromPhone',
        value: raw.from,
      }),
      toPhone: redactValue({
        tenantId: input.tenantId,
        fieldPath: 'toPhone',
        value: raw.to,
      }),
      direction: raw.from === input.phoneNumberId ? 'outbound' : 'inbound',
      kind,
      text: text
        ? redactValue({
            tenantId: input.tenantId,
            fieldPath: 'text',
            value: text,
          })
        : null,
      media: null,
      contacts: null,
      raw: {
        ...raw,
        meta: { recovered_via: 'reconciliation' },
      } as unknown as Readonly<Record<string, unknown>>,
      ingestedAt: nowIso,
      auditHash,
    });
  }
  return {
    outcome: 'ok',
    rows,
    nextSince: maxTs,
  };
}
