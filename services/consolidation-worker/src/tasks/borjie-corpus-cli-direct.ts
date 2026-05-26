/**
 * Direct-DB variant of borjie-corpus-cli.
 *
 * Bypasses the shipped CLI's @borjie/database dependency (that package
 * currently fails to build because of legacy schema imports left over
 * from the pre-Borjie tree) by wiring a raw postgres-js sink directly against
 * `intelligence_corpus_chunks`. Same pure ingestCorpus engine, same
 * OpenAI/stub embedder resolution.
 *
 * Run: pnpm tsx services/consolidation-worker/src/tasks/borjie-corpus-cli-direct.ts
 */

import { join } from 'node:path';
import postgres from 'postgres';
import { ingestCorpus } from './borjie-corpus-ingest.js';
import {
  createOpenAIEmbedder,
  createStubEmbedder,
} from './borjie-corpus-adapters.js';

const DOCS_ROOT =
  process.env.BORJIE_DOCS_ROOT ??
  '/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Claude Projects/Boji project/Docs';

const corpusRoots = [
  join(DOCS_ROOT, 'primary_sources'),
  join(DOCS_ROOT, 'research'),
  join(DOCS_ROOT, 'research', 'minerals'),
];

const logger = {
  info: (msg: string, ctx?: unknown) =>
    process.stdout.write(`[INFO] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`),
  warn: (msg: string, ctx?: unknown) =>
    process.stdout.write(`[WARN] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`),
  error: (msg: string, ctx?: unknown) =>
    process.stderr.write(`[ERROR] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`),
};

async function run(): Promise<number> {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    logger.error('DATABASE_URL missing');
    return 2;
  }

  const allowStub = process.argv.includes('--allow-stub-embeddings');
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey && !allowStub) {
    logger.error(
      'OPENAI_API_KEY missing — pass --allow-stub-embeddings to ingest with zero-vector stubs (dev only)',
    );
    return 2;
  }
  const embedder = apiKey
    ? createOpenAIEmbedder({ apiKey })
    : (logger.warn('OPENAI_API_KEY missing — stub embedder enabled via --allow-stub-embeddings (zero vectors)'),
       createStubEmbedder());

  const sql = postgres(dbUrl, { max: 4, prepare: false });

  // Raw upsert. The 0003 migration shipped only a non-unique index on
  // (source_file, section), so ON CONFLICT can't target it; emulate the
  // upsert with DELETE-then-INSERT inside a transaction.
  const sink = {
    async upsert(row: {
      id: string;
      sourceFile: string;
      sectionHeading: string;
      content: string;
      embedding: ReadonlyArray<number>;
      ingestedAt: string;
    }): Promise<void> {
      const vec = `[${row.embedding.join(',')}]`;
      await sql.begin(async (tx) => {
        await tx`
          DELETE FROM intelligence_corpus_chunks
          WHERE source_file = ${row.sourceFile}
            AND section IS NOT DISTINCT FROM ${row.sectionHeading}
        `;
        await tx`
          INSERT INTO intelligence_corpus_chunks
            (id, tenant_id, source_file, section, text, embedding, ingested_at)
          VALUES
            (${row.id}, NULL, ${row.sourceFile}, ${row.sectionHeading},
             ${row.content}, ${vec}::vector(1024), ${new Date(row.ingestedAt)})
        `;
      });
    },
  };

  logger.info('roots', { corpusRoots });

  try {
    const report = await ingestCorpus({ corpusRoots, sink, embedder, logger });
    process.stdout.write(`[REPORT] ${JSON.stringify(report, null, 2)}\n`);
    await sql.end({ timeout: 5 });
    return report.errors.length === 0 ? 0 : 1;
  } catch (err) {
    process.stderr.write(
      `[FATAL] ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    await sql.end({ timeout: 5 });
    return 2;
  }
}

const isDirect =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /borjie-corpus-cli-direct(\.js|\.ts)?$/.test(process.argv[1]);

if (isDirect) {
  run().then((code) => process.exit(code));
}
