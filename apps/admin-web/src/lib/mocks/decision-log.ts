import type { DecisionLogRow } from './types';

const SAMPLE_DECISIONS: ReadonlyArray<Omit<DecisionLogRow, 'id' | 'at'>> = [
  {
    tenantId: 'tnt_geita_dhahabu',
    tenant: 'Geita Dhahabu Mines',
    juniorId: 'jr_geology',
    junior: 'Geology',
    mode: 'Recommend',
    decision: 'Recommend 25m drill spacing for Pit 4 north flank',
    evidenceIds: ['ev_1', 'ev_2', 'ev_3'],
    confidence: 0.87,
  },
  {
    tenantId: 'tnt_kahama_shaba',
    tenant: 'Kahama Shaba Holdings',
    juniorId: 'jr_cost',
    junior: 'Cost Engineer',
    mode: 'Advise',
    decision: 'Hedge 60% of Q3 diesel against $0.92/L cap',
    evidenceIds: ['ev_11', 'ev_12'],
    confidence: 0.72,
  },
  {
    tenantId: 'tnt_mererani',
    tenant: 'Mererani Tanzanite Cluster',
    juniorId: 'jr_compliance',
    junior: 'Compliance',
    mode: 'Recommend',
    decision: 'Escalate: NEMC renewal expiring in 14d',
    evidenceIds: ['ev_21', 'ev_22', 'ev_23', 'ev_24'],
    confidence: 0.94,
  },
  {
    tenantId: 'tnt_kiwira',
    tenant: 'Kiwira Coltan Cooperative',
    juniorId: 'jr_sales',
    junior: 'Sales',
    mode: 'Recommend',
    decision: 'Match 2.4t coltan parcel to AVZ buyer (Rwanda)',
    evidenceIds: ['ev_31', 'ev_32'],
    confidence: 0.66,
  },
  {
    tenantId: 'tnt_lake_zone_gold',
    tenant: 'Lake Zone Gold Network',
    juniorId: 'jr_fx',
    junior: 'FX / Treasury',
    mode: 'Auto-act',
    decision: 'Convert 38% of USD float to TZS at 2,632',
    evidenceIds: ['ev_41'],
    confidence: 0.81,
  },
];

/**
 * Generate ~120 rows so the virtualised list has something meaningful
 * to scroll through. IDs and timestamps are deterministic so two
 * renders see the same data.
 */
export function buildMockDecisionLog(): ReadonlyArray<DecisionLogRow> {
  const base = Date.parse('2026-05-25T09:14:00Z');
  const out: DecisionLogRow[] = [];
  for (let i = 0; i < 120; i += 1) {
    const sample = SAMPLE_DECISIONS[i % SAMPLE_DECISIONS.length]!;
    out.push({
      ...sample,
      id: `dec_${String(2811 - i).padStart(5, '0')}`,
      at: new Date(base - i * 7 * 60_000).toISOString(),
    });
  }
  return out;
}

export const MOCK_DECISION_LOG = buildMockDecisionLog();
