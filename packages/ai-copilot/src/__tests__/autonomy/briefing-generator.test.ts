import { describe, it, expect } from 'vitest';
import {
  EXECUTIVE_BRIEFING_SCHEDULE,
  ExecutiveBriefingGenerator,
  InMemoryBriefingRepository,
  InMemoryExceptionRepository,
  ExceptionInbox,
} from '../../autonomy/index.js';

const TENANT = 'tenant_brief_1';

describe('ExecutiveBriefingGenerator', () => {
  it('produces a full weekly briefing with markdown body', async () => {
    const repo = new InMemoryBriefingRepository();
    const gen = new ExecutiveBriefingGenerator({ repository: repo });
    const briefing = await gen.generate({
      tenantId: TENANT,
      cadence: 'weekly',
      periodStart: new Date('2026-04-06T00:00:00Z'),
      periodEnd: new Date('2026-04-12T23:59:59Z'),
      portfolioHealth: {
        occupancyPct: 91.2,
        collectionsPct: 94.0,
        arrearsRatioPct: 8.4,
        maintenanceSpendMinorUnits: 12_000_000,
        satisfactionScore: 0.82,
      },
      wins: [
        { title: 'Block C occupancy hit 97%', evidence: '2 new leases' },
      ],
      openExceptions: [],
    });
    expect(briefing.cadence).toBe('weekly');
    expect(briefing.headline).toContain('91%');
    expect(briefing.bodyMarkdown).toContain('# Executive briefing');
    expect(briefing.bodyMarkdown).toContain('Portfolio health');
  });

  it('caps wins + exceptions at five each', async () => {
    const exRepo = new InMemoryExceptionRepository();
    const inbox = new ExceptionInbox({ repository: exRepo });
    for (let i = 0; i < 8; i++) {
      await inbox.addException({
        tenantId: TENANT,
        domain: 'finance',
        kind: 'x',
        title: `excp ${i}`,
        description: 'd',
        amountMinorUnits: 20_000_000,
      });
    }
    const openExceptions = await inbox.listOpen(TENANT);
    const gen = new ExecutiveBriefingGenerator({
      repository: new InMemoryBriefingRepository(),
    });
    const briefing = await gen.generate({
      tenantId: TENANT,
      cadence: 'weekly',
      periodStart: new Date(),
      periodEnd: new Date(),
      portfolioHealth: {
        occupancyPct: 85,
        collectionsPct: 80,
        arrearsRatioPct: 18,
        maintenanceSpendMinorUnits: 1_000_000,
        satisfactionScore: 0.5,
      },
      wins: Array.from({ length: 9 }, (_, i) => ({
        title: `w${i}`,
        evidence: '',
      })),
      openExceptions,
    });
    expect(briefing.wins).toHaveLength(5);
    expect(briefing.exceptions).toHaveLength(5);
  });

  it('recommends accelerating arrears when ratio > 15%', async () => {
    const gen = new ExecutiveBriefingGenerator({
      repository: new InMemoryBriefingRepository(),
    });
    const briefing = await gen.generate({
      tenantId: TENANT,
      cadence: 'weekly',
      periodStart: new Date(),
      periodEnd: new Date(),
      portfolioHealth: {
        occupancyPct: 95,
        collectionsPct: 70,
        arrearsRatioPct: 22,
        maintenanceSpendMinorUnits: 1,
        satisfactionScore: 0.7,
      },
      wins: [],
      openExceptions: [],
    });
    const hasArrearsRec = briefing.recommendations.some((r) =>
      r.headline.toLowerCase().includes('arrears'),
    );
    expect(hasArrearsRec).toBe(true);
  });

  it('exports schedule constants for the background scheduler', () => {
    expect(EXECUTIVE_BRIEFING_SCHEDULE.weeklyCron).toBe('0 8 * * 1');
    expect(EXECUTIVE_BRIEFING_SCHEDULE.monthlyCron).toBe('0 8 1 * *');
    expect(EXECUTIVE_BRIEFING_SCHEDULE.taskName).toBe('generate_executive_briefing');
  });
});
