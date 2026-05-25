/**
 * Longform case studies — HBR-quality estate-management teaching vehicles.
 *
 * Ten cases spanning acquisitions, service-charge disputes, zoning flips,
 * arrears cadence, anchor-tenant negotiation, tender fraud, holdover,
 * internal fraud, refurb vs divest, and first-90-days playbook.
 *
 * Each case is a pure CaseStudy value (see case-study-types.ts). The
 * `seedCaseStudies` helper ingests them into the knowledge store with
 * kind='knowledge_base' + metadata.kind='case_study' +
 * metadata.pedagogicalDepth='longform' so the Professor retriever can
 * surface them at Apply/Analyze/Evaluate moments.
 */

import type { KnowledgeStore } from '../knowledge-store.js';
import {
  CASE_STUDY_METADATA_KIND,
  CASE_STUDY_PEDAGOGICAL_DEPTH,
  type CaseStudy,
} from './case-study-types.js';

import { CASE_STUDY_01_MUTHAIGA_ACQUISITION } from './01-muthaiga-portfolio-acquisition.js';
import { CASE_STUDY_02_KINONDONI_SERVICE_CHARGE } from './02-kinondoni-service-charge-dispute.js';
import { CASE_STUDY_03_MIXED_USE_FLIP } from './03-nairobi-mixed-use-zoning-flip.js';
import { CASE_STUDY_04_ARREARS_CLIFF } from './04-arrears-cliff.js';
import { CASE_STUDY_05_ANCHOR_RENEWAL } from './05-anchor-tenant-renewal.js';
import { CASE_STUDY_06_TENDER_MANIPULATION } from './06-tender-manipulation.js';
import { CASE_STUDY_07_HOLDOVER_DRAMA } from './07-holdover-drama.js';
import { CASE_STUDY_08_CARETAKER_FRAUD } from './08-caretaker-internal-fraud.js';
import { CASE_STUDY_09_DAR_REFURB_DIVEST } from './09-dar-block-refurb-or-divest.js';
import { CASE_STUDY_10_FIRST_90_DAYS } from './10-first-90-days-post-acquisition.js';
import { logger } from '../../logger.js';

export * from './case-study-types.js';
export { CASE_STUDY_01_MUTHAIGA_ACQUISITION } from './01-muthaiga-portfolio-acquisition.js';
export { CASE_STUDY_02_KINONDONI_SERVICE_CHARGE } from './02-kinondoni-service-charge-dispute.js';
export { CASE_STUDY_03_MIXED_USE_FLIP } from './03-nairobi-mixed-use-zoning-flip.js';
export { CASE_STUDY_04_ARREARS_CLIFF } from './04-arrears-cliff.js';
export { CASE_STUDY_05_ANCHOR_RENEWAL } from './05-anchor-tenant-renewal.js';
export { CASE_STUDY_06_TENDER_MANIPULATION } from './06-tender-manipulation.js';
export { CASE_STUDY_07_HOLDOVER_DRAMA } from './07-holdover-drama.js';
export { CASE_STUDY_08_CARETAKER_FRAUD } from './08-caretaker-internal-fraud.js';
export { CASE_STUDY_09_DAR_REFURB_DIVEST } from './09-dar-block-refurb-or-divest.js';
export { CASE_STUDY_10_FIRST_90_DAYS } from './10-first-90-days-post-acquisition.js';

export const ALL_CASE_STUDIES: readonly CaseStudy[] = Object.freeze([
  CASE_STUDY_01_MUTHAIGA_ACQUISITION,
  CASE_STUDY_02_KINONDONI_SERVICE_CHARGE,
  CASE_STUDY_03_MIXED_USE_FLIP,
  CASE_STUDY_04_ARREARS_CLIFF,
  CASE_STUDY_05_ANCHOR_RENEWAL,
  CASE_STUDY_06_TENDER_MANIPULATION,
  CASE_STUDY_07_HOLDOVER_DRAMA,
  CASE_STUDY_08_CARETAKER_FRAUD,
  CASE_STUDY_09_DAR_REFURB_DIVEST,
  CASE_STUDY_10_FIRST_90_DAYS,
]);

/**
 * Render a case study as a single searchable text blob for the knowledge
 * store. Pure function; no side effects.
 */
export function renderCaseStudyContent(cs: CaseStudy): string {
  const rows = cs.dataTable.rows
    .map((r) => `- ${r.label}: ${r.value}${r.note ? ` (${r.note})` : ''}`)
    .join('\n');
  const socratic = cs.socraticPath
    .map(
      (s, i) =>
        `${i + 1}. [${s.bloomLevel}] ${s.question}${
          s.idealAnswerSketch ? `\n   Ideal sketch: ${s.idealAnswerSketch}` : ''
        }`,
    )
    .join('\n');
  const discussion = cs.discussionQuestions
    .map((q, i) => `${i + 1}. ${q}`)
    .join('\n');

  const deepDive = cs.quantitativeDeepDive
    ? `\n## Quantitative deep-dive — ${cs.quantitativeDeepDive.title}\n${cs.quantitativeDeepDive.setup}\nExpected answer: ${cs.quantitativeDeepDive.expectedAnswer}\nSolution: ${cs.quantitativeDeepDive.solutionSketch}`
    : '';

  return `# ${cs.title}

${cs.narrative}

## Data
${rows}

## Decision question
${cs.decisionQuestion}

## Socratic path
${socratic}

## Activity
${cs.activity.prompt}
Deliverable: ${cs.activity.deliverable}
Time: ${cs.activity.timeBoxMinutes} min
${deepDive}

## Discussion questions
${discussion}
`;
}

/**
 * Seed all case studies into a tenant-scoped knowledge store. Idempotent
 * per run (each call creates fresh chunk ids via the store's upsert).
 */
export async function seedCaseStudies(
  store: KnowledgeStore,
  tenantId: string,
): Promise<number> {
  if (!tenantId) {
    throw new Error('seedCaseStudies: tenantId is required');
  }
  let count = 0;
  for (const cs of ALL_CASE_STUDIES) {
    try {
      await store.upsert({
        tenantId,
        knowledgeSource: 'borjie-case-studies',
        sourceId: cs.id,
        kind: 'knowledge_base',
        title: cs.title,
        chunkIndex: 0,
        content: renderCaseStudyContent(cs),
        tags: [
          ...cs.tags,
          cs.difficulty,
          cs.country === 'BOTH' ? 'east-african' : cs.country.toLowerCase(),
          CASE_STUDY_METADATA_KIND,
          CASE_STUDY_PEDAGOGICAL_DEPTH,
        ],
        metadata: {
          kind: CASE_STUDY_METADATA_KIND,
          pedagogicalDepth: CASE_STUDY_PEDAGOGICAL_DEPTH,
          caseId: cs.id,
          wordCount: cs.wordCount,
          country: cs.country,
          difficulty: cs.difficulty,
        },
        countryCode: cs.country === 'TZ' ? 'TZ' : cs.country === 'KE' ? 'KE' : undefined,
      });
      count += 1;
    } catch (error) {
      logger.error(`seedCaseStudies: failed on ${cs.id}`, { error: error });
      throw new Error(
        `Failed to seed case study ${cs.id}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
  return count;
}
