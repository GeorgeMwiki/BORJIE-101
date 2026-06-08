/**
 * Tests for the corpus-ingest flow fixes (lane knowledge-flow):
 *   - KI-01: `failOnZeroFiles` throws `EmptyCorpusError` on a dead path,
 *            and does NOT throw when at least one file is scanned.
 *   - KI-02: `resolveCorpusRoots` honours `BORJIE_MINING_CORPUS_PATH`
 *            (canonical) and `BORJIE_DOCS_ROOT` (legacy alias), and falls
 *            back to an in-repo default tree that actually exists.
 *   - KI-03: `runCorpusIngestTick` absorbs `EmptyCorpusError` (never
 *            throws to the supervisor) and reports counts on success.
 *
 * Pure pipeline only — no DB, no network. The sink + embedder are fakes;
 * the corpus root is a temp dir of markdown we control.
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ingestCorpus,
  EmptyCorpusError,
  type CorpusSink,
  type CorpusUpsertRow,
  type Embedder,
  type WorkerLogger,
} from './borjie-corpus-ingest.js';
import { resolveCorpusRoots, resolveDocsRoot } from './corpus-roots.js';
import { runCorpusIngestTick } from './corpus-ingest-cron.js';

// ─────────────────────────────────────────────────────────────────────
// Fakes
// ─────────────────────────────────────────────────────────────────────

function silentLogger(): WorkerLogger {
  return { info() {}, warn() {}, error() {} };
}

function stubEmbedder(): Embedder {
  return { async embed() { return new Array(1024).fill(0); } };
}

function captureSink(): { sink: CorpusSink; rows: CorpusUpsertRow[] } {
  const rows: CorpusUpsertRow[] = [];
  return {
    rows,
    sink: {
      async upsert(row) {
        rows.push(row);
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Temp corpus fixtures
// ─────────────────────────────────────────────────────────────────────

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'borjie-corpus-test-'));
});

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function writeMd(rel: string, body: string): Promise<void> {
  const full = join(dir, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, body, 'utf8');
}

// ─────────────────────────────────────────────────────────────────────
// KI-01 — fail loud on a dead corpus path
// ─────────────────────────────────────────────────────────────────────

describe('ingestCorpus failOnZeroFiles (KI-01)', () => {
  it('throws EmptyCorpusError when no markdown files are found', async () => {
    const { sink } = captureSink();
    await expect(
      ingestCorpus({
        corpusRoots: [join(dir, 'does-not-exist')],
        sink,
        embedder: stubEmbedder(),
        logger: silentLogger(),
        failOnZeroFiles: true,
      }),
    ).rejects.toBeInstanceOf(EmptyCorpusError);
  });

  it('does NOT throw when at least one file is scanned, and writes chunks', async () => {
    await writeMd(
      'research/sample.md',
      '## Section A\n' + 'x'.repeat(200) + '\n## Section B\n' + 'y'.repeat(200),
    );
    const { sink, rows } = captureSink();
    const report = await ingestCorpus({
      corpusRoots: [dir],
      sink,
      embedder: stubEmbedder(),
      logger: silentLogger(),
      failOnZeroFiles: true,
    });
    expect(report.filesScanned).toBe(1);
    expect(report.chunksWritten).toBe(2);
    expect(rows).toHaveLength(2);
    // Each row carries a deterministic id + the 1024-d embedding.
    expect(rows[0]?.embedding).toHaveLength(1024);
  });

  it('legacy contract preserved: no throw on empty scan when flag is unset', async () => {
    const { sink } = captureSink();
    const report = await ingestCorpus({
      corpusRoots: [join(dir, 'nope')],
      sink,
      embedder: stubEmbedder(),
      logger: silentLogger(),
    });
    expect(report.filesScanned).toBe(0);
    expect(report.chunksWritten).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// KI-02 — env var resolution + real in-repo default
// ─────────────────────────────────────────────────────────────────────

describe('resolveDocsRoot / resolveCorpusRoots (KI-02)', () => {
  it('prefers BORJIE_MINING_CORPUS_PATH (canonical)', () => {
    const root = resolveDocsRoot({ BORJIE_MINING_CORPUS_PATH: '/canon' });
    expect(root).toBe('/canon');
  });

  it('honours BORJIE_DOCS_ROOT as a legacy alias when canonical is unset', () => {
    const root = resolveDocsRoot({ BORJIE_DOCS_ROOT: '/legacy' });
    expect(root).toBe('/legacy');
  });

  it('canonical wins over legacy when both are set', () => {
    const root = resolveDocsRoot({
      BORJIE_MINING_CORPUS_PATH: '/canon',
      BORJIE_DOCS_ROOT: '/legacy',
    });
    expect(root).toBe('/canon');
  });

  it('falls back to an in-repo path (not the dead machine-local path)', () => {
    const root = resolveDocsRoot({});
    expect(root).not.toContain('Boji project');
    expect(root).toContain('_BOJI_PROJECT_INTAKE_2026_05_27');
  });

  it('custom path yields the historical sub-tree without the extra research root', () => {
    const roots = resolveCorpusRoots({ BORJIE_MINING_CORPUS_PATH: '/c' });
    expect(roots).toEqual(['/c/primary_sources', '/c/research', '/c/research/minerals']);
  });

  it('in-repo default appends the repo Docs/research SOTA dossiers', () => {
    const roots = resolveCorpusRoots({});
    expect(roots.length).toBe(4);
    expect(roots.some((r) => r.endsWith(join('Docs', 'research')))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// KI-03 — cron tick never throws to the supervisor
// ─────────────────────────────────────────────────────────────────────

describe('runCorpusIngestTick (KI-03)', () => {
  it('absorbs EmptyCorpusError and returns null (supervisor stays up)', async () => {
    const { sink } = captureSink();
    const result = await runCorpusIngestTick({
      sink,
      embedder: stubEmbedder(),
      logger: silentLogger(),
      corpusRoots: [join(dir, 'empty')],
    });
    expect(result).toBeNull();
  });

  it('returns the report with counts on a healthy run', async () => {
    await writeMd('research/a.md', '## H\n' + 'z'.repeat(200));
    const { sink, rows } = captureSink();
    const result = await runCorpusIngestTick({
      sink,
      embedder: stubEmbedder(),
      logger: silentLogger(),
      corpusRoots: [dir],
    });
    expect(result?.filesScanned).toBe(1);
    expect(result?.chunksWritten).toBe(1);
    expect(rows).toHaveLength(1);
  });
});
