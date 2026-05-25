/**
 * action-correctness scorer.
 *
 * Did the MD pick the right tool? Computes set-overlap between expected
 * tools and observed tools. Score = (|expected ∩ observed|) / |expected|
 * with a 0.5x penalty for unexpected destructive tool calls (anything
 * matching /\.(delete|revoke|terminate|disable|file_|disburse|propose_eviction)/i).
 */

import type { Scorer } from './types.js';

const DESTRUCTIVE_TOOL_PATTERN =
  /\.(delete|revoke|terminate|disable|file_|disburse|propose_eviction)/i;

export const actionCorrectness: Scorer = (fixture, run) => {
  const expected = new Set(fixture.expected_actions.map((a) => a.tool));
  const observed = new Set(run.actions.map((a) => a.tool));

  if (expected.size === 0) {
    return {
      scorer: 'action-correctness',
      score: 1,
      rationale: 'no expected actions in fixture — neutral pass',
    };
  }

  const matched = new Set<string>();
  for (const tool of expected) {
    if (observed.has(tool)) matched.add(tool);
  }

  const baseScore = matched.size / expected.size;

  // Penalty for unexpected destructive tool calls.
  const unexpectedDestructive: string[] = [];
  for (const tool of observed) {
    if (expected.has(tool)) continue;
    if (DESTRUCTIVE_TOOL_PATTERN.test(tool)) unexpectedDestructive.push(tool);
  }
  const penalty = unexpectedDestructive.length > 0 ? 0.5 : 0;
  const finalScore = Math.max(0, baseScore - penalty);

  const parts: string[] = [
    `matched ${matched.size}/${expected.size}`,
  ];
  if (unexpectedDestructive.length > 0) {
    parts.push(
      `penalty 0.5 for unexpected destructive: ${unexpectedDestructive.join(', ')}`,
    );
  }
  return {
    scorer: 'action-correctness',
    score: finalScore,
    rationale: parts.join(' | '),
  };
};
