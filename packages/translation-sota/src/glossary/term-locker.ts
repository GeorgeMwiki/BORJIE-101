/**
 * Term locker — the load-bearing correctness piece for the
 * translation runner.
 *
 * Two-pass design borrowed from the terminology-constrained MT
 * literature:
 *   - arxiv 2310.05824 "Terminology-Aware Translation with
 *     Constrained Decoding and Large Language Model Prompting"
 *     (October 2023):
 *     https://arxiv.org/pdf/2310.05824
 *   - arxiv 2004.12681 "Lexically Constrained Neural Machine
 *     Translation with Levenshtein Transformer" (2020):
 *     https://arxiv.org/pdf/2004.12681
 *
 * Pass 1 (`lockTerms`): scan source text for glossary matches
 * (longest-match wins, case-insensitive), replace each matched span
 * with a placeholder `<<G:NNNN>>`. Return the placeholder-laced
 * source + the placeholder-to-target-term map.
 *
 * Pass 2 (provider call): in the runner. The provider gets the
 * placeholder-laced source plus an explicit "preserve placeholders"
 * directive in the system prompt.
 *
 * Pass 3 (`unlockTerms`): swap each placeholder back to its target-
 * side glossary term. `verifyTermSurvival` then verifies (a) every
 * placeholder is present in the output exactly once and (b) every
 * substituted term is preserved verbatim in the post-substituted
 * output. Returns a 0..1 adherence ratio.
 */

import type { CodeSwitchSegment, Glossary, GlossaryEntry } from '../types.js';
import { filterForDirection } from './glossary-manager.js';

export interface LockResult {
  /** Source text with glossary spans replaced by `<<G:NNNN>>` tokens. */
  readonly placeholderSource: string;
  /** Placeholder token → target-side glossary term. */
  readonly placeholders: ReadonlyArray<PlaceholderBinding>;
  /** All glossary entries that fired. */
  readonly entriesUsed: ReadonlyArray<GlossaryEntry>;
}

export interface PlaceholderBinding {
  readonly token: string;
  readonly entry: GlossaryEntry;
  /** Byte offsets where the original term sat (for code-switch tagging). */
  readonly startByte: number;
  readonly endByte: number;
}

/**
 * Pass 1 — pre-substitute. Walks the source text scanning for the
 * longest possible glossary match starting at each position.
 * Case-insensitive on the source side, but the original casing of the
 * matched span is discarded (the placeholder will be replaced with the
 * canonical target term in pass 3).
 */
export function lockTerms(
  sourceText: string,
  glossary: Glossary,
  sourceLang: 'sw' | 'en',
  targetLang: 'sw' | 'en',
): LockResult {
  const filtered = filterForDirection(glossary, sourceLang, targetLang);
  // Longest-first sorted entry list so prefix matches don't shadow
  // multi-word entries.
  const sortedEntries: ReadonlyArray<GlossaryEntry> = [...filtered.entries]
    .slice()
    .sort((a, b) => b.srcTerm.length - a.srcTerm.length);

  const bindings: PlaceholderBinding[] = [];
  const entriesUsed: GlossaryEntry[] = [];
  const lowerSource = sourceText.toLowerCase();
  const consumed = new Array<boolean>(sourceText.length).fill(false);

  let placeholderCounter = 1;
  for (const entry of sortedEntries) {
    const needle = entry.srcTerm.toLowerCase();
    if (needle.length === 0) {
      continue;
    }
    let cursor = 0;
    while (cursor <= lowerSource.length - needle.length) {
      const idx = lowerSource.indexOf(needle, cursor);
      if (idx < 0) {
        break;
      }
      // Skip if we've already consumed any byte inside this span.
      const collision = anyConsumed(consumed, idx, idx + needle.length);
      if (collision) {
        cursor = idx + 1;
        continue;
      }
      // Require word boundaries on both sides so partial matches don't
      // fire (e.g. "ml" should not match inside "controlment").
      if (!hasWordBoundary(sourceText, idx, idx + needle.length)) {
        cursor = idx + 1;
        continue;
      }
      const token = makePlaceholder(placeholderCounter);
      placeholderCounter += 1;
      bindings.push(
        Object.freeze({
          token,
          entry,
          startByte: idx,
          endByte: idx + needle.length,
        }),
      );
      entriesUsed.push(entry);
      for (let i = idx; i < idx + needle.length; i += 1) {
        consumed[i] = true;
      }
      cursor = idx + needle.length;
    }
  }

  // Render: replace each binding's original span with its placeholder
  // token, walking left-to-right. Sort bindings by startByte.
  const ordered = [...bindings].slice().sort((a, b) => a.startByte - b.startByte);
  let rendered = '';
  let pos = 0;
  for (const binding of ordered) {
    rendered += sourceText.slice(pos, binding.startByte);
    rendered += binding.token;
    pos = binding.endByte;
  }
  rendered += sourceText.slice(pos);

  return Object.freeze({
    placeholderSource: rendered,
    placeholders: Object.freeze([...bindings]),
    entriesUsed: Object.freeze([...entriesUsed]),
  });
}

