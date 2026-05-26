import { describe, it, expect } from 'vitest';
import { normalizeDriveFile } from '../ingest/normalizer.js';
import { redactValue } from '../redact/pii-redactor.js';
import type { DriveUpstreamFile } from '../types.js';

describe('normalizeDriveFile', () => {
  const upstream: DriveUpstreamFile = {
    id: 'file-1',
    name: 'Q4 royalty plan.gdoc',
    mimeType: 'application/vnd.google-apps.document',
    parents: ['folder-1'],
    modifiedTime: '2026-05-25T08:00:00.000Z',
    owners: [{ emailAddress: 'george@borjie.test' }],
    lastModifyingUser: { emailAddress: 'samia@borjie.test' },
  };

  const deps = {
    tenantId: 'tenant_a',
    account: 'george@borjie.test',
    nowIso: () => '2026-05-26T10:00:00.000Z',
    uuid: () => 'uuid-1',
  };

  it('preserves file metadata as-is', () => {
    const { row } = normalizeDriveFile(upstream, 'plain text body', deps);
    expect(row.fileId).toBe('file-1');
    expect(row.name).toBe('Q4 royalty plan.gdoc');
    expect(row.mimeType).toBe('application/vnd.google-apps.document');
    expect(row.parents).toEqual(['folder-1']);
    expect(row.modifiedAt).toBe('2026-05-25T08:00:00.000Z');
    expect(row.extractedText).toBe('plain text body');
  });

  it('hashes owners and lastModifyingUser emails into the raw payload', () => {
    const { row, redactedFields } = normalizeDriveFile(upstream, null, deps);
    const raw = row.raw as {
      owners_redacted: ReadonlyArray<string>;
      lastModifyingUser_redacted: string;
    };
    expect(raw.owners_redacted).toContain(
      redactValue({
        tenantId: 'tenant_a',
        fieldPath: 'owners.emailAddress',
        value: 'george@borjie.test',
      }),
    );
    expect(raw.lastModifyingUser_redacted).toBe(
      redactValue({
        tenantId: 'tenant_a',
        fieldPath: 'lastModifyingUser.emailAddress',
        value: 'samia@borjie.test',
      }),
    );
    expect(redactedFields).toContain('owners.emailAddress');
    expect(redactedFields).toContain('lastModifyingUser.emailAddress');
  });

  it('stamps a deterministic audit_hash from (tenant, account, fileId)', () => {
    const a = normalizeDriveFile(upstream, null, deps);
    const b = normalizeDriveFile(upstream, null, { ...deps, uuid: () => 'uuid-2' });
    expect(a.row.auditHash).toBe(b.row.auditHash);
  });
});
