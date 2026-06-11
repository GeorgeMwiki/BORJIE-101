/**
 * Teach-route enforced-grounding tests — anti-hallucination hard rule on the
 * owner's PRIMARY chat surface (/api/v1/brain/teach).
 *
 * CLAUDE.md hard rule: "Every junior recommendation cites >=1 evidence_id …
 * the Auditor Agent rejects responses with empty evidence chains." Before
 * this wiring the teach stream shipped its accumulated answer with ZERO
 * auditor grounding (the gate protected only /turn /think /stream). These
 * tests pin the `auditTeachAnswer` contract the route now calls BEFORE the
 * first chunk flushes (mirroring jarvis-grounding-enforcement.test.ts):
 *
 *   - UNGROUNDED answer → WITHHELD: safe single-language message + an
 *     `auditor` frame with mode 'withheld' / enforced true (HARD mode);
 *   - GROUNDED answer → ships unchanged; warn-only `auditor` frame;
 *   - SW locale withhold → the Swahili safe message, zero EN mixing;
 *   - kill-switch BORJIE_STRICT_EVIDENCE=off → never withholds (verdict
 *     still computed + surfaced warn-only);
 *   - corpus verifier fault → fail-CLOSED withhold (needs_human);
 *   - gate THROW → fail-OPEN: answer ships, no frame (a broken auditor
 *     must never break chat).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

// Partial mock: delegate to the REAL gate unless a test flips `gateThrows`
// (the only way to exercise the helper's fail-OPEN catch deterministically).
let gateThrows = false;
vi.mock('../../composition/chat-response-gate.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../composition/chat-response-gate.js')
    >();
  return {
    ...actual,
    auditChatResponse: async (
      input: Parameters<typeof actual.auditChatResponse>[0],
    ) => {
      if (gateThrows) throw new Error('auditor exploded');
      return actual.auditChatResponse(input);
    },
  };
});

import { auditTeachAnswer } from '../teach-grounding.js';
import {
  setEvidenceExistenceVerifier,
  STRICT_WITHHOLD_TEXTS,
} from '../../composition/chat-response-gate.js';

const BASE = {
  tenantId: 'tnt-teach',
  userId: 'usr-owner',
  sessionId: 'sess-1',
  lang: 'en' as const,
};

beforeEach(() => {
  gateThrows = false;
  setEvidenceExistenceVerifier(null);
  delete process.env.BORJIE_STRICT_EVIDENCE;
});

afterEach(() => {
  setEvidenceExistenceVerifier(null);
  delete process.env.BORJIE_STRICT_EVIDENCE;
});

describe('brain/teach — HARD-mode grounding enforcement', () => {
  it('WITHHOLDS an ungrounded answer (safe EN message + enforced auditor frame)', async () => {
    const out = await auditTeachAnswer({
      ...BASE,
      answerText: 'You should definitely sell the gold now. Trust me.',
    });
    expect(out.withheld).toBe(true);
    expect(out.safeText).toBe(STRICT_WITHHOLD_TEXTS.en);
    expect(out.frame).not.toBeNull();
    expect(out.frame?.mode).toBe('withheld');
    expect(out.frame?.enforced).toBe(true);
    expect(out.frame?.verdict).toBe('reject');
    expect(out.frame?.evidenceCount).toBe(0);
    expect(out.frame?.evidenceWarning).toBe('no_evidence_cited');
  });

  it('substitutes the SWAHILI safe message on a sw locale (zero EN mixing)', async () => {
    const out = await auditTeachAnswer({
      ...BASE,
      lang: 'sw',
      answerText: 'Uza dhahabu sasa hivi.',
    });
    expect(out.withheld).toBe(true);
    expect(out.safeText).toBe(STRICT_WITHHOLD_TEXTS.sw);
    expect(out.safeText).not.toMatch(/evidence|records|answer/i);
  });

  it('PASSES a grounded answer unchanged (warn-only approve frame)', async () => {
    const out = await auditTeachAnswer({
      ...BASE,
      answerText:
        'Your PML royalty rate is 6% for gold [evidence:lmbm_42]. File by the 14th.',
    });
    expect(out.withheld).toBe(false);
    expect(out.safeText).toBeNull();
    expect(out.frame?.mode).toBe('warn-only');
    expect(out.frame?.enforced).toBe(false);
    expect(out.frame?.verdict).toBe('approve');
    expect(out.frame?.evidenceCount).toBeGreaterThan(0);
  });

  it('does NOT withhold when BORJIE_STRICT_EVIDENCE=off (verdict still surfaced warn-only)', async () => {
    process.env.BORJIE_STRICT_EVIDENCE = 'off';
    const out = await auditTeachAnswer({
      ...BASE,
      answerText: 'Ungrounded claim with no citation.',
    });
    expect(out.withheld).toBe(false);
    expect(out.safeText).toBeNull();
    expect(out.frame?.mode).toBe('warn-only');
    expect(out.frame?.enforced).toBe(false);
    expect(out.frame?.verdict).toBe('reject');
  });

  it('fails CLOSED on a corpus-verifier fault (citation unverifiable → withhold needs_human)', async () => {
    // The verifier reports the corpus UNREACHABLE — the cited id is NOT
    // blessed, the gate escalates to needs_human, HARD mode withholds.
    setEvidenceExistenceVerifier({
      async verifyEvidenceIds() {
        return { verified: false, missingIds: [] };
      },
    });
    const out = await auditTeachAnswer({
      ...BASE,
      answerText: 'Royalty is 6% [evidence:lmbm_42].',
    });
    expect(out.withheld).toBe(true);
    expect(out.safeText).toBe(STRICT_WITHHOLD_TEXTS.en);
    expect(out.frame?.verdict).toBe('needs_human');
    expect(out.frame?.groundingFault).toBe(true);
  });
});

describe('brain/teach — gate fault is fail-OPEN', () => {
  it('a THROWING auditor never breaks the turn: answer ships, no frame', async () => {
    gateThrows = true;
    const out = await auditTeachAnswer({
      ...BASE,
      answerText: 'Ungrounded claim while the auditor is down.',
    });
    expect(out.withheld).toBe(false);
    expect(out.safeText).toBeNull();
    expect(out.frame).toBeNull();
  });
});
