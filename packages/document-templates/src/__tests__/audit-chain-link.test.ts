/**
 * Audit-chain link tests — per spec §5 "every produced doc emits one
 * entry into the audit-hash-chain".
 */

import { describe, expect, it } from 'vitest';
import { buildDocAuditLink } from '../citations/audit-chain-link.js';
import { hashChainEntry } from '@borjie/audit-hash-chain';
import type { SpanCitation } from '../types.js';

const SPAN: SpanCitation = {
  id: 'cit-001',
  claim: 'reference claim',
  source: { kind: 'corpus_chunk', ref: 'chunk-1' },
};

describe('buildDocAuditLink', () => {
  it('emits a 64-char hex hash for a sealed payload', () => {
    const link = buildDocAuditLink({
      tenant_id: 'tenant-1',
      recipe: {
        id: 'daily_briefing',
        version: 1,
        class: 'daily_briefing',
        authority_tier: 1,
      },
      checksum: 'abc'.repeat(20),
      span_citations: [SPAN],
      generated_at: '2026-05-26T08:00:00.000Z',
      format: 'md',
    });
    expect(link.audit_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(link.payload['kind']).toBe('doc_artifact');
    expect(link.payload['recipe_id']).toBe('daily_briefing');
    expect(link.payload['span_citation_count']).toBe(1);
  });

  it('is deterministic for the same inputs', () => {
    const args = {
      tenant_id: 'tenant-1',
      recipe: {
        id: 'board_report',
        version: 1,
        class: 'board_report' as const,
        authority_tier: 1 as const,
      },
      checksum: 'def'.repeat(20),
      span_citations: [SPAN],
      generated_at: '2026-05-26T08:00:00.000Z',
      format: 'docx' as const,
    };
    const a = buildDocAuditLink(args);
    const b = buildDocAuditLink(args);
    expect(a.audit_hash).toBe(b.audit_hash);
  });

  it('chains via prev_audit_hash so successive docs share lineage', () => {
    const first = buildDocAuditLink({
      tenant_id: 'tenant-1',
      recipe: {
        id: 'sop',
        version: 1,
        class: 'sop',
        authority_tier: 1,
      },
      checksum: '111'.repeat(20),
      span_citations: [SPAN],
      generated_at: '2026-05-26T08:00:00.000Z',
      format: 'docx',
    });

    const second = buildDocAuditLink({
      tenant_id: 'tenant-1',
      recipe: {
        id: 'sop',
        version: 1,
        class: 'sop',
        authority_tier: 1,
      },
      checksum: '222'.repeat(20),
      span_citations: [SPAN],
      generated_at: '2026-05-26T09:00:00.000Z',
      format: 'docx',
      prev_audit_hash: first.audit_hash,
    });

    expect(second.audit_hash).not.toBe(first.audit_hash);
    expect(second.audit_hash).toMatch(/^[a-f0-9]{64}$/);

    // Reconstruct the second hash via the audit-hash-chain primitive
    // to prove this module did not invent its own hashing function.
    const reconstructed = hashChainEntry({
      payload: second.payload,
      prev: first.audit_hash,
    });
    expect(reconstructed).toBe(second.audit_hash);
  });

  it('supports HMAC-keyed sealing via secret_id + secret_value', () => {
    const link = buildDocAuditLink({
      tenant_id: 'tenant-1',
      recipe: {
        id: 'contract',
        version: 1,
        class: 'contract',
        authority_tier: 2,
      },
      checksum: '777'.repeat(20),
      span_citations: [SPAN],
      generated_at: '2026-05-26T08:00:00.000Z',
      format: 'docx',
      secret_id: 'tenant-1-v1',
      secret_value: '00deadbeef',
    });
    expect(link.audit_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
