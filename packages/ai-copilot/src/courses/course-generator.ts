/**
 * CourseGenerator — turns a domain + scenario (+ optional documents) into a
 * strict, validated mining-estate course.
 *
 * HONEST-DEGRADE (CLAUDE.md hard rule, mirrors the scenario generator seam):
 *   - When an `LLMLike` port is wired, the model produces the course; its raw
 *     JSON is parsed and validated against `GeneratedCourseSchema`, with ONE
 *     stricter retry on a parse miss. On success -> `generatedVia: 'llm'`.
 *   - When NO LLM is wired, OR the model output fails validation after the
 *     retry, the generator falls back to the deterministic sequencer, which
 *     builds a REAL course from the curated mining concept catalog ->
 *     `generatedVia: 'deterministic'`.
 *
 * The generator NEVER returns silently-fabricated content: either the model's
 * validated output, or genuine catalog material arranged by the sequencer. The
 * `generatedVia` marker is surfaced to the UI so the provenance is transparent.
 *
 * This file is decoupled from any model SDK: the `LLMLike` it is handed may
 * pull the model layer, but the generator itself has no model import, so it
 * stays unit testable with a stub LLM (or none).
 *
 * Ported from the BossNyumba course generator.
 *
 * @module courses/course-generator
 */

import { buildDeterministicCourse } from './deterministic-sequencer.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt-templates.js';
import {
  GeneratedCourseSchema,
  GenerateCourseInputSchema,
  type CourseGenerationSource,
  type GeneratedCourse,
  type GenerateCourseInput,
} from './schema.js';

/** Minimal LLM port — a single-prompt completion seam. */
export interface LLMLike {
  complete(prompt: string): Promise<string>;
}

export interface CourseGeneratorDeps {
  /** When null/absent the generator runs in deterministic-only mode. */
  readonly llm?: LLMLike | null;
  /** Injectable logger seam for tests. */
  readonly logger?: {
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

export interface GenerateCourseResult {
  readonly course: GeneratedCourse;
  readonly generatedVia: CourseGenerationSource;
  readonly attempts: number;
}

/**
 * Pull the first balanced JSON object out of an LLM response. Handles ```json
 * fences and a stray sentence before/after. Returns null when none is present.
 */
function extractJsonObject(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced && fenced[1] ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse + validate one model response into a GeneratedCourse, or null. */
function parseCourse(raw: string): GeneratedCourse | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    const result = GeneratedCourseSchema.safeParse(parsed);
    // safeParse returns a widened object; the runtime shape is validated to
    // match GeneratedCourse, so the cast is sound (and we avoid z.infer).
    return result.success ? (result.data as unknown as GeneratedCourse) : null;
  } catch {
    return null;
  }
}

export class CourseGenerator {
  private readonly llm: LLMLike | null;
  private readonly logger: CourseGeneratorDeps['logger'];

  constructor(deps: CourseGeneratorDeps = {}) {
    this.llm = deps.llm ?? null;
    this.logger = deps.logger;
  }

  /**
   * Generate + validate a course. Throws ONLY on invalid input (the caller's
   * fault); generation itself always resolves because the deterministic
   * sequencer is the floor.
   */
  async generateCourse(rawInput: GenerateCourseInput): Promise<GenerateCourseResult> {
    const input = GenerateCourseInputSchema.parse(rawInput) as GenerateCourseInput;

    if (!this.llm) {
      return {
        course: buildDeterministicCourse(input),
        generatedVia: 'deterministic',
        attempts: 0,
      };
    }

    const systemPrompt = buildSystemPrompt(input.language);
    const userPrompt = buildUserPrompt(input);
    // The LLMLike port takes a single prompt; thread the system prompt in.
    const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

    try {
      const first = await this.llm.complete(fullPrompt);
      const firstCourse = parseCourse(first);
      if (firstCourse) {
        return { course: firstCourse, generatedVia: 'llm', attempts: 1 };
      }

      this.logger?.warn('course JSON invalid on first attempt; retrying', {
        domain: input.domain,
        language: input.language,
      });

      const retryPrompt =
        `${fullPrompt}\n\n---\n\n` +
        'Your previous response was not valid. Return ONLY the JSON object that ' +
        'matches the contract exactly. No prose, no code fences.';
      const retry = await this.llm.complete(retryPrompt);
      const retryCourse = parseCourse(retry);
      if (retryCourse) {
        return { course: retryCourse, generatedVia: 'llm', attempts: 2 };
      }

      // Honest-degrade: the model could not produce valid output, so fall back
      // to the deterministic catalog course rather than fabricate or fail.
      this.logger?.warn('course LLM output invalid after retry; using deterministic fallback', {
        domain: input.domain,
        language: input.language,
      });
      return {
        course: buildDeterministicCourse(input),
        generatedVia: 'deterministic',
        attempts: 2,
      };
    } catch (error) {
      this.logger?.error('course LLM generation threw; using deterministic fallback', {
        domain: input.domain,
        language: input.language,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        course: buildDeterministicCourse(input),
        generatedVia: 'deterministic',
        attempts: 1,
      };
    }
  }
}

let singleton: CourseGenerator | null = null;

/** Lazily-constructed shared generator (deterministic-only unless re-created). */
export function getCourseGenerator(deps: CourseGeneratorDeps = {}): CourseGenerator {
  if (deps.llm !== undefined || deps.logger !== undefined) {
    return new CourseGenerator(deps);
  }
  if (!singleton) singleton = new CourseGenerator();
  return singleton;
}
