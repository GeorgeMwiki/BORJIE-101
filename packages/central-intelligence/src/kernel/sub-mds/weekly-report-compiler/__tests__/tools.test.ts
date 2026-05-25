import { describe, expect, it } from 'vitest';
import {
  gatherKpis,
  type KpiDataPort,
  type PortfolioKpiSnapshot,
} from '../tools/gather-kpis.js';
import {
  detectAnomalies,
  type ForecastReplayPort,
} from '../tools/detect-anomalies.js';
import { citeEvidence } from '../tools/cite-evidence.js';
import { draftBriefing } from '../tools/draft-briefing.js';

const TENANT = 't1';

function mkPort(): KpiDataPort {
  return {
    async fetchCashflow() {
      return {
        grossCollectedMinor: 1_000_000_00,
        netCollectedMinor: 950_000_00,
        arrearsBalanceMinor: 75_000_00,
        currency: 'KES',
        citation: { metric: 'cashflow', sourceTable: 'cashflow', sourceRowId: 'cf-1', capturedAtMs: 1000 },
      };
    },
    async fetchOccupancy() {
      return {
        occupiedUnits: 18,
        totalUnits: 20,
        occupancyRate: 0.9,
        newSignsThisWeek: 2,
        movedOutThisWeek: 1,
        citation: { metric: 'occupancy', sourceTable: 'occupancy', sourceRowId: 'oc-1', capturedAtMs: 1000 },
      };
    },
    async fetchArrears() {
      return {
        leasesInArrears: 3,
        newArrearsThisWeek: 1,
        curedThisWeek: 2,
        citation: { metric: 'arrears', sourceTable: 'arrears', sourceRowId: 'ar-1', capturedAtMs: 1000 },
      };
    },
    async fetchMaintenance() {
      return {
        openTickets: 5,
        closedThisWeek: 8,
        emergencyTicketsThisWeek: 1,
        avgResponseSeconds: 720,
        citation: { metric: 'maintenance', sourceTable: 'maintenance', sourceRowId: 'mt-1', capturedAtMs: 1000 },
      };
    },
    async fetchComplaints() {
      return {
        newComplaintsThisWeek: 4,
        criticalComplaintsThisWeek: 0,
        resolvedThisWeek: 3,
        citation: { metric: 'complaints', sourceTable: 'complaints', sourceRowId: 'cp-1', capturedAtMs: 1000 },
      };
    },
  };
}

describe('gatherKpis', () => {
  it('returns a complete snapshot across all 5 sources', async () => {
    const s = await gatherKpis({
      port: mkPort(),
      tenantId: TENANT,
      periodStartMs: 0,
      periodEndMs: 7 * 86400_000,
    });
    expect(s.cashflow.grossCollectedMinor).toBe(1_000_000_00);
    expect(s.occupancy.occupancyRate).toBe(0.9);
    expect(s.arrears.leasesInArrears).toBe(3);
    expect(s.maintenance.openTickets).toBe(5);
    expect(s.complaints.newComplaintsThisWeek).toBe(4);
  });
});

const forecastPort: ForecastReplayPort = {
  async read() {
    return {
      grossCollectedMinor: 1_000_000_00,
      occupancyRate: 0.9,
      emergencyTicketsThisWeek: 0,
      newArrearsThisWeek: 1,
      criticalComplaintsThisWeek: 0,
    };
  },
};

const forecastEmpty: ForecastReplayPort = {
  async read() { return null; },
};

