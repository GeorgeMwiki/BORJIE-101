/**
 * Orchestrator integration test using TRC pilot seed data (Wave 15).
 *
 * Fixture: 5 leases at TRC stations, varying expiry windows + rent amounts,
 * DG persona (T1 owner equivalent). Builds the full ports stack as
 * deterministic mocks so we verify the END-TO-END brief structure:
 *
 *   - ≥ 3 gaps, ≥ 3 opportunities, ≥ 3 risks, ≥ 3 recommended_actions
 *   - All findings carry citations
 *   - Hash chain works (prevHash → hash)
 *   - Persona scoping: T5 customer cannot generate (refused)
 *   - Cross-tenant isolation: tenant A's prior brief invisible from B
 *   - Cost budget exhaustion → degraded result
 *   - Hash tamper detection
 */

import { describe, expect, it } from 'vitest';
import { generateBrief, ENGINE_VERSION } from '../orchestrator.js';
import { verifyBriefHash } from '../brief-assembler.js';
import { createInMemoryCostBudget } from '../cost-budget.js';
import type {
  AuditChainPort,
  DebatePort,
  HybridRetrieverDeps,
  HaikuLlmPort,
  KillswitchHaltPort,
  OnlineJudgePort,
  OrchestratorDeps,
  PriorBriefLookupPort,
  RoutingRulesPort,
  SensorBundle,
  SensorSignal,
  ToTLatsPort,
  RetrievalHit,
} from '../index.js';
import type { Persona } from '@borjie/persona-runtime';
import type { GraphTraversalPort } from '@borjie/org-graph';

// ─────────────────────────────────────────────────────────────────────
// TRC seed fixtures — based on scripts/seed-trc-tenant.mjs (Wave 15).
// ─────────────────────────────────────────────────────────────────────

const TRC_TENANT = 'ten_trc';
const NOW = new Date('2026-05-22T06:00:00.000Z');
const PERIOD_START = new Date('2026-05-15T00:00:00.000Z');
const PERIOD_END = NOW;

// Five TRC leases. Three are due to expire within 60 days (risks).
// Two have arrears (gaps). Two are at TZS rates that lag market (opportunities).
const TRC_LEASES = [
  { id: 'lease_1', unitId: 'ent_unit_t01', endDate: new Date('2026-05-29'), rent: 350_000 },
  { id: 'lease_2', unitId: 'ent_unit_t02', endDate: new Date('2026-06-15'), rent: 420_000 },
  { id: 'lease_3', unitId: 'ent_unit_t03', endDate: new Date('2026-07-20'), rent: 280_000 },
  { id: 'lease_4', unitId: 'ent_unit_t04', endDate: new Date('2027-02-10'), rent: 600_000 },
  { id: 'lease_5', unitId: 'ent_unit_t05', endDate: new Date('2027-04-05'), rent: 500_000 },
];

const DG_PERSONA: Persona = {
  id: 'pers_dg_trc',
  tenantId: TRC_TENANT,
  slug: 'dg_strategist',
  displayNameEn: 'Director General',
  powerTier: 1,
  scopePredicate: { kind: 'tenant_scope', tenant_id: TRC_TENANT },
  toolCatalogIds: [],
  channelAllowlist: ['web', 'mobile'],
  maxActionTier: 'HIGH',
  memoryNamespaceTemplate: '{tenant_id}:{persona_slug}',
  uiSectionFilter: [],
  isBuiltIn: true,
};

const T5_CUSTOMER_PERSONA: Persona = {
  ...DG_PERSONA,
  id: 'pers_lessee',
  slug: 'customer_lessee',
  powerTier: 5,
  maxActionTier: 'LOW',
};

// ─────────────────────────────────────────────────────────────────────
// Mock ports
// ─────────────────────────────────────────────────────────────────────

