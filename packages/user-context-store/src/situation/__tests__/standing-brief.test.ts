/**
 * Standing-brief synthesizer tests — the six-facet situational model.
 */
import { describe, expect, it } from 'vitest';
import { buildStandingBrief, type BuildBriefContext } from '../standing-brief.js';
import { standingBriefSchema } from '../brief-types.js';
import type {
  BlindSpotRecord,
  BriefSources,
  DoingRecord,
  FutureRecord,
  HappenedRecord,
  ToDoRecord,
} from '../brief-ports.js';

const NOW = new Date('2026-06-08T12:00:00Z');
const ctx: BuildBriefContext = { now: () => NOW };

function isoDaysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

const sources: BriefSources = {
  happened: async (): Promise<HappenedRecord[]> => [
    {
      id: 'h1',
      summary: 'Posted royalty payment TZS 12M',
      at: isoDaysFromNow(-1),
      importance: 8,
      evidenceKind: 'audit',
      evidenceId: 'audit:abc',
    },
    {
      id: 'h2',
      summary: 'Closed onboarding for Site B',
      at: isoDaysFromNow(-30),
      importance: 4,
      evidenceKind: 'memory',
      evidenceId: 'mem:xyz',
    },
  ],
  doing: async (): Promise<DoingRecord[]> => [
    {
      id: 'd1',
      summary: 'Sub-MD investigating production dip at Site C',
      startedAt: isoDaysFromNow(-0.1),
      importance: 7,
      evidenceKind: 'workflow',
      evidenceId: 'wf:run1',
    },
  ],
  toDo: async (): Promise<ToDoRecord[]> => [
    {
      id: 't1',
      summary: 'File TRA royalty return',
      state: 'pending',
      importance: 9,
      dueAt: isoDaysFromNow(2),
      evidenceKind: 'workflow',
      evidenceId: 'wf:tra',
    },
    {
      id: 't2',
      summary: 'Approve vendor invoice',
      state: 'blocked',
      importance: 5,
      evidenceKind: 'workflow',
      evidenceId: 'wf:inv',
    },
  ],
  future: async (): Promise<FutureRecord[]> => [
    {
      id: 'f1',
      summary: 'Licence #4471 renewal window opens',
      dueAt: isoDaysFromNow(20),
      importance: 9,
      evidenceId: 'forecast:lic',
    },
  ],
  blindSpots: async (): Promise<BlindSpotRecord[]> => [
    {
      id: 'b1',
      summary: 'No recent assay for Pit 3',
      blocksDecision: 'offtake pricing for Pit 3',
      resolutionHint: 'commission an assay',
      importance: 8,
      evidenceKind: 'signal',
      evidenceId: 'signal:assay-gap',
    },
  ],
};

describe('buildStandingBrief', () => {
  it('synthesizes all six facets', async () => {
    const brief = await buildStandingBrief('tenant_a', sources, ctx);
    expect(brief.tenantId).toBe('tenant_a');
    expect(brief.happened.length).toBe(2);
    expect(brief.doing.length).toBe(1);
    expect(brief.toDo.length).toBe(2);
    expect(brief.couldMatterLater.length).toBe(1);
    expect(brief.blindSpots.length).toBe(1);
  });

  it('validates against the zod schema', async () => {
    const brief = await buildStandingBrief('tenant_a', sources, ctx);
    expect(() => standingBriefSchema.parse(brief)).not.toThrow();
  });

  it('every facet item cites at least one evidence pointer', async () => {
    const brief = await buildStandingBrief('tenant_a', sources, ctx);
    const all = [
      ...brief.happened,
      ...brief.doing,
      ...brief.toDo,
      ...brief.couldMatterLater,
      ...brief.blindSpots,
    ];
    for (const item of all) {
      expect(item.evidence.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('ranks happened by salience (recent+important first)', async () => {
    const brief = await buildStandingBrief('tenant_a', sources, ctx);
    // h1 (1d ago, importance 8) should outrank h2 (30d ago, importance 4).
    expect(brief.happened[0]?.id).toBe('h1');
  });

  it('picks the highest-priority undone item as nextBestAction', async () => {
    const brief = await buildStandingBrief('tenant_a', sources, ctx);
    // t1: importance 9 + due in 2d → highest salience.
    expect(brief.nextBestAction?.id).toBe('t1');
  });

  it('annotates a blocked toDo item with its state', async () => {
    const brief = await buildStandingBrief('tenant_a', sources, ctx);
    const blocked = brief.toDo.find((i) => i.id === 't2');
    expect(blocked?.summary).toContain('[blocked]');
  });

  it('turns every blind spot into an abstain caveat', async () => {
    const brief = await buildStandingBrief('tenant_a', sources, ctx);
    const blindCaveat = brief.caveats.find((c) => c.id === 'caveat:blind:b1');
    expect(blindCaveat).toBeDefined();
    expect(blindCaveat?.abstain).toBe(true);
  });

  it('computes daysUntil for future items', async () => {
    const brief = await buildStandingBrief('tenant_a', sources, ctx);
    expect(brief.couldMatterLater[0]?.daysUntil).toBe(20);
  });

  it('degrades gracefully when a source throws', async () => {
    const brief = await buildStandingBrief(
      'tenant_a',
      {
        happened: async () => {
          throw new Error('db down');
        },
        toDo: sources.toDo,
      },
      ctx,
    );
    expect(brief.happened).toEqual([]);
    expect(brief.toDo.length).toBe(2);
  });

  it('handles a fully empty source set', async () => {
    const brief = await buildStandingBrief('tenant_a', {}, ctx);
    expect(brief.happened).toEqual([]);
    expect(brief.nextBestAction).toBeNull();
    expect(brief.caveats).toEqual([]);
    expect(() => standingBriefSchema.parse(brief)).not.toThrow();
  });

  it('respects the platform-internal (null tenant) scope', async () => {
    const brief = await buildStandingBrief(null, sources, ctx);
    expect(brief.tenantId).toBeNull();
  });

  it('caps each facet at perFacetLimit', async () => {
    const many: BriefSources = {
      happened: async () =>
        Array.from({ length: 20 }, (_, i) => ({
          id: `h${i}`,
          summary: `event ${i}`,
          at: isoDaysFromNow(-i),
          importance: 5,
          evidenceKind: 'audit' as const,
          evidenceId: `audit:${i}`,
        })),
    };
    const brief = await buildStandingBrief('tenant_a', many, {
      ...ctx,
      perFacetLimit: 3,
    });
    expect(brief.happened.length).toBe(3);
  });
});
