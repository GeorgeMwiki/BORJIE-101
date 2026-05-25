/**
 * Repository map — Aider-style.
 *
 * Produces a token-budget-aware summary of a codebase:
 *
 *   - File tree
 *   - Key symbols per file (functions / classes / exports)
 *   - Brief docstring (first JSDoc block or `"""..."""`)
 *
 * Symbol extraction defaults to a fast regex pass. If callers want
 * AST precision they may inject a `treeSitterParser` (peer dep —
 * see `parseSymbolsWithTreeSitter` below). We keep tree-sitter as
 * a peer dep so the package stays usable in environments where the
 * native build is undesirable.
 *
 * Ranking heuristic (importance):
 *
 *     recencyScore * importCountScore * sizeScore
 *
 * Files are sorted by importance and dropped from the tail until
 * the token budget is met. The result is content-addressed by
 * `cacheKey` so repeat invocations on an unchanged repo are O(1).
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep, extname } from 'node:path';

import type {
  CodebaseFile,
  CodebaseSnapshot,
  RepositoryFileMap,
  RepositoryMap,
  RepositorySymbol,
  RuntimeLogger,
} from '../types.js';
import { noopLogger } from '../types.js';

export interface BuildRepositoryMapOptions {
  readonly rootDir: string;
  /** Allowlist of languages (lowercased extensions, no dot). Empty = all known. */
  readonly languages?: ReadonlyArray<string>;
  /** Approximate token cap (chars ≈ tokens × 4). */
  readonly tokenBudget: number;
  /** Skip directories with these names anywhere in the path. */
  readonly excludeDirs?: ReadonlyArray<string>;
  /** Optional injected tree-sitter parser (see `parseSymbolsWithTreeSitter`). */
  readonly treeSitterParser?: TreeSitterParserAdapter;
  readonly logger?: RuntimeLogger;
}

export interface TreeSitterParserAdapter {
  readonly extractSymbols: (
    language: string,
    source: string,
  ) => ReadonlyArray<RepositorySymbol>;
}

const DEFAULT_EXCLUDES = Object.freeze([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
  'target',
  '.venv',
  '__pycache__',
]);

const LANG_BY_EXT: Readonly<Record<string, string>> = Object.freeze({
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
});

const APPROX_CHARS_PER_TOKEN = 4;

// ─────────────────────────────────────────────────────────────────
// Snapshot
// ─────────────────────────────────────────────────────────────────

export async function buildCodebaseSnapshot(
  options: BuildRepositoryMapOptions,
): Promise<CodebaseSnapshot> {
  const logger = options.logger ?? noopLogger;
  const excludeDirs = new Set([
    ...DEFAULT_EXCLUDES,
    ...(options.excludeDirs ?? []),
  ]);
  const langAllow = options.languages
    ? new Set(options.languages.map((l) => l.toLowerCase()))
    : undefined;

  const files: CodebaseFile[] = [];
  await walkDir(options.rootDir, excludeDirs, options.rootDir, langAllow, files, logger);

  return Object.freeze({
    rootDir: options.rootDir,
    files: Object.freeze(files),
    takenAt: Date.now(),
  });
}

async function walkDir(
  rootDir: string,
  exclude: ReadonlySet<string>,
  current: string,
  langAllow: ReadonlySet<string> | undefined,
  out: CodebaseFile[],
  logger: RuntimeLogger,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (err) {
    logger.warn('repository-map: readdir failed', {
      path: current,
      error: String(err),
    });
    return;
  }

  for (const entry of entries) {
    if (exclude.has(entry.name)) continue;
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      await walkDir(rootDir, exclude, full, langAllow, out, logger);
      continue;
    }
    if (!entry.isFile()) continue;

    const ext = extname(entry.name).slice(1).toLowerCase();
    const language = LANG_BY_EXT[ext] ?? 'unknown';
    if (language === 'unknown') continue;
    if (langAllow && !langAllow.has(language) && !langAllow.has(ext)) continue;

    let info;
    try {
      info = await stat(full);
    } catch (err) {
      logger.warn('repository-map: stat failed', { path: full, error: String(err) });
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(full);
    } catch (err) {
      logger.warn('repository-map: readFile failed', {
        path: full,
        error: String(err),
      });
      continue;
    }

    out.push(
      Object.freeze({
        path: relative(rootDir, full).split(sep).join('/'),
        size: info.size,
        mtimeMs: info.mtimeMs,
        contentHash: hashBuffer(bytes),
        language,
      }),
    );
  }
}

function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────
// Symbol extraction (regex fallback)
// ─────────────────────────────────────────────────────────────────

const TS_SYMBOL_RE =
  /^export\s+(?:default\s+)?(?:async\s+)?(function|class|interface|type|const)\s+([A-Za-z_$][\w$]*)/gm;