function makeSensorBundle(tenantId: string): SensorBundle {
  // Generate signals that motivate ≥3 gaps + ≥3 opportunities + ≥3 risks.
  const signals: SensorSignal[] = [
    // Risks — 3 expirations within 60 days.
    ...TRC_LEASES.filter((l) => {
      const days = (l.endDate.getTime() - NOW.getTime()) / 86_400_000;
      return days > 0 && days <= 60;
    }).map<SensorSignal>((l) => ({
      sensor: 'contracts',
      metric: 'days_to_expiry',
      value: (l.endDate.getTime() - NOW.getTime()) / 86_400_000,
      unit: 'days',
      timestamp: NOW,
      evidenceRefs: [{ kind: 'entity', id: l.id }],
      note: `Lease ${l.id} on unit ${l.unitId} expires ${l.endDate.toISOString().slice(0, 10)}.`,
    })),
    // Gaps — collection rate, complaint volume, maintenance backlog.
    {
      sensor: 'ledger',
      metric: 'collection_rate',
      value: 0.78,
      baseline: 0.92,
      delta: -0.14,
      unit: 'pct',
      timestamp: NOW,
      evidenceRefs: [{ kind: 'audit_event', id: 'aud_ledger_health_1' }],
      note: `Collection rate ${tenantId} period dropped to 78%.`,
    },
    {
      sensor: 'arrears',
      metric: 'overdue_count',
      value: 12,
      baseline: 4,
      delta: 8,
      unit: 'count',
      timestamp: NOW,
      evidenceRefs: [{ kind: 'audit_event', id: 'aud_arrears_1' }],
      note: 'Arrears doubled period-over-period.',
    },
    {
      sensor: 'complaints',
      metric: 'open_complaints',
      value: 14,
      baseline: 5,
      delta: 9,
      unit: 'count',
      timestamp: NOW,
      evidenceRefs: [{ kind: 'audit_event', id: 'aud_complaint_storm_1' }],
      note: 'Complaint volume tripled — maintenance backlog suspected.',
    },
    {
      sensor: 'audit',
      metric: 'maintenance_backlog_age_days',
      value: 22,
      baseline: 7,
      delta: 15,
      unit: 'days',
      timestamp: NOW,
      evidenceRefs: [{ kind: 'audit_event', id: 'aud_mx_backlog_1' }],
      note: 'Maintenance ticket age ballooned.',
    },
    // Opportunities — rent reviews + occupancy drive.
    {
      sensor: 'kpi',
      metric: 'rent_below_market_pct',
      value: 0.22,
      baseline: 0.05,
      delta: 0.17,
      unit: 'pct',
      timestamp: NOW,
      evidenceRefs: [{ kind: 'entity', id: 'lease_4' }],
      note: 'TZS 600k rent vs market median TZS 730k — rent review opportunity.',
    },
    {
      sensor: 'kpi',
      metric: 'rent_below_market_pct',
      value: 0.18,
      baseline: 0.05,
      delta: 0.13,
      unit: 'pct',
      timestamp: NOW,
      evidenceRefs: [{ kind: 'entity', id: 'lease_5' }],
      note: 'TZS 500k rent vs market median TZS 595k — rent review opportunity.',
    },
    {
      sensor: 'kpi',
      metric: 'occupancy_rate',
      value: 0.81,
      baseline: 0.95,
      delta: -0.14,
      unit: 'pct',
      timestamp: NOW,
      evidenceRefs: [{ kind: 'entity', id: 'ent_station_a' }],
      note: 'Occupancy rate 81% at this station — fill opportunity.',
    },
  ];

  return {
    ledger: { async ledgerHealth() { return signals.filter((s) => s.sensor === 'ledger'); } },
    arrears: { async arrearsTrend() { return signals.filter((s) => s.sensor === 'arrears'); } },
    complaints: { async complaintVolume() { return signals.filter((s) => s.sensor === 'complaints'); } },
    audit: { async anomalies() { return signals.filter((s) => s.sensor === 'audit'); } },
    contracts: { async upcomingExpirations() { return signals.filter((s) => s.sensor === 'contracts'); } },
    kpi: { async kpiDeltas() { return signals.filter((s) => s.sensor === 'kpi'); } },
  };
}

