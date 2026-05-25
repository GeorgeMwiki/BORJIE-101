/**
 * Dynamic Section Manager — progressive form sections.
 *
 * Unlocks sections as context fills. Section N unlocks when all its
 * prerequisite sections are at least X% complete.
 *
 * Default gating: each section unlocks when the previous section is ≥80%
 * complete. Config adjusts per-section.
 *
 * @module progressive-intelligence/dynamic-section-manager
 */

import type { ReadinessReport } from './types.js';
import type { SectionId } from './field-mappings.js';

export interface SectionGate {
  readonly sectionId: SectionId;
  readonly prerequisites: readonly SectionId[];
  readonly unlockAtPct: number;
}

export const DEFAULT_SECTION_GATES: readonly SectionGate[] = Object.freeze([
  { sectionId: 'property', prerequisites: [], unlockAtPct: 0 },
  { sectionId: 'tenantProfile', prerequisites: ['property'], unlockAtPct: 80 },
  {
    sectionId: 'leaseTerms',
    prerequisites: ['property', 'tenantProfile'],
    unlockAtPct: 80,
  },
  {
    sectionId: 'maintenanceCase',
    prerequisites: ['property'],
    unlockAtPct: 50,
  },
  {
    sectionId: 'migrationBatch',
    prerequisites: [],
    unlockAtPct: 0,
  },
  {
    sectionId: 'renewalProposal',
    prerequisites: ['leaseTerms'],
    unlockAtPct: 80,
  },
  {
    sectionId: 'complianceNotice',
    prerequisites: ['tenantProfile', 'leaseTerms'],
    unlockAtPct: 80,
  },
]);

export interface UnlockState {
  readonly sectionId: SectionId;
  readonly unlocked: boolean;
  readonly reasonLocked?: string;
}

export class DynamicSectionManager {
  constructor(
    private readonly gates: readonly SectionGate[] = DEFAULT_SECTION_GATES,
  ) {}

  computeUnlocks(readiness: ReadinessReport): readonly UnlockState[] {
    const bySection = new Map<string, number>();
    for (const s of readiness.sections) {
      bySection.set(s.sectionId, s.completionPct);
    }

    return this.gates.map((gate) => {
      if (gate.prerequisites.length === 0) {
        return { sectionId: gate.sectionId, unlocked: true };
      }
      const unmet = gate.prerequisites.filter(
        (p) => (bySection.get(p) ?? 0) < gate.unlockAtPct,
      );
      if (unmet.length === 0) {
        return { sectionId: gate.sectionId, unlocked: true };
      }
      return {
        sectionId: gate.sectionId,
        unlocked: false,
        reasonLocked: `Requires ${unmet.join(', ')} ≥ ${gate.unlockAtPct}%`,
      };
    });
  }

  isUnlocked(sectionId: SectionId, readiness: ReadinessReport): boolean {
    const states = this.computeUnlocks(readiness);
    return states.find((s) => s.sectionId === sectionId)?.unlocked ?? false;
  }
}

export function createDynamicSectionManager(
  gates?: readonly SectionGate[],
): DynamicSectionManager {
  return new DynamicSectionManager(gates);
}
