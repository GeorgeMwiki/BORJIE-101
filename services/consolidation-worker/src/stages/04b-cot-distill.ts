/**
 * Stage 04b — CoT → Reflexion distillation.
 *
 * Phase D / D3 — Closes the B4 reflexion-buffer integration gap.
 *
 * Stage 05 (`05-decay`) was already claimed by B4 for memory-decay, so
 * this distillation stage is wedged in between stages 04 (promote) and
 * 05 (decay) as `04b`. The orchestrator threads it additively.
 *
 * What it does
 * ────────────
 * For each `kernel_provenance` row in the window where the judge gave
 * a low verdict (`judgeScore < 0.6` by default), we:
 *
 *   1. Look up the matching `kernel_cot_reservoir` entry (by thoughtId).
 *      Many low-judge turns will have NO CoT row (the reservoir samples
 *      probabilistically); those are skipped silently — never logged
 *      as errors.
 *   2. Re-scrub the CoT text through `scrubCotForPersist` so the
 *      reflexion-lesson row never carries fresh PII even if the
 *      original was scrubbed under an older pattern set.
 *   3. Distill into a `reflexion_lesson` row whose `reflection` text
 *      is the scrubbed CoT + the judge's `reasonText` as the
 *      "what went wrong" signal. `lessonKind = 'cot-distilled'` is
 *      stamped in a JSON tail of the reflection text (the existing
 *      `reflexion_buffer` schema has no first-class `lessonKind`
 *      column; we keep the row compatible with the existing readers
 *      and let the marker live in the text).
 *
 * Pure / port-driven: the worker has no compile-time dependency on
 * `@borjie/database` — both the source loader and the lesson sink
 * are duck-typed interfaces wired by the composition root.
 */

import type { StageLogger } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Local persist-boundary CoT scrub — duplicates the surface of
// `@borjie/central-intelligence` `scrubCotForPersist` so the
// consolidation-worker keeps zero compile-time dependency on the
// central-intelligence package (same discipline as the existing
// `ConstitutionalCriticPort` duck-type in 03-reflect). The pattern
// set MUST stay in sync with
// `packages/central-intelligence/src/kernel/cot-reservoir/pii-scrub-cot.ts`;
// drift will only relax (not tighten) what reaches `reflexion_buffer`,
// so the worst case is a richer-than-intended audit row, not a leak.
// ─────────────────────────────────────────────────────────────────────

interface LocalCotPattern {
  readonly kind: string;
  readonly re: RegExp;
  readonly replace: string;
}

const LOCAL_COT_PATTERNS: ReadonlyArray<LocalCotPattern> = [
  { kind: 'phone-tz', re: /\+?255[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}/g, replace: '[redacted-phone]' },
  { kind: 'phone-ke', re: /\+?254[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}/g, replace: '[redacted-phone]' },
  { kind: 'phone-gen', re: /\b0[67]\d{2}([\s-])\d{3}\1\d{3}\b/g, replace: '[redacted-phone]' },
  { kind: 'email', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, replace: '[redacted-email]' },
  { kind: 'nida-tz', re: /\b\d{8}-\d{5}-\d{5}-\d{2}\b/g, replace: '[redacted-nida]' },
  { kind: 'kra-pin', re: /\b[A-Z]\d{9}[A-Z]\b/g, replace: '[redacted-kra-pin]' },
  {
    kind: 'model-provider-url',
    re: /\bhttps?:\/\/(?:[a-z0-9-]+\.)*(?:anthropic\.com|openai\.com|api\.openai\.com|api\.anthropic\.com|cohere\.ai|together\.xyz|mistral\.ai)\b[^\s]*/gi,
    replace: '[redacted-model-url]',
  },
  { kind: 'anthropic-key', re: /\bsk-ant-(?:api03-)?[A-Za-z0-9_-]{20,}\b/g, replace: '[redacted-api-key]' },
  { kind: 'api-key-generic', re: /\b(?:sk|pk)-[A-Za-z0-9_-]{20,}\b/g, replace: '[redacted-api-key]' },
  {
    kind: 'api-key-querystring',
    re: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key|bearer)[\s:=]+["']?[A-Za-z0-9_.-]{16,}["']?/gi,
    replace: '[redacted-api-key]',
  },
  { kind: 'mpesa-txn', re: /\bMPESA[A-Z0-9]{8,10}\b/g, replace: '[redacted-mpesa-txn]' },
  {
    kind: 'model-name',
    re: /\b(?:claude-(?:opus|sonnet|haiku)?-?\d[\w.-]*|gpt-(?:4o|4|3\.5)[\w.-]*|o[13]-(?:preview|mini)[\w.-]*)\b/gi,
    replace: '[redacted-model-name]',
  },
];