const TRC_HAIKU_LLM: HaikuLlmPort = {
  async call() {
    // Deterministic LLM output — 9 candidate hypotheses backed by the
    // sensor signals (the test depends on these matching the seeded refs).
    const hypotheses = [
      // Risks (3)
      {
        kind: 'risk',
        title: 'Lease lease_1 expiring within 7 days',
        description: 'Unit t01 lease expires May 29, 2026 — only 7 days remaining.',
        severity: 'CRITICAL',
        evidenceRefs: [{ kind: 'entity', id: 'lease_1' }],
      },
      {
        kind: 'risk',
        title: 'Lease lease_2 expiring within 30 days',
        description: 'Unit t02 lease expires June 15, 2026 — 24 days remaining.',
        severity: 'HIGH',
        evidenceRefs: [{ kind: 'entity', id: 'lease_2' }],
      },
      {
        kind: 'risk',
        title: 'Lease lease_3 expiring within 60 days',
        description: 'Unit t03 lease expires July 20, 2026 — 59 days remaining.',
        severity: 'MEDIUM',
        evidenceRefs: [{ kind: 'entity', id: 'lease_3' }],
      },
      // Gaps (3)
      {
        kind: 'gap',
        title: 'Rent collection below target',
        description: 'Collection rate dropped to 78% vs 92% baseline (-14pp).',
        severity: 'HIGH',
        evidenceRefs: [{ kind: 'audit_event', id: 'aud_ledger_health_1' }],
      },
      {
        kind: 'gap',
        title: 'Arrears doubled period-over-period',
        description: 'Open arrears count rose from 4 to 12 leases overdue.',
        severity: 'HIGH',
        evidenceRefs: [{ kind: 'audit_event', id: 'aud_arrears_1' }],
      },
      {
        kind: 'gap',
        title: 'Maintenance backlog age ballooned',
        description: 'Mean ticket age 22 days vs 7-day baseline (+15 days).',
        severity: 'MEDIUM',
        evidenceRefs: [{ kind: 'audit_event', id: 'aud_mx_backlog_1' }],
      },
      // Opportunities (3)
      {
        kind: 'opportunity',
        title: 'Rent review opportunity on lease_4',
        description: 'TZS 600k rent vs market median TZS 730k (22% below).',
        severity: 'HIGH',
        evidenceRefs: [{ kind: 'entity', id: 'lease_4' }],
      },
      {
        kind: 'opportunity',
        title: 'Rent review opportunity on lease_5',
        description: 'TZS 500k rent vs market median TZS 595k (18% below).',
        severity: 'HIGH',
        evidenceRefs: [{ kind: 'entity', id: 'lease_5' }],
      },
      {
        kind: 'opportunity',
        title: 'Occupancy fill opportunity',
        description: 'Occupancy rate at 81% — 14pp below baseline (95%).',
        severity: 'MEDIUM',
        evidenceRefs: [{ kind: 'entity', id: 'ent_station_a' }],
      },
    ];
    return { text: JSON.stringify(hypotheses), costMicros: 2500 };
  },
};

const TRC_JUDGE: OnlineJudgePort = {
  async score() {
    return 0.82; // above the 0.5 threshold
  },
};

const TRC_TOTLATS: ToTLatsPort = {
  async verify() {
    return { survives: true, additionalEvidence: [] };
  },
};

const TRC_DEBATE: DebatePort = {
  async debate() {
    return { verdict: 'keep', synthesisedNote: '', tokenCostMicros: 100 };
  },
};

const TRC_ROUTING: RoutingRulesPort = {
  async lookup() {
    return null; // fall back to built-in matrix
  },
};

const TRC_RETRIEVAL: HybridRetrieverDeps = {
  bm25: {
    async search({ query }) {
      // Echo back a single entity hit per query so retrieval has content.
      const r: RetrievalHit[] = [{
        id: 'lease_1',
        kind: 'entity',
        snippet: query.slice(0, 80),
        score: 0.9,
        source: 'bm25',
      }];
      return r;
    },
  },
  vector: { async search() { return []; } },
  embedder: { async embed() { return [0.1, 0.2]; } },
  mmr: { async rerank({ hits, k }) { return hits.slice(0, k); } },
  graph: {
    async findAncestors() { return []; },
    async findDescendants() { return []; },
    async findShortestPath() { return null; },
    async findAllReachable() { return []; },
  } as GraphTraversalPort,
};

