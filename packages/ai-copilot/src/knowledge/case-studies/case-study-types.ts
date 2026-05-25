/**
 * Case-study shape shared by every longform HBR-quality case Mr. Mwikila
 * uses as a teaching vehicle.
 *
 * Each case study is a self-contained teaching asset: a narrative to set
 * the scene, a data table the learner can actually read numbers from,
 * a decision question to center the discussion, a Socratic path of
 * graduated questions, an activity to force commitment, and an optional
 * quantitative deep-dive for learners ready to go past Apply level.
 *
 * Cases are seeded into the knowledge store with kind='case_study' and
 * pedagogicalDepth='longform'. Because the existing KnowledgeKind schema
 * (knowledge-store.ts) does not yet include 'case_study', we ingest using
 * kind='knowledge_base' plus metadata.kind='case_study' and
 * metadata.pedagogicalDepth='longform'. This preserves backwards
 * compatibility while surfacing case studies to the Professor retriever.
 */

import type { BloomLevel } from '../../personas/sub-personas/pedagogy-standards.js';

export interface CaseStudyDataRow {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}

export interface CaseStudyDataTable {
  readonly title: string;
  readonly rows: readonly CaseStudyDataRow[];
}

export interface SocraticStep {
  readonly bloomLevel: BloomLevel;
  readonly question: string;
  readonly hint?: string;
  readonly idealAnswerSketch?: string;
}

export interface CaseStudyActivity {
  readonly prompt: string;
  readonly deliverable: string;
  readonly timeBoxMinutes: number;
}

export interface QuantitativeDeepDive {
  readonly title: string;
  readonly setup: string;
  readonly expectedAnswer: string;
  readonly solutionSketch: string;
}

export type Country = 'KE' | 'TZ' | 'BOTH';

export interface CaseStudy {
  readonly id: string;
  readonly title: string;
  readonly wordCount: number;
  readonly country: Country;
  readonly tags: readonly string[];
  readonly difficulty: 'intermediate' | 'advanced' | 'expert';
  readonly narrative: string;
  readonly dataTable: CaseStudyDataTable;
  readonly decisionQuestion: string;
  readonly socraticPath: readonly SocraticStep[];
  readonly activity: CaseStudyActivity;
  readonly quantitativeDeepDive?: QuantitativeDeepDive;
  readonly discussionQuestions: readonly string[];
}

export const CASE_STUDY_METADATA_KIND = 'case_study' as const;
export const CASE_STUDY_PEDAGOGICAL_DEPTH = 'longform' as const;

/**
 * Small helper so each case-study file can `as const satisfies CaseStudy`
 * without losing narrowness on tags / difficulty.
 */
export function defineCaseStudy<T extends CaseStudy>(c: T): T {
  return c;
}
