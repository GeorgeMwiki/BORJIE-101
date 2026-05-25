/**
 * BFCL v4 scorers — one strategy per category.
 *
 * All scorers are pure functions. The runner calls the right scorer
 * based on `task.category` and the model's `attempt.producedCall`.
 */

import type { BfclAttempt, BfclGroundTruth, BfclScore, BfclTask } from './types.js';

export function scoreAttempt(task: BfclTask, attempt: BfclAttempt): BfclScore {
  const { category } = task;

  if (category === 'irrelevant') {
    const pass = attempt.producedCall === null;
    return mkScore(task, pass ? 1 : 0, pass, pass ? 'correctly abstained' : 'invoked a tool when none applied');
  }

  if (category === 'multi_turn') {
    return scoreMultiTurn(task, attempt);
  }

  if (category === 'parallel' || category === 'parallel_multiple') {
    return scoreParallel(task, attempt);
  }

  return scoreSingle(task, attempt);
}

// ─── Single-call categories ─────────────────────────────────────────

function scoreSingle(task: BfclTask, attempt: BfclAttempt): BfclScore {
  if (!attempt.producedCall || Array.isArray(attempt.producedCall)) {
    return mkScore(task, 0, false, 'expected a single call; got none or array');
  }
  if (task.groundTruth.kind !== 'expected-call') {
    return mkScore(task, 0, false, 'ground-truth shape mismatch for single category');
  }
  const expectedName = task.groundTruth.toolName;
  const expectedArgs = task.groundTruth.args;
  const got = attempt.producedCall;
  if (got.toolName !== expectedName) {
    return mkScore(task, 0, false, `tool ${got.toolName} != expected ${expectedName}`);
  }
  const argScore = scoreArgs(expectedArgs, got.args);
  const pass = argScore >= 0.99;
  return mkScore(task, argScore, pass, pass ? 'args match' : `args partial (${argScore.toFixed(2)})`);
}

// ─── Parallel categories ────────────────────────────────────────────

function scoreParallel(task: BfclTask, attempt: BfclAttempt): BfclScore {
  if (!Array.isArray(attempt.producedCall)) {
    return mkScore(task, 0, false, 'expected an array of calls');
  }
  if (task.groundTruth.kind !== 'expected-calls') {
    return mkScore(task, 0, false, 'ground-truth shape mismatch for parallel category');
  }
  const expected = task.groundTruth.calls;
  if (expected.length !== attempt.producedCall.length) {
    return mkScore(task, 0, false, `call count mismatch ${attempt.producedCall.length} vs ${expected.length}`);
  }

  // Match by tool name (set semantics — order-independent).
  const expectedByName = new Map(expected.map((e) => [e.toolName, e]));
  let total = 0;
  for (const got of attempt.producedCall) {
    const exp = expectedByName.get(got.toolName);
    if (!exp) {
      return mkScore(task, 0, false, `unexpected tool ${got.toolName}`);
    }
    total += scoreArgs(exp.args, got.args);
    expectedByName.delete(got.toolName);
  }
  const score = expected.length === 0 ? 0 : total / expected.length;
  const pass = score >= 0.99;
  return mkScore(task, score, pass, pass ? 'all parallel calls match' : `partial parallel match (${score.toFixed(2)})`);
}

// ─── Multi-turn category ────────────────────────────────────────────

function scoreMultiTurn(task: BfclTask, attempt: BfclAttempt): BfclScore {
  // The runner is expected to flatten the multi-turn trace into a single
  // attempt whose producedCall is the LAST tool call in the dialogue.
  if (task.groundTruth.kind !== 'multi-turn-trace') {
    return mkScore(task, 0, false, 'ground-truth shape mismatch for multi-turn');
  }
  if (!attempt.producedCall || Array.isArray(attempt.producedCall)) {
    return mkScore(task, 0, false, 'multi-turn requires a final call attempt');
  }
  const last = task.groundTruth.turns[task.groundTruth.turns.length - 1];
  if (!last) return mkScore(task, 0, false, 'multi-turn trace empty');
  if (attempt.producedCall.toolName !== last.toolName) {
    return mkScore(task, 0, false, `final call ${attempt.producedCall.toolName} != expected ${last.toolName}`);
  }
  const score = scoreArgs(last.args, attempt.producedCall.args);
  const pass = score >= 0.95; // multi-turn is graded slightly looser
  return mkScore(task, score, pass, pass ? 'multi-turn closed cleanly' : `multi-turn arg drift (${score.toFixed(2)})`);
}

// ─── Helpers ────────────────────────────────────────────────────────

function scoreArgs(expected: Record<string, unknown>, got: Record<string, unknown>): number {
  const expectedKeys = Object.keys(expected);
  if (expectedKeys.length === 0) {
    return Object.keys(got).length === 0 ? 1 : 0.5;
  }
  let matched = 0;
  for (const k of expectedKeys) {
    if (deepEqual(expected[k], got[k])) matched++;
  }
  // Penalise hallucinated extra keys.
  const extraKeys = Object.keys(got).filter((k) => !(k in expected));
  const penalty = extraKeys.length * 0.1;
  const base = matched / expectedKeys.length;
  return Math.max(0, base - penalty);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a as Record<string, unknown>).sort();
  const kb = Object.keys(b as Record<string, unknown>).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function mkScore(task: BfclTask, score: number, pass: boolean, detail: string): BfclScore {
  return { taskId: task.id, category: task.category, score, pass, detail };
}
