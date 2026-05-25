/**
 * Stage 01 — Ingest.
 *
 * Pulls yesterday's traces, implicit signals, and explicit feedback
 * from the database. Each source has its own port so the worker is
 * unit-testable without a real DB connection.
 *
 * The join key for downstream stages is
 *   `(trace_id, agent_action_id, tenant_id, user_id, surface, role)`
 * — every row carries the `trace_id` so stage 02 can group by intent.
 */

import type {
  FeedbackEntry,
  ImplicitSignalEntry,
  IngestBundle,
  StageLogger,
  TraceEntry,
} from './types.js';

export interface IngestSources {
  /** Yesterday's chain-of-thought reservoir entries. */
  fetchTraces(args: {
    readonly since: Date;
    readonly until: Date;
    readonly limit?: number;
  }): Promise<ReadonlyArray<TraceEntry>>;
  /** Yesterday's implicit feedback events. */
  fetchImplicitSignals(args: {
    readonly since: Date;
    readonly until: Date;
    readonly limit?: number;
  }): Promise<ReadonlyArray<ImplicitSignalEntry>>;
  /** Yesterday's explicit thumbs / corrections / flags. */
  fetchExplicitFeedback(args: {
    readonly since: Date;
    readonly until: Date;
    readonly limit?: number;
  }): Promise<ReadonlyArray<FeedbackEntry>>;
}

export interface IngestArgs {
  readonly sources: IngestSources;
  readonly logger: StageLogger;
  readonly now?: () => Date;
  /** Window in ms. Default 24h. */
  readonly windowMs?: number;
  readonly perSourceLimit?: number;
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 5_000;

export async function runIngestStage(args: IngestArgs): Promise<IngestBundle> {
  const now = (args.now ?? (() => new Date()))();
  const windowMs = args.windowMs ?? DEFAULT_WINDOW_MS;
  const since = new Date(now.getTime() - windowMs);
  const limit = args.perSourceLimit ?? DEFAULT_LIMIT;

  const [traces, implicitSignals, explicitFeedback] = await Promise.all([
    safe(args.logger, 'fetchTraces', () =>
      args.sources.fetchTraces({ since, until: now, limit }),
    ),
    safe(args.logger, 'fetchImplicitSignals', () =>
      args.sources.fetchImplicitSignals({ since, until: now, limit }),
    ),
    safe(args.logger, 'fetchExplicitFeedback', () =>
      args.sources.fetchExplicitFeedback({ since, until: now, limit }),
    ),
  ]);

  args.logger.info(
    {
      stage: '01-ingest',
      traces: traces.length,
      implicitSignals: implicitSignals.length,
      explicitFeedback: explicitFeedback.length,
    },
    'ingest stage complete',
  );

  return {
    windowStart: since.toISOString(),
    windowEnd: now.toISOString(),
    traces,
    implicitSignals,
    explicitFeedback,
  };
}

async function safe<T>(
  logger: StageLogger,
  label: string,
  fn: () => Promise<ReadonlyArray<T>>,
): Promise<ReadonlyArray<T>> {
  try {
    const out = await fn();
    return Array.isArray(out) ? out : [];
  } catch (error) {
    logger.warn(
      { stage: '01-ingest', source: label, err: asMessage(error) },
      'ingest source failed — degrading to empty',
    );
    return [];
  }
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
