/**
 * Lesson renderer — Phase E gap-closure (P8 Gap 7).
 *
 * Pure function. Given a `LessonStore`, a tenant id, a task tag, and
 * (optional) bounds, returns a system-prompt fragment to prepend to
 * the next kernel turn. The fragment is bounded by token budget AND
 * a hard lesson-count cap. Selection is LRU-by-(recency × relevance):
 * the store returns lessons already sorted by `recencyScore` desc, the
 * renderer then walks them in that order and greedily fills the
 * token budget. Anything past the budget is silently dropped.
 *
 * Pure / I/O-free apart from the store call. No clock, no PRNG.
 */

import {
  CHARS_PER_TOKEN,
  DEFAULT_MAX_LESSONS,
  DEFAULT_MAX_TOKENS,
  type Lesson,
  type LessonStore,
  type RendererOptions,
} from './types.js';

/**
 * Wrap a lesson into the prompt-fragment line format. Stable shape so
 * downstream auditors can grep for "[lesson lsn_…]" in trace exports.
 */
function formatLine(lesson: Lesson): string {
  return `- [lesson ${lesson.id}] ${lesson.lesson} (evidence: ${lesson.evidence})`;
}

/** Approximate token count via a chars-per-token heuristic. */
function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

const HEADER = '## Lessons from prior turns (Reflexion)';
const HEADER_TOKENS = approxTokens(HEADER) + 2; // newline + spacing

/**
 * Render recent lessons for a tenant + task tag into a system-prompt
 * fragment. Returns an empty string when the store has no lessons OR
 * when the token budget can't fit even the header.
 */
export async function renderLessons(
  store: LessonStore,
  tenantId: string,
  taskTag: string,
  options: RendererOptions = {},
): Promise<string> {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxLessons = options.maxLessons ?? DEFAULT_MAX_LESSONS;

  if (maxTokens <= HEADER_TOKENS) return '';

  const lessons = await store.recent(tenantId, taskTag, maxLessons);
  if (lessons.length === 0) return '';

  const lines: string[] = [];
  let usedTokens = HEADER_TOKENS;
  for (const lesson of lessons) {
    const line = formatLine(lesson);
    const cost = approxTokens(line) + 1; // +1 for newline
    if (usedTokens + cost > maxTokens) {
      // LRU eviction: stop at the first lesson that would blow the cap.
      // Lessons are already sorted by recencyScore desc by the store, so
      // the dropped tail is the least-recent / least-relevant set.
      break;
    }
    lines.push(line);
    usedTokens += cost;
  }

  if (lines.length === 0) return '';
  return `${HEADER}\n${lines.join('\n')}`;
}
