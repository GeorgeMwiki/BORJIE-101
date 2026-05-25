/**
 * Minimal-diff editing — Aider / Cline style.
 *
 * Three dialects supported:
 *
 *   1. unified         — standard unified diff hunks
 *   2. search-replace  — Aider's preferred format (unambiguous,
 *                        survives token boundaries better than
 *                        unified-diff line numbers)
 *   3. ast-aware       — placeholder for a tree-sitter mutation list
 *                        (encoded JSON; applied via injected adapter)
 *
 * The brain is asked to propose a minimal diff for an intent. We
 * then:
 *
 *   - apply it deterministically (no fuzz, no positional guessing)
 *   - report conflicts (search not found, ambiguous matches, …)
 *   - verify no side effects (changes outside the stated intent)
 *
 * This module never calls the brain itself — it's a deterministic
 * apply/verify engine plus a `proposeMinimalDiff` helper that wraps
 * a `BrainPort`.
 */

import type {
  BrainPort,
  DiffDialect,
  EditApplyConflict,
  EditApplyResult,
  EditProposal,
  MinimalDiff,
  SearchReplaceBlock,
  SideEffectReport,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────
// Brain-backed proposal
// ─────────────────────────────────────────────────────────────────

export interface ProposeMinimalDiffOptions {
  readonly filePath: string;
  readonly before: string;
  readonly intent: string;
  readonly brain: BrainPort;
  readonly dialect?: DiffDialect;
  /** Truncate the before-content sent to the brain (chars). */
  readonly maxContextChars?: number;
}

const DEFAULT_DIALECT: DiffDialect = 'search-replace';
const DEFAULT_MAX_CONTEXT = 16_000;

export async function proposeMinimalDiff(
  options: ProposeMinimalDiffOptions,
): Promise<EditProposal> {
  const dialect = options.dialect ?? DEFAULT_DIALECT;
  const ctxCap = options.maxContextChars ?? DEFAULT_MAX_CONTEXT;
  const context =
    options.before.length > ctxCap
      ? options.before.slice(0, ctxCap) + '\n... [truncated]'
      : options.before;

  const prompt = renderDiffPrompt(dialect, options.filePath, context, options.intent);
  const res = await options.brain.generate({ prompt });
  const diff = parseDiff(dialect, res.text);
  const rationale = extractRationale(res.text);

  return Object.freeze({
    filePath: options.filePath,
    intent: options.intent,
    diff,
    ...(rationale !== undefined ? { rationale } : {}),
  });
}

function renderDiffPrompt(
  dialect: DiffDialect,
  filePath: string,
  before: string,
  intent: string,
): string {
  if (dialect === 'unified') {
    return `Produce a minimal unified diff for ${filePath} that achieves: ${intent}\n\nFILE:\n${before}`;
  }
  if (dialect === 'ast-aware') {
    return `Produce a minimal AST-mutation list (JSON) for ${filePath} that achieves: ${intent}\n\nFILE:\n${before}`;
  }
  return [
    `Produce a series of SEARCH/REPLACE blocks for ${filePath} that achieves: ${intent}`,
    `Each block:\n<<<<<<< SEARCH\n<exact text>\n=======\n<replacement>\n>>>>>>> REPLACE`,
    `Keep replacements MINIMAL — do not modify untouched lines.`,
    ``,
    `FILE:`,
    before,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────

const SR_BLOCK_RE = /<<<<<<<\s*SEARCH\s*\r?\n([\s\S]*?)\r?\n=======\s*\r?\n([\s\S]*?)\r?\n>>>>>>>\s*REPLACE/g;

export function parseDiff(dialect: DiffDialect, text: string): MinimalDiff {
  if (dialect === 'unified') {
    const fenced = extractFencedBlock(text, 'diff') ?? text;
    return Object.freeze({ dialect, unifiedDiff: fenced });
  }
  if (dialect === 'ast-aware') {
    const fenced = extractFencedBlock(text, 'json') ?? text;
    return Object.freeze({ dialect, astMutations: fenced });
  }
  // search-replace
  const blocks: SearchReplaceBlock[] = [];
  let m;
  while ((m = SR_BLOCK_RE.exec(text)) !== null) {
    blocks.push(
      Object.freeze({
        search: m[1] ?? '',
        replace: m[2] ?? '',
      }),
    );
  }
  // Reset lastIndex so subsequent calls work.
  SR_BLOCK_RE.lastIndex = 0;
  return Object.freeze({ dialect, searchReplaceBlocks: Object.freeze(blocks) });
}

function extractFencedBlock(text: string, lang: string): string | undefined {
  const re = new RegExp('```' + lang + '\\r?\\n([\\s\\S]*?)```', 'm');
  const m = text.match(re);
  return m?.[1];
}

function extractRationale(text: string): string | undefined {
  const m = text.match(/^Rationale:\s*(.+)$/m);
  return m?.[1]?.trim();
}

// ─────────────────────────────────────────────────────────────────
// Apply
// ─────────────────────────────────────────────────────────────────

export interface ApplyEditProposalOptions {
  readonly proposal: EditProposal;
  readonly fileBytes: string;
  /** Inject a custom AST adapter for `ast-aware` dialect. */
  readonly astAdapter?: AstApplyAdapter;
}

export interface AstApplyAdapter {
  readonly apply: (source: string, encodedMutations: string) => string;
}

export function applyEditProposal(options: ApplyEditProposalOptions): EditApplyResult {
  const { diff } = options.proposal;

  if (diff.dialect === 'search-replace') {
    return applySearchReplace(options.fileBytes, diff.searchReplaceBlocks ?? []);
  }
  if (diff.dialect === 'unified') {
    return applyUnifiedDiff(options.fileBytes, diff.unifiedDiff ?? '');
  }
  // ast-aware
  if (!options.astAdapter) {
    return Object.freeze({
      newBytes: options.fileBytes,
      conflicts: Object.freeze([
        Object.freeze({
          kind: 'patch-rejected' as const,
          detail: 'AST dialect requires an astAdapter',
        }),
      ]),
      appliedHunks: 0,
    });
  }
  try {
    const out = options.astAdapter.apply(options.fileBytes, diff.astMutations ?? '');
    return Object.freeze({ newBytes: out, conflicts: Object.freeze([]), appliedHunks: 1 });
  } catch (err) {
    return Object.freeze({
      newBytes: options.fileBytes,
      conflicts: Object.freeze([
        Object.freeze({
          kind: 'patch-rejected' as const,
          detail: `AST adapter failed: ${String(err)}`,
        }),
      ]),
      appliedHunks: 0,
    });
  }
}

function applySearchReplace(
  source: string,
  blocks: ReadonlyArray<SearchReplaceBlock>,
): EditApplyResult {
  if (blocks.length === 0) {
    return Object.freeze({
      newBytes: source,
      conflicts: Object.freeze([
        Object.freeze({
          kind: 'patch-rejected' as const,
          detail: 'no SEARCH/REPLACE blocks parsed',
        }),
      ]),
      appliedHunks: 0,
    });
  }
  let current = source;
  const conflicts: EditApplyConflict[] = [];
  let applied = 0;
  for (const block of blocks) {
    const occurrences = countOccurrences(current, block.search);
    if (occurrences === 0) {
      conflicts.push(
        Object.freeze({
          kind: 'search-not-found' as const,
          detail: `SEARCH block not found: ${truncateForLog(block.search)}`,
        }),
      );
      continue;
    }
    if (occurrences > 1) {
      conflicts.push(
        Object.freeze({
          kind: 'ambiguous' as const,
          detail: `SEARCH block matched ${occurrences} times — refusing to apply: ${truncateForLog(block.search)}`,
        }),
      );
      continue;
    }
    current = current.replace(block.search, () => block.replace);
    applied++;
  }
  return Object.freeze({
    newBytes: current,
    conflicts: Object.freeze(conflicts),
    appliedHunks: applied,
  });
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function truncateForLog(s: string): string {
  return s.length > 80 ? s.slice(0, 80) + '...' : s;
}

// ─────────────────────────────────────────────────────────────────
// Unified diff apply (line-precise, no fuzz)
// ─────────────────────────────────────────────────────────────────

interface UnifiedHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly body: ReadonlyArray<string>;
}

function parseUnifiedHunks(diff: string): ReadonlyArray<UnifiedHunk> {
  const lines = diff.split('\n');
  const hunks: UnifiedHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const m = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!m) {
      i++;
      continue;
    }
    const oldStart = Number(m[1]);
    const oldLines = m[2] ? Number(m[2]) : 1;
    const newStart = Number(m[3]);
    const newLines = m[4] ? Number(m[4]) : 1;
    const body: string[] = [];
    i++;
    while (i < lines.length && !lines[i]?.startsWith('@@')) {
      const ln = lines[i] ?? '';
      if (ln.startsWith('---') || ln.startsWith('+++') || ln.startsWith('diff ')) {
        i++;
        continue;
      }
      body.push(ln);
      i++;
    }
    hunks.push(
      Object.freeze({
        oldStart,
        oldLines,
        newStart,
        newLines,
        body: Object.freeze(body),
      }),
    );
  }
  return Object.freeze(hunks);
}

function applyUnifiedDiff(source: string, diff: string): EditApplyResult {
  const hunks = parseUnifiedHunks(diff);
  if (hunks.length === 0) {
    return Object.freeze({
      newBytes: source,
      conflicts: Object.freeze([
        Object.freeze({
          kind: 'patch-rejected' as const,
          detail: 'no @@ hunks parsed',
        }),
      ]),
      appliedHunks: 0,
    });
  }
  const srcLines = source.split('\n');
  const out: string[] = [];
  const conflicts: EditApplyConflict[] = [];
  let srcIdx = 0; // 0-based pointer in srcLines
  let applied = 0;

  for (const hunk of hunks) {
    const hunkStart = hunk.oldStart - 1;
    if (hunkStart < srcIdx) {
      conflicts.push(
        Object.freeze({
          kind: 'patch-rejected' as const,
          detail: `hunk @@ -${hunk.oldStart} overlaps previous hunk`,
        }),
      );
      continue;
    }
    // Copy untouched lines up to the hunk.
    while (srcIdx < hunkStart) {
      out.push(srcLines[srcIdx] ?? '');
      srcIdx++;
    }
    // Apply the hunk body.
    let consumed = 0;
    let hunkOk = true;
    for (const line of hunk.body) {
      if (line.startsWith(' ')) {
        const expected = line.slice(1);
        if (srcLines[srcIdx] !== expected) {
          conflicts.push(
            Object.freeze({
              kind: 'patch-rejected' as const,
              detail: `context mismatch at line ${srcIdx + 1}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(srcLines[srcIdx])}`,
            }),
          );
          hunkOk = false;
          break;
        }
        out.push(expected);
        srcIdx++;
        consumed++;
      } else if (line.startsWith('-')) {
        const expected = line.slice(1);
        if (srcLines[srcIdx] !== expected) {
          conflicts.push(
            Object.freeze({
              kind: 'patch-rejected' as const,
              detail: `removal mismatch at line ${srcIdx + 1}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(srcLines[srcIdx])}`,
            }),
          );
          hunkOk = false;
          break;
        }
        srcIdx++;
        consumed++;
      } else if (line.startsWith('+')) {
        out.push(line.slice(1));
      } else {
        // Tolerate empty trailing lines.
        if (line === '' && srcLines[srcIdx] === '') {
          out.push('');
          srcIdx++;
          consumed++;
        }
      }
    }
    if (hunkOk) applied++;
    void consumed;
  }
  while (srcIdx < srcLines.length) {
    out.push(srcLines[srcIdx] ?? '');
    srcIdx++;
  }
  return Object.freeze({
    newBytes: out.join('\n'),
    conflicts: Object.freeze(conflicts),
    appliedHunks: applied,
  });
}

// ─────────────────────────────────────────────────────────────────
// Side-effect verifier
// ─────────────────────────────────────────────────────────────────

export interface VerifyDiffNoSideEffectsOptions {
  readonly before: string;
  readonly after: string;
  /** Optional set of allow-listed files the proposal claims to touch. */
  readonly intendedFilePaths?: ReadonlyArray<string>;
  /** Optional map of other-file changes detected by the caller. */
  readonly otherFileChanges?: ReadonlyArray<string>;
  /**
   * Threshold: if changed-line count exceeds N% of total lines, flag
   * as non-focused. Default 20.
   */
  readonly nonFocusedPercent?: number;
}

export function verifyDiffNoSideEffects(
  options: VerifyDiffNoSideEffectsOptions,
): SideEffectReport {
  const beforeLines = options.before.split('\n');
  const afterLines = options.after.split('\n');
  const changed = countChangedLines(beforeLines, afterLines);
  const total = Math.max(beforeLines.length, afterLines.length, 1);
  const pct = (changed / total) * 100;
  const limit = options.nonFocusedPercent ?? 20;
  const intended = new Set(options.intendedFilePaths ?? []);
  const unexpectedFiles = (options.otherFileChanges ?? []).filter(
    (p) => !intended.has(p),
  );
  return Object.freeze({
    unexpectedLineChanges: changed,
    unexpectedFilesTouched: Object.freeze(unexpectedFiles),
    isFocused: pct <= limit && unexpectedFiles.length === 0,
  });
}

function countChangedLines(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): number {
  const max = Math.max(a.length, b.length);
  let changed = 0;
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) changed++;
  }
  return changed;
}
