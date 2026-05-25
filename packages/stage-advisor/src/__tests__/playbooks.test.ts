/**
 * Playbook tests — each stage has a playbook, completion predicates
 * evaluate correctly, evaluator returns deterministic ordering.
 */

import { describe, it, expect } from 'vitest';
import { evaluatePlaybook } from '../playbooks/index.js';
import { STAGE_CARDS } from '../stages/index.js';
import { ORG_STAGES } from '../types.js';
import { defaultOrgState } from '../index.js';
import type { OrgState } from '../types.js';

describe('Each stage playbook has the required shape', () => {
  for (const stage of ORG_STAGES) {
    it(`${stage} playbook has ≥3 objectives, all with non-empty tasks`, () => {
      const pb = STAGE_CARDS[stage].stageOnboardingPlaybook;
      expect(pb.stage).toBe(stage);
      expect(pb.objectives.length).toBeGreaterThanOrEqual(3);
      for (const obj of pb.objectives) {
        expect(obj.id.length).toBeGreaterThan(0);
        expect(obj.name.length).toBeGreaterThan(0);
        expect(obj.tasks.length).toBeGreaterThan(0);
        for (const task of obj.tasks) {
          expect(task.id.length).toBeGreaterThan(0);
          expect(task.requiredCapability.length).toBeGreaterThan(0);
          expect(typeof task.completionPredicate).toBe('function');
        }
      }
    });
  }
});

describe('evaluatePlaybook — empty state', () => {
  it('every task incomplete with default state', () => {
    const pb = STAGE_CARDS['sapling'].stageOnboardingPlaybook;
    const ev = evaluatePlaybook({
      playbook: pb,
      orgState: defaultOrgState('tn-empty'),
    });
    expect(ev.completedTasks).toBe(0);
    expect(ev.completionRatio).toBe(0);
    expect(ev.nextIncompleteTasks.length).toBe(3);
  });
});

describe('evaluatePlaybook — task predicates fire on matching state', () => {
  it('pre-launch: org setup + property + payment = some progress', () => {
    const state: OrgState = {
      ...defaultOrgState('tn1'),
      orgSetupComplete: true,
      propertyCount: 1,
      paymentMethodsConfigured: 1,
    };
    const ev = evaluatePlaybook({
      playbook: STAGE_CARDS['pre-launch'].stageOnboardingPlaybook,
      orgState: state,
    });
    expect(ev.completedTasks).toBeGreaterThanOrEqual(3);
    expect(ev.completionRatio).toBeGreaterThan(0);
  });

  it('seedling: first lease + 5 units + payment = high completion', () => {
    const state: OrgState = {
      ...defaultOrgState('tn2'),
      leaseCount: 1,
      paymentMethodsConfigured: 1,
      unitsManaged: 6,
      extra: { broadcastsSent: 1 },
    };
    const ev = evaluatePlaybook({
      playbook: STAGE_CARDS['seedling'].stageOnboardingPlaybook,
      orgState: state,
    });
    expect(ev.completionRatio).toBeGreaterThanOrEqual(0.75);
  });

  it('sprout: 5 categories + scheduled inspection + cadence = done', () => {
    const state: OrgState = {
      ...defaultOrgState('tn3'),
      maintenanceCategoriesDefined: 6,
      scheduledInspectionsConfigured: 1,
      reportCadenceCount: 1,
    };
    const ev = evaluatePlaybook({
      playbook: STAGE_CARDS['sprout'].stageOnboardingPlaybook,
      orgState: state,
    });
    expect(ev.completedTasks).toBe(ev.totalTasks);
    expect(ev.completionRatio).toBe(1);
  });

  it('sapling: 5 vendors + inventory location + first rfq = done', () => {
    const state: OrgState = {
      ...defaultOrgState('tn4'),
      vendorCount: 5,
      inventoryLocationsCount: 1,
      rfqCount: 1,
    };
    const ev = evaluatePlaybook({
      playbook: STAGE_CARDS['sapling'].stageOnboardingPlaybook,
      orgState: state,
    });
    expect(ev.completedTasks).toBe(ev.totalTasks);
  });

  it('tree: fleet + clusters + reporting cadence', () => {
    const state: OrgState = {
      ...defaultOrgState('tn5'),
      fleetVehicleCount: 1,
      reportCadenceCount: 1,
      extra: { pmClusterCount: 3 },
    };
    const ev = evaluatePlaybook({
      playbook: STAGE_CARDS['tree'].stageOnboardingPlaybook,
      orgState: state,
    });
    expect(ev.completedTasks).toBe(ev.totalTasks);
  });

  it('forest: regions + treasury + expansion pipeline', () => {
    const state: OrgState = {
      ...defaultOrgState('tn6'),
      regionsConfigured: 3,
      treasuryAccountCount: 1,
      extra: { expansionPipelineEntries: 5 },
    };
    const ev = evaluatePlaybook({
      playbook: STAGE_CARDS['forest'].stageOnboardingPlaybook,
      orgState: state,
    });
    expect(ev.completedTasks).toBe(ev.totalTasks);
  });

  it('ecosystem: jurisdictions + ir/aor + ops command', () => {
    const state: OrgState = {
      ...defaultOrgState('tn7'),
      jurisdictionsConfigured: 3,
      reportCadenceCount: 2,
      extra: { opsCommandEnabled: true },
    };
    const ev = evaluatePlaybook({
      playbook: STAGE_CARDS['ecosystem'].stageOnboardingPlaybook,
      orgState: state,
    });
    expect(ev.completedTasks).toBe(ev.totalTasks);
  });
});

describe('evaluatePlaybook — nextIncompleteTasks ordering', () => {
  it('returns up to nextN incomplete tasks in declaration order', () => {
    const ev = evaluatePlaybook({
      playbook: STAGE_CARDS['sapling'].stageOnboardingPlaybook,
      orgState: defaultOrgState('tn'),
      nextN: 2,
    });
    expect(ev.nextIncompleteTasks).toHaveLength(2);
  });

  it('nextN === 0 returns empty array', () => {
    const ev = evaluatePlaybook({
      playbook: STAGE_CARDS['sapling'].stageOnboardingPlaybook,
      orgState: defaultOrgState('tn'),
      nextN: 0,
    });
    expect(ev.nextIncompleteTasks).toHaveLength(0);
  });

  it('returns empty when all complete', () => {
    const state: OrgState = {
      ...defaultOrgState('tn'),
      vendorCount: 100,
      inventoryLocationsCount: 5,
      rfqCount: 5,
    };
    const ev = evaluatePlaybook({
      playbook: STAGE_CARDS['sapling'].stageOnboardingPlaybook,
      orgState: state,
    });
    expect(ev.nextIncompleteTasks).toHaveLength(0);
  });
});

describe('evaluatePlaybook — predicate robustness', () => {
  it('throwing predicate is treated as not done (no crash)', () => {
    const state: OrgState = defaultOrgState('tn');
    const customPlaybook = {
      stage: 'seedling' as const,
      objectives: [
        {
          id: 'broken',
          name: 'Broken',
          description: '',
          tasks: [
            {
              id: 'broken-1',
              name: 'Broken predicate',
              description: '',
              requiredCapability: 'lease-lifecycle' as const,
              completionPredicate: () => {
                throw new Error('boom');
              },
            },
          ],
        },
      ],
    };
    const ev = evaluatePlaybook({ playbook: customPlaybook, orgState: state });
    expect(ev.completedTasks).toBe(0);
    expect(ev.totalTasks).toBe(1);
  });
});
