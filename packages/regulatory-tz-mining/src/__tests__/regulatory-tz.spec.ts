/**
 * Happy-path tests for the TZ mining regulator adapter.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createRegulatoryTzAdvisor,
  type RegulatoryFacts,
} from '../index.js';

const NOW_ISO = '2026-05-01';

const SAMPLE_FACTS: RegulatoryFacts = {
  asOfISO: NOW_ISO,
  licences: [
    {
      id: 'lic-1',
      kind: 'ML',
      holder: 'Borjie Demo Mine Ltd',
      issuedISO: '2024-05-01',
      expiresISO: '2030-05-01',
      annualFeeTzs: 0,
      status: 'active',
    },
  ],
  eiaApprovals: [
    {
      id: 'eia-1',
      projectId: 'proj-1',
      approvedISO: '2024-01-15',
      expiresISO: '2027-01-15',
      category: 'EIA-A',
    },
  ],
  goldWindowReceipts: [
    {
      id: 'gw-1',
      receivedISO: '2026-04-20',
      tonnes: 0.5,
      proceedsUsd: 32_000_000,
    },
  ],
  taxFilings: [
    {
      id: 'fil-1',
      kind: 'royalty',
      periodLabel: '2026-04',
      dueISO: '2026-05-15',
      filedISO: '2026-05-10',
      amountTzs: 100_000_000,
      paidTzs: 100_000_000,
    },
  ],
  gepgControlNumbers: [
    {
      controlNumber: 'CN-12345',
      issuedISO: '2026-04-25',
      expiresISO: '2026-06-25',
      amountTzs: 100_000_000,
      paid: true,
      paidISO: '2026-04-28',
    },
  ],
  goldSoldOutsideWindowTonnes: 1.0,
  annualProductionTonnes: 3500,
};

describe('regulatory-tz-mining.analyze', () => {
  it('returns one result per default rule and summarises counts', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const advisor = createRegulatoryTzAdvisor({ logger });
    const analysis = await advisor.analyze(SAMPLE_FACTS);
    expect(analysis.results.length).toBeGreaterThan(5);
    const total =
      analysis.summary.compliantCount +
      analysis.summary.warningCount +
      analysis.summary.breachCount +
      analysis.summary.unknownCount;
    expect(total).toBe(analysis.results.length);
  });

  it('flags a BoT-gold-window breach when share is below the minimum', async () => {
    const advisor = createRegulatoryTzAdvisor();
    const bad: RegulatoryFacts = {
      ...SAMPLE_FACTS,
      goldSoldOutsideWindowTonnes: 100,
      goldWindowReceipts: [
        {
          id: 'gw-x',
          receivedISO: '2026-04-20',
          tonnes: 1,
          proceedsUsd: 64_000_000,
        },
      ],
    };
    const analysis = await advisor.analyze(bad);
    const bot = analysis.results.find((r) => r.ruleId === 'bot.gold-window.share');
    expect(bot?.verdict).toBe('breach');
  });
});

describe('regulatory-tz-mining.recommend', () => {
  it('emits remediation recommendations for warnings + breaches', async () => {
    const advisor = createRegulatoryTzAdvisor();
    const bad: RegulatoryFacts = {
      ...SAMPLE_FACTS,
      taxFilings: [
        {
          id: 'fil-late',
          kind: 'corporate',
          periodLabel: '2026-Q1',
          dueISO: '2026-04-30',
          filedISO: null,
          amountTzs: 50_000_000,
          paidTzs: 0,
        },
      ],
    };
    const analysis = await advisor.analyze(bad);
    const recs = await advisor.recommend({ analysis });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.some((r) => r.severity === 'critical')).toBe(true);
  });
});
