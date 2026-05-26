/**
 * Audit-chain-link — hash stability + canonical payload tests.
 */

import { appendEntry, verifyChain } from '@borjie/audit-hash-chain';
import { describe, expect, it } from 'vitest';

import {
  buildResultAuditPayload,
  computeResultAuditHash,
  hashArtifact,
  summariseArtifactAudit,
} from '../audit/audit-chain-link.js';
import type { ResearchArtifact, ResearchResult } from '../types.js';

const RECENT_ISO = '2026-01-01T00:00:00.000Z';

function sampleArtifact(): ResearchArtifact {
  return {
    id: 'art_1',
    step_id: 'step_1',
    source_kind: 'web',
    source_uri: 'https://www.tumemadini.go.tz/x',
    source_class: 'tz_official',
    retrieved_at: RECENT_ISO,
    content: 'Some retrieved content',
    excerpt: 'Some retrieved content',
    title: 'X',
    extracted_entities: [],
    quality_score: 0.95,
    bias_flags: [],
    citation_id: 'cit_x',
    audit_hash: 'a'.repeat(64),
    tool_name: 'tavily-search',
    cost_usd_cents: 1,
  };
}

function sampleResult(): ResearchResult {
  return {
    id: 'res_1',
    plan_id: 'plan_1',
    summary_md: '# Findings\nRoyalty rate is 6%.',
    span_citations: [
      {
        citationId: 'cit_x',
        kind: 'web',
        sourceUri: 'https://www.tumemadini.go.tz/x',
        startOffset: 0,
        endOffset: 10,
        quotedSpan: 'Royalty 6%',
        overlap: 0.9,
      },
    ],
    confidence: 'high',
    disagreements: [],
    audit_hash: '',
    generated_at: RECENT_ISO,
    total_cost_usd_cents: 5,
    total_duration_ms: 12_345,
  };
}

describe('hashArtifact', () => {
  it('produces stable 64-char hex hash', () => {
    const h = hashArtifact({
      source_uri: 'https://x.com',
      content: 'abc',
      retrieved_at: RECENT_ISO,
      tool_name: 'tavily',
    });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    const h2 = hashArtifact({
      source_uri: 'https://x.com',
      content: 'abc',
      retrieved_at: RECENT_ISO,
      tool_name: 'tavily',
    });
    expect(h).toBe(h2);
  });

  it('differs when content differs', () => {
    const a = hashArtifact({
      source_uri: 'x',
      content: 'a',
      retrieved_at: RECENT_ISO,
      tool_name: 't',
    });
    const b = hashArtifact({
      source_uri: 'x',
      content: 'b',
      retrieved_at: RECENT_ISO,
      tool_name: 't',
    });
    expect(a).not.toBe(b);
  });
});

describe('buildResultAuditPayload', () => {
  it('produces a deterministic payload with required fields', () => {
    const result = sampleResult();
    const payload = buildResultAuditPayload({ result, model_id: 'claude-opus-4-7' });
    expect(payload.kind).toBe('research_result');
    expect(payload.result_id).toBe(result.id);
    expect(payload.plan_id).toBe(result.plan_id);
    expect(payload.confidence).toBe('high');
    expect(payload.model_id).toBe('claude-opus-4-7');
    expect(payload.summary_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.citation_count).toBe(1);
    const citationHashes = payload.citation_hashes as ReadonlyArray<string>;
    expect(citationHashes).toHaveLength(1);
    expect(citationHashes[0]).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('computeResultAuditHash + appendEntry round-trip', () => {
  it('appendEntry then verifyChain succeeds', () => {
    const result = sampleResult();
    const payload = buildResultAuditPayload({ result, model_id: 'claude-opus-4-7' });
    const chain = appendEntry([], payload);
    const verified = verifyChain(chain);
    expect(verified.ok).toBe(true);
  });

  it('computeResultAuditHash matches the chain hash', () => {
    const result = sampleResult();
    const hash = computeResultAuditHash({ result, model_id: 'claude-opus-4-7' });
    const payload = buildResultAuditPayload({ result, model_id: 'claude-opus-4-7' });
    const chain = appendEntry([], payload);
    expect(chain[0]?.rowHash).toBe(hash);
  });
});

describe('summariseArtifactAudit', () => {
  it('extracts id, uri, and content hash', () => {
    const a = sampleArtifact();
    const summary = summariseArtifactAudit(a);
    expect(summary.artifact_id).toBe(a.id);
    expect(summary.source_uri).toBe(a.source_uri);
    expect(summary.content_hash).toBe(a.audit_hash);
  });
});
