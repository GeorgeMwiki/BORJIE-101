/**
 * WhatsApp webhook receiver.
 *
 * Verifies the `X-Hub-Signature-256` header (HMAC-SHA256 of the raw
 * request body keyed with the App Secret) before any payload
 * normalisation runs.
 *
 * Reference: Meta — "Webhooks signature verification"
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#payload
 *   (visited 2026-05-26).
 *
 * The function is pure — supply the raw body, the header, and the
 * decoded App Secret. Returns a boolean + the parsed envelope on
 * success.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  WhatsappWebhookEnvelope,
  WhatsappMessage,
  ConnectorLogger,
} from '../types.js';
import { normalizeInbound, type NormalizerDeps } from './normalizer.js';

export interface VerifySignatureInput {
  readonly rawBody: string;
  readonly signatureHeader: string | null;
  readonly appSecret: string;
}

/**
 * `signatureHeader` arrives as `sha256=<hex>`. We compute the HMAC,
 * compare with `timingSafeEqual` to defeat timing oracles.
 */
export function verifyWhatsappSignature({
  rawBody,
  signatureHeader,
  appSecret,
}: VerifySignatureInput): boolean {
  if (!signatureHeader) return false;
  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) return false;
  const provided = signatureHeader.slice(prefix.length);
  // Hex must be even length.
  if (provided.length === 0 || provided.length % 2 !== 0) return false;
  // Validate hex chars to avoid Buffer.from throwing.
  if (!/^[0-9a-fA-F]+$/.test(provided)) return false;
  const expectedHex = createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex');
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface ReceiverDeps extends NormalizerDeps {
  readonly logger: ConnectorLogger;
  readonly appSecret: string;
}

export interface ReceiveResult {
  readonly outcome: 'ok' | 'invalid-signature' | 'malformed-payload';
  readonly rows: ReadonlyArray<WhatsappMessage>;
  readonly redactedFieldsPerRow: ReadonlyArray<ReadonlyArray<string>>;
}

/**
 * Top-level webhook handler. Verifies + parses + normalises. Persistence
 * is the caller's responsibility (the orchestrator owns the SQL write
 * and the audit-chain append).
 */
export function receiveWhatsappWebhook(
  rawBody: string,
  signatureHeader: string | null,
  deps: ReceiverDeps,
): ReceiveResult {
  if (
    !verifyWhatsappSignature({
      rawBody,
      signatureHeader,
      appSecret: deps.appSecret,
    })
  ) {
    deps.logger.warn('WhatsApp webhook rejected — invalid signature', {
      persona: 'Mr. Mwikila',
      connector: 'whatsapp',
      tenantId: deps.tenantId,
    });
    return { outcome: 'invalid-signature', rows: [], redactedFieldsPerRow: [] };
  }
  let envelope: WhatsappWebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody) as WhatsappWebhookEnvelope;
  } catch (e) {
    deps.logger.error('WhatsApp webhook body is not valid JSON', {
      persona: 'Mr. Mwikila',
      connector: 'whatsapp',
      tenantId: deps.tenantId,
      err: e instanceof Error ? e.message : String(e),
    });
    return { outcome: 'malformed-payload', rows: [], redactedFieldsPerRow: [] };
  }
  if (!envelope.entry || !Array.isArray(envelope.entry)) {
    deps.logger.error('WhatsApp webhook envelope is missing `entry`', {
      persona: 'Mr. Mwikila',
      connector: 'whatsapp',
      tenantId: deps.tenantId,
    });
    return { outcome: 'malformed-payload', rows: [], redactedFieldsPerRow: [] };
  }
  const normalised = normalizeInbound(envelope, {
    tenantId: deps.tenantId,
    nowIso: deps.nowIso,
    uuid: deps.uuid,
  });
  return {
    outcome: 'ok',
    rows: normalised.map((n) => n.row),
    redactedFieldsPerRow: normalised.map((n) => n.redactedFields),
  };
}
