/**
 * Question orchestrator (Wave 11).
 *
 * Uses the Professor sub-persona (from the personas subtree) to generate
 * questions for a given concept at a specified difficulty + Bloom level.
 *
 * Stays provider-agnostic — the caller injects an `AskProfessorFn` so this
 * module can run against any LLM path (Anthropic client, multi-LLM router,
 * mocked provider in tests).
 */

import type { Concept } from './concepts-catalog.js';
import { getConcept } from './concepts-catalog.js';

export type QuizDifficulty = 'easy' | 'medium' | 'hard';

export type BloomLevel =
  | 'remember'
  | 'understand'
  | 'apply'
  | 'analyze'
  | 'evaluate'
  | 'create';

export interface GenerateQuestionRequest {
  readonly concept: Concept;
  readonly difficulty: QuizDifficulty;
  readonly bloomLevel: BloomLevel;
  readonly language: 'en' | 'sw' | 'mixed';
  readonly learnerId: string;
}

export interface GeneratedQuestion {
  readonly id: string;
  readonly conceptId: string;
  readonly questionText: string;
  readonly choices?: readonly string[] | undefined;
  readonly correctIndex?: number | undefined;
  readonly rationale: string;
  readonly difficulty: QuizDifficulty;
  readonly bloomLevel: BloomLevel;
  readonly language: 'en' | 'sw' | 'mixed';
}

/** Function the orchestrator uses to invoke the Professor. */
export type AskProfessorFn = (prompt: {
  systemPrompt: string;
  userPrompt: string;
  language: 'en' | 'sw' | 'mixed';
}) => Promise<string>;

export interface OrchestratorConfig {
  readonly ask: AskProfessorFn;
  readonly idGenerator?: () => string;
}

export function createQuestionOrchestrator(config: OrchestratorConfig) {
  const genId =
    config.idGenerator ?? (() => `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

  async function generateQuestion(
    req: GenerateQuestionRequest
  ): Promise<GeneratedQuestion> {
    const systemPrompt = professorSystemPrompt(req.language);
    const userPrompt = buildPrompt(req);
    const raw = await config.ask({
      systemPrompt,
      userPrompt,
      language: req.language,
    });
    return parseQuestion(raw, req, genId());
  }

  async function generateQuestionForConcept(params: {
    readonly conceptId: string;
    readonly difficulty: QuizDifficulty;
    readonly bloomLevel: BloomLevel;
    readonly language: 'en' | 'sw' | 'mixed';
    readonly learnerId: string;
  }): Promise<GeneratedQuestion> {
    const c = getConcept(params.conceptId);
    if (!c) throw new Error(`Unknown concept: ${params.conceptId}`);
    return generateQuestion({ ...params, concept: c });
  }

  return { generateQuestion, generateQuestionForConcept };
}

export function pickBloomForPKnow(
  pKnow: number,
  conceptBloomLevels: readonly BloomLevel[]
): BloomLevel {
  // If concept doesn't specify, fall back to a reasonable default.
  const fallback: readonly BloomLevel[] = ['remember', 'understand', 'apply'];
  const available: readonly BloomLevel[] = conceptBloomLevels.length
    ? conceptBloomLevels
    : fallback;
  let target: BloomLevel = 'remember';
  if (pKnow >= 0.85) target = 'evaluate';
  else if (pKnow >= 0.6) target = 'analyze';
  else if (pKnow >= 0.4) target = 'apply';
  else if (pKnow >= 0.2) target = 'understand';
  if (available.includes(target)) return target;
  return available[available.length - 1] ?? 'remember';
}

export function pickDifficultyForPKnow(pKnow: number): QuizDifficulty {
  if (pKnow >= 0.7) return 'hard';
  if (pKnow >= 0.35) return 'medium';
  return 'easy';
}

function professorSystemPrompt(language: 'en' | 'sw' | 'mixed'): string {
  const langHint =
    language === 'sw'
      ? 'Write ONLY in Kiswahili.'
      : language === 'mixed'
        ? 'Write mostly in English but include Swahili for estate-management terms in parentheses.'
        : 'Write in clear, professional English.';
  return [
    'You are the AI Professor for BORJIE — a senior tutor training property-management staff.',
    'Your task: produce exactly ONE quiz question in strict JSON, no prose, no markdown fences.',
    langHint,
    'Keep questions practical and grounded in property operations, tenancy law, compliance, maintenance, or financial workflows.',
  ].join(' ');
}

function buildPrompt(req: GenerateQuestionRequest): string {
  return [
    `Concept: ${req.concept.titleEn} (${req.concept.titleSw}).`,
    `Summary: ${req.concept.summaryEn}`,
    `Difficulty: ${req.difficulty}. Bloom level: ${req.bloomLevel}.`,
    'Return JSON shaped as:',
    '{"questionText": string, "choices": [string, string, string, string], "correctIndex": 0-3, "rationale": string}',
    'The rationale should explain the correct answer briefly (1-2 sentences).',
  ].join('\n');
}

function parseQuestion(
  raw: string,
  req: GenerateQuestionRequest,
  id: string
): GeneratedQuestion {
  const cleaned = stripFences(raw).trim();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // fall back to a plain text question when model produces prose
    return {
      id,
      conceptId: req.concept.id,
      questionText: cleaned.slice(0, 1000),
      rationale: '',
      difficulty: req.difficulty,
      bloomLevel: req.bloomLevel,
      language: req.language,
    };
  }
  const questionText = String(parsed.questionText ?? '').trim();
  const choicesRaw = Array.isArray(parsed.choices)
    ? (parsed.choices as unknown[]).map((c) => String(c))
    : undefined;
  const correctIndex =
    typeof parsed.correctIndex === 'number'
      ? parsed.correctIndex
      : undefined;
  const rationale = String(parsed.rationale ?? '');
  return {
    id,
    conceptId: req.concept.id,
    questionText: questionText || 'Please restate the key point of this concept.',
    choices: choicesRaw,
    correctIndex,
    rationale,
    difficulty: req.difficulty,
    bloomLevel: req.bloomLevel,
    language: req.language,
  };
}

function stripFences(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return m ? (m[1] ?? '') : raw;
}
