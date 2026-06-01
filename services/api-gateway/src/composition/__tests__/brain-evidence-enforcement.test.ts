/**
 * brain evidence-required ENFORCEMENT (GAP 1).
 *
 * CLAUDE.md hard rule: "The Auditor Agent REJECTS responses with empty
 * evidence chains." Before this wiring the brain /turn JSON handler
 * computed the verdict but shipped the ungrounded `responseText`
 * unchanged. These tests pin the enforcement contract:
 *
 *   - an empty-evidence response is BLOCKED in HARD mode — the
 *     ungrounded text is WITHHELD, a safe single-language placeholder
 *     is substituted, and the status flips to 422;
 *   - a well-evidenced response PASSES through unchanged at 200;
 *   - the substitution is EN/SW absolute (one language per locale, no
 *     mixing);
 *   - strict OFF restores the legacy observe-only behaviour.
 *
 * The enforcement decision is exercised through `auditChatResponse`
 * (the real Stage-1 auditor) composed with `decideStrictResponse` — the
 * exact composition `brain.hono.ts::auditAndEnforceJson` performs.
 */

import { describe, it, expect } from 'vitest';
import {
  auditChatResponse,
  decideStrictResponse,
  STRICT_WITHHOLD_TEXTS,
  type StrictWithholdLang,
} from '../chat-response-gate';

const BASE_INPUT = {
  tenantId: 't_demo',
  threadId: 'thread_enforce',
  userId: 'u_owner',
  personaId: 'persona.mwikila',
  tokensUsed: 17,
} as const;

/**
 * Mirror of `brain.hono.ts::auditAndEnforceJson` — audit, then apply
 * HARD-mode enforcement. Kept tiny so the test asserts the real
 * composition (auditor verdict → strict decision) without spinning up a
 * Hono route + Supabase auth + Postgres GUC.
 */
async function auditAndEnforce(
  responseText: string,
  opts: { lang?: StrictWithholdLang; strict?: boolean } = {},
) {
  const verdict = await auditChatResponse({ ...BASE_INPUT, responseText });
  const decision = decideStrictResponse({
    verdict: verdict.verdict,
    originalText: responseText,
    lang: opts.lang ?? 'en',
    strict: opts.strict ?? true,
  });
  return { verdict, decision };
}

describe('brain evidence enforcement — HARD mode', () => {
  it('BLOCKS an empty-evidence response (withholds text + 422)', async () => {
    const ungrounded =
      'The reserve is roughly 4,000 ounces and you should sell now.';
    const { verdict, decision } = await auditAndEnforce(ungrounded);

    // The auditor must flag the violation …
    expect(verdict.verdict).toBe('reject');
    expect(verdict.evidenceCount).toBe(0);
    // … and enforcement must WITHHOLD the ungrounded answer.
    expect(decision.withheld).toBe(true);
    expect(decision.status).toBe(422);
    expect(decision.responseText).not.toContain('4,000 ounces');
    expect(decision.responseText).toBe(STRICT_WITHHOLD_TEXTS.en);
  });

  it('PASSES a well-evidenced response unchanged (200)', async () => {
    const grounded =
      'The reserve estimate is ~4,000 oz [evidence:lmbm_42] given the assay.';
    const { verdict, decision } = await auditAndEnforce(grounded);

    expect(verdict.verdict).toBe('approve');
    expect(verdict.evidenceCount).toBeGreaterThan(0);
    expect(decision.withheld).toBe(false);
    expect(decision.status).toBe(200);
    // The grounded answer is shipped verbatim.
    expect(decision.responseText).toBe(grounded);
  });

  it('substitutes the SWAHILI safe message when locale is sw (no EN mixing)', async () => {
    const { decision } = await auditAndEnforce('Hakuna ushahidi hapa.', {
      lang: 'sw',
    });
    expect(decision.withheld).toBe(true);
    expect(decision.responseText).toBe(STRICT_WITHHOLD_TEXTS.sw);
    // EN/SW absolute — the Swahili message must carry zero English words
    // from the EN variant ("evidence", "records", "answer").
    expect(decision.responseText).not.toMatch(/evidence|records|answer/i);
  });

  it('does NOT withhold when strict mode is OFF (legacy observe-only)', async () => {
    const ungrounded = 'No citations whatsoever, but strict is disabled.';
    const { verdict, decision } = await auditAndEnforce(ungrounded, {
      strict: false,
    });
    // Verdict still computed (observability preserved) …
    expect(verdict.verdict).toBe('reject');
    // … but the original text ships and the status stays 200.
    expect(decision.withheld).toBe(false);
    expect(decision.status).toBe(200);
    expect(decision.responseText).toBe(ungrounded);
  });
});
