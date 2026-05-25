/**
 * TrainingGenerator — turns a natural-language admin brief into a typed,
 * sequenced TrainingPath.
 *
 * Mr. Mwikila (Professor sub-persona) drives the generation: the provider
 * produces the concept sequence, minute estimates, Socratic prompts,
 * scenarios, and checkpoint questions. A fallback deterministic sequencer
 * runs when no LLM is available (tests, degraded mode) so the generator is
 * always usable.
 *
 * Idempotent by (tenantId, topic, audience) — the upsert in the path
 * repository guarantees re-running produces the same logical path row.
 */

import { ESTATE_CONCEPTS, type Concept } from '../classroom/concepts-catalog.js';
import { PROFESSOR_PROMPT_LAYER } from '../personas/sub-personas/professor-persona.js';
import type {
  GenerateTrainingPathOpts,
  TrainingPath,
  TrainingPathStep,
  TrainingStepContent,
  TrainingStepKind,
} from './training-types.js';

export interface LLMLike {
  complete(prompt: string): Promise<string>;
}

export interface TrainingGeneratorDeps {
  readonly llm?: LLMLike | null;
  readonly concepts?: readonly Concept[];
  readonly now?: () => Date;
  readonly idFactory?: (prefix: string) => string;
}

function defaultId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

function scoreConcept(concept: Concept, topic: string): number {
  const needle = topic.toLowerCase();
  const hay = `${concept.id} ${concept.titleEn} ${concept.summaryEn} ${concept.category}`.toLowerCase();
  const tokens = needle.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (tokens.length === 0) return 0;
  return tokens.reduce((acc, t) => (hay.includes(t) ? acc + 1 : acc), 0);
}

function orderByPrerequisites(selected: readonly Concept[]): readonly Concept[] {
  const visited = new Set<string>();
  const ordered: Concept[] = [];
  const index = new Map(selected.map((c) => [c.id, c]));

  function visit(c: Concept): void {
    if (visited.has(c.id)) return;
    visited.add(c.id);
    for (const pid of c.prerequisites) {
      const p = index.get(pid);
      if (p) visit(p);
    }
    ordered.push(c);
  }

  for (const c of selected) visit(c);
  return ordered;
}