/**
 * Pass 3 (a) — post-substitute. Replace each placeholder in the
 * provider output with its target-side glossary term.
 */
export function unlockTerms(
  providerOutput: string,
  placeholders: ReadonlyArray<PlaceholderBinding>,
): string {
  let result = providerOutput;
  for (const binding of placeholders) {
    // Use a global replace because some providers may emit the
    // placeholder more than once (which is itself a constraint
    // violation but we want the unlock pass to still terminate).
    const escaped = escapeRegExp(binding.token);
    result = result.replace(new RegExp(escaped, 'g'), binding.entry.targetTerm);
  }
  return result;
}

/**
 * Pass 3 (b) — verify. Returns adherence ratio in [0, 1]: fraction of
 * placeholders that appear exactly once in the provider output AND
 * whose target term survives verbatim in the post-substituted text.
 *
 * A perfect run returns 1.0. Any placeholder missing, duplicated, or
 * whose target term was mangled drops the ratio.
 */
export function verifyTermSurvival(
  providerOutput: string,
  finalOutput: string,
  placeholders: ReadonlyArray<PlaceholderBinding>,
): number {
  if (placeholders.length === 0) {
    return 1;
  }
  let survived = 0;
  for (const binding of placeholders) {
    const placeholderOccurrences = countOccurrences(
      providerOutput,
      binding.token,
    );
    if (placeholderOccurrences !== 1) {
      continue;
    }
    if (!finalOutput.includes(binding.entry.targetTerm)) {
      continue;
    }
    survived += 1;
  }
  return survived / placeholders.length;
}

/**
 * Translate placeholder bindings to a list of code-switch segments
 * tagged as `placeholder` or `brand` (for brand-flagged entries) so
 * the runner can carry them across the segmenter boundary.
 */
export function bindingsToSegments(
  bindings: ReadonlyArray<PlaceholderBinding>,
): ReadonlyArray<CodeSwitchSegment> {
  return Object.freeze(
    bindings.map((binding) =>
      Object.freeze({
        text: binding.entry.srcTerm,
        tag: (binding.entry.brand === true ? 'brand' : 'placeholder') as
          | 'placeholder'
          | 'brand',
        startByte: binding.startByte,
        endByte: binding.endByte,
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlaceholder(idx: number): string {
  return `<<G:${idx.toString().padStart(4, '0')}>>`;
}

function anyConsumed(
  consumed: ReadonlyArray<boolean>,
  start: number,
  end: number,
): boolean {
  for (let i = start; i < end; i += 1) {
    if (consumed[i] === true) {
      return true;
    }
  }
  return false;
}

function hasWordBoundary(
  source: string,
  start: number,
  end: number,
): boolean {
  const leftChar = start > 0 ? source[start - 1] : undefined;
  const rightChar = end < source.length ? source[end] : undefined;
  return isBoundary(leftChar) && isBoundary(rightChar);
}

function isBoundary(ch: string | undefined): boolean {
  if (ch === undefined) {
    return true;
  }
  return /[^\p{L}\p{N}_]/u.test(ch);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let pos = 0;
  while (pos <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, pos);
    if (idx < 0) {
      break;
    }
    count += 1;
    pos = idx + needle.length;
  }
  return count;
}
