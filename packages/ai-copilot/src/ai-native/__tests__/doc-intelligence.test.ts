/**
 * Doc-intelligence extractor tests (Agent PhL).
 *
 *   1. Happy: LLM returns entities + obligations → stored with document
 *      span citations. Each entity picks up `languageCode` from the LLM.
 *   2. No semantic-memory (degraded): entities still persist, embeddingRef
 *      is null on every row.
 *   3. Budget exceeded: assertWithinBudget throws → no LLM call, structured
 *      BUDGET_EXCEEDED result.
 */

import { describe, it, expect, vi } from 'vitest';
import { createDocumentIntelligence } from '../doc-intelligence/extractor.js';
import type {
  DocIntelligenceLLMPort,
  DocIntelligenceRepository,
  ExtractedEntity,
  ExtractedObligation,
} from '../doc-intelligence/types.js';
import { AiBudgetExceededError } from '../../cost-ledger.js';

function makeRepo() {
  const entities: ExtractedEntity[] = [];
  const obligations: ExtractedObligation[] = [];
  const repo: DocIntelligenceRepository = {
    async insertEntities(rows) {
      entities.push(...rows);
    },
    async insertObligations(rows) {
      obligations.push(...rows);
    },
    async listEntities() {
      return entities.slice();
    },
    async listObligations() {
      return obligations.slice();
    },
  };
  return { repo, entities, obligations };
}

const SAMPLE_TEXT =
  'LEASE AGREEMENT. Between Mr. Smith (Landlord) and Ms. Jones (Tenant). Monthly rent: USD 2,500. Lease ends 2027-01-31. Auto-renews for twelve months unless terminated with 60 days notice.';

describe('DocumentIntelligence', () => {
  it('happy path: entities + obligations persist with citations', async () => {
    const { repo, entities, obligations } = makeRepo();

    const llm: DocIntelligenceLLMPort = {
      async extract() {
        return {
          detectedLanguage: 'en',
          entities: [
            {
              entityKind: 'party',
              entityValue: 'Mr. Smith',
              entityRaw: 'Mr. Smith (Landlord)',
              normalizedForm: { role: 'landlord' },
              languageCode: 'en',
              spanStart: 22,
              spanEnd: 38,
              confidence: 0.9,
            },
            {
              entityKind: 'amount',
              entityValue: '2500.00',
              entityRaw: 'USD 2,500',
              normalizedForm: { currency: 'USD', amountMinor: 250_000 },
              languageCode: 'en',
              spanStart: 80,
              spanEnd: 95,
              confidence: 0.95,
            },
          ],
          obligations: [
            {
              obligor: 'Tenant',
              obligee: 'Landlord',
              actionSummary: 'Pay monthly rent of USD 2,500',
              dueDate: null,
              recurrence: 'monthly',
              consequenceIfMissed: 'default per lease terms',
              riskFlags: ['auto_renew'],
              languageCode: 'en',
              spanStart: 100,
              spanEnd: 180,
              confidence: 0.88,
              explanation: 'Recurring rent obligation inferred from lease.',
            },
          ],
          modelVersion: 'test-sonnet-2',
          inputTokens: 2000,
          outputTokens: 500,
          costUsdMicro: 12_000,
        };
      },
    };

    const di = createDocumentIntelligence({ llm, repo });

    const res = await di.extract({
      tenantId: 'tnt_1',
      documentId: 'doc_1',
      canonicalText: SAMPLE_TEXT,
      countryCode: 'US',
    });

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.detectedLanguage).toBe('en');
    expect(entities).toHaveLength(2);
    expect(obligations).toHaveLength(1);
    expect(obligations[0].riskFlags).toContain('auto_renew');
    expect(res.data.citations.length).toBeGreaterThan(0);
    expect(res.data.citations[0].kind).toBe('document_span');
    expect(res.data.promptHash).toMatch(/^ph_/);
  });

  it('degraded (no semanticMemory): rows still persist with null embeddingRef', async () => {
    const { repo, entities } = makeRepo();

    const llm: DocIntelligenceLLMPort = {
      async extract() {
        return {
          detectedLanguage: 'sw',
          entities: [
            {
              entityKind: 'party',
              entityValue: 'Bwana Juma',
              entityRaw: 'Bwana Juma (Mwenye Nyumba)',
              normalizedForm: {},
              languageCode: 'sw',
              spanStart: 0,
              spanEnd: 10,
              confidence: 0.7,
            },
          ],
          obligations: [],
          modelVersion: 'test-sonnet-2',
          inputTokens: 100,
          outputTokens: 50,
          costUsdMicro: 1_000,
        };
      },
    };

    const di = createDocumentIntelligence({ llm, repo });

    const res = await di.extract({
      tenantId: 'tnt_1',
      documentId: 'doc_2',
      canonicalText: 'Hati ya Kukodisha. Bwana Juma na Bibi Amina.',
    });

    expect(res.success).toBe(true);
    expect(entities).toHaveLength(1);
    expect(entities[0].embeddingRef).toBeNull();
    expect(entities[0].languageCode).toBe('sw');
  });

  it('budget guardrail: over-budget → BUDGET_EXCEEDED, no LLM call', async () => {
    const { repo } = makeRepo();
    const llm: DocIntelligenceLLMPort = {
      extract: vi.fn(),
    };
    const ledger: any = {
      async assertWithinBudget() {
        throw new AiBudgetExceededError({
          tenantId: 'tnt_1',
          monthlyCapUsdMicro: 100,
          currentSpendUsdMicro: 100,
        });
      },
      async recordUsage() {},
    };

    const di = createDocumentIntelligence({ ledger, llm, repo });
    const res = await di.extract({
      tenantId: 'tnt_1',
      documentId: 'doc_3',
      canonicalText: SAMPLE_TEXT,
    });

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.code).toBe('BUDGET_EXCEEDED');
    expect(llm.extract).not.toHaveBeenCalled();
  });
});
