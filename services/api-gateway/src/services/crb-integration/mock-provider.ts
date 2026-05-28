/**
 * Mock CRB provider — deterministic shape derived from the subject TIN.
 *
 * Used in local-dev + CI when no real CRB licence is provisioned.
 * Returns a `cacheable:true` report so the gateway can persist into
 * `external_party_credit_pulls` once that table is wired (Wave
 * OPS-WIDE companion).
 */

import { createHash } from 'node:crypto';
import type {
  CrbProvider,
  CrbReport,
  CrbReportRequest,
  CrbCreditLine,
  CrbHistoryEntry,
  CrbDefaultEntry,
} from './types.js';

function deterministicScore(tin: string): number {
  const hash = createHash('sha256').update(tin).digest();
  // 300..900 inclusive — mirrors the CRSA standard band.
  const value = hash.readUInt16BE(0) % 601;
  return 300 + value;
}

function bandFor(score: number): CrbReport['scoreBand'] {
  if (score >= 800) return 'excellent';
  if (score >= 700) return 'good';
  if (score >= 600) return 'fair';
  if (score >= 450) return 'poor';
  return 'unrated';
}

function generateOpenCredits(tin: string): ReadonlyArray<CrbCreditLine> {
  const seed = createHash('sha256').update(`${tin}:credits`).digest();
  const count = (seed[0] ?? 0) % 4;
  if (count === 0) return [];
  const out: CrbCreditLine[] = [];
  for (let i = 0; i < count; i++) {
    const original = 1_000_000 + ((seed[1 + i] ?? 0) % 50) * 1_000_000;
    const outstanding = Math.floor(original * (0.2 + ((seed[5 + i] ?? 0) % 70) / 100));
    out.push({
      creditor: ['CRDB', 'NMB', 'NBC', 'Stanbic', 'Equity'][i % 5] ?? 'Other',
      facilityType: (['overdraft', 'term-loan', 'invoice-finance', 'guarantee', 'other'] as const)[
        i % 5
      ] ?? 'other',
      originalAmountTzs: original,
      outstandingTzs: outstanding,
      openedAt: new Date(Date.now() - (180 + i * 90) * 86400_000).toISOString(),
      maturityAt:
        i % 2 === 0
          ? new Date(Date.now() + (180 + i * 90) * 86400_000).toISOString()
          : null,
      status: (['current', 'current', 'arrears', 'restructured'] as const)[i % 4] ?? 'current',
    });
  }
  return out;
}

function generateDefaults(tin: string): ReadonlyArray<CrbDefaultEntry> {
  const seed = createHash('sha256').update(`${tin}:defaults`).digest();
  if ((seed[0] ?? 0) % 5 !== 0) return [];
  return [
    {
      creditor: 'NMB',
      amountTzs: 8_500_000,
      defaultedAt: new Date(Date.now() - 540 * 86400_000).toISOString(),
      resolvedAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
    },
  ];
}

function generateHistory(score: number): ReadonlyArray<CrbHistoryEntry> {
  const now = Date.now();
  return [
    {
      observedAt: new Date(now - 365 * 86400_000).toISOString(),
      score: Math.max(300, score - 40),
      reason: 'Initial bureau pull',
    },
    {
      observedAt: new Date(now - 180 * 86400_000).toISOString(),
      score: Math.max(300, score - 15),
      reason: 'New term loan opened',
    },
    {
      observedAt: new Date(now - 30 * 86400_000).toISOString(),
      score,
      reason: 'Recent payments on time',
    },
  ];
}

export function createMockCrbProvider(): CrbProvider {
  return {
    name: 'mock',
    async fetchReport(req: CrbReportRequest): Promise<CrbReport> {
      const score = deterministicScore(req.tin);
      return {
        provider: 'mock',
        subject: {
          tin: req.tin,
          nida: req.nida,
          displayName: req.displayName ?? null,
        },
        score,
        scoreBand: bandFor(score),
        openCredits: generateOpenCredits(req.tin),
        defaults: generateDefaults(req.tin),
        history: generateHistory(score),
        pulledAt: new Date().toISOString(),
        cacheable: false,
        degraded: false,
      };
    },
  };
}