const TRC_KILLSWITCH: KillswitchHaltPort = {
  async isHaltedForTenant() {
    return false;
  },
};

const TRC_PRIOR_BRIEF: PriorBriefLookupPort = {
  async findLatestForPersona() {
    return null;
  },
};

const TRC_AUDIT_CHAIN: AuditChainPort = {
  async append() {
    return `aud_${Math.random().toString(36).slice(2)}`;
  },
};

function makeTrcDeps(): OrchestratorDeps {
  return {
    sensors: makeSensorBundle(TRC_TENANT),
    llm: TRC_HAIKU_LLM,
    retrieval: TRC_RETRIEVAL,
    judge: TRC_JUDGE,
    totLats: TRC_TOTLATS,
    debate: TRC_DEBATE,
    routingRules: TRC_ROUTING,
    costBudget: createInMemoryCostBudget(),
    killswitch: TRC_KILLSWITCH,
    priorBrief: TRC_PRIOR_BRIEF,
    auditChain: TRC_AUDIT_CHAIN,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('orchestrator — TRC seed data integration', () => {
  it('renders a brief with ≥3 gaps, ≥3 opportunities, ≥3 risks, ≥3 actions, all cited', async () => {
    const result = await generateBrief(makeTrcDeps(), {
      tenantId: TRC_TENANT,
      persona: DG_PERSONA,
      modulesInScope: ['ESTATE', 'FINANCE'],
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      locale: 'en',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');

    const brief = result.brief;
    expect(brief.gaps.length).toBeGreaterThanOrEqual(3);
    expect(brief.opportunities.length).toBeGreaterThanOrEqual(3);
    expect(brief.risks.length).toBeGreaterThanOrEqual(3);
    expect(brief.recommendedActions.length).toBeGreaterThanOrEqual(3);

    // Every finding has at least one citation.
    for (const f of [...brief.gaps, ...brief.opportunities, ...brief.risks]) {
      expect(f.citationIndices.length).toBeGreaterThan(0);
      for (const ci of f.citationIndices) {
        expect(ci).toBeGreaterThanOrEqual(0);
        expect(ci).toBeLessThan(brief.citations.length);
      }
    }
    // Every recommended action has citations.
    for (const a of brief.recommendedActions) {
      expect(a.citationIndices.length).toBeGreaterThan(0);
    }

    expect(brief.tenantId).toBe(TRC_TENANT);
    expect(brief.personaId).toBe(DG_PERSONA.id);
    expect(brief.generatorVersion).toBe(ENGINE_VERSION);
    expect(brief.degraded).toBe(false);
  });

  it('rejects T5 customer persona (tier > 3)', async () => {
    const result = await generateBrief(makeTrcDeps(), {
      tenantId: TRC_TENANT,
      persona: T5_CUSTOMER_PERSONA,
      modulesInScope: [],
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      locale: 'en',
    });
    expect(result.status).toBe('refused');
    if (result.status === 'refused') {
      expect(result.reason).toContain('power tier');
    }
  });

  it('refuses generation when kill-switch is halted', async () => {
    const deps = makeTrcDeps();
    const haltedDeps: OrchestratorDeps = {
      ...deps,
      killswitch: {
        async isHaltedForTenant() {
          return true;
        },
      },
    };
    const result = await generateBrief(haltedDeps, {
      tenantId: TRC_TENANT,
      persona: DG_PERSONA,
      modulesInScope: [],
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      locale: 'en',
    });
    expect(result.status).toBe('refused');
  });

  it('fails closed when kill-switch read errors', async () => {
    const deps = makeTrcDeps();
    const erroringDeps: OrchestratorDeps = {
      ...deps,
      killswitch: {
        async isHaltedForTenant() {
          throw new Error('killswitch unreachable');
        },
      },
    };
    const result = await generateBrief(erroringDeps, {
      tenantId: TRC_TENANT,
      persona: DG_PERSONA,
      modulesInScope: [],
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      locale: 'en',
    });
    expect(result.status).toBe('refused');
    if (result.status === 'refused') {
      expect(result.reason).toContain('Killswitch read failed');
    }
  });

  it('returns degraded result when over budget', async () => {
    const deps = makeTrcDeps();
    const overBudgetDeps: OrchestratorDeps = {
      ...deps,
      costBudget: createInMemoryCostBudget({ overBudgetTenants: [TRC_TENANT] }),
    };
    const result = await generateBrief(overBudgetDeps, {
      tenantId: TRC_TENANT,
      persona: DG_PERSONA,
      modulesInScope: [],
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      locale: 'en',
    });
    expect(result.status).toBe('degraded');
    if (result.status === 'degraded') {
      expect(result.brief.degraded).toBe(true);
      expect(result.reason).toBe('over_budget');
    }
  });

  it('hash-chains successive briefs', async () => {
    // First brief — no prior.
    const r1 = await generateBrief(makeTrcDeps(), {
      tenantId: TRC_TENANT,
      persona: DG_PERSONA,
      modulesInScope: [],
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      locale: 'en',
    });
    if (r1.status !== 'ok') throw new Error('first ok');
    const firstHash = r1.brief.hash;

    // Second brief — prior present.
    const depsWithPrior: OrchestratorDeps = {
      ...makeTrcDeps(),
      priorBrief: {
        async findLatestForPersona() {
          return r1.brief;
        },
      },
    };
    const r2 = await generateBrief(depsWithPrior, {
      tenantId: TRC_TENANT,
      persona: DG_PERSONA,
      modulesInScope: [],
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      locale: 'en',
    });
    if (r2.status !== 'ok') throw new Error('second ok');
    expect(r2.brief.prevHash).toBe(firstHash);
    expect(r2.brief.hash).not.toBe(firstHash);
  });

  it('verifyBriefHash detects tampering', async () => {
    const r = await generateBrief(makeTrcDeps(), {
      tenantId: TRC_TENANT,
      persona: DG_PERSONA,
      modulesInScope: [],
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      locale: 'en',
    });
    if (r.status !== 'ok') throw new Error('ok');
    expect(verifyBriefHash(r.brief)).toBe(true);
    // Tamper with a finding.
    const tampered = {
      ...r.brief,
      gaps: [
        ...r.brief.gaps,
        {
          title: 'Injected gap not in original',
          description: 'Not from engine.',
          severity: 'CRITICAL' as const,
          citationIndices: [0],
        },
      ],
    };
    expect(verifyBriefHash(tampered)).toBe(false);
  });

  it('cross-tenant: prior brief from tenant A is not used for tenant B', async () => {
    const tenantADeps = makeTrcDeps();
    const tenantAResult = await generateBrief(tenantADeps, {
      tenantId: 'ten_a',
      persona: { ...DG_PERSONA, tenantId: 'ten_a' },
      modulesInScope: [],
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      locale: 'en',
    });
    if (tenantAResult.status !== 'ok') throw new Error('a ok');

    // Now generate for tenant B; the priorBrief port returns NULL for ten_b.
    const tenantBDeps: OrchestratorDeps = {
      ...makeTrcDeps(),
      priorBrief: {
        async findLatestForPersona({ tenantId }) {
          // Simulating an RLS-correct port: only returns rows for tenantId.
          if (tenantId === 'ten_a') return tenantAResult.brief;
          return null;
        },
      },
    };
    const tenantBResult = await generateBrief(tenantBDeps, {
      tenantId: 'ten_b',
      persona: { ...DG_PERSONA, id: 'pers_dg_b', tenantId: 'ten_b' },
      modulesInScope: [],
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      locale: 'en',
    });
    if (tenantBResult.status !== 'ok') throw new Error('b ok');
    // No prior found → prevHash null.
    expect(tenantBResult.brief.prevHash).toBeNull();
    expect(tenantBResult.brief.tenantId).toBe('ten_b');
  });
});
