import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryBottleneckStore,
  InMemoryImprovementSnapshotStore,
  InMemoryProcessObservationStore,
  classifyQuestion,
  createBottleneckDetector,
  createImprovementTracker,
  createOrgQueryService,
  createProcessMiner,
  extractProcessKind,
} from '../index.js';
import { buildQueryOrganizationTool } from '../../skills/org/query-organization.js';

describe('query-organization', () => {
  const tenant = 'tenant-omega';
  let obsStore: InMemoryProcessObservationStore;
  let btnStore: InMemoryBottleneckStore;
  let snapStore: InMemoryImprovementSnapshotStore;
  let service: ReturnType<typeof createOrgQueryService>;
  let detector: ReturnType<typeof createBottleneckDetector>;

  beforeEach(async () => {
    obsStore = new InMemoryProcessObservationStore();
    btnStore = new InMemoryBottleneckStore();
    snapStore = new InMemoryImprovementSnapshotStore();
    const miner = createProcessMiner({ store: obsStore });
    detector = createBottleneckDetector({
      observationStore: obsStore,
      bottleneckStore: btnStore,
      miner,
    });
    const tracker = createImprovementTracker({ store: snapStore });
    service = createOrgQueryService({
      miner,
      bottleneckStore: btnStore,
      improvementTracker: tracker,
    });
    await tracker.recordSnapshot({
      tenantId: tenant,
      metric: 'arrears_ratio',
      periodKind: 'monthly',
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-01-31T23:59:59Z'),
      value: 0.4,
      isBaseline: true,
    });
    await tracker.recordSnapshot({
      tenantId: tenant,
      metric: 'arrears_ratio',
      periodKind: 'monthly',
      periodStart: new Date('2026-04-01T00:00:00Z'),
      periodEnd: new Date('2026-04-30T23:59:59Z'),
      value: 0.2,
    });
  });

  it('classifyQuestion routes bottleneck questions', () => {
    expect(classifyQuestion("what's our biggest bottleneck?")).toBe(
      'bottleneck_top',
    );
    expect(classifyQuestion('where are we stuck')).toBe('bottleneck_top');
  });

  it('classifyQuestion routes improvement questions', () => {
    expect(
      classifyQuestion('show me our improvements since we adopted you'),
    ).toBe('improvement_report');
    expect(classifyQuestion('how has the arrears ratio changed?')).toBe(
      'improvement_report',
    );
  });

  it('classifyQuestion routes process stats questions', () => {
    expect(classifyQuestion('how long does a maintenance ticket take?'))
      .toBe('process_stats');
  });

  it('classifyQuestion routes generic status questions', () => {
    expect(classifyQuestion('how are we doing overall?')).toBe(
      'general_status',
    );
  });

  it('extractProcessKind picks the right kind', () => {
    expect(extractProcessKind('maintenance case stats')).toBe(
      'maintenance_case',
    );
    expect(extractProcessKind('renewal data')).toBe('lease_renewal');
    expect(extractProcessKind('tender bids')).toBe('tender_bid');
  });

  it('answers "how are we doing" with a structured general status', async () => {
    const answer = await service.answer({
      tenantId: tenant,
      question: 'How are we doing?',
    });
    expect(answer.intent).toBe('general_status');
    expect(answer.blackboardBlock).toBe('status_summary');
    expect(answer.tenantId).toBe(tenant);
  });

  it('answers "biggest bottleneck" by returning top-3 from the store', async () => {
    for (let i = 0; i < 10; i++) {
      await obsStore.append({
        tenantId: tenant,
        processKind: 'maintenance_case',
        processInstanceId: `c-${i}`,
        stage: 'assigned',
        actorKind: 'human',
        durationMsFromPrevious: i === 9 ? 200_000 : 1000,
      });
    }
    await detector.detectForTenant(tenant);
    const answer = await service.answer({
      tenantId: tenant,
      question: "what's our biggest bottleneck?",
    });
    expect(answer.intent).toBe('bottleneck_top');
    if (answer.intent === 'bottleneck_top') {
      expect(answer.bottlenecks.length).toBeGreaterThan(0);
      expect(answer.bottlenecks.length).toBeLessThanOrEqual(3);
    }
  });

  it('answers improvement questions with baseline diff', async () => {
    const answer = await service.answer({
      tenantId: tenant,
      question: 'how has our arrears ratio changed since we adopted you?',
    });
    expect(answer.intent).toBe('improvement_report');
    if (answer.intent === 'improvement_report') {
      expect(answer.report.deltas.length).toBeGreaterThan(0);
      const arrears = answer.report.deltas.find(
        (d) => d.metric === 'arrears_ratio',
      );
      expect(arrears?.isBetter).toBe(true);
    }
  });

  it('exposes a ToolHandler with the correct name and schema', () => {
    const tool = buildQueryOrganizationTool(service);
    expect(tool.name).toBe('skill.org.query_organization');
    expect(tool.parameters).toMatchObject({
      type: 'object',
      required: ['question'],
    });
  });

  it('tool execute returns ok with an answer payload', async () => {
    const tool = buildQueryOrganizationTool(service);
    const r = await tool.execute(
      { question: 'how are we doing?' },
      {
        tenant: { tenantId: tenant } as unknown as never,
      } as unknown as never,
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toBeDefined();
  });

  it('tool rejects missing tenantId from context', async () => {
    const tool = buildQueryOrganizationTool(service);
    const r = await tool.execute(
      { question: 'hi' },
      { tenant: { tenantId: '' } as unknown as never } as unknown as never,
    );
    expect(r.ok).toBe(false);
  });

  it('enforces cross-tenant isolation in answer path', async () => {
    const other = 'tenant-isolated';
    for (let i = 0; i < 10; i++) {
      await obsStore.append({
        tenantId: tenant,
        processKind: 'maintenance_case',
        processInstanceId: `c-${i}`,
        stage: 'assigned',
        actorKind: 'human',
        durationMsFromPrevious: i === 9 ? 200_000 : 1000,
      });
    }
    await detector.detectForTenant(tenant);
    const answer = await service.answer({
      tenantId: other,
      question: "what's our biggest bottleneck?",
    });
    if (answer.intent === 'bottleneck_top') {
      expect(answer.bottlenecks).toHaveLength(0);
    }
  });
});