const TS_TOP_SYMBOL_RE =
  /^(?:async\s+)?(function|class|interface|type|const)\s+([A-Za-z_$][\w$]*)/gm;
const PY_SYMBOL_RE = /^(?:async\s+)?(def|class)\s+([A-Za-z_][\w]*)/gm;
const GO_SYMBOL_RE = /^(func)\s+(?:\([^)]*\)\s+)?([A-Z][\w]*)/gm;
const RUST_SYMBOL_RE = /^pub\s+(fn|struct|enum|trait|type)\s+([A-Za-z_][\w]*)/gm;

const KIND_MAP: Readonly<Record<string, RepositorySymbol['kind']>> = Object.freeze({
  function: 'function',
  func: 'function',
  fn: 'function',
  def: 'function',
  class: 'class',
  struct: 'class',
  enum: 'type',
  trait: 'interface',
  interface: 'interface',
  type: 'type',
  const: 'const',
});

export function extractSymbolsRegex(
  language: string,
  source: string,
): ReadonlyArray<RepositorySymbol> {
  const found: RepositorySymbol[] = [];
  const lines = source.split('\n');

  const pushFromRegex = (re: RegExp, kindFromMatch: (m: string) => string) => {
    let m;
    while ((m = re.exec(source)) !== null) {
      const kindStr = kindFromMatch(m[1] ?? '');
      const name = m[2] ?? '';
      if (!name) continue;
      const lineIdx = source.slice(0, m.index).split('\n').length - 1;
      const mappedKind = KIND_MAP[kindStr] ?? 'export';
      const docstring = extractDocstring(lines, lineIdx);
      const sym: RepositorySymbol = Object.freeze({
        name,
        kind: mappedKind,
        line: lineIdx + 1,
        ...(docstring !== undefined ? { docstring } : {}),
      });
      found.push(sym);
    }
  };

  if (language === 'typescript' || language === 'javascript') {
    pushFromRegex(TS_SYMBOL_RE, (k) => k);
    pushFromRegex(TS_TOP_SYMBOL_RE, (k) => k);
  } else if (language === 'python') {
    pushFromRegex(PY_SYMBOL_RE, (k) => k);
  } else if (language === 'go') {
    pushFromRegex(GO_SYMBOL_RE, () => 'function');
  } else if (language === 'rust') {
    pushFromRegex(RUST_SYMBOL_RE, (k) => k);
  }

  // De-dupe by name + line (TS top + export regexes can collide).
  const seen = new Set<string>();
  const out: RepositorySymbol[] = [];
  for (const s of found) {
    const key = `${s.name}@${s.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return Object.freeze(out);
}

function extractDocstring(lines: ReadonlyArray<string>, atLine: number): string | undefined {
  // Look upward for a /** ... */ or """...""" block.
  if (atLine <= 0) return undefined;
  const prev = lines[atLine - 1]?.trim() ?? '';
  // Case 1: single-line JSDoc on the previous line (`/** foo */`).
  const singleLine = prev.match(/^\/\*\*\s*(.*?)\s*\*\/$/);
  if (singleLine && singleLine[1]) {
    return singleLine[1].slice(0, 200);
  }
  // Case 2: multi-line JSDoc that ends with `*/` on the previous line.
  if (prev.startsWith('*/') || prev.endsWith('*/')) {
    for (let i = atLine - 2; i >= Math.max(0, atLine - 20); i--) {
      const line = lines[i]?.trim() ?? '';
      if (line.startsWith('/**')) {
        return lines
          .slice(i + 1, atLine - 1)
          .map((l) => l.trim().replace(/^\*\s?/, ''))
          .filter(Boolean)
          .join(' ')
          .slice(0, 200);
      }
    }
  }
  // Case 3: Python triple-string docstring (one or many lines).
  if (prev.startsWith('"""') || prev.endsWith('"""')) {
    for (let i = atLine - 2; i >= Math.max(0, atLine - 20); i--) {
      const line = lines[i]?.trim() ?? '';
      if (line.startsWith('"""')) {
        return lines
          .slice(i + 1, atLine - 1)
          .join(' ')
          .slice(0, 200);
      }
    }
  }
  return undefined;
}

export function parseSymbolsWithTreeSitter(
  parser: TreeSitterParserAdapter,
  language: string,
  source: string,
): ReadonlyArray<RepositorySymbol> {
  return parser.extractSymbols(language, source);
}

// ─────────────────────────────────────────────────────────────────
// File map + ranking + budget pruning
// ─────────────────────────────────────────────────────────────────

const IMPORT_RES: ReadonlyArray<RegExp> = Object.freeze([
  /(?:from|import)\s+['"]([^'"]+)['"]/g,
  /require\(['"]([^'"]+)['"]\)/g,
]);

function countImports(source: string): number {
  let total = 0;
  for (const re of IMPORT_RES) {
    const m = source.match(re);
    if (m) total += m.length;
  }
  return total;
}

function summarize(source: string): string | undefined {
  const lines = source.split('\n').slice(0, 80);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]?.trim() ?? '';
    if (t.startsWith('/**')) {
      const end = lines.findIndex((l, idx) => idx > i && l.includes('*/'));
      if (end > i) {
        return lines
          .slice(i + 1, end)
          .map((l) => l.trim().replace(/^\*\s?/, ''))
          .filter(Boolean)
          .join(' ')
          .slice(0, 240);
      }
    }
  }
  return undefined;
}

function rankScore(file: CodebaseFile, importCount: number, now: number): number {
  // Recency: 1.0 (today) decaying to 0.1 (1 year old).
  const ageDays = Math.max(1, (now - file.mtimeMs) / (24 * 60 * 60 * 1000));
  const recency = 1 / Math.log10(10 + ageDays);
  // Import-count: log-scaled so high-fanout files dominate but don't explode.
  const importScore = Math.log10(1 + importCount + 1);
  // Size: slight preference for medium files (very tiny + very huge get penalised).
  const kb = file.size / 1024;
  const sizeScore = kb < 1 ? 0.5 : kb > 500 ? 0.3 : 1.0;
  return recency * importScore * sizeScore;
}

export async function buildRepositoryMap(
  options: BuildRepositoryMapOptions,
): Promise<RepositoryMap> {
  if (!Number.isFinite(options.tokenBudget) || options.tokenBudget <= 0) {
    throw new Error('buildRepositoryMap: tokenBudget must be a positive finite number');
  }
  const logger = options.logger ?? noopLogger;
  const snapshot = await buildCodebaseSnapshot(options);

  const now = Date.now();
  const mapped: Array<{
    file: RepositoryFileMap;
    rank: number;
  }> = [];

  for (const f of snapshot.files) {
    let source: string;
    try {
      source = (await readFile(join(snapshot.rootDir, f.path))).toString('utf8');
    } catch (err) {
      logger.warn('repository-map: file read failed during mapping', {
        path: f.path,
        error: String(err),
      });
      continue;
    }
    const symbols = options.treeSitterParser
      ? parseSymbolsWithTreeSitter(options.treeSitterParser, f.language, source)
      : extractSymbolsRegex(f.language, source);
    const summary = summarize(source);
    const importCount = countImports(source);

    const tokenEstimate = Math.ceil(
      (f.path.length +
        (summary?.length ?? 0) +
        symbols.reduce((acc, s) => acc + s.name.length + (s.docstring?.length ?? 0) + 24, 0)) /
        APPROX_CHARS_PER_TOKEN,
    );

    const file: RepositoryFileMap = Object.freeze({
      path: f.path,
      language: f.language,
      symbols,
      ...(summary !== undefined ? { summary } : {}),
      importCount,
      tokenEstimate,
    });
    mapped.push({ file, rank: rankScore(f, importCount, now) });
  }

  // Sort by importance (highest first) and prune from the tail.
  mapped.sort((a, b) => b.rank - a.rank);

  const kept: RepositoryFileMap[] = [];
  const dropped: string[] = [];
  let total = 0;
  for (const m of mapped) {
    if (total + m.file.tokenEstimate <= options.tokenBudget) {
      kept.push(m.file);
      total += m.file.tokenEstimate;
    } else {
      dropped.push(m.file.path);
    }
  }

  // Cache key — content-hash of every included file's hash.
  const cacheKey = createHash('sha256')
    .update(kept.map((f) => `${f.path}:${snapshot.files.find((x) => x.path === f.path)?.contentHash ?? ''}`).join('|'))
    .digest('hex')
    .slice(0, 24);

  return Object.freeze({
    rootDir: snapshot.rootDir,
    files: Object.freeze(kept),
    tokenEstimate: total,
    tokenBudget: options.tokenBudget,
    droppedFiles: Object.freeze(dropped),
    cacheKey,
  });
}

// ─────────────────────────────────────────────────────────────────
// Content-addressed cache
// ─────────────────────────────────────────────────────────────────

const mapCache = new Map<string, RepositoryMap>();

export async function buildRepositoryMapCached(
  options: BuildRepositoryMapOptions,
): Promise<RepositoryMap> {
  // Cheap pre-check: snapshot only (no source reads) to compute pre-key.
  const snapshot = await buildCodebaseSnapshot(options);
  const preKey = createHash('sha256')
    .update(snapshot.files.map((f) => `${f.path}:${f.contentHash}`).join('|'))
    .update(String(options.tokenBudget))
    .digest('hex')
    .slice(0, 24);

  const hit = mapCache.get(preKey);
  if (hit) return hit;
  const fresh = await buildRepositoryMap(options);
  mapCache.set(preKey, fresh);
  return fresh;
}

export function clearRepositoryMapCache(): void {
  mapCache.clear();
}
