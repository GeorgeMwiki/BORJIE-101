/**
 * CLI runner for the Borjie corpus-ingest task.
 *
 * Wires the abstract `ingestCorpus(...)` engine to the concrete adapters
 * (OpenAI embedder, Drizzle sink) at the composition root. Kept separate
 * from `borjie-corpus-ingest.ts` so the core ingest module stays under
 * the file-size budget and so tests can exercise the pure pipeline
 * without dragging in `@borjie/database` or `fetch`.
 *
 * Invocation:
 *   pnpm tsx services/consolidation-worker/src/tasks/borjie-corpus-cli.ts
 */

import { join } from 'node:path';
import {
  createDrizzleCorpusSink,
  createLogSink,
  createOpenAIEmbedder,
  createStubEmbedder,
  type DrizzleLikeClient,
} from './borjie-corpus-adapters.js';
import {
  ingestCorpus,
  type CorpusSink,
  type Embedder,
  type IngestReport,
  type WorkerLogger,
} from './borjie-corpus-ingest.js';

const DEFAULT_DOCS_ROOT =
  process.env.BORJIE_DOCS_ROOT ??
  '/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Claude Projects/Boji project/Docs';

const DEFAULT_CORPUS_ROOTS = [
  join(DEFAULT_DOCS_ROOT, 'primary_sources'),
  join(DEFAULT_DOCS_ROOT, 'research'),
  join(DEFAULT_DOCS_ROOT, 'research', 'minerals'),
];

export interface CliOptions {
  readonly corpusRoots?: ReadonlyArray<string>;
  readonly db?: DrizzleLikeClient | null;
  readonly embedder?: Embedder | null;
  readonly logger?: WorkerLogger;
}

export async function main(opts: CliOptions = {}): Promise<IngestReport> {
  const logger: WorkerLogger = opts.logger ?? noopLogger();
  const corpusRoots = opts.corpusRoots ?? DEFAULT_CORPUS_ROOTS;
  const embedder = opts.embedder ?? resolveEmbedder(logger);
  const sink = opts.db
    ? createDrizzleCorpusSink(opts.db)
    : await resolveSink(logger);
  return ingestCorpus({ corpusRoots, sink, embedder, logger });
}

function resolveEmbedder(logger: WorkerLogger): Embedder {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (apiKey) return createOpenAIEmbedder({ apiKey });
  const allowStub = process.argv.includes('--allow-stub-embeddings');
  if (!allowStub) {
    throw new Error(
      'OPENAI_API_KEY missing — pass --allow-stub-embeddings to ingest with zero-vector stubs (dev only)',
    );
  }
  logger.warn('borjie-corpus-ingest: OPENAI_API_KEY missing — stub embedder enabled via --allow-stub-embeddings (zero vectors)');
  return createStubEmbedder();
}

async function resolveSink(logger: WorkerLogger): Promise<CorpusSink> {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    logger.warn('borjie-corpus-ingest: DATABASE_URL missing — using log-only sink');
    return createLogSink(logger);
  }
  try {
    const dbMod = (await import('@borjie/database')) as {
      createDatabaseClient?: (url: string) => DrizzleLikeClient;
    };
    if (typeof dbMod.createDatabaseClient !== 'function') {
      throw new Error('@borjie/database does not export createDatabaseClient');
    }
    return createDrizzleCorpusSink(dbMod.createDatabaseClient(dbUrl));
  } catch (error) {
    logger.error('borjie-corpus-ingest: db client init failed — using log-only sink', {
      error: error instanceof Error ? error.message : String(error),
    });
    return createLogSink(logger);
  }
}

function noopLogger(): WorkerLogger {
  // TODO(#40): replace with `import { logger } from '../logger.js'` once the
  // pino dep is hoisted into this service's runtime image.
  //
  // BORJIE_DEBUG=1 surfaces ingest progress on stdout/stderr so dev runs
  // are observable without re-wiring pino.
  if (process.env.BORJIE_DEBUG === '1') {
    return {
      info: (msg, ctx) =>
        process.stdout.write(
          `[INFO] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`,
        ),
      warn: (msg, ctx) =>
        process.stdout.write(
          `[WARN] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`,
        ),
      error: (msg, ctx) =>
        process.stderr.write(
          `[ERROR] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`,
        ),
    };
  }
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

// CLI guard — only run main() when THIS file is the program entry. The
// sibling `borjie-corpus-ingest.ts` has its own guard that imports this
// module dynamically, so we deliberately do NOT match the ingest path
// here to avoid double-running main().
const isDirect =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /borjie-corpus-cli(\.js|\.ts)?$/.test(process.argv[1]);

if (isDirect) {
  main()
    .then((report) => {
      process.stdout.write(
        `[REPORT] ${JSON.stringify(report)}\n`,
      );
      process.exit(0);
    })
    .catch((error) => {
      process.stderr.write(
        `borjie-corpus-ingest fatal: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(2);
    });
}
