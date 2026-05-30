/**
 * chat-response-gate — auditor wiring unit tests.
 *
 * Pins the contract the brain.hono.ts /turn handlers depend on:
 *   - the gate ALWAYS resolves (never throws on missing evidence);
 *   - empty evidence chain → verdict=reject + evidenceWarning='no_evidence_cited';
 *   - bracketed inline citations are extracted and approved;
 *   - footer-style `Sources:` citations are extracted;
 *   - the gate is called per response — proven by the public verdict
 *     surface (evidenceCount + auditLogId).
 */

import { describe, it, expect } from 'vitest';
import {
  auditChatResponse,
  extractEvidenceIds,
} from '../chat-response-gate';

const BASE_INPUT = {
  tenantId: 't_demo',
  threadId: 'thread_001',
  userId: 'u_owner',
  personaId: 'persona.coworker',
  tokensUsed: 42,
} as const;

describe('extractEvidenceIds', () => {
  it('returns empty array on a response without citations', () => {
    expect(extractEvidenceIds('Hello, world. No citations here.')).toEqual([]);
  });

  it('extracts a single bracketed inline citation', () => {
    const ids = extractEvidenceIds('See [evidence:lmbm_42] for details.');
    expect(ids).toContain('lmbm_42');
  });

  it('extracts multiple distinct inline citations and dedupes', () => {
    const ids = extractEvidenceIds(
      'See [evidence:lmbm_42] and [evidence:corpus:abc-123] and again [evidence:lmbm_42].',
    );
    expect(ids).toContain('lmbm_42');
    expect(ids).toContain('corpus:abc-123');
    expect(ids.length).toBe(2);
  });

  it('extracts ids from a Sources: footer', () => {
    const body = [
      'Recommendation summary above.',
      '',
      'Sources:',
      '- evidence_id: lmbm_99',
      '- corpus_chunk_42',
    ].join('\n');
    const ids = extractEvidenceIds(body);
    expect(ids).toContain('lmbm_99');
    expect(ids).toContain('corpus_chunk_42');
  });

  it('extracts ids from a Vyanzo: (Swahili) footer', () => {
    const body = ['Pendekezo hapo juu.', '', 'Vyanzo:', '- lmbm_88'].join('\n');
    expect(extractEvidenceIds(body)).toContain('lmbm_88');
  });
});

describe('auditChatResponse', () => {
  it('flags violation when evidence chain is empty', async () => {
    const out = await auditChatResponse({
      ...BASE_INPUT,
      responseText: 'No citations whatsoever.',
    });
    expect(out.violation).toBe(true);
    expect(out.evidenceCount).toBe(0);
    expect(out.evidenceWarning).toBe('no_evidence_cited');
    expect(out.verdict).toBe('reject');
    expect(typeof out.auditLogId).toBe('string');
    expect(out.auditLogId.length).toBeGreaterThan(0);
    expect(typeof out.latencyMs).toBe('number');
  });

  it('approves when at least one bracketed citation is present', async () => {
    const out = await auditChatResponse({
      ...BASE_INPUT,
      responseText: 'The reserve estimate cites [evidence:lmbm_42].',
    });
    expect(out.violation).toBe(false);
    expect(out.evidenceCount).toBe(1);
    expect(out.evidenceIds).toContain('lmbm_42');
    expect(out.evidenceWarning).toBeNull();
    expect(out.verdict).toBe('approve');
  });

  it('approves when only footer-style citations are present', async () => {
    const body = ['Body here.', '', 'Sources:', '- evidence_id: lmbm_77'].join(
      '\n',
    );
    const out = await auditChatResponse({ ...BASE_INPUT, responseText: body });
    expect(out.evidenceCount).toBeGreaterThan(0);
    expect(out.violation).toBe(false);
    expect(out.verdict).toBe('approve');
  });

  it('never throws on empty / non-string response text', async () => {
    const out = await auditChatResponse({ ...BASE_INPUT, responseText: '' });
    expect(out.violation).toBe(true);
    expect(out.evidenceCount).toBe(0);
  });
});
