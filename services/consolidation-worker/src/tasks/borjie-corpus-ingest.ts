/**
 * Borjie first-boot corpus ingestion job (Phase 3, item 3).
 *
 * Reads the mining-domain markdown corpus (primary_sources/, research/,
 * research/minerals/), chunks each file by H2 (`^## `), embeds each
 * chunk, and upserts into `intelligence_corpus_chunks` with
 * `tenant_id = NULL` (global rows) so every tenant inherits the same
 * baseline knowledge on first sign-in.
 *
 * See `Docs/build/BOJI_BUILD_PLAN.md` §Phase 3 step 3 and
 * `Docs/build/DATA_MODEL.md` §4 for the target schema.
 *
 * ---------------------------------------------------------------------
 * Architecture
 * ---------------------------------------------------------------------
 *
 *   - Storage + embedding are abstracted by ports (`CorpusSink`,
 *     `Embedder`). Business logic here compiles + tests without ever
 *     touching `@borjie/database` or `drizzle-orm`. Concrete adapters
 *     live in `./borjie-corpus-adapters.ts`.
 *
 *   - Idempotent on `(source_file, section_heading)`: re-running the
 *     job overwrites the existing row's content + embedding rather
 *     than producing duplicates. The DATA_MODEL.md schema has a soft
 *     `superseded_by_id` field for time-travel; we leave it unset on
 *     vanilla re-ingest.
 *
 * ---------------------------------------------------------------------
 * Blocking gap (called out in the report)
 * ---------------------------------------------------------------------
 *
 * The `intelligence_corpus_chunks` table is defined in DATA_MODEL.md §4
 * but the Drizzle schema does NOT yet exist under
 * `packages/database/src/schemas/`. The Drizzle adapter issues raw SQL
 * so this worker compiles today; once the schema is added the adapter
 * should be swapped for a typed Drizzle upsert.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────
// Public types — ports
// ─────────────────────────────────────────────────────────────────────

export interface CorpusChunk {
  readonly sourceFile: string;
  readonly sectionHeading: string;
  readonly content: string;
  readonly ingestedAt: string;
}

export interface CorpusUpsertRow extends CorpusChunk {
  readonly id: string;
  readonly embedding: ReadonlyArray<number>;
}

export interface CorpusSink {
  /**
   * Idempotent upsert keyed on `(source_file, section_heading)`. Must
   * overwrite content + embedding when the same key arrives twice.
   */
  upsert(row: CorpusUpsertRow): Promise<void>;
}

export interface Embedder {
  embed(text: string): Promise<ReadonlyArray<number>>;
}

export interface WorkerLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface IngestOptions {
  readonly corpusRoots: ReadonlyArray<string>;
  readonly sink: CorpusSink;
  readonly embedder: Embedder;
  readonly logger?: WorkerLogger;
  /** Skip embedding for very small chunks (< minBytes). Default 64. */
  readonly minBytes?: number;
}

export interface IngestReport {
  readonly filesScanned: number;
  readonly chunksWritten: number;
  readonly chunksSkipped: number;
  readonly errors: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Core ingest — pure logic, no I/O wiring
// ─────────────────────────────────────────────────────────────────────

/**
 * Recursively walk each corpus root, split markdown by H2, embed, and
 * upsert. Errors per-file are absorbed so a single bad file does not
 * stop the run.
 */
export async function ingestCorpus(opts: IngestOptions): Promise<IngestReport> {
  const minBytes = opts.minBytes ?? 64;
  const errors: string[] = [];
  let filesScanned = 0;
  let chunksWritten = 0;
  let chunksSkipped = 0;

  for (const root of opts.corpusRoots) {
    const files = await walkMarkdown(root, errors);
    for (const absolutePath of files) {
      filesScanned += 1;
      try {
        const raw = await readFile(absolutePath, 'utf8');
        const relPath = relative(root, absolutePath);
        const sourceFile = join(basename(root), relPath);
        const chunks = splitByH2(sourceFile, raw);
        for (const chunk of chunks) {
          if (chunk.content.length < minBytes) {
            chunksSkipped += 1;
            continue;
          }
          const embedding = await opts.embedder.embed(chunk.content);
          const id = deterministicId(chunk.sourceFile, chunk.sectionHeading);
          await opts.sink.upsert({ ...chunk, id, embedding });
          chunksWritten += 1;
        }
      } catch (error) {
        const msg = `ingest failed for ${absolutePath}: ${asMessage(error)}`;
        errors.push(msg);
        opts.logger?.warn('borjie-corpus-ingest: file failed', { file: absolutePath, error: asMessage(error) });
      }
    }
  }

  opts.logger?.info('borjie-corpus-ingest: completed', {
    filesScanned,
    chunksWritten,
    chunksSkipped,
    errorCount: errors.length,
  });

  return { filesScanned, chunksWritten, chunksSkipped, errors };
}

/**
 * Split a markdown document by H2 (`^## `) into one chunk per section.
 * Content above the first H2 is captured as a synthetic `__preamble__`
 * section so introductions are not lost.
 */
export function splitByH2(sourceFile: string, raw: string): ReadonlyArray<CorpusChunk> {
  const lines = raw.split(/\r?\n/);
  const sections: { heading: string; body: string[] }[] = [];
  let current: { heading: string; body: string[] } = {
    heading: '__preamble__',
    body: [],
  };

  for (const line of lines) {
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      if (current.body.length > 0 || current.heading !== '__preamble__') {
        sections.push(current);
      }
      const heading = line.replace(/^##\s+/, '').trim();
      current = { heading, body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.length > 0) sections.push(current);

  const ingestedAt = new Date().toISOString();
  return sections.map((section) => ({
    sourceFile,
    sectionHeading: section.heading,
    content: section.body.join('\n').trim(),
    ingestedAt,
  }));
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function walkMarkdown(root: string, errors: string[]): Promise<string[]> {
  const out: string[] = [];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(root, entry.name);
      if (entry.isDirectory()) {
        const children = await walkMarkdown(full, errors);
        out.push(...children);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        const sizeOk = await isReadableFile(full);
        if (sizeOk) out.push(full);
      }
    }
  } catch (error) {
    errors.push(`walk failed at ${root}: ${asMessage(error)}`);
  }
  return out;
}

async function isReadableFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function deterministicId(sourceFile: string, sectionHeading: string): string {
  // Stable id derived from the upsert key so re-runs are byte-identical.
  return createHash('sha256')
    .update(`${sourceFile}::${sectionHeading}`)
    .digest('hex')
    .slice(0, 32);
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─────────────────────────────────────────────────────────────────────
// CLI entrypoint — pnpm tsx src/tasks/borjie-corpus-ingest.ts
//
// The CLI composition root (env-driven wiring, embedder + sink
// resolution, process.exit) lives in `./borjie-corpus-cli.ts` to keep
// this module focused on the pure ingest pipeline. We re-export `main`
// and `CliOptions` so callers and the `pnpm tsx ...borjie-corpus-
// ingest.ts` invocation both work. The direct-execution guard also
// fires `main()` so the spec's exact CLI path stays runnable.
// ─────────────────────────────────────────────────────────────────────

export { main, type CliOptions } from './borjie-corpus-cli.js';

const isDirect =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /borjie-corpus-ingest(\.js|\.ts)?$/.test(process.argv[1]);

if (isDirect) {
  // Lazy-import the CLI so the core module has zero side effects when
  // imported as a library.
  void import('./borjie-corpus-cli.js').then(async (mod) => {
    try {
      await mod.main();
    } catch (error) {
      process.stderr.write(
        `borjie-corpus-ingest fatal: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(2);
    }
  });
}
