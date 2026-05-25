/**
 * Heuristic-classifier tests. Pure function — no mocks needed.
 *
 * Goals:
 *  - Classify the 5 canonical example intents the task brief lists.
 *  - Reject obvious non-intents with HIGH confidence.
 *  - Reject domain-less messages with MEDIUM confidence so the
 *    caller escalates to the LLM.
 *  - Domain-keyword precedence (HR > Compliance > Operations) for
 *    overlapping words like "leave" / "audit".
 */

import { describe, it, expect } from 'vitest';
import { classifyHeuristic } from '../intent/heuristics.js';

describe('classifyHeuristic — canonical examples', () => {
  it('detects HR / payroll intent', () => {
    const v = classifyHeuristic('we need to track our staff payroll');
    expect(v.classified).not.toBeNull();
    expect(v.classified?.domain).toBe('hr');
    expect(v.classified?.confidence).toBeGreaterThan(0.4);
    expect(v.classified?.proposedTabKey).toMatch(/^hr\./);
  });

  it('detects finance / budget intent', () => {
    const v = classifyHeuristic("I'd like a place to manage our budgets and expenses");
    expect(v.classified?.domain).toBe('finance');
    expect(v.classified?.confidence).toBeGreaterThan(0.3);
  });

  it('detects compliance / ISO intent', () => {
    const v = classifyHeuristic(
      "let's create a new tab for our ISO 27001 compliance evidence",
    );
    expect(v.classified?.domain).toBe('compliance');
    expect(v.classified?.confidence).toBeGreaterThan(0.4);
  });

  it('detects procurement / supplier intent', () => {
    const v = classifyHeuristic(
      'can we set up a new section for our supplier onboarding?',
    );
    expect(v.classified?.domain).toBe('procurement');
    expect(v.classified?.confidence).toBeGreaterThan(0.3);
  });

  it('detects sustainability intent', () => {
    const v = classifyHeuristic(
      'we need to track our scope 2 emissions across the portfolio',
    );
    expect(v.classified?.domain).toBe('sustainability');
  });
});

describe('classifyHeuristic — rejections', () => {
  it('rejects greeting with high confidence', () => {
    const v = classifyHeuristic('hi there, hope you had a good weekend');
    expect(v.classified).toBeNull();
    expect(v.heuristicConfidence).toBeGreaterThan(0.8);
  });

  it('rejects question about existing data', () => {
    const v = classifyHeuristic("what's the rent due this month?");
    expect(v.classified).toBeNull();
    expect(v.heuristicConfidence).toBeGreaterThan(0.8);
  });

  it('rejects empty / whitespace input', () => {
    expect(classifyHeuristic('').classified).toBeNull();
    expect(classifyHeuristic('   ').classified).toBeNull();
  });

  it('rejects bug-report-style complaints', () => {
    const v = classifyHeuristic('the dashboard is slow today, can you fix it?');
    expect(v.classified).toBeNull();
  });

  it('escalates intent-without-domain with medium confidence', () => {
    const v = classifyHeuristic('we need to track our XYZQ things');
    expect(v.classified).toBeNull();
    expect(v.heuristicConfidence).toBeGreaterThan(0.05);
    expect(v.heuristicConfidence).toBeLessThan(0.75);
  });
});

describe('classifyHeuristic — domain precedence', () => {
  it('prefers HR over compliance when "leave" + "employee" co-occur', () => {
    const v = classifyHeuristic(
      'i need a way to track employee leave requests',
    );
    expect(v.classified?.domain).toBe('hr');
  });

  it('produces stable tab keys (lowercase, dotted)', () => {
    const v = classifyHeuristic('let us add a marketing campaign tracker');
    expect(v.classified?.proposedTabKey).toMatch(/^[a-z][a-z0-9._-]*$/);
  });

  it('caps confidence at 1', () => {
    const v = classifyHeuristic(
      "let's create a new tab to track our staff payroll, salaries, and time off please",
    );
    expect(v.classified?.confidence ?? 0).toBeLessThanOrEqual(1);
  });
});
