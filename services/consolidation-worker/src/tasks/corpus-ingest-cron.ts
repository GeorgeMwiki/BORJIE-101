/**
 * Corpus-ingest cron (KI-03).
 *
 * ---------------------------------------------------------------------
 * Why this module exists
 * ---------------------------------------------------------------------
 * The first-boot corpus ingest (`ingestCorpus`) was only ever runnable
 * from the manual CLI (`borjie-corpus-cli.ts` / `…-direct.ts`). NOTHING
 * invoked it at boot or on any cron, so a fresh deploy started with an
 * EMPTY global corpus and stayed that way until someone SSH'd in and ran
 * the CLI by hand — the single biggest reason "infinite knowledge is
 * wired but not flowing".
 *
 * This module turns the ingest into a scheduled job that fires ONCE on
 * boot (so a fresh deploy grounds itself immediately) and then on a slow
 * cadence (default daily) to pick up corpus edits. The ingest is
 * idempotent — every chunk upserts on the `(tenant, source_file, section)`
 * expression unique index from migration 0311 — so re-running is safe and
 * cheap; no separate run-marker table is needed.
 *
 * Degradation contract (mirrors the worker's other crons):
 *   - A tick NEVER throws to the caller. `EmptyCorpusError` (dead corpus
 *     path, KI-01) is logged at ERROR but absorbed so the supervisor
 *     stays up — the loud signal is the structured ERROR log + the
 *     `chunksWritten:0` report, not a process crash.
 *   - Ticks never overlap (in-flight guard).
 *   - When no DB / no embedder is available the sink/embedder resolution
 *     degrades to a log-only / stub run so a tick still surfaces the file
 *     count without writing rows.
 */

import { resolveCorpusRoots } from './corpus-roots.js';
import {
  ingestCorpus,
  EmptyCorpusError,
  type CorpusSink,
  type Embedder,
  type IngestReport,
  type WorkerLogger,
} from './borjie-corpus-ingest.js';
import {
  createDrizzleCorpusSink,
  createLogSink,
  createOpenAIEmbedder,
  createStubEmbedder,
  type DrizzleLikeClient,
} from './borjie-corpus-adapters.js';

/**
 * The Drizzle surface the corpus-ingest sink needs (insert + execute).
 * Re-exported so the composition root can cast its narrower `execute`-only
 * client to the shape `buildCorpusIngestCronDeps` expects at the call site.
 */
export type CorpusIngestDb = DrizzleLikeClient;

/**
 * Resolve the corpus-ingest cadence. Default DAILY; env-tunable and
 * clamped to [1min, 30d] so a deploy can dial it without letting it run
 * unboundedly often. Composition-root env read (in-bounds here).
 */
export function resolveCorpusIngestIntervalMs(): number {
  const raw = Number(process.env.CORPUS_INGEST_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 24 * 60 * 60 * 1000;
  return Math.min(Math.max(Math.floor(raw), 60_000), 30 * 24 * 60 * 60 * 1000);
}

export interface CorpusIngestCronDeps {
  readonly sink: CorpusSink;
  readonly embedder: Embedder;
  readonly logger: WorkerLogger;
  /** Override corpus roots (tests). Defaults to the in-repo resolver. */
  readonly corpusRoots?: ReadonlyArray<string>;
}

/**
 * Build the cron deps from the live Drizzle client. The embedder is the
 * live OpenAI embedder when `OPENAI_API_KEY` is set, else a zero-vector
 * stub (dev/CI). The sink is the Drizzle upsert sink when `db` is present,
 * else a log-only sink so a tick still reports the file/chunk counts.
 */
export function buildCorpusIngestCronDeps(args: {
  readonly db: DrizzleLikeClient | null;
  readonly logger: WorkerLogger;
  readonly apiKey?: string | undefined;
}): CorpusIngestCronDeps {
  const apiKey = args.apiKey?.trim();
  const embedder: Embedder = apiKey
    ? createOpenAIEmbedder({ apiKey })
    : (args.logger.warn(
        'corpus-ingest-cron: OPENAI_API_KEY missing — zero-vector stub embedder (corpus rows will not be semantically searchable until re-ingested with a key)',
      ),
      createStubEmbedder());
  const sink: CorpusSink = args.db
    ? createDrizzleCorpusSink(args.db)
    : (args.logger.warn(
        'corpus-ingest-cron: no DB client — log-only sink (no rows written)',
      ),
      createLogSink(args.logger));
  return { sink, embedder, logger: args.logger };
}

/**
 * Run one corpus-ingest tick. Resolves the corpus roots, runs the
 * idempotent ingest with `failOnZeroFiles` so a dead path surfaces, and
 * returns the report. Absorbs `EmptyCorpusError` (logs ERROR) so the
 * caller's supervisor stays up; any other error is also absorbed + logged.
 */
export async function runCorpusIngestTick(
  deps: CorpusIngestCronDeps,
): Promise<IngestReport | null> {
  const corpusRoots = deps.corpusRoots ?? resolveCorpusRoots();
  try {
    const report = await ingestCorpus({
      corpusRoots,
      sink: deps.sink,
      embedder: deps.embedder,
      logger: deps.logger,
      failOnZeroFiles: true,
    });
    deps.logger.info('corpus-ingest-cron: tick complete', {
      filesScanned: report.filesScanned,
      chunksWritten: report.chunksWritten,
      chunksSkipped: report.chunksSkipped,
      errorCount: report.errors.length,
    });
    return report;
  } catch (error) {
    if (error instanceof EmptyCorpusError) {
      deps.logger.error('corpus-ingest-cron: DEAD corpus path — zero files (KI-01)', {
        corpusRoots,
        message: error.message,
      });
      return null;
    }
    deps.logger.error('corpus-ingest-cron: tick failed', {
      corpusRoots,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
