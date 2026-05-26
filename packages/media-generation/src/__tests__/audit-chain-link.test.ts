/**
 * Audit-chain link tests — payload shape, hash stability under
 * canonical-JSON ordering, secret-rotation aware HMAC.
 */

import { describe, expect, it } from 'vitest';
import { buildMediaAuditLink, sha256Hex } from '../audit/audit-chain-link.js';
import type { MediaProvenance } from '../types.js';

function makeProvenance(): MediaProvenance {
  return {
    model_id: 'flux-1.1-pro-ultra',
    model_version: '1.1.0',
    model_provider: 'flux',
    prompt_text: 'Photographic style: Borjie OKLCH palette\nSubject: parcel',
    prompt_image_refs: [],
    seed: 'auto',
    safety_scan: {
      nsfw_probability: 0,
      deepfake_probability: 0,
      brand_violation_flags: [],
    },
    cost_usd_cents: 6,
    duration_ms: 1_200,
  };
}

describe('buildMediaAuditLink', () => {
  it('produces a stable hash for identical input', () => {
    const args = {
      tenant_id: 't1',
      recipe: {
        id: 'briefing_thumbnail',
        version: 1,
        class: 'briefing_thumbnail' as const,
        authority_tier: 0 as const,
      },
      format: 'image' as const,
      checksum: 'abc123',
      provenance: makeProvenance(),
      span_citations: [],
      generated_at: '2026-05-26T00:00:00.000Z',
    };
    const a = buildMediaAuditLink(args);
    const b = buildMediaAuditLink(args);
    expect(a.audit_hash).toBe(b.audit_hash);
    expect(a.audit_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes hash when checksum changes', () => {
    const base = {
      tenant_id: 't1',
      recipe: {
        id: 'briefing_thumbnail',
        version: 1,
        class: 'briefing_thumbnail' as const,
        authority_tier: 0 as const,
      },
      format: 'image' as const,
      checksum: 'abc',
      provenance: makeProvenance(),
      span_citations: [],
      generated_at: '2026-05-26T00:00:00.000Z',
    };
    const a = buildMediaAuditLink(base);
    const b = buildMediaAuditLink({ ...base, checksum: 'def' });
    expect(a.audit_hash).not.toBe(b.audit_hash);
  });

  it('uses HMAC when secret_value supplied', () => {
    const args = {
      tenant_id: 't1',
      recipe: {
        id: 'briefing_thumbnail',
        version: 1,
        class: 'briefing_thumbnail' as const,
        authority_tier: 0 as const,
      },
      format: 'image' as const,
      checksum: 'abc',
      provenance: makeProvenance(),
      span_citations: [],
      generated_at: '2026-05-26T00:00:00.000Z',
    };
    const unsigned = buildMediaAuditLink(args);
    const signed = buildMediaAuditLink({
      ...args,
      secret_id: 'tenant-1-2026',
      secret_value: 'super-secret-rotated',
    });
    expect(unsigned.audit_hash).not.toBe(signed.audit_hash);
  });

  it('payload bundles span_citation_ids', () => {
    const link = buildMediaAuditLink({
      tenant_id: 't1',
      recipe: {
        id: 'briefing_thumbnail',
        version: 1,
        class: 'briefing_thumbnail' as const,
        authority_tier: 0 as const,
      },
      format: 'image' as const,
      checksum: 'abc',
      provenance: makeProvenance(),
      span_citations: [
        {
          id: 'cit-1',
          claim: 'baseline',
          source: { kind: 'corpus_chunk', ref: 'c1' },
        },
      ],
      generated_at: '2026-05-26T00:00:00.000Z',
    });
    const payload = link.payload as Record<string, unknown>;
    expect(payload['span_citation_count']).toBe(1);
    expect(payload['span_citation_ids']).toEqual(['cit-1']);
  });
});

describe('sha256Hex', () => {
  it('hashes deterministically', () => {
    const a = sha256Hex(Buffer.from('hello'));
    const b = sha256Hex(Buffer.from('hello'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
