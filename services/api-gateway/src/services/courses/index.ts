/**
 * Course-generation service — orchestration over the generator + repo ports.
 *
 * The Hono route authenticates, validates, gates (tier + rate limit), then
 * calls `kickoffGeneration`. That creates a fast `draft` placeholder and
 * returns its id immediately; the slow generation runs detached
 * (`runBackgroundGeneration`) and finalises (or marks-failed) the row. The FE
 * polls the course route until lessons appear.
 *
 * HONEST-DEGRADE (CLAUDE.md hard rule): the `CourseGenerator` uses the wired
 * `LLMPort` when present, otherwise the deterministic catalog sequencer. The
 * service never throws on generation (the sequencer is the floor); it only
 * marks the course failed when a thrown error escapes — which today only
 * happens on invalid INPUT, since the generator itself absorbs LLM failures
 * into the deterministic fallback.
 *
 * Mirrors the scenario-repository clean-port shape so it is unit-testable with
 * stub repo + stub/no LLM.
 *
 * Ported from the BossNyumba courses service and retargeted real-estate ->
 * mining.
 *
 * @module services/courses
 */

import {
  CourseGenerator,
  type GenerateCourseInput,
} from '@borjie/ai-copilot/courses';
import {
  CourseServiceError,
  type CoursesRepo,
  type CreateCoursePlaceholderArgs,
  type LLMPort,
} from './types.js';

export {
  CourseServiceError,
  type CoursesRepo,
  type CourseDocumentInput,
  type CreateCoursePlaceholderArgs,
  type FinalizeCourseArgs,
  type LLMPort,
} from './types.js';

export interface CourseServiceLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface CourseServiceDeps {
  readonly repo: CoursesRepo;
  /** When null the generator honest-degrades to the deterministic sequencer. */
  readonly llm?: LLMPort | null;
  readonly logger?: CourseServiceLogger;
  /** Detach hook (defaults to queueMicrotask) — overridable in tests. */
  readonly schedule?: (fn: () => void) => void;
}

export interface KickoffResult {
  readonly courseId: string;
  readonly status: 'generating';
}

export class CourseService {
  private readonly repo: CoursesRepo;
  private readonly generator: CourseGenerator;
  private readonly logger: CourseServiceLogger | undefined;
  private readonly schedule: (fn: () => void) => void;

  constructor(deps: CourseServiceDeps) {
    if (!deps.repo) {
      throw new CourseServiceError('NO_REPO', 'CourseService requires a repo');
    }
    this.repo = deps.repo;
    this.logger = deps.logger;
    this.generator = new CourseGenerator(
      deps.logger
        ? { llm: deps.llm ?? null, logger: deps.logger }
        : { llm: deps.llm ?? null },
    );
    this.schedule =
      deps.schedule ??
      ((fn: () => void) => {
        // Detach so the HTTP response returns before the slow model call.
        queueMicrotask(fn);
      });
  }

  /**
   * Create the placeholder course FAST, return its id, and kick the slow
   * generation off detached. The route returns 202; the FE polls `get`.
   */
  async kickoffGeneration(
    args: CreateCoursePlaceholderArgs,
  ): Promise<KickoffResult> {
    const courseId = await this.repo.createPlaceholder(args);
    this.schedule(() => {
      void this.runBackgroundGeneration(args, courseId);
    });
    return { courseId, status: 'generating' };
  }

  /**
   * Run generation for an existing placeholder, then finalise. Owns its own
   * error handling because it runs detached from the HTTP response. Never
   * throws.
   */
  async runBackgroundGeneration(
    args: CreateCoursePlaceholderArgs,
    courseId: string,
  ): Promise<void> {
    try {
      const input: GenerateCourseInput = {
        domain: args.domain,
        scenarioDescription: args.scenarioDescription,
        language: args.language,
        difficulty: args.difficulty,
        documentContext: args.documents.map((d) => ({
          documentName: d.documentName,
          documentType: d.documentType,
          summary: d.summary,
        })),
      };
      const { course, generatedVia } =
        await this.generator.generateCourse(input);
      await this.repo.finalize({
        tenantId: args.tenantId,
        userId: args.userId,
        courseId,
        course,
        generatedVia,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Course generation failed. Please try again.';
      this.logger?.error('background course generation failed', {
        courseId,
        domain: args.domain,
        error: message,
      });
      await this.repo.markFailed(
        args.tenantId,
        args.userId,
        courseId,
        message,
      );
    }
  }
}

export function createCourseService(deps: CourseServiceDeps): CourseService {
  return new CourseService(deps);
}

/** Re-export the generator's catalog/domain surface for the route + tools. */
export {
  COURSE_DOMAINS,
  findCourseDomain,
  courseDomainLabel,
  COURSE_LANGUAGES,
  COURSE_DIFFICULTIES,
  type CourseDomain,
  type CourseDifficulty,
  type CourseLanguage,
  type CourseSummary,
  type CourseWithLessons,
} from '@borjie/ai-copilot/courses';
