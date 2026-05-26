/**
 * Normalise a Drive upstream file row + optional extracted text into a
 * canonical `DriveFile` row. Pure — no I/O.
 */

import { createHash } from 'node:crypto';
import type { DriveFile, DriveUpstreamFile } from '../types.js';
import { redactValue } from '../redact/pii-redactor.js';

export interface DriveNormalizerDeps {
  readonly tenantId: string;
  readonly account: string;
  readonly nowIso: () => string;
  readonly uuid: () => string;
}

export interface NormalizedDriveFile {
  readonly row: DriveFile;
  readonly redactedFields: ReadonlyArray<string>;
}

export function normalizeDriveFile(
  upstream: DriveUpstreamFile,
  extractedText: string | null,
  deps: DriveNormalizerDeps,
): NormalizedDriveFile {
  const ownerEmails = (upstream.owners ?? [])
    .map((o) => o.emailAddress)
    .filter((e): e is string => typeof e === 'string');
  const lastMod = upstream.lastModifyingUser?.emailAddress;
  const hashedOwners = ownerEmails.map((e) =>
    redactValue({
      tenantId: deps.tenantId,
      fieldPath: 'owners.emailAddress',
      value: e,
    }),
  );
  const hashedLast = lastMod
    ? redactValue({
        tenantId: deps.tenantId,
        fieldPath: 'lastModifyingUser.emailAddress',
        value: lastMod,
      })
    : null;
  const redactedFields: string[] = [];
  if (hashedOwners.length > 0) redactedFields.push('owners.emailAddress');
  if (hashedLast) redactedFields.push('lastModifyingUser.emailAddress');
  const canonical = `${deps.tenantId}|${deps.account}|${upstream.id}`;
  const auditHash = createHash('sha256').update(canonical).digest('hex');
  const raw: Record<string, unknown> = {
    ...upstream,
    owners_redacted: hashedOwners,
    ...(hashedLast ? { lastModifyingUser_redacted: hashedLast } : {}),
  };
  return {
    row: {
      id: deps.uuid(),
      tenantId: deps.tenantId,
      account: deps.account,
      fileId: upstream.id,
      name: upstream.name,
      mimeType: upstream.mimeType,
      parents: upstream.parents ?? [],
      modifiedAt: upstream.modifiedTime,
      extractedText,
      raw,
      ingestedAt: deps.nowIso(),
      auditHash,
    },
    redactedFields,
  };
}
