/**
 * Happy-path tests for the mine-planner advisor.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createMinePlannerAdvisor,
  type PlanInput,
} from '../index.js';

const SAMPLE_INPUT: PlanInput = {
  siteId: 'site-1',
  planDateISO: '2026-04-15',
  targetTonnesPerDay: 1500,
  polygons: [
    {
      id: 'p1',
      label: 'North bench',
      ring: [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]],
      estimatedTonnes: 1000,
      grade: 2.5,
    },
    {
      id: 'p2',
      label: 'South bench',
      ring: [[2, 0], [2, 1], [3, 1], [3, 0], [2, 0]],
      estimatedTonnes: 800,
      grade: 1.8,
    },
  ],
  fleet: [
    {
      id: 'ex-1',
      kind: 'excavator',
      capacityTonnesPerHour: 80,
      availableFromISO: '2026-04-01',
      availableToISO: '2026-04-30',
      hourlyOpex: 50_000,
    },
  ],
  crew: [
    {
      id: 'c1',
      name: 'Asha',
      skills: ['excavator', 'loader'],
      shiftAvailability: ['morning', 'afternoon'],
    },
    {
      id: 'c2',
      name: 'Babu',
      skills: ['excavator'],
      shiftAvailability: ['night'],
    },
  ],
};

describe('mine-planner-advisor.analyze', () => {
  it('builds a shift plan with at least one assignment', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const advisor = createMinePlannerAdvisor({ logger });
    const plan = await advisor.analyze(SAMPLE_INPUT);
    expect(plan.assignments.length).toBeGreaterThan(0);
    expect(plan.totalEstimatedTonnes).toBeGreaterThan(0);
    expect(logger.info).toHaveBeenCalledWith(
      'mine-planner.analyze.start',
      expect.any(Object),
    );
  });
});

describe('mine-planner-advisor.recommend', () => {
  it('flags unmet target when fleet capacity falls short', async () => {
    const advisor = createMinePlannerAdvisor();
    const constrained: PlanInput = { ...SAMPLE_INPUT, targetTonnesPerDay: 10_000 };
    const plan = await advisor.analyze(constrained);
    const recs = await advisor.recommend({ input: constrained, plan });
    const unmet = recs.find((r) => r.id === 'unmet-target');
    expect(unmet).toBeDefined();
    expect(unmet?.evidence.length).toBeGreaterThan(0);
  });
});
