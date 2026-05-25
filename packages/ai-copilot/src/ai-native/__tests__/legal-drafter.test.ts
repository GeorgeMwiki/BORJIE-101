/**
 * Legal drafter tests (Agent PhL).
 *
 *   1. Happy: compose a notice_to_vacate; cites jurisdiction statutes.
 *   2. Guardrail: eviction_notice + autonomy.canAutoSend = true — service
 *      MUST still set needsHumanReview + autonomy_decision=auto_send_forbidden.
 *   3. Global-first: unknown country plugin throws in leaseLaw.resolve →
 *      VALIDATION result (no LLM call).
 */

import { describe, it, expect, vi } from 'vitest';
import { createLegalDrafter } from '../legal-drafter/drafter.js';
import type {
  AutonomyPolicyLookup,
  LegalDraftRepository,
  LegalDraftRow,
  LegalDrafterLLMPort,
  LeaseLawDispatchPort,
} from '../legal-drafter/types.js';

function makeRepo() {
  const rows: LegalDraftRow[] = [];
  const repo: LegalDraftRepository = {
    async insert(row) {
      rows.push(row);
      return row;
    },
    async list() {
      return rows.slice();
    },
  };
  return { repo, rows };
}

const TZ_LAW = {
  noticeWindowDays: 30,
  requiredClauses: ['notice-period', 'reason', 'remedy-window'],
  citations: ['TZ-Landlord-Tenant-Act-2023'],
  forbiddenClauses: ['perpetual-lease'],
  sourceTag: 'TZ-default',
};

describe('LegalDrafter', () => {
  it('happy: notice_to_vacate composes with jurisdiction citations', async () => {
    const { repo, rows } = makeRepo();
    const leaseLaw: LeaseLawDispatchPort = {
      resolve(countryCode) {
        if (countryCode !== 'TZ') throw new Error('unknown country');
        return TZ_LAW;
      },
    };
    const llm: LegalDrafterLLMPort = {
      async compose({ law }) {
        expect(law.sourceTag).toBe('TZ-default');
        return {
          title: 'Notice to Vacate',
          body: 'Dear tenant... (statutory 30-day notice).',
          languageCode: 'sw',
          reviewFlags: ['verify-move-out-date'],
          citedClauses: ['notice-period', 'reason'],
          modelVersion: 'test-opus-1',
          confidence: 0.85,
          inputTokens: 500,
          outputTokens: 300,
          costUsdMicro: 7_000,
        };
      },
    };
    const drafter = createLegalDrafter({ leaseLaw, llm, repo });

    const res = await drafter.draft({
      documentKind: 'notice_to_vacate',
      context: {
        tenantId: 'tnt_1',
        countryCode: 'TZ',
        languageCode: 'sw',
      },
      facts: { reason: 'chronic late payment', effectiveDate: '2026-05-30' },
    });

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.documentKind).toBe('notice_to_vacate');
    expect(res.data.needsHumanReview).toBe(true); // default — no autonomy lookup
    expect(res.data.autonomyDecision).toBe('queued_for_review');
    expect(res.data.legalCitations).toContain('TZ-Landlord-Tenant-Act-2023');
    expect(res.data.citations.some((c) => c.kind === 'statute')).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it('guardrail: eviction_notice + autonomy claims auto-send → still forbidden', async () => {
    const { repo } = makeRepo();
    const leaseLaw: LeaseLawDispatchPort = {
      resolve: () => TZ_LAW,
    };
    const llm: LegalDrafterLLMPort = {
      async compose() {
        return {
          title: 'Eviction Notice',
          body: '...',
          languageCode: 'en',
          reviewFlags: [],
          citedClauses: [],
          modelVersion: 'test-opus-1',
          confidence: 0.9,
          inputTokens: 500,
          outputTokens: 300,
          costUsdMicro: 7_000,
        };
      },
    };
    // Autonomy would let us auto-send — but FORBIDDEN_AUTO_SEND wins.
    const autonomy: AutonomyPolicyLookup = {
      async canAutoSend() {
        return true;
      },
    };

    const drafter = createLegalDrafter({ leaseLaw, llm, autonomy, repo });

    const res = await drafter.draft({
      documentKind: 'eviction_notice',
      context: { tenantId: 'tnt_1', countryCode: 'TZ' },
      facts: { cause: 'non-payment', arrearsDays: 90 },
    });

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.needsHumanReview).toBe(true);
    expect(res.data.autonomyDecision).toBe('auto_send_forbidden');
  });

  it('global-first: unknown country → VALIDATION, no LLM call', async () => {
    const { repo } = makeRepo();
    const leaseLaw: LeaseLawDispatchPort = {
      resolve: (countryCode) => {
        throw new Error(`no plugin for country ${countryCode}`);
      },
    };
    const llm: LegalDrafterLLMPort = {
      compose: vi.fn(),
    };
    const drafter = createLegalDrafter({ leaseLaw, llm, repo });

    const res = await drafter.draft({
      documentKind: 'demand_letter',
      context: { tenantId: 'tnt_1', countryCode: 'ZZ' },
      facts: {},
    });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.code).toBe('VALIDATION');
    expect(llm.compose).not.toHaveBeenCalled();
  });
});
