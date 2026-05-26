import { describe, expect, it } from 'vitest';
import { createSlackNormaliser } from '../ingest/normalizer.js';
import { createPiiRedactor } from '../redact/pii-redactor.js';
import type { Hasher } from '../types.js';

function deterministicHasher(): Hasher {
  return async (input) => {
    // Trivial but stable digest for tests; clearly NOT cryptographic.
    let h = 0;
    for (let i = 0; i < input.length; i += 1) {
      h = (h * 31 + input.charCodeAt(i)) >>> 0;
    }
    return `test-${h.toString(16).padStart(8, '0')}`;
  };
}

describe('Slack normaliser — provider payload → canonical row', () => {
  it('produces a canonical SlackMessage with redacted PII and storage keys', async () => {
    const hasher = deterministicHasher();
    const redactor = createPiiRedactor({ hasher });
    let uuidCounter = 0;
    const normaliser = createSlackNormaliser({
      redactor,
      clock: { nowIso: () => '2026-05-26T12:00:00.000Z' },
      uuid: {
        v4: () => {
          uuidCounter += 1;
          return `00000000-0000-0000-0000-${uuidCounter.toString().padStart(12, '0')}`;
        },
      },
    });

    const result = await normaliser.normalise({
      tenantId: 'tenant-001',
      workspaceId: 'T01TEAM',
      channelId: 'C01OPS',
      apiMessage: {
        type: 'message',
        ts: '1700000000.000100',
        user: 'U01ADMIN',
        text: 'Email mwikila@example.com about the permit.',
        files: [
          {
            id: 'F01FILE',
            name: 'permit.pdf',
            mimetype: 'application/pdf',
            size: 12345,
          },
        ],
      },
      auditHash: 'audit-hash-001',
      attachmentStorageKeys: new Map([
        ['F01FILE', 'slack/tenant-001/T01TEAM/C01OPS/1700000000.000100/permit.pdf'],
      ]),
    });

    expect(result.tenant_id).toBe('tenant-001');
    expect(result.workspace_id).toBe('T01TEAM');
    expect(result.channel_id).toBe('C01OPS');
    expect(result.ts).toBe('1700000000.000100');
    expect(result.user_id).toBe('U01ADMIN');
    expect(result.text).not.toContain('mwikila@example.com');
    expect(result.text).toMatch(/\[email:/);
    expect(result.files[0]?.storage_key).toBe(
      'slack/tenant-001/T01TEAM/C01OPS/1700000000.000100/permit.pdf',
    );
    expect(result.audit_hash).toBe('audit-hash-001');
    expect(result.ingested_at).toBe('2026-05-26T12:00:00.000Z');
  });

  it('handles empty text + no files + no reactions', async () => {
    const normaliser = createSlackNormaliser({
      redactor: createPiiRedactor({ hasher: deterministicHasher() }),
      clock: { nowIso: () => '2026-05-26T12:00:00.000Z' },
      uuid: { v4: () => 'uuid-empty' },
    });

    const result = await normaliser.normalise({
      tenantId: 'tenant-001',
      workspaceId: 'T01',
      channelId: 'C01',
      apiMessage: { type: 'message', ts: '1700000000.000200' },
      auditHash: 'h',
      attachmentStorageKeys: new Map(),
    });

    expect(result.text).toBeNull();
    expect(result.files).toEqual([]);
    expect(result.reactions).toEqual([]);
    expect(result.user_id).toBeNull();
  });
});