function pickConceptsForTopic(
  topic: string,
  audience: string,
  concepts: readonly Concept[],
  priorMastery?: Readonly<Record<string, number>>,
  maxCount = 6
): readonly Concept[] {
  const audienceBias: Record<string, string> = {
    'station-masters': 'operations',
    'estate-officers': 'financial',
    caretakers: 'maintenance',
    accountants: 'financial',
    owners: 'financial',
    tenants: 'tenancy',
    custom: '',
  };
  const bias = audienceBias[audience] ?? '';
  const scored = concepts
    .map((c) => {
      let score = scoreConcept(c, topic);
      if (bias && c.category === bias) score += 1;
      const mastery = priorMastery?.[c.id] ?? 0;
      if (mastery >= 0.8) score -= 2; // already mastered — deprioritise
      return { c, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const chosen =
    scored.length > 0
      ? scored.slice(0, maxCount).map((x) => x.c)
      : concepts.slice(0, Math.min(maxCount, 3));

  return orderByPrerequisites(chosen);
}

function deriveTitle(topic: string, audience: string): string {
  const cleaned = topic.trim().replace(/\s+/g, ' ');
  const humanAudience = audience.replace(/-/g, ' ');
  return `${cleaned} — for ${humanAudience}`;
}

function stepKindForOrder(orderIndex: number, totalSteps: number): TrainingStepKind {
  if (orderIndex === 0) return 'lesson';
  if (orderIndex === totalSteps - 1) return 'reflection';
  const cycle: readonly TrainingStepKind[] = ['scenario', 'quiz', 'roleplay', 'lesson'];
  return cycle[orderIndex % cycle.length] ?? 'lesson';
}

function deterministicStepContent(
  concept: Concept,
  language: string
): TrainingStepContent {
  const useSw = language === 'sw';
  const useBoth = language === 'both';

  const prompts = useSw
    ? [
        `Habari rafiki — tujifunze kuhusu ${concept.titleSw}. Unafahamu nini kuhusu hii?`,
        `Ni hali gani ulishaiona ambayo inahusiana na ${concept.titleSw}?`,
        `Ukifikiri jengo la Kilimani — hili dhana lingeathiri vipi kazi yako?`,
      ]
    : [
        `Let's explore ${concept.titleEn}. What do you already know about it?`,
        `Can you recall a situation where ${concept.titleEn} came up in your work?`,
        `Imagine a 40-unit block in Kilimani — how would this concept shape your actions there?`,
      ];

  if (useBoth) {
    prompts.push(`In Swahili: ${concept.titleSw} — eleza kwa maneno yako.`);
  }

  return {
    socraticPrompts: prompts,
    scenario: useSw
      ? `Fikiri kuhusu hali ya kweli: ${concept.summarySw}. Mpangilio wako ni upi?`
      : `Imagine a real-world case: ${concept.summaryEn}. What would your plan be?`,
    handoutMarkdown: `# ${concept.titleEn}\n\n${concept.summaryEn}\n\n- Category: ${concept.category}\n- Difficulty: ${concept.difficulty}`,
    checkpointQuestion: useSw
      ? `Eleza kwa ufupi ${concept.titleSw} na kwa nini ni muhimu.`
      : `In your own words, explain ${concept.titleEn} and why it matters.`,
    expectedAnswer: concept.summaryEn,
  };
}

async function llmEnrichContent(
  llm: LLMLike,
  concept: Concept,
  topic: string,
  audience: string,
  language: string,
  baseContent: TrainingStepContent
): Promise<TrainingStepContent> {
  const prompt = `${PROFESSOR_PROMPT_LAYER}

TASK: You are generating training content for an estate-management employee.

Topic requested by admin: ${topic}
Audience: ${audience}
Preferred language: ${language}

Produce a JSON object ONLY (no prose) with keys:
{
  "prompts": ["...","...","..."],  // exactly 3 Socratic prompts
  "scenario": "...",               // 1-paragraph Tanzanian/Kenyan scenario
  "checkpoint": "...",             // one checkpoint question testing the concept
  "expected": "..."                // 1-2 sentence ideal answer
}

Concept being taught: ${concept.titleEn} (id: ${concept.id})
Concept summary: ${concept.summaryEn}`;

  try {
    const raw = await llm.complete(prompt);
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < 0) return baseContent;
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      prompts?: unknown;
      scenario?: unknown;
      checkpoint?: unknown;
      expected?: unknown;
    };
    const prompts = Array.isArray(parsed.prompts)
      ? (parsed.prompts.filter((p) => typeof p === 'string' && p.length > 0) as string[])
      : baseContent.socraticPrompts.slice();
    return {
      socraticPrompts: prompts.length > 0 ? prompts : baseContent.socraticPrompts,
      scenario: typeof parsed.scenario === 'string' ? parsed.scenario : baseContent.scenario,
      handoutMarkdown: baseContent.handoutMarkdown,
      checkpointQuestion:
        typeof parsed.checkpoint === 'string' ? parsed.checkpoint : baseContent.checkpointQuestion,
      expectedAnswer:
        typeof parsed.expected === 'string' ? parsed.expected : baseContent.expectedAnswer,
    };
  } catch {
    return baseContent;
  }
}

export class TrainingGenerator {
  private readonly llm: LLMLike | null;
  private readonly concepts: readonly Concept[];
  private readonly now: () => Date;
  private readonly idFactory: (prefix: string) => string;

  constructor(deps: TrainingGeneratorDeps = {}) {
    this.llm = deps.llm ?? null;
    this.concepts = deps.concepts ?? ESTATE_CONCEPTS;
    this.now = deps.now ?? (() => new Date());
    this.idFactory = deps.idFactory ?? defaultId;
  }

  async generateTrainingPath(
    opts: GenerateTrainingPathOpts
  ): Promise<TrainingPath> {
    this.validate(opts);

    const durationMinutes = Math.max(15, Math.round(opts.durationHours * 60));
    const selected = pickConceptsForTopic(
      opts.topic,
      opts.audience,
      this.concepts,
      opts.priorMastery,
      Math.min(8, Math.max(3, Math.round(opts.durationHours * 2)))
    );

    if (selected.length === 0) {
      throw new Error(`No concepts matched topic "${opts.topic}"`);
    }

    const perStepMinutes = Math.max(
      5,
      Math.floor(durationMinutes / selected.length)
    );

    const pathId = this.idFactory('tpath');
    const nowIso = this.now().toISOString();

    const steps: TrainingPathStep[] = [];
    for (let i = 0; i < selected.length; i++) {
      const concept = selected[i];
      const base = deterministicStepContent(concept, opts.language);
      const content = this.llm
        ? await llmEnrichContent(
            this.llm,
            concept,
            opts.topic,
            opts.audience,
            opts.language,
            base
          )
        : base;
      steps.push({
        id: this.idFactory('tstep'),
        pathId,
        orderIndex: i,
        conceptId: concept.id,
        kind: stepKindForOrder(i, selected.length),
        title: concept.titleEn,
        content,
        masteryThreshold: 0.8,
        estimatedMinutes: perStepMinutes,
      });
    }

    const summary = this.buildSummary(opts, selected);

    return {
      id: pathId,
      tenantId: opts.tenantId,
      title: deriveTitle(opts.topic, opts.audience),
      topic: opts.topic.trim(),
      audience: opts.audience,
      language: opts.language,
      durationMinutes,
      conceptIds: selected.map((c) => c.id),
      summary,
      generatedBy: opts.createdBy,
      steps,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    };
  }

  private validate(opts: GenerateTrainingPathOpts): void {
    if (!opts.tenantId || opts.tenantId.trim().length === 0) {
      throw new Error('tenantId is required');
    }
    if (!opts.createdBy || opts.createdBy.trim().length === 0) {
      throw new Error('createdBy is required');
    }
    if (!opts.topic || opts.topic.trim().length === 0) {
      throw new Error('topic is required');
    }
    if (!Number.isFinite(opts.durationHours) || opts.durationHours <= 0) {
      throw new Error('durationHours must be > 0');
    }
    if (opts.durationHours > 40) {
      throw new Error('durationHours cannot exceed 40');
    }
  }

  private buildSummary(
    opts: GenerateTrainingPathOpts,
    selected: readonly Concept[]
  ): string {
    const audience = opts.audience.replace(/-/g, ' ');
    const concepts = selected.map((c) => c.titleEn).join(', ');
    return `Training for ${audience} on ${opts.topic.trim()}. Covers: ${concepts}.`;
  }
}

export function createTrainingGenerator(
  deps: TrainingGeneratorDeps = {}
): TrainingGenerator {
  return new TrainingGenerator(deps);
}
