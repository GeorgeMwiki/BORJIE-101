/**
 * Curriculum Builder — assembles a dynamic curriculum for a user.
 *
 * Inputs:
 *   - user's role (owner, tenant, estate-officer, admin, station-master)
 *   - portfolio context (e.g. size, countries, has-arrears-cases)
 *   - concepts-catalog from ai-copilot/classroom
 *
 * Output: ordered list of concept IDs the user should study next.
 * Purely deterministic. Caller persists + revisits weekly.
 */

import { ESTATE_CONCEPTS, type Concept } from '../classroom/concepts-catalog.js';

export type CurriculumRole =
  | 'owner'
  | 'tenant'
  | 'estate-officer'
  | 'admin'
  | 'station-master';

export interface PortfolioContext {
  readonly tenantId: string;
  readonly countries: readonly string[];
  readonly unitCount: number;
  readonly hasActiveArrears: boolean;
  readonly hasActiveMaintenance: boolean;
  readonly managesVendors: boolean;
}

export interface CurriculumItem {
  readonly conceptId: string;
  readonly priority: number;
  readonly reason: string;
}

export interface Curriculum {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: CurriculumRole;
  readonly items: readonly CurriculumItem[];
  readonly builtAt: string;
}

const ROLE_CATEGORY_WEIGHT: Readonly<
  Record<CurriculumRole, Readonly<Record<Concept['category'], number>>>
> = {
  owner: {
    financial: 1.0,
    tenancy: 0.8,
    compliance: 0.7,
    maintenance: 0.3,
    operations: 0.4,
    strategy: 1.0,
  },
  tenant: {
    financial: 0.5,
    tenancy: 1.0,
    compliance: 0.2,
    maintenance: 0.1,
    operations: 0.1,
    strategy: 0.1,
  },
  'estate-officer': {
    financial: 0.6,
    tenancy: 0.8,
    compliance: 0.8,
    maintenance: 1.0,
    operations: 1.0,
    strategy: 0.5,
  },
  admin: {
    financial: 1.0,
    tenancy: 1.0,
    compliance: 1.0,
    maintenance: 0.9,
    operations: 1.0,
    strategy: 1.0,
  },
  'station-master': {
    financial: 0.7,
    tenancy: 0.9,
    compliance: 0.6,
    maintenance: 0.9,
    operations: 1.0,
    strategy: 0.3,
  },
};

function scoreConcept(
  concept: Concept,
  role: CurriculumRole,
  context: PortfolioContext,
  knownMastery: ReadonlyMap<string, number>,
): number {
  const weights = ROLE_CATEGORY_WEIGHT[role];
  let score = weights[concept.category] ?? 0;
  const mastery = knownMastery.get(concept.id) ?? 0;
  score *= 1 - mastery;
  if (concept.difficulty === 'beginner') score *= 1.1;
  if (concept.difficulty === 'advanced') score *= 0.9;
  if (context.hasActiveArrears && concept.category === 'financial') score *= 1.25;
  if (context.hasActiveMaintenance && concept.category === 'maintenance') score *= 1.25;
  if (context.managesVendors && concept.category === 'operations') score *= 1.15;
  const unmetPrereqs = concept.prerequisites.filter(
    (id) => (knownMastery.get(id) ?? 0) < 0.6,
  ).length;
  if (unmetPrereqs > 0) score *= Math.pow(0.6, unmetPrereqs);
  return score;
}

function reasonFor(
  concept: Concept,
  role: CurriculumRole,
  context: PortfolioContext,
): string {
  const parts: string[] = [];
  parts.push(`Core for ${role}`);
  if (context.hasActiveArrears && concept.category === 'financial') {
    parts.push('active arrears in portfolio');
  }
  if (context.hasActiveMaintenance && concept.category === 'maintenance') {
    parts.push('open maintenance cases');
  }
  if (concept.difficulty === 'beginner') parts.push('foundation level');
  return parts.join(', ');
}

export function buildCurriculum(input: {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: CurriculumRole;
  readonly context: PortfolioContext;
  readonly knownMastery: ReadonlyMap<string, number>;
  readonly now: string;
  readonly topN?: number;
}): Curriculum {
  const items: CurriculumItem[] = [];
  for (const concept of ESTATE_CONCEPTS) {
    const score = scoreConcept(concept, input.role, input.context, input.knownMastery);
    if (score <= 0) continue;
    items.push({
      conceptId: concept.id,
      priority: score,
      reason: reasonFor(concept, input.role, input.context),
    });
  }
  items.sort((a, b) => b.priority - a.priority);
  const topN = input.topN ?? 10;
  return {
    userId: input.userId,
    tenantId: input.tenantId,
    role: input.role,
    items: items.slice(0, topN),
    builtAt: input.now,
  };
}
