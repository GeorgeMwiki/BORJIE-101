/**
 * Trace helpers — internal. Building immutable trace entries with the
 * canonical ISO timestamp + agentId formatting all patterns share.
 */

import type { ExecutionResult, ExecutionTraceEntry, TokenUsage } from '../types.js';
import { nowIso } from '../types.js';

type Kind = ExecutionTraceEntry['kind'];

function entry(kind: Kind, detail: string, agentId?: string): ExecutionTraceEntry {
  if (agentId !== undefined) {
    return Object.freeze({ at: nowIso(), kind, detail, agentId });
  }
  return Object.freeze({ at: nowIso(), kind, detail });
}

export function thought(detail: string, agentId?: string): ExecutionTraceEntry {
  return entry('thought', detail, agentId);
}

export function action(detail: string, agentId?: string): ExecutionTraceEntry {
  return entry('action', detail, agentId);
}

export function observation(detail: string, agentId?: string): ExecutionTraceEntry {
  return entry('observation', detail, agentId);
}

export function planEntry(detail: string, agentId?: string): ExecutionTraceEntry {
  return entry('plan', detail, agentId);
}

export function critiqueEntry(detail: string, agentId?: string): ExecutionTraceEntry {
  return entry('critique', detail, agentId);
}

export function voteEntry(detail: string, agentId?: string): ExecutionTraceEntry {
  return entry('vote', detail, agentId);
}

export function handoffEntry(detail: string, agentId?: string): ExecutionTraceEntry {
  return entry('handoff', detail, agentId);
}

export function finalEntry(detail: string, agentId?: string): ExecutionTraceEntry {
  return entry('final', detail, agentId);
}

/**
 * Extract a JSON object from a free-text response. Returns null if no
 * parseable JSON found. Tolerant of fenced ```json blocks + leading
 * commentary the model sometimes emits.
 */
export function tryParseJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  const trimmed = text.trim();
  // 1) bare JSON
  const direct = safeParse<T>(trimmed);
  if (direct !== null) return direct;
  // 2) fenced ```json
  const fence = /```(?:json)?\s*\n([\s\S]*?)\n```/m.exec(trimmed);
  if (fence && fence[1]) {
    const inner = safeParse<T>(fence[1]);
    if (inner !== null) return inner;
  }
  // 3) substring scan for the first balanced object
  const start = trimmed.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    for (let i = start; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const slice = trimmed.slice(start, i + 1);
          const parsed = safeParse<T>(slice);
          if (parsed !== null) return parsed;
        }
      }
    }
  }
  return null;
}

function safeParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/**
 * Build an immutable ExecutionResult. The optional `reason` field is
 * omitted entirely (not set to `undefined`) to satisfy
 * `exactOptionalPropertyTypes`.
 */
export function makeExecutionResult(parts: {
  outcome: ExecutionResult['outcome'];
  answer: string;
  trace: ReadonlyArray<ExecutionTraceEntry>;
  usage: TokenUsage;
  brainCalls: number;
  reason?: string;
}): ExecutionResult {
  if (parts.reason !== undefined) {
    return Object.freeze({
      outcome: parts.outcome,
      answer: parts.answer,
      trace: parts.trace,
      usage: parts.usage,
      brainCalls: parts.brainCalls,
      reason: parts.reason,
    });
  }
  return Object.freeze({
    outcome: parts.outcome,
    answer: parts.answer,
    trace: parts.trace,
    usage: parts.usage,
    brainCalls: parts.brainCalls,
  });
}
