/**
 * Longform case studies — HBR-quality mining-estate teaching vehicles.
 *
 * Ten cases spanning licence acquisitions, cooperative royalty/levy
 * disputes, licence-overlap and land-use flips, royalty-and-receivables
 * arrears cadence, anchor off-take negotiation, equipment-tender fraud,
 * artisanal incursion and access, gold-room/weighbridge fraud, wash-plant
 * upgrade vs divest, and the first-90-days post-mine-acquisition playbook.
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

import { CASE_STUDY_01_GEITA_LICENCE_ACQUISITION } from './01-geita-licence-portfolio-acquisition.js';
import { CASE_STUDY_02_COOPERATIVE_LEVY_DISPUTE } from './02-cooperative-royalty-levy-dispute.js';
import { CASE_STUDY_03_LICENCE_OVERLAP_FLIP } from './03-licence-overlap-and-land-use-flip.js';
import { CASE_STUDY_04_ROYALTY_ARREARS_CLIFF } from './04-royalty-arrears-cliff.js';
import { CASE_STUDY_05_ANCHOR_OFFTAKE_RENEWAL } from './05-anchor-offtake-renewal.js';
import { CASE_STUDY_06_EQUIPMENT_TENDER_MANIPULATION } from './06-equipment-tender-manipulation.js';
import { CASE_STUDY_07_ARTISANAL_INCURSION } from './07-artisanal-incursion-and-access.js';
import { CASE_STUDY_08_GOLD_ROOM_FRAUD } from './08-weighbridge-and-gold-room-fraud.js';
import { CASE_STUDY_09_WASHPLANT_UPGRADE_DIVEST } from './09-washplant-upgrade-or-divest.js';
import { CASE_STUDY_10_FIRST_90_DAYS } from './10-first-90-days-post-mine-acquisition.js';
import { logger } from '../../logger.js';

export * from './case-study-types.js';
export { CASE_STUDY_01_GEITA_LICENCE_ACQUISITION } from './01-geita-licence-portfolio-acquisition.js';
export { CASE_STUDY_02_COOPERATIVE_LEVY_DISPUTE } from './02-cooperative-royalty-levy-dispute.js';
export { CASE_STUDY_03_LICENCE_OVERLAP_FLIP } from './03-licence-overlap-and-land-use-flip.js';
export { CASE_STUDY_04_ROYALTY_ARREARS_CLIFF } from './04-royalty-arrears-cliff.js';
export { CASE_STUDY_05_ANCHOR_OFFTAKE_RENEWAL } from './05-anchor-offtake-renewal.js';
export { CASE_STUDY_06_EQUIPMENT_TENDER_MANIPULATION } from './06-equipment-tender-manipulation.js';
export { CASE_STUDY_07_ARTISANAL_INCURSION } from './07-artisanal-incursion-and-access.js';
export { CASE_STUDY_08_GOLD_ROOM_FRAUD } from './08-weighbridge-and-gold-room-fraud.js';
export { CASE_STUDY_09_WASHPLANT_UPGRADE_DIVEST } from './09-washplant-upgrade-or-divest.js';
export { CASE_STUDY_10_FIRST_90_DAYS } from './10-first-90-days-post-mine-acquisition.js';

export const ALL_CASE_STUDIES: readonly CaseStudy[] = Object.freeze([
  CASE_STUDY_01_GEITA_LICENCE_ACQUISITION,
  CASE_STUDY_02_COOPERATIVE_LEVY_DISPUTE,
  CASE_STUDY_03_LICENCE_OVERLAP_FLIP,
  CASE_STUDY_04_ROYALTY_ARREARS_CLIFF,
  CASE_STUDY_05_ANCHOR_OFFTAKE_RENEWAL,
  CASE_STUDY_06_EQUIPMENT_TENDER_MANIPULATION,
  CASE_STUDY_07_ARTISANAL_INCURSION,
  CASE_STUDY_08_GOLD_ROOM_FRAUD,
  CASE_STUDY_09_WASHPLANT_UPGRADE_DIVEST,
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