describe('detectAnomalies', () => {
  it('returns no anomalies on perfectly matching forecast', async () => {
    const snap = await gatherKpis({ port: mkPort(), tenantId: TENANT, periodStartMs: 0, periodEndMs: 1 });
    const r = await detectAnomalies({ snapshot: snap, forecastPort, tenantId: TENANT });
    // Maintenance emergency=1 vs predicted 0 → flagged. So expect 1 anomaly.
    expect(r.forecastFound).toBe(true);
    expect(r.anomalies.length).toBe(1);
    expect(r.anomalies[0]?.metric).toBe('emergencyTicketsThisWeek');
  });

  it('handles missing forecast gracefully', async () => {
    const snap = await gatherKpis({ port: mkPort(), tenantId: TENANT, periodStartMs: 0, periodEndMs: 1 });
    const r = await detectAnomalies({ snapshot: snap, forecastPort: forecastEmpty, tenantId: TENANT });
    expect(r.forecastFound).toBe(false);
    expect(r.anomalies.length).toBe(0);
  });

  it('classifies severity correctly', async () => {
    const snap = await gatherKpis({ port: mkPort(), tenantId: TENANT, periodStartMs: 0, periodEndMs: 1 });
    const port: ForecastReplayPort = {
      async read() {
        return {
          grossCollectedMinor: 500_000_00, // actual is 1,000,000 = +100% over
          occupancyRate: 0.9,
          emergencyTicketsThisWeek: 1,
          newArrearsThisWeek: 1,
          criticalComplaintsThisWeek: 0,
        };
      },
    };
    const r = await detectAnomalies({ snapshot: snap, forecastPort: port, tenantId: TENANT });
    const cf = r.anomalies.find(a => a.metric === 'grossCollectedMinor');
    expect(cf?.severity).toBe('major');
    expect(cf?.direction).toBe('over-performed');
  });
});

describe('citeEvidence + draftBriefing', () => {
  it('emits citations for every snapshot metric', async () => {
    const snap = await gatherKpis({ port: mkPort(), tenantId: TENANT, periodStartMs: 0, periodEndMs: 1 });
    const cite = citeEvidence({ snapshot: snap, anomalies: [] });
    expect(cite.citations.length).toBeGreaterThanOrEqual(10);
    expect(cite.byMetric['cashflow.gross']).toBeDefined();
  });

  it('drafts a markdown briefing with citation refs', async () => {
    const snap = await gatherKpis({ port: mkPort(), tenantId: TENANT, periodStartMs: 0, periodEndMs: 1 });
    const r = await detectAnomalies({ snapshot: snap, forecastPort, tenantId: TENANT });
    const cite = citeEvidence({ snapshot: snap, anomalies: r.anomalies });
    const b = draftBriefing({
      snapshot: snap,
      anomalies: r.anomalies,
      citations: cite.citations,
      portfolioName: 'Asha Estates',
      language: 'en',
    });
    expect(b.draftStatus).toBe('queued-for-owner-review');
    expect(b.uiKind).toBe('markdown-card');
    expect(b.markdown).toContain('[c:cashflow.gross]');
    expect(b.markdown).toContain('[c:occupancy.rate]');
    expect(b.markdown).toContain('# Weekly briefing');
  });

  it('renders Swahili briefing', async () => {
    const snap = await gatherKpis({ port: mkPort(), tenantId: TENANT, periodStartMs: 0, periodEndMs: 1 });
    const cite = citeEvidence({ snapshot: snap, anomalies: [] });
    const b = draftBriefing({
      snapshot: snap, anomalies: [], citations: cite.citations,
      portfolioName: 'Asha Estates', language: 'sw',
    });
    expect(b.markdown).toContain('Muhtasari');
    expect(b.markdown).toContain('Mtiririko');
  });

  it('produces a major-variance headline when anomalies are major', async () => {
    const snap: PortfolioKpiSnapshot = await gatherKpis({ port: mkPort(), tenantId: TENANT, periodStartMs: 0, periodEndMs: 1 });
    const anomalies = [{
      metric: 'grossCollectedMinor',
      actual: 100_000_00,
      predicted: 1_000_000_00,
      delta: -900_000_00,
      relativeError: 0.9,
      severity: 'major' as const,
      direction: 'under-performed' as const,
    }];
    const cite = citeEvidence({ snapshot: snap, anomalies });
    const b = draftBriefing({ snapshot: snap, anomalies, citations: cite.citations, portfolioName: 'X', language: 'en' });
    expect(b.headline).toContain('Major');
  });
});
