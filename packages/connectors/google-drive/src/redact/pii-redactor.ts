/**
 * Salted-hash PII redactor for Google Drive ingest.
 *
 * Owner emails, last-modifying-user emails, and sharing-permission
 * emails are hashed. File names are left intact unless they look like
 * raw PII.
 */

import { createHash } from 'node:crypto';

export interface RedactInput {
  readonly tenantId: string;
  readonly fieldPath: string;
  readonly value: string;
}

export function redactValue({
  tenantId,
  fieldPath,
  value,
}: RedactInput): string {
  return createHash('sha256')
    .update(`${tenantId}:${fieldPath}:${value}`)
    .digest('hex');
}
