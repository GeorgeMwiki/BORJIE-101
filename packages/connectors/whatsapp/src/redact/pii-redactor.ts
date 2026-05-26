/**
 * Salted-hash PII redactor for WhatsApp ingest.
 *
 * Every PII value is replaced with `sha256(tenantId + ':' + fieldPath +
 * ':' + value)`, base16-encoded. The salt is tenant-scoped so the same
 * value across tenants hashes differently.
 *
 * Deterministic so the cognitive-memory layer can deduplicate
 * semantically identical mentions across sources (e.g. the same vendor
 * in Notion and WhatsApp).
 */

import { createHash } from 'node:crypto';

export interface RedactInput {
  readonly tenantId: string;
  readonly fieldPath: string;
  readonly value: string;
}

export function redactValue({ tenantId, fieldPath, value }: RedactInput): string {
  const input = `${tenantId}:${fieldPath}:${value}`;
  return createHash('sha256').update(input).digest('hex');
}

export interface WhatsappPiiPaths {
  readonly fromPhone: boolean;
  readonly toPhone: boolean;
  readonly text: boolean;
  readonly contacts: boolean;
}

export const DEFAULT_WHATSAPP_PII_PATHS: WhatsappPiiPaths = {
  fromPhone: true,
  toPhone: true,
  text: true,
  contacts: true,
};
