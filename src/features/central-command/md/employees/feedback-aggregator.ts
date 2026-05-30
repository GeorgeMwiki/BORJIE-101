/**
 * Employees — Feedback Aggregator
 *
 * Scans chat turns for mentions of employees, classifies the polarity of
 * each mention (positive / neutral / negative), and aggregates the
 * resulting `SentimentEvent` stream into per-employee summaries.
 *
 * Heuristic, deterministic, hermetic — production may swap in an LLM
 * with the same input/output shape.
 *
 * @module features/central-command/md/employees/feedback-aggregator
 */

import { randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logger";
import {
  feedbackTurnSchema,
  type Employee,
  type EmployeeSentiment,
  type FeedbackTurn,
  type SentimentAggregate,
  type SentimentEvent,
  type SentimentPolarity,
} from "./types";

const log = createLogger("md.employees.feedback");

const POSITIVE_TOKENS: ReadonlyArray<string> = Object.freeze([
  "great",
  "excellent",
  "awesome",
  "amazing",
  "outstanding",
  "fantastic",
  "crushed",
  "killed it",
  "love working with",
  "stellar",
  "exceptional",
  "rock star",
  "rockstar",
  "promote",
  "thank",
  "appreciate",
  "well done",
  "good job",
  "impressive",
]);

const NEGATIVE_TOKENS: ReadonlyArray<string> = Object.freeze([
  "concerned",
  "worried",
  "frustrat",
  "disappoint",
  "missed",
  "drop the ball",
  "underperform",
  "issue",
  "problem",
  "complaint",
  "argument",
  "argued",
  "slow",
  "late again",
  "no-show",
  "ghosted",
  "rude",
  "unprofessional",
]);

const NEGATION_TOKENS: ReadonlyArray<string> = Object.freeze([
  "not ",
  "no ",
  "never ",
  "isn't ",
  "wasn't ",
  "doesn't ",
  "didn't ",
]);

const RECENCY_HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export interface AggregatorInput {
  readonly turn: FeedbackTurn;
  readonly employees: ReadonlyArray<Employee>;
  readonly idGen?: () => string;
}

/**
 * Extract sentiment events from a single chat turn. Pure function.
 */
export function extractSentimentEvents(
  rawInput: AggregatorInput,
): ReadonlyArray<SentimentEvent> {
  const turn = feedbackTurnSchema.parse(rawInput.turn);
  const idGen = rawInput.idGen ?? randomUUID;
  const text = turn.text;
  const events: SentimentEvent[] = [];
  const lower = text.toLowerCase();

  for (const employee of rawInput.employees) {
    const occurrences = findOccurrences(text, employee.name);
    for (const occ of occurrences) {
      // Scoring window: stop at the nearest sentence boundary so a
      // negative phrase about another employee in the next clause
      // doesn't leak into this employee's polarity score.
      const window = sliceSentenceBounded(lower, occ.start, occ.end, 80);
      const polarityScore = scoreWindow(window);
      const polarity = classifyPolarity(polarityScore);
      const evidence = sliceSentenceBounded(
        text,
        occ.start,
        occ.end,
        80,
      ).trim();
      events.push(
        Object.freeze({
          id: idGen(),
          tenantId: turn.tenantId,
          employeeId: employee.id,
          polarity,
          score: clamp(polarityScore, -1, 1),
          evidence,
          originTurnId: turn.turnId,
          recordedAt: turn.recordedAt,
        }),
      );
    }
  }

  if (events.length === 0 && turn.nameMap) {
    // Fall back to nameMap-based extraction if the caller pre-resolved
    // aliases we don't know how to match.
    for (const [name, employeeId] of Object.entries(turn.nameMap)) {
      const occurrences = findOccurrences(text, name);
      for (const occ of occurrences) {
        const window = sliceSentenceBounded(lower, occ.start, occ.end, 80);
        const score = scoreWindow(window);
        events.push(
          Object.freeze({
            id: idGen(),
            tenantId: turn.tenantId,
            employeeId,
            polarity: classifyPolarity(score),
            score: clamp(score, -1, 1),
            evidence: sliceContext(text, occ.start, occ.end, 80).trim(),
            originTurnId: turn.turnId,
            recordedAt: turn.recordedAt,
          }),
        );
      }
    }
  }

  log.debug("extracted sentiment events", {
    turnId: turn.turnId,
    count: events.length,
  });

  return Object.freeze(events);
}

/**
 * Aggregate raw sentiment events into a per-employee weighted summary.
 * Recent events count more (exponential decay with 30-day half-life).
 */
export function aggregateForEmployee(
  employeeId: string,
  events: ReadonlyArray<SentimentEvent>,
  now: Date,
): SentimentAggregate {
  const myEvents = events.filter((e) => e.employeeId === employeeId);
  const counts: Record<SentimentPolarity, number> = {
    positive: 0,
    neutral: 0,
    negative: 0,
  };
  let weightedTotal = 0;
  let weightSum = 0;
  for (const e of myEvents) {
    counts[e.polarity] += 1;
    const ageDays =
      (now.getTime() - new Date(e.recordedAt).getTime()) / MS_PER_DAY;
    const weight = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
    weightedTotal += e.score * weight;
    weightSum += weight;
  }
  const weighted = weightSum > 0 ? weightedTotal / weightSum : 0;
  const classification = classifyAggregate(weighted, myEvents.length);
  return Object.freeze({
    employeeId,
    sampleSize: myEvents.length,
    weightedScore: weighted,
    counts: Object.freeze(counts),
    classification,
  });
}

/**
 * Aggregate across every employee mentioned in `events`.
 */
export function aggregateAcrossEmployees(
  events: ReadonlyArray<SentimentEvent>,
  now: Date,
): ReadonlyArray<SentimentAggregate> {
  const seen = new Set<string>();
  for (const e of events) seen.add(e.employeeId);
  return Object.freeze(
    [...seen].map((id) => aggregateForEmployee(id, events, now)),
  );
}

// ---------------- helpers ----------------

function findOccurrences(
  text: string,
  needle: string,
): ReadonlyArray<{ start: number; end: number }> {
  if (!needle) return [];
  const out: Array<{ start: number; end: number }> = [];
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let from = 0;
  while (true) {
    const idx = lowerText.indexOf(lowerNeedle, from);
    if (idx < 0) break;
    const before = idx === 0 ? " " : lowerText[idx - 1]!;
    const after =
      idx + lowerNeedle.length >= lowerText.length
        ? " "
        : lowerText[idx + lowerNeedle.length]!;
    if (!isWordChar(before) && !isWordChar(after)) {
      out.push({ start: idx, end: idx + lowerNeedle.length });
    }
    from = idx + lowerNeedle.length;
  }
  return out;
}

function isWordChar(c: string): boolean {
  return /[\w]/.test(c);
}

function sliceContext(
  text: string,
  start: number,
  end: number,
  radius: number,
): string {
  const a = Math.max(0, start - radius);
  const b = Math.min(text.length, end + radius);
  return text.slice(a, b);
}

/**
 * Like `sliceContext` but stops at the nearest sentence boundary
 * (`. ! ?`) on either side of the mention. Critical when one chat
 * turn names two employees in adjacent sentences with opposite
 * sentiment — without sentence clipping, the negative phrase about
 * one employee bleeds into the positive score for the other.
 */
function sliceSentenceBounded(
  text: string,
  start: number,
  end: number,
  radius: number,
): string {
  const lo = Math.max(0, start - radius);
  const hi = Math.min(text.length, end + radius);
  // Walk backward from `start` to find the previous sentence end.
  let a = start;
  while (a > lo) {
    const ch = text[a - 1];
    if (ch === "." || ch === "!" || ch === "?") break;
    a -= 1;
  }
  // Walk forward from `end` to find the next sentence end.
  let b = end;
  while (b < hi) {
    const ch = text[b];
    if (ch === "." || ch === "!" || ch === "?") {
      b += 1; // include the terminator
      break;
    }
    b += 1;
  }
  return text.slice(a, b);
}

function scoreWindow(window: string): number {
  let score = 0;
  for (const tok of POSITIVE_TOKENS) {
    if (window.includes(tok)) {
      score += isNegated(window, tok) ? -0.5 : 0.6;
    }
  }
  for (const tok of NEGATIVE_TOKENS) {
    if (window.includes(tok)) {
      score += isNegated(window, tok) ? 0.4 : -0.7;
    }
  }
  return clamp(score, -1, 1);
}

function isNegated(window: string, token: string): boolean {
  const idx = window.indexOf(token);
  if (idx < 0) return false;
  const before = window.slice(Math.max(0, idx - 20), idx);
  return NEGATION_TOKENS.some((n) => before.includes(n));
}

function classifyPolarity(score: number): SentimentPolarity {
  if (score >= 0.2) return "positive";
  if (score <= -0.2) return "negative";
  return "neutral";
}

function classifyAggregate(
  weighted: number,
  sampleSize: number,
): EmployeeSentiment {
  if (sampleSize === 0) return "neutral";
  if (weighted <= -0.15) return "concerning";
  if (weighted >= 0.2) return "positive";
  return "neutral";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
