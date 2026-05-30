/**
 * Follow-Up — Commitment Extractor
 *
 * Detects commitments + deadlines inside a chat turn. The default
 * implementation is a deterministic, dependency-free heuristic so tests
 * run hermetically; production wires an LLM-backed extractor with the
 * same `ExtractorFn` shape.
 *
 * Examples handled:
 *   - "I'll get back to you Tuesday"
 *   - "we'll review pricing next month"
 *   - "let's circle back in 2 weeks"
 *   - "by end of day Friday"
 *   - "follow up tomorrow morning"
 *
 * Returns an empty array when no commitment is present — never throws.
 *
 * @module features/central-command/md/follow-up/extractor
 */

import { createLogger } from "@/lib/logger";
import {
  extractorInputSchema,
  type ExtractedCommitment,
  type ExtractorFn,
  type ExtractorInput,
  type FollowUpPriority,
} from "./types";

const log = createLogger("md.follow-up.extractor");

const COMMIT_VERBS = [
  "i'll",
  "i will",
  "we'll",
  "we will",
  "let's",
  "let me",
  "going to",
  "gonna",
  "plan to",
  "follow up",
  "circle back",
  "get back to",
  "review",
  "check in",
  "touch base",
  "ping you",
  "reach out",
  "send",
  "deliver",
];

const PRIORITY_HINTS: ReadonlyArray<{
  readonly token: string;
  readonly level: FollowUpPriority;
}> = Object.freeze([
  { token: "urgent", level: "urgent" },
  { token: "asap", level: "urgent" },
  { token: "right away", level: "urgent" },
  { token: "immediately", level: "urgent" },
  { token: "high priority", level: "high" },
  { token: "important", level: "high" },
  { token: "when you can", level: "low" },
  { token: "no rush", level: "low" },
  { token: "eventually", level: "low" },
]);

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * Public default extractor function. Pure with respect to the inputs;
 * the only nondeterminism comes from the supplied `now` reference.
 */
export const defaultExtractor: ExtractorFn = async (
  rawInput: ExtractorInput,
): Promise<ReadonlyArray<ExtractedCommitment>> => {
  const input = extractorInputSchema.parse(rawInput);
  const now = new Date(input.now);
  if (Number.isNaN(now.getTime())) {
    log.warn("invalid now timestamp", { turnId: input.turnId });
    return Object.freeze([]);
  }

  const sentences = splitSentences(input.text);
  const commits: ExtractedCommitment[] = [];
  for (const s of sentences) {
    const norm = s.toLowerCase();
    if (!hasCommitVerb(norm)) continue;
    const due = resolveDueDate(norm, now);
    if (!due) continue;
    const priority = resolvePriority(norm);
    const subject = trimSubject(s);
    commits.push(
      Object.freeze({
        subject,
        dueAt: due.toISOString(),
        confidence: scoreConfidence(norm),
        priority,
        evidence: s.trim(),
      }),
    );
  }
  return Object.freeze(commits);
};

function splitSentences(text: string): ReadonlyArray<string> {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function hasCommitVerb(s: string): boolean {
  return COMMIT_VERBS.some((v) => s.includes(v));
}

function resolvePriority(s: string): FollowUpPriority {
  for (const hint of PRIORITY_HINTS) {
    if (s.includes(hint.token)) return hint.level;
  }
  return "normal";
}

function scoreConfidence(s: string): number {
  let score = 0.4;
  if (/\bi'?ll\b|\bwe'?ll\b/.test(s)) score += 0.2;
  if (/\bby\b|\bbefore\b|\bon\b/.test(s)) score += 0.1;
  if (/\bfollow up|circle back|get back/.test(s)) score += 0.2;
  return Math.min(score, 0.99);
}

function trimSubject(sentence: string): string {
  const out = sentence.trim();
  return out.length > 200 ? out.slice(0, 197) + "..." : out;
}

/**
 * Resolve a due-date for a normalized (lowercase) sentence relative to
 * `now`. Returns `null` when no temporal anchor can be found.
 *
 * Resolution rules (first match wins):
 *   1. "tomorrow [morning|afternoon|evening]"
 *   2. "today"
 *   3. "by end of day" / "eod"  → today 17:00 local
 *   4. "next <weekday>"         → following week's weekday at 09:00
 *   5. "<weekday>"              → next occurrence (>= 1 day ahead)
 *   6. "in N day(s)/week(s)/month(s)" → arithmetic
 *   7. "next week"              → +7 days
 *   8. "next month"             → +30 days
 */
function resolveDueDate(s: string, now: Date): Date | null {
  if (s.includes("tomorrow")) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + 1);
    return atHour(d, hourFromPhrase(s));
  }
  if (/\btoday\b/.test(s)) {
    return atHour(new Date(now), hourFromPhrase(s));
  }
  if (/\b(eod|end of day)\b/.test(s)) {
    return atHour(new Date(now), 17);
  }
  const nextWeekday = matchNextWeekday(s, now);
  if (nextWeekday) return nextWeekday;
  const weekday = matchWeekday(s, now);
  if (weekday) return weekday;
  const inN = matchInN(s, now);
  if (inN) return inN;
  if (/\bnext week\b/.test(s)) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + 7);
    return atHour(d, 9);
  }
  if (/\bnext month\b/.test(s)) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + 30);
    return atHour(d, 9);
  }
  return null;
}

function hourFromPhrase(s: string): number {
  if (/morning/.test(s)) return 9;
  if (/afternoon/.test(s)) return 14;
  if (/evening|tonight/.test(s)) return 18;
  return 9;
}

function atHour(d: Date, h: number): Date {
  const out = new Date(d);
  out.setUTCHours(h, 0, 0, 0);
  return out;
}

function matchWeekday(s: string, now: Date): Date | null {
  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    const name = WEEKDAYS[i];
    const re = new RegExp(`\\b${name}\\b`);
    if (re.test(s)) {
      const today = now.getUTCDay();
      let diff = i - today;
      if (diff <= 0) diff += 7;
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + diff);
      return atHour(d, 9);
    }
  }
  return null;
}

function matchNextWeekday(s: string, now: Date): Date | null {
  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    const name = WEEKDAYS[i];
    const re = new RegExp(`\\bnext\\s+${name}\\b`);
    if (re.test(s)) {
      const today = now.getUTCDay();
      let diff = i - today;
      if (diff <= 0) diff += 7;
      // "next <weekday>" means the FOLLOWING week's occurrence,
      // not the imminent one — add a full 7 days if diff < 7.
      if (diff < 7) diff += 7;
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + diff);
      return atHour(d, 9);
    }
  }
  return null;
}

function matchInN(s: string, now: Date): Date | null {
  const re = /\bin\s+(\d{1,3})\s+(day|days|week|weeks|month|months)\b/;
  const m = s.match(re);
  if (!m) return null;
  const n = parseInt(m[1] ?? "", 10);
  const unit = m[2] ?? "";
  if (Number.isNaN(n) || n <= 0) return null;
  const d = new Date(now);
  if (unit.startsWith("day")) d.setUTCDate(d.getUTCDate() + n);
  else if (unit.startsWith("week")) d.setUTCDate(d.getUTCDate() + n * 7);
  else if (unit.startsWith("month")) d.setUTCDate(d.getUTCDate() + n * 30);
  return atHour(d, 9);
}