interface LocalScrubResult {
  readonly scrubbed: string;
  readonly categories: ReadonlyArray<string>;
}

function scrubCotForPersist(text: string | null | undefined): LocalScrubResult {
  if (!text || text.length === 0) {
    return { scrubbed: '', categories: [] };
  }
  let out = text;
  const cats: string[] = [];
  for (const p of LOCAL_COT_PATTERNS) {
    if (p.re.test(out)) {
      out = out.replace(p.re, p.replace);
      cats.push(p.kind);
    }
  }
  return { scrubbed: out, categories: Array.from(new Set(cats)).sort() };
}

// ─────────────────────────────────────────────────────────────────────
// Duck-typed ports.
// ─────────────────────────────────────────────────────────────────────

export interface LowJudgeTurn {
  readonly thoughtId: string;
  readonly tenantId: string | null;
  readonly userId: string;
  readonly threadId: string;
  readonly judgeScore: number;
  readonly judgeReasonText: string | null;
  readonly producedAt: string;
}

export interface CotLookupHit {
  readonly thoughtId: string;
  readonly thoughtText: string;
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  readonly capturedAt: string;
}

export interface LowJudgeTurnSource {
  /**
   * Return every provenance row in the window where `judgeScore` is
   * below the supplied threshold. Implementations are free to apply
   * additional sampling or tenant filtering — this stage is best-effort.
   */
  listLowJudgeTurns(args: {
    readonly threshold: number;
    readonly windowStartIso: string;
    readonly windowEndIso: string;
  }): Promise<ReadonlyArray<LowJudgeTurn>>;
}

export interface CotReservoirLookup {
  /** Return the matching reservoir row or null if the turn wasn't sampled. */
  findByThoughtId(thoughtId: string): Promise<CotLookupHit | null>;
}

export interface ReflexionLessonRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  /**
   * The full reflection text written to `reflexion_buffer.reflection`.
   * Format:
   *
   *   [cot-distilled judgeScore=0.42]
   *   <scrubbed CoT thought>
   *
   *   Judge: <judge reason text>
   *
   * The bracket-prefixed marker doubles as the `lessonKind` flag the
   * reader can grep for without a schema migration.
   */
  readonly reflection: string;
  /** Always `'failure'` for distilled lessons — low judge implies failure mode. */
  readonly outcome: 'failure';
}

