/**
 * checkpoint-questions — build REAL, content-grounded mastery questions from
 * the mining concept catalog. Backs the mastery-checkpoint surface (owner-web
 * /training/checkpoint) and its api-gateway route.
 *
 * For each resolvable concept the correct answer is the concept's own
 * "define / recognize" statement (its catalog `summary`); distractors are the
 * summaries of SIBLING concepts in the same category, falling back to the
 * wider catalog. Option order is deterministic per concept (seeded hash) so
 * it does not flicker between renders and is reproducible across server +
 * client. Concept ids that do not resolve are skipped — NO placeholder is
 * ever fabricated.
 *
 * Ported from the BossNyumba checkpoint-question builder against the shared
 * `Concept` shape (titleEn/titleSw + summaryEn/summarySw + category) — see
 * concepts-catalog.ts. Retargeted real-estate -> mining via the catalog only;
 * this builder is domain-agnostic.
 */

import {
  getConcept,
  conceptsByCategory,
  ESTATE_CONCEPTS,
  type Concept,
} from './concepts-catalog.js';

export const DISTRACTORS_PER_QUESTION = 3;

export type CheckpointLanguage = 'en' | 'sw';

export interface CheckpointOption {
  readonly id: string;
  readonly label: string;
  readonly isCorrect: boolean;
}

export interface CheckpointQuestion {
  readonly id: string;
  readonly conceptId: string;
  readonly prompt: string;
  readonly options: readonly CheckpointOption[];
}

/** Deterministic small hash so option order is stable per concept (no flicker). */
function seedFrom(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) % 1_000_000_007;
  }
  return h;
}

/** The real "define / recognize" statement for a concept, by language. */
function definitionFor(concept: Concept, language: CheckpointLanguage): string {
  if (language === 'sw') {
    return concept.summarySw || concept.summaryEn;
  }
  return concept.summaryEn;
}

function nameFor(concept: Concept, language: CheckpointLanguage): string {
  return language === 'sw' ? concept.titleSw || concept.titleEn : concept.titleEn;
}

function promptFor(name: string, language: CheckpointLanguage): string {
  return language === 'sw'
    ? `Ni kauli ipi inayoeleza vyema "${name}"?`
    : `Which statement best describes "${name}"?`;
}

/**
 * Collect distractor statements for one concept: same-category sibling
 * concepts first, then the wider catalog. Deduped, never equal to the correct
 * statement.
 */
function buildDistractors(
  concept: Concept,
  siblings: readonly Concept[],
  correct: string,
  language: CheckpointLanguage,
): readonly string[] {
  const pool: string[] = [];
  const seen = new Set<string>([correct]);
  const pushUnique = (text: string | undefined): void => {
    if (!text) return;
    if (seen.has(text)) return;
    seen.add(text);
    pool.push(text);
  };

  for (const sibling of siblings) {
    if (sibling.id === concept.id) continue;
    pushUnique(definitionFor(sibling, language));
  }
  if (pool.length < DISTRACTORS_PER_QUESTION) {
    for (const other of ESTATE_CONCEPTS) {
      if (other.id === concept.id) continue;
      if (pool.length >= DISTRACTORS_PER_QUESTION * 2) break;
      pushUnique(definitionFor(other, language));
    }
  }

  return pool.slice(0, DISTRACTORS_PER_QUESTION);
}

function toQuestion(
  concept: Concept,
  language: CheckpointLanguage,
): CheckpointQuestion {
  const correct = definitionFor(concept, language);
  const siblings = conceptsByCategory(concept.category);
  const distractors = buildDistractors(concept, siblings, correct, language);

  // Deterministic placement of the correct option among the distractors.
  const seed = seedFrom(concept.id);
  const correctIndex = distractors.length ? seed % (distractors.length + 1) : 0;
  const labels: string[] = [...distractors];
  labels.splice(correctIndex, 0, correct);

  return {
    id: `${concept.id}-q`,
    conceptId: concept.id,
    prompt: promptFor(nameFor(concept, language), language),
    options: labels.map((label, i) => ({
      id: `${concept.id}-o${i}`,
      label,
      isCorrect: label === correct,
    })),
  };
}

/**
 * Build one real checkpoint question per resolvable concept id. Concept ids
 * that do not resolve in the catalog are skipped (no placeholder is
 * fabricated for them). Returns [] when nothing resolves so the surface can
 * honest-degrade to an empty state.
 */
export function buildCheckpointQuestions(
  conceptIds: readonly string[],
  language: CheckpointLanguage,
): readonly CheckpointQuestion[] {
  const concepts = conceptIds
    .map((id) => getConcept(id))
    .filter((c): c is Concept => Boolean(c));

  return concepts.map((concept) => toQuestion(concept, language));
}
