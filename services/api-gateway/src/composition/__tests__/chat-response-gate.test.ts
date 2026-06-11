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

import { describe, it, expect, afterEach } from 'vitest';
import {
  auditChatResponse,
  extractEvidenceIds,
  isResponseGrounded,
  setEvidenceExistenceVerifier,
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

describe('isResponseGrounded', () => {
  it('is false when no evidence is cited', () => {
    expect(isResponseGrounded('No citations whatsoever.')).toBe(false);
  });

  it('is true when an inline citation is present', () => {
    expect(isResponseGrounded('Grade is high [evidence:lmbm_42].')).toBe(true);
  });

  it('is false for empty / non-string input', () => {
    expect(isResponseGrounded('')).toBe(false);
    expect(isResponseGrounded(undefined as unknown as string)).toBe(false);
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

describe('auditChatResponse — Stage-2 evidence-existence verification', () => {
  afterEach(() => {
    // Reset the module-level verifier so other suites see Stage-1-only.
    setEvidenceExistenceVerifier(null);
  });

  it('rejects a response that cites a non-existent (fabricated) evidence_id', async () => {
    setEvidenceExistenceVerifier({
      // The cited id does not exist → report it as missing.
      async verifyEvidenceIds({ evidenceIds }) {
        return { verified: true, missingIds: evidenceIds }; // none exist
      },
    });
    const out = await auditChatResponse({
      ...BASE_INPUT,
      responseText: 'The grade is high [evidence:made_up_999].',
    });
    expect(out.verdict).toBe('reject');
    expect(out.violation).toBe(true);
    expect(out.evidenceWarning).toBe('evidence_invalid');
    expect(out.invalidEvidenceIds).toContain('made_up_999');
    expect(out.groundingFault).toBe(false);
  });

  it('approves when every cited evidence_id resolves to a real chunk', async () => {
    setEvidenceExistenceVerifier({
      async verifyEvidenceIds() {
        return { verified: true, missingIds: [] }; // all exist
      },
    });
    const out = await auditChatResponse({
      ...BASE_INPUT,
      responseText: 'Backed by [evidence:lmbm_42].',
    });
    expect(out.verdict).toBe('approve');
    expect(out.violation).toBe(false);
    expect(out.invalidEvidenceIds).toEqual([]);
    expect(out.groundingFault).toBe(false);
  });

  it('fails CLOSED (treats citations as UNVERIFIED) when the corpus reports a fault', async () => {
    setEvidenceExistenceVerifier({
      // Corpus unreachable — the contract resolves `verified: false` instead
      // of throwing.
      async verifyEvidenceIds() {
        return { verified: false, missingIds: [] };
      },
    });
    const out = await auditChatResponse({
      ...BASE_INPUT,
      responseText: 'Backed by [evidence:lmbm_42].',
    });
    // A broken corpus check must NOT bless the cited id (no silent approve).
    // The unverified state is carried by `groundingFault` + the needs_human
    // verdict (the warning-string union is intentionally not widened).
    expect(out.groundingFault).toBe(true);
    expect(out.violation).toBe(true);
    expect(out.evidenceWarning).toBeNull();
    expect(out.verdict).toBe('needs_human');
    // Crucially: NOT silently valid.
    expect(out.verdict).not.toBe('approve');
  });

  it('fails CLOSED when the verifier THROWS (contract violation still not blessed)', async () => {
    setEvidenceExistenceVerifier({
      async verifyEvidenceIds() {
        throw new Error('db down');
      },
    });
    const out = await auditChatResponse({
      ...BASE_INPUT,
      responseText: 'Backed by [evidence:lmbm_42].',
    });
    // A thrown verifier is treated the SAME as a reported fault — fail-CLOSED.
    expect(out.groundingFault).toBe(true);
    expect(out.verdict).toBe('needs_human');
    expect(out.verdict).not.toBe('approve');
  });
});