export interface ReflexionLessonSink {
  write(row: ReflexionLessonRow): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Stage args + report.
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_LOW_JUDGE_THRESHOLD = 0.6;

export interface CotDistillArgs {
  readonly logger: StageLogger;
  readonly windowStartIso: string;
  readonly windowEndIso: string;
  /** Defaults to {@link DEFAULT_LOW_JUDGE_THRESHOLD}. */
  readonly threshold?: number;
  readonly source?: LowJudgeTurnSource;
  readonly cotLookup?: CotReservoirLookup;
  readonly sink?: ReflexionLessonSink;
  /** Injectable id factory so tests are deterministic. */
  readonly idFactory?: () => string;
}

export interface CotDistillReport {
  readonly lowJudgeTurns: number;
  readonly distilledLessons: number;
  /** Number of low-judge turns where the reservoir had no CoT sample. */
  readonly missingCot: number;
  /** Number of sink writes that threw (and were swallowed). */
  readonly sinkErrors: number;
}

const REFLECT_MARKER_PREFIX = '[cot-distilled';

// ─────────────────────────────────────────────────────────────────────
// Stage entry point.
// ─────────────────────────────────────────────────────────────────────

export async function runCotDistillStage(args: CotDistillArgs): Promise<CotDistillReport> {
  const threshold = args.threshold ?? DEFAULT_LOW_JUDGE_THRESHOLD;

  if (!args.source || !args.cotLookup || !args.sink) {
    args.logger.info(
      { stage: '04b-cot-distill' },
      'cot-distill stage skipped (source / cotLookup / sink not all wired)',
    );
    return Object.freeze({
      lowJudgeTurns: 0,
      distilledLessons: 0,
      missingCot: 0,
      sinkErrors: 0,
    });
  }

  let lowJudgeTurns = 0;
  let distilledLessons = 0;
  let missingCot = 0;
  let sinkErrors = 0;

  let turns: ReadonlyArray<LowJudgeTurn>;
  try {
    turns = await args.source.listLowJudgeTurns({
      threshold,
      windowStartIso: args.windowStartIso,
      windowEndIso: args.windowEndIso,
    });
  } catch (error) {
    args.logger.warn(
      {
        stage: '04b-cot-distill',
        err: asMessage(error),
      },
      'cot-distill source threw — skipping stage',
    );
    return Object.freeze({
      lowJudgeTurns: 0,
      distilledLessons: 0,
      missingCot: 0,
      sinkErrors: 0,
    });
  }

  lowJudgeTurns = turns.length;

  for (const turn of turns) {
    // Skip turns with no tenant — the reflexion_buffer is tenant-scoped
    // (NOT NULL FK to tenants). Platform-scope CoT lessons have no
    // user-facing surface to consume them.
    if (!turn.tenantId) {
      continue;
    }

    let cot: CotLookupHit | null;
    try {
      cot = await args.cotLookup.findByThoughtId(turn.thoughtId);
    } catch (error) {
      args.logger.warn(
        {
          stage: '04b-cot-distill',
          thoughtId: turn.thoughtId,
          err: asMessage(error),
        },
        'cot lookup threw — treating as missing CoT',
      );
      cot = null;
    }

    if (!cot) {
      missingCot += 1;
      continue;
    }

    const persistScrub = scrubCotForPersist(cot.thoughtText);
    const reflection = buildLessonReflection({
      thoughtText: persistScrub.scrubbed,
      judgeScore: turn.judgeScore,
      judgeReasonText: turn.judgeReasonText,
    });

    const row: ReflexionLessonRow = Object.freeze({
      id: args.idFactory ? args.idFactory() : defaultId(turn.thoughtId),
      tenantId: turn.tenantId,
      userId: turn.userId,
      sessionId: turn.threadId,
      reflection,
      outcome: 'failure',
    });

    try {
      await args.sink.write(row);
      distilledLessons += 1;
    } catch (error) {
      sinkErrors += 1;
      args.logger.warn(
        {
          stage: '04b-cot-distill',
          thoughtId: turn.thoughtId,
          tenantId: turn.tenantId,
          err: asMessage(error),
        },
        'reflexion-lesson sink threw — counted as failure',
      );
    }
  }

  args.logger.info(
    {
      stage: '04b-cot-distill',
      lowJudgeTurns,
      distilledLessons,
      missingCot,
      sinkErrors,
      threshold,
    },
    'cot-distill stage complete',
  );

  return Object.freeze({
    lowJudgeTurns,
    distilledLessons,
    missingCot,
    sinkErrors,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — keep the formatting predictable so downstream readers can
// `startsWith('[cot-distilled')` to filter.
// ─────────────────────────────────────────────────────────────────────

function buildLessonReflection(input: {
  readonly thoughtText: string;
  readonly judgeScore: number;
  readonly judgeReasonText: string | null;
}): string {
  const headerScore = input.judgeScore.toFixed(2);
  const header = `${REFLECT_MARKER_PREFIX} judgeScore=${headerScore}]`;
  const judgePart = input.judgeReasonText && input.judgeReasonText.trim().length > 0
    ? `\n\nJudge: ${input.judgeReasonText.trim()}`
    : '\n\nJudge: (no reason text)';
  return `${header}\n${input.thoughtText}${judgePart}`;
}

function defaultId(thoughtId: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `refl_cot_${thoughtId}_${suffix}`;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
